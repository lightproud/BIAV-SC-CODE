import { useState, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import SilverPanel from './components/SilverPanel';
import BPEPanel from './components/BPEPanel';
import SettingsPanel from './components/SettingsPanel';
import StatusBar from './components/StatusBar';
import ErrorBoundary from './components/ErrorBoundary';
import type { CiteBlock } from './types';

type RightPanel = 'none' | 'silver' | 'bpe' | 'settings';

export default function App() {
  const [rightPanel, setRightPanel] = useState<RightPanel>('none');
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [pendingCites, setPendingCites] = useState<CiteBlock[]>([]);

  const togglePanel = (panel: RightPanel) => {
    setRightPanel((prev) => (prev === panel ? 'none' : panel));
  };

  /**
   * Handle @Cite injection from BPE panel.
   * Adds a cite block to pendingCites; ChatView picks it up on next send.
   */
  const handleCite = useCallback((cite: CiteBlock) => {
    setPendingCites((prev) => [...prev, cite]);
  }, []);

  const consumePendingCites = useCallback((): CiteBlock[] => {
    const cites = pendingCites;
    setPendingCites([]);
    return cites;
  }, [pendingCites]);

  return (
    <ErrorBoundary>
      <div className="flex flex-col h-screen bg-bpt-bg text-bpt-text">
        {/* Main area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <Sidebar
            currentId={currentConversationId}
            onSelect={setCurrentConversationId}
            onToggleSilver={() => togglePanel('silver')}
            onToggleBpe={() => togglePanel('bpe')}
            onToggleSettings={() => togglePanel('settings')}
          />

          {/* Chat */}
          <div className="flex-1 flex flex-col min-w-0">
            <ChatView
              conversationId={currentConversationId}
              pendingCites={pendingCites}
              onConsumeCites={consumePendingCites}
            />
          </div>

          {/* Right panel (Silver / BPE / Settings) */}
          {rightPanel !== 'none' && (
            <div className="w-80 border-l border-bpt-border flex flex-col overflow-hidden">
              {rightPanel === 'silver' && <SilverPanel />}
              {rightPanel === 'bpe' && (
                <BPEPanel
                  conversationId={currentConversationId}
                  onCite={handleCite}
                />
              )}
              {rightPanel === 'settings' && <SettingsPanel />}
            </div>
          )}
        </div>

        {/* Status bar */}
        <StatusBar />
      </div>
    </ErrorBoundary>
  );
}
