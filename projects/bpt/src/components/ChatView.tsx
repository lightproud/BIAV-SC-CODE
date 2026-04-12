import { useState, useRef, useEffect, useCallback } from 'react';
import { getBpt } from '../lib/ipc';
import { useGear } from '../lib/hooks';
import GearSwitch from './GearSwitch';
import TokenMeter from './TokenMeter';
import type { Message, ContentBlock, TextBlock, ToolUseBlock, TokenUsage } from '../types';

interface ChatViewProps {
  conversationId: string | null;
}

export default function ChatView({ conversationId }: ChatViewProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [turnUsage, setTurnUsage] = useState<TokenUsage | null>(null);
  const { gear, switchGear } = useGear();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Listen to chat stream events
  useEffect(() => {
    let currentText = '';

    const cleanup = getBpt().onChatStream((event: unknown) => {
      const e = event as Record<string, unknown>;

      if (e.type === 'text_delta') {
        currentText += e.text as string;
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'assistant') {
            const textBlock = last.content.find((b): b is TextBlock => b.type === 'text');
            if (textBlock) {
              textBlock.text = currentText;
            }
            return [...updated];
          }
          return updated;
        });
      } else if (e.type === 'tool_use_start') {
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
            last.content.push(toolBlock);
            return [...updated];
          }
          return updated;
        });
      } else if (e.type === 'message_end') {
        setStreaming(false);
        setTurnUsage(e.usage as TokenUsage);
      } else if (e.type === 'error') {
        setStreaming(false);
        setMessages((prev) => [
          ...prev,
          {
            id: `err_${Date.now()}`,
            role: 'assistant',
            content: [{ type: 'text', text: `Error: ${e.error as string}` }],
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

    const userMsg: Message = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: [{ type: 'text', text }],
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
    await getBpt().chatSend(convId, text, gear);
  }, [input, streaming, conversationId, gear]);

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
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

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
    return <div className="whitespace-pre-wrap">{block.text}</div>;
  }
  if (block.type === 'tool_use') {
    return (
      <div className="my-2 p-2 bg-bpt-bg rounded border border-bpt-border text-xs">
        <span className="text-bpt-accent">Tool: {block.name}</span>
        <pre className="mt-1 text-bpt-text-dim overflow-x-auto">
          {JSON.stringify(block.input, null, 2)}
        </pre>
      </div>
    );
  }
  if (block.type === 'tool_result') {
    return (
      <div className="my-2 p-2 bg-bpt-bg rounded border border-bpt-border text-xs">
        <span className={block.isError ? 'text-bpt-error' : 'text-bpt-success'}>
          Tool Result {block.isError ? '(error)' : ''}
        </span>
        <pre className="mt-1 text-bpt-text-dim overflow-x-auto whitespace-pre-wrap">
          {block.content}
        </pre>
      </div>
    );
  }
  if (block.type === 'cite') {
    return (
      <div className="my-2 p-2 bg-bpt-bg rounded border border-bpt-gold-dim/30 text-xs">
        <span className="text-bpt-gold">@Cite: {block.source}</span>
        {block.lineStart && <span className="text-bpt-text-dim">:{block.lineStart}-{block.lineEnd}</span>}
        <pre className="mt-1 text-bpt-text overflow-x-auto whitespace-pre-wrap">
          {block.text}
        </pre>
      </div>
    );
  }
  return null;
}
