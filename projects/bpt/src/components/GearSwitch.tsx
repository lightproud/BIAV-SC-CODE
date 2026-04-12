/**
 * GearSwitch — 档位切换器 (Chat / Work).
 *
 * Sits next to the input box. Switching gear changes the active tool set.
 * Work gear shows a cost warning before activating.
 */

interface GearSwitchProps {
  gear: 'chat' | 'work';
  onSwitch: (gear: 'chat' | 'work') => void;
}

export default function GearSwitch({ gear, onSwitch }: GearSwitchProps) {
  const handleClick = () => {
    if (gear === 'chat') {
      // Switching to work gear — show cost implication
      const confirmed = window.confirm(
        'Switch to Work gear?\n\n' +
        'Work gear loads additional tools (~2.5k extra tokens/turn).\n' +
        'Use it for writing code, modifying files, and executing commands.',
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
        ? 'Chat mode: lightweight tools (~1.5k tokens/turn)'
        : 'Work mode: full tools (~4k tokens/turn)'}
    >
      {gear === 'chat' ? 'Chat' : 'Work'}
    </button>
  );
}
