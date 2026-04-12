/**
 * GearSwitch — 档位切换器 (Chat / Work).
 *
 * Sits next to the input box. Switching gear changes model behavior:
 * Chat = discuss/analyze/advise mode, Work = execute/write/modify mode.
 * This is behavioral steering (like Claude Code's plan mode), not just
 * a tool set toggle.
 *
 * The confirmation dialog only appears on the FIRST switch to Work gear.
 * After that, the user has demonstrated they understand the distinction.
 */

import { useState, useEffect } from 'react';
import { getBpt } from '../lib/ipc';

interface GearSwitchProps {
  gear: 'chat' | 'work';
  onSwitch: (gear: 'chat' | 'work') => void;
}

export default function GearSwitch({ gear, onSwitch }: GearSwitchProps) {
  const [confirmSeen, setConfirmSeen] = useState(false);

  useEffect(() => {
    getBpt().configGet('gearConfirmSeen').then((val: unknown) => {
      if (val === true) setConfirmSeen(true);
    }).catch(() => {});
  }, []);

  const handleClick = () => {
    if (gear === 'chat') {
      // Skip confirmation if the user has already seen it once
      if (confirmSeen) {
        onSwitch('work');
        return;
      }

      const confirmed = window.confirm(
        'Switch to Work gear?\n\n' +
        'Work gear enables execution mode: the model will write code, ' +
        'modify files, and execute commands.\n' +
        'Chat gear is discussion mode: analyze, explain, advise only.\n\n' +
        '(This confirmation only appears once.)',
      );
      if (confirmed) {
        setConfirmSeen(true);
        getBpt().configSet('gearConfirmSeen', true).catch(() => {});
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
