/**
 * SentinelPanel.tsx -- Community monitoring sentinel alerts display.
 *
 * Why separate from DreamPanel: Sentinel is about community health monitoring
 * (Steam reviews, Discord activity, negative keyword spikes). Dream is about
 * codebase structural health. Different audiences and urgency levels.
 *
 * The sentinel scans run as part of dream.py's shallow sleep tier (every 6h).
 * Alerts are embedded in dream reports but this panel presents them focused
 * on the monitoring use case.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getBpt } from '../lib/ipc';

interface SentinelAlert {
  level: 'red' | 'orange' | 'yellow';
  source: string;
  metric: string;
  message: string;
  current: number;
  baseline: number;
}

interface DreamReportEntry {
  date: string;
  issues: number;
  alertCount: number;
}

interface DreamReport {
  date: string;
  timestamp: string;
  phase1: {
    issues: number;
    checks: Record<string, unknown>;
    sentinel?: {
      alerts: SentinelAlert[];
      alert_count: number;
    };
  };
}

export default function SentinelPanel() {
  const [latestAlerts, setLatestAlerts] = useState<SentinelAlert[]>([]);
  const [history, setHistory] = useState<Array<{ date: string; alerts: SentinelAlert[] }>>([]);
  const [loading, setLoading] = useState(true);
  const cancelledRef = useRef(false);

  const loadData = useCallback(async () => {
    cancelledRef.current = false;
    setLoading(true);
    try {
      // Get latest alerts
      const alerts = await getBpt().sentinelAlerts() as SentinelAlert[];
      if (cancelledRef.current) return;
      setLatestAlerts(Array.isArray(alerts) ? alerts : []);

      // Get report list to build alert history
      const reports = await getBpt().dreamList() as DreamReportEntry[];
      if (cancelledRef.current) return;
      const reportsWithAlerts = (Array.isArray(reports) ? reports : [])
        .filter((r) => r.alertCount > 0)
        .slice(0, 10); // Last 10 reports with alerts

      const historyEntries: Array<{ date: string; alerts: SentinelAlert[] }> = [];
      for (const entry of reportsWithAlerts) {
        if (cancelledRef.current) return;
        const report = await getBpt().dreamGet(entry.date) as DreamReport | null;
        if (report?.phase1.sentinel?.alerts) {
          historyEntries.push({
            date: entry.date,
            alerts: report.phase1.sentinel.alerts,
          });
        }
      }
      if (cancelledRef.current) return;
      setHistory(historyEntries);
    } catch {
      if (cancelledRef.current) return;
      setLatestAlerts([]);
      setHistory([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
    return () => { cancelledRef.current = true; };
  }, [loadData]);

  const levelStyle = (level: string): { dot: string; text: string; bg: string } => {
    switch (level) {
      case 'red': return {
        dot: 'bg-bpt-error',
        text: 'text-bpt-error',
        bg: 'bg-bpt-error/10 border-bpt-error/20',
      };
      case 'orange': return {
        dot: 'bg-bpt-warning',
        text: 'text-bpt-warning',
        bg: 'bg-bpt-warning/10 border-bpt-warning/20',
      };
      case 'yellow': return {
        dot: 'bg-bpt-gold',
        text: 'text-bpt-gold',
        bg: 'bg-bpt-gold/10 border-bpt-gold/20',
      };
      default: return {
        dot: 'bg-bpt-text-dim',
        text: 'text-bpt-text-dim',
        bg: 'bg-bpt-border/50 border-bpt-border',
      };
    }
  };

  const sourceIcon = (source: string): string => {
    switch (source) {
      case 'steam': return 'S';
      case 'bilibili': return 'B';
      case 'discord': return 'D';
      default: return '?';
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-bpt-border">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-bpt-gold">Sentinel</h2>
            <p className="text-xs text-bpt-text-dim mt-0.5">
              Community health monitoring
            </p>
          </div>
          <button
            onClick={() => loadData()}
            disabled={loading}
            className="px-2 py-1 text-[10px] border border-bpt-border rounded
              hover:bg-bpt-border/50 transition-colors disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <p className="p-4 text-xs text-bpt-text-dim text-center">Loading...</p>
        )}

        {/* Current status */}
        {!loading && (
          <div className="px-3 py-3 border-b border-bpt-border">
            <div className="text-[10px] font-medium text-bpt-text-dim mb-2">
              CURRENT STATUS
            </div>
            {latestAlerts.length === 0 ? (
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-bpt-success" />
                <span className="text-xs text-bpt-success">All clear</span>
                <span className="text-[10px] text-bpt-text-dim">
                  No active alerts
                </span>
              </div>
            ) : (
              <div className="space-y-2">
                {latestAlerts.map((alert, i) => {
                  const style = levelStyle(alert.level);
                  return (
                    <div
                      key={i}
                      className={`px-2.5 py-2 rounded border ${style.bg}`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={`w-2 h-2 rounded-full ${style.dot}`} />
                        <span className={`text-[10px] font-bold ${style.text}`}>
                          {alert.level.toUpperCase()}
                        </span>
                        <span className="text-[10px] px-1 bg-bpt-border/50 rounded text-bpt-text-dim">
                          {sourceIcon(alert.source)} {alert.source}
                        </span>
                      </div>
                      <p className="text-[11px] text-bpt-text">
                        {alert.message}
                      </p>
                      <div className="flex gap-3 mt-1 text-[9px] text-bpt-text-dim">
                        <span>Metric: {alert.metric}</span>
                        <span>Current: {alert.current}</span>
                        <span>Baseline: {alert.baseline}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Alert history */}
        {!loading && history.length > 0 && (
          <div className="px-3 py-3">
            <div className="text-[10px] font-medium text-bpt-text-dim mb-2">
              ALERT HISTORY
            </div>
            {history.map((entry) => (
              <div key={entry.date} className="mb-3">
                <div className="text-[10px] text-bpt-text-dim mb-1">
                  {entry.date}
                </div>
                {entry.alerts.map((alert, i) => {
                  const style = levelStyle(alert.level);
                  return (
                    <div
                      key={i}
                      className="flex items-start gap-1.5 mb-1 pl-2"
                    >
                      <span className={`w-1.5 h-1.5 rounded-full mt-1 flex-shrink-0 ${style.dot}`} />
                      <div>
                        <span className={`text-[9px] font-medium ${style.text}`}>
                          {alert.level}
                        </span>
                        <span className="text-[9px] text-bpt-text-dim ml-1">
                          {alert.source}
                        </span>
                        <p className="text-[10px] text-bpt-text">
                          {alert.message}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        {!loading && history.length === 0 && latestAlerts.length === 0 && (
          <p className="p-4 text-xs text-bpt-text-dim text-center">
            No alerts recorded. Sentinel scans run every 6 hours via GitHub Actions.
          </p>
        )}
      </div>

      {/* Footer — monitoring sources */}
      <div className="p-2 border-t border-bpt-border">
        <div className="flex justify-center gap-3 text-[9px] text-bpt-text-dim">
          <span>S Steam</span>
          <span>B Bilibili</span>
          <span>D Discord</span>
        </div>
      </div>
    </div>
  );
}
