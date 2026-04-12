import { useState, useCallback, useRef } from 'react';
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

  // Use ref to avoid re-creating the consume callback on every cite change.
  // This prevents ChatView's stream event listener from being re-registered.
  const pendingCitesRef = useRef<CiteBlock[]>([]);
  pendingCitesRef.current = pendingCites;

  const togglePanel = (panel: RightPanel) => {
    setRightPanel((prev) => (prev === panel ? 'none' : panel));
  };

  /**
   * Handle @Cite injection from BPE panel.
   */
  const handleCite = useCallback((cite: CiteBlock) => {
    setPendingCites((prev) => [...prev, cite]);
  }, []);

  /**
   * Consume pending cites. Uses ref so this callback is stable (no deps).
   */
  const consumePendingCites = useCallback((): CiteBlock[] => {
    const cites = pendingCitesRef.current;
    setPendingCites([]);
    return cites;
  }, []);

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
