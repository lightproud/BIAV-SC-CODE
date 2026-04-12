import { useState, useCallback, useRef } from 'react';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import SilverPanel from './components/SilverPanel';
import BPEPanel from './components/BPEPanel';
import SettingsPanel from './components/SettingsPanel';
import ArtifactsPanel from './components/ArtifactsPanel';
import PluginsPanel from './components/PluginsPanel';
import DreamPanel from './components/DreamPanel';
import SentinelPanel from './components/SentinelPanel';
import StatusBar from './components/StatusBar';
import ErrorBoundary from './components/ErrorBoundary';
import type { CiteBlock } from './types';

type RightPanel = 'none' | 'silver' | 'bpe' | 'settings' | 'artifacts' | 'plugins' | 'dream' | 'sentinel';

export default function App() {
  const [rightPanel, setRightPanel] = useState<RightPanel>('none');
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [pendingCites, setPendingCites] = useState<CiteBlock[]>([]);
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);

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

  /**
   * Open the Settings panel (used by ChatView's welcome page).
   */
  const openSettings = useCallback(() => {
    setRightPanel('settings');
  }, []);

  /**
   * Trigger Sidebar to refresh its conversation list (used after auto-title).
   */
  const refreshSidebar = useCallback(() => {
    setSidebarRefreshKey((k) => k + 1);
  }, []);

  return (
    <ErrorBoundary>
      <div className="flex flex-col h-screen bg-bpt-bg text-bpt-text">
        {/* Main area */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <Sidebar
            currentId={currentConversationId}
            refreshKey={sidebarRefreshKey}
            activePanel={rightPanel}
            onSelect={setCurrentConversationId}
            onToggleSilver={() => togglePanel('silver')}
            onToggleBpe={() => togglePanel('bpe')}
            onToggleSettings={() => togglePanel('settings')}
            onToggleArtifacts={() => togglePanel('artifacts')}
            onTogglePlugins={() => togglePanel('plugins')}
            onToggleDream={() => togglePanel('dream')}
            onToggleSentinel={() => togglePanel('sentinel')}
          />

          {/* Chat */}
          <div className="flex-1 flex flex-col min-w-0">
            <ChatView
              conversationId={currentConversationId}
              pendingCites={pendingCites}
              onConsumeCites={consumePendingCites}
              onOpenSettings={openSettings}
              onConversationUpdated={refreshSidebar}
            />
          </div>

          {/* Right panel (Silver / BPE / Settings / etc.) */}
          {rightPanel !== 'none' && (
            <div className="w-80 border-l border-bpt-border flex flex-col overflow-hidden panel-enter">
              {/* Panel close button */}
              <div className="flex items-center justify-end px-2 pt-1">
                <button
                  onClick={() => setRightPanel('none')}
                  className="text-bpt-text-dim hover:text-bpt-text text-xs px-1.5 py-0.5
                             rounded hover:bg-bpt-border/50 transition-colors"
                  title="Close panel"
                >
                  [x]
                </button>
              </div>

              {rightPanel === 'silver' && <SilverPanel />}
              {rightPanel === 'bpe' && (
                <BPEPanel
                  conversationId={currentConversationId}
                  onCite={handleCite}
                />
              )}
              {rightPanel === 'settings' && <SettingsPanel />}
              {rightPanel === 'artifacts' && (
                <ArtifactsPanel conversationId={currentConversationId} />
              )}
              {rightPanel === 'plugins' && <PluginsPanel />}
              {rightPanel === 'dream' && <DreamPanel />}
              {rightPanel === 'sentinel' && <SentinelPanel />}
            </div>
          )}
        </div>

        {/* Status bar */}
        <StatusBar />
      </div>
    </ErrorBoundary>
  );
}
