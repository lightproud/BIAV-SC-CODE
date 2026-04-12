import { useState } from 'react';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import SilverPanel from './components/SilverPanel';
import BPEPanel from './components/BPEPanel';
import StatusBar from './components/StatusBar';

type RightPanel = 'none' | 'silver' | 'bpe';

export default function App() {
  const [rightPanel, setRightPanel] = useState<RightPanel>('none');
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);

  const togglePanel = (panel: RightPanel) => {
    setRightPanel((prev) => (prev === panel ? 'none' : panel));
  };

  return (
    <div className="flex flex-col h-screen bg-bpt-bg text-bpt-text">
      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          currentId={currentConversationId}
          onSelect={setCurrentConversationId}
          onToggleSilver={() => togglePanel('silver')}
          onToggleBpe={() => togglePanel('bpe')}
        />

        {/* Chat */}
        <div className="flex-1 flex flex-col min-w-0">
          <ChatView conversationId={currentConversationId} />
        </div>

        {/* Right panel (Silver / BPE) */}
        {rightPanel !== 'none' && (
          <div className="w-80 border-l border-bpt-border flex flex-col overflow-hidden">
            {rightPanel === 'silver' && <SilverPanel />}
            {rightPanel === 'bpe' && <BPEPanel />}
          </div>
        )}
      </div>

      {/* Status bar */}
      <StatusBar />
    </div>
  );
}
