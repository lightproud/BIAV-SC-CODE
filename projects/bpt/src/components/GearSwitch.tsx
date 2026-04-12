/**
 * GearSwitch — 档位切换器 (Chat / Work).
 *
 * Sits next to the input box. Switching gear changes model behavior:
 * Chat = discuss/analyze/advise mode, Work = execute/write/modify mode.
 * This is behavioral steering (like Claude Code's plan mode), not just
 * a tool set toggle.
 */

interface GearSwitchProps {
  gear: 'chat' | 'work';
  onSwitch: (gear: 'chat' | 'work') => void;
}

export default function GearSwitch({ gear, onSwitch }: GearSwitchProps) {
  const handleClick = () => {
    if (gear === 'chat') {
      // Switching to work gear — confirm mode change
      const confirmed = window.confirm(
        'Switch to Work gear?\n\n' +
        'Work gear enables execution mode: the model will write code, ' +
        'modify files, and execute commands.\n' +
        'Chat gear is discussion mode: analyze, explain, advise only.',
      );
      if (confirmed) {
        onSwitch('work');
      }
    } else {
      onSwitch('chat');
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`px-2 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
        gear === 'chat'
          ? 'bg-bpt-accent/20 text-bpt-accent'
          : 'bg-bpt-warning/20 text-bpt-warning'
      }`}
      title={gear === 'chat'
        ? 'Chat mode: discuss, analyze, advise'
        : 'Work mode: write code, modify files, execute'}
    >
      {gear === 'chat' ? 'Chat' : 'Work'}
    </button>
  );
}
