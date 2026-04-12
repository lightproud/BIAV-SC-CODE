import { useState, useRef, useEffect, useCallback } from 'react';
import { getBpt } from '../lib/ipc';
import { useGear } from '../lib/hooks';
import GearSwitch from './GearSwitch';
import TokenMeter from './TokenMeter';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Message, ContentBlock, ToolUseBlock, ToolResultBlock, CiteBlock, TokenUsage } from '../types';

interface ChatViewProps {
  conversationId: string | null;
  pendingCites?: CiteBlock[];
  onConsumeCites?: () => CiteBlock[];
}

export default function ChatView({ conversationId, pendingCites, onConsumeCites }: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [turnUsage, setTurnUsage] = useState<TokenUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { gear, switchGear } = useGear();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Track current text accumulation across stream events.
  // Stored as ref so stream callback always sees latest value.
  const currentTextRef = useRef('');
  // Track accumulated tool input JSON during streaming
  const toolInputRef = useRef('');

  // Load persisted messages when conversation changes
  useEffect(() => {
    setTurnUsage(null);
    setError(null);
    currentTextRef.current = '';
    toolInputRef.current = '';

    if (!conversationId) {
      setMessages([]);
      return;
    }

    // Load history from SQLite via main process
    getBpt().convLoadMessages(conversationId).then((loaded) => {
      const msgs = loaded as Message[];
      if (Array.isArray(msgs) && msgs.length > 0) {
        setMessages(msgs);
      } else {
        setMessages([]);
      }
    }).catch(() => {
      setMessages([]);
    });
  }, [conversationId]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Listen to chat stream events
  useEffect(() => {
    const cleanup = getBpt().onChatStream((event: unknown) => {
      const e = event as Record<string, unknown>;
      const eventType = e.type as string;

      if (eventType === 'text_delta') {
        currentTextRef.current += e.text as string;
        const textSnapshot = currentTextRef.current;
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') {
            // Update the LAST text block in the assistant message
            const lastContent = [...last.content];
            for (let i = lastContent.length - 1; i >= 0; i--) {
              if (lastContent[i].type === 'text') {
                lastContent[i] = { type: 'text', text: textSnapshot };
                break;
              }
            }
            return [...updated.slice(0, -1), { ...last, content: lastContent }];
          }
          return updated;
        });
      } else if (eventType === 'tool_use_start') {
        toolInputRef.current = '';
        const toolBlock: ToolUseBlock = {
          type: 'tool_use',
          id: e.id as string,
          name: e.name as string,
          input: {},
        };
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') {
            return [...updated.slice(0, -1), {
              ...last,
              content: [...last.content, toolBlock],
            }];
          }
          return updated;
        });
      } else if (eventType === 'tool_use_delta') {
        toolInputRef.current += e.text as string;
        const inputSnapshot = toolInputRef.current;
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') {
            const lastContent = [...last.content];
            // Find the last tool_use block and update its input
            for (let i = lastContent.length - 1; i >= 0; i--) {
              if (lastContent[i].type === 'tool_use') {
                const tool = lastContent[i] as ToolUseBlock;
                lastContent[i] = {
                  ...tool,
                  input: safeParse(inputSnapshot),
                };
                break;
              }
            }
            return [...updated.slice(0, -1), { ...last, content: lastContent }];
          }
          return updated;
        });
      } else if (eventType === 'tool_use_end') {
        // Final parse of tool input
        const finalInput = toolInputRef.current;
        toolInputRef.current = '';
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') {
            const lastContent = [...last.content];
            for (let i = lastContent.length - 1; i >= 0; i--) {
              if (lastContent[i].type === 'tool_use') {
                const tool = lastContent[i] as ToolUseBlock;
                lastContent[i] = {
                  ...tool,
                  input: safeParse(finalInput),
                };
                break;
              }
            }
            return [...updated.slice(0, -1), { ...last, content: lastContent }];
          }
          return updated;
        });
      } else if (eventType === 'tool_result') {
        // Tool execution completed — add result block to current assistant message
        const resultBlock: ToolResultBlock = {
          type: 'tool_result',
          toolUseId: e.toolUseId as string,
          content: e.content as string,
          isError: e.isError as boolean,
        };
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') {
            return [...updated.slice(0, -1), {
              ...last,
              content: [...last.content, resultBlock],
            }];
          }
          return updated;
        });
      } else if (eventType === 'assistant_continue') {
        // LLM is continuing after tool results — add a new text block
        currentTextRef.current = '';
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') {
            return [...updated.slice(0, -1), {
              ...last,
              content: [...last.content, { type: 'text' as const, text: '' }],
            }];
          }
          return updated;
        });
      } else if (eventType === 'message_end') {
        setStreaming(false);
        setTurnUsage(e.usage as TokenUsage);
      } else if (eventType === 'error') {
        setStreaming(false);
        setError(e.error as string);
        setMessages((prev) => [
          ...prev,
          {
            id: `err_${Date.now()}`,
            role: 'assistant' as const,
            content: [{ type: 'text' as const, text: `Error: ${e.error as string}` }],
            timestamp: Date.now(),
          },
        ]);
      }
    });

    return cleanup;
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || streaming) return;

    setError(null);
    currentTextRef.current = '';
    toolInputRef.current = '';

    // Collect any pending @Cite blocks
    const cites: CiteBlock[] = onConsumeCites ? onConsumeCites() : [];

    // Build user message content: cites first, then text
    const userContent: ContentBlock[] = [
      ...cites,
      { type: 'text', text },
    ];

    const userMsg: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: userContent,
      timestamp: Date.now(),
    };

    const assistantMsg: Message = {
      id: `msg_${Date.now() + 1}`,
      role: 'assistant',
      content: [{ type: 'text', text: '' }],
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setStreaming(true);
    setTurnUsage(null);

    const convId = conversationId ?? `temp_${Date.now()}`;

    // Build the text to send to main process.
    // If there are cites, prepend them as context.
    let messageForLlm = text;
    if (cites.length > 0) {
      const citeTexts = cites.map((c) => {
        const loc = c.lineStart != null ? `:${c.lineStart}-${c.lineEnd}` : '';
        return `@Cite ${c.source}${loc}\n\`\`\`\n${c.text}\n\`\`\``;
      });
      messageForLlm = citeTexts.join('\n\n') + '\n\n' + text;
    }

    await getBpt().chatSend(convId, messageForLlm, gear);
  }, [input, streaming, conversationId, gear, onConsumeCites]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Token meter */}
      <TokenMeter usage={turnUsage} />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex items-center justify-center h-full text-bpt-text-dim">
            <div className="text-center">
              <p className="text-lg text-bpt-gold">BPT</p>
              <p className="text-sm mt-1">Black Pool Terminal — ready</p>
              <p className="text-xs mt-3 text-bpt-text-dim max-w-sm">
                Configure your API endpoint in Settings (sidebar) to start chatting.
              </p>
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mb-2 p-2 bg-bpt-error/10 border border-bpt-error/30 rounded text-xs text-bpt-error">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* Pending cites */}
      {pendingCites && pendingCites.length > 0 && (
        <div className="mx-4 mb-1 flex flex-wrap gap-1">
          {pendingCites.map((cite, i) => (
            <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-bpt-gold/10 border border-bpt-gold-dim/30 rounded text-[10px] text-bpt-gold">
              @{cite.source.split('/').pop()}
              {cite.lineStart != null && `:${cite.lineStart}`}
            </span>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-bpt-border p-3">
        <div className="flex items-end gap-2">
          <GearSwitch gear={gear} onSwitch={switchGear} />
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={streaming ? 'Waiting for response...' : 'Type a message...'}
            disabled={streaming}
            rows={1}
            className="flex-1 bg-bpt-surface border border-bpt-border rounded-lg px-3 py-2 text-sm
                       resize-none focus:outline-none focus:border-bpt-gold-dim
                       disabled:opacity-50 placeholder:text-bpt-text-dim"
          />
          <button
            onClick={streaming ? () => getBpt().chatAbort() : handleSend}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              streaming
                ? 'bg-bpt-error/20 text-bpt-error hover:bg-bpt-error/30'
                : 'bg-bpt-gold/20 text-bpt-gold hover:bg-bpt-gold/30'
            }`}
          >
            {streaming ? 'Stop' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Message rendering ──────────────────────────────────────────────

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-lg px-4 py-2 text-sm ${
          isUser
            ? 'bg-bpt-gold/10 text-bpt-text'
            : 'bg-bpt-surface text-bpt-text'
        }`}
      >
        {message.content.map((block, i) => (
          <ContentBlockView key={i} block={block} />
        ))}
      </div>
    </div>
  );
}

function ContentBlockView({ block }: { block: ContentBlock }) {
  if (block.type === 'text') {
    if (!block.text) return null;
    return (
      <div className="prose prose-invert prose-sm max-w-none break-words">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown>
      </div>
    );
  }
  if (block.type === 'tool_use') {
    return (
      <div className="my-2 p-2 bg-bpt-bg rounded border border-bpt-border text-xs">
        <div className="flex items-center gap-1.5 mb-1">
          <span className="w-1.5 h-1.5 rounded-full bg-bpt-accent animate-pulse" />
          <span className="text-bpt-accent font-medium">{block.name}</span>
        </div>
        {Object.keys(block.input).length > 0 && (
          <pre className="mt-1 text-bpt-text-dim overflow-x-auto whitespace-pre-wrap text-[11px]">
            {JSON.stringify(block.input, null, 2)}
          </pre>
        )}
      </div>
    );
  }
  if (block.type === 'tool_result') {
    return (
      <div className={`my-2 p-2 bg-bpt-bg rounded border text-xs ${
        block.isError ? 'border-bpt-error/30' : 'border-bpt-success/30'
      }`}>
        <span className={block.isError ? 'text-bpt-error' : 'text-bpt-success'}>
          {block.isError ? 'Tool Error' : 'Tool Result'}
        </span>
        <pre className="mt-1 text-bpt-text-dim overflow-x-auto whitespace-pre-wrap text-[11px] max-h-40 overflow-y-auto">
          {block.content}
        </pre>
      </div>
    );
  }
  if (block.type === 'cite') {
    return (
      <div className="my-2 p-2 bg-bpt-bg rounded border border-bpt-gold-dim/30 text-xs">
        <span className="text-bpt-gold">@Cite: {block.source}</span>
        {block.lineStart != null && (
          <span className="text-bpt-text-dim">:{block.lineStart}-{block.lineEnd}</span>
        )}
        <pre className="mt-1 text-bpt-text overflow-x-auto whitespace-pre-wrap text-[11px] max-h-40 overflow-y-auto">
          {block.text}
        </pre>
      </div>
    );
  }
  return null;
}

function safeParse(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch (err) {
    // Log parse failures for debugging — partial JSON during streaming is expected,
    // but complete failures at tool_use_end indicate a real problem
    console.warn('[ChatView] Failed to parse tool input JSON:', {
      preview: json.slice(0, 100),
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}
