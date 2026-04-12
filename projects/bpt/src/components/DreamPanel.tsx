/**
 * DreamPanel.tsx -- Dream agent report visualization.
 *
 * Why: The dream agent (scripts/dream.py) runs on GitHub Actions and produces
 * daily health check reports (memory/dreams/YYYY-MM-DD.json). This panel
 * lets users browse those reports without leaving BPT -- see structural issues,
 * stale files, broken references, and accumulated insights.
 */

import { useState, useEffect, useCallback } from 'react';
import { getBpt } from '../lib/ipc';

interface DreamCheckSection {
  lines: string[];
  issues: number;
}

interface DreamReport {
  date: string;
  timestamp: string;
  phase1: {
    issues: number;
    checks: {
      staleness: DreamCheckSection;
      references: DreamCheckSection;
      decisions: DreamCheckSection;
      lessons: DreamCheckSection;
      memory_size: DreamCheckSection;
    };
    sentinel?: {
      alerts: SentinelAlert[];
      alert_count: number;
    };
  };
}

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

interface DreamInsight {
  id: string;
  type: 'trend' | 'gap' | 'anomaly' | 'pattern';
  summary: string;
  evidence: string[];
  suggested_action: string;
  auto_actionable: boolean;
}

interface InsightsLibrary {
  meta: { description: string; created_at: string; schema_version: number };
  insights: DreamInsight[];
}

type ViewMode = 'reports' | 'insights';

export default function DreamPanel() {
  const [reports, setReports] = useState<DreamReportEntry[]>([]);
  const [selectedReport, setSelectedReport] = useState<DreamReport | null>(null);
  const [insights, setInsights] = useState<InsightsLibrary | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('reports');
  const [loading, setLoading] = useState(false);

  const loadReports = useCallback(async () => {
    try {
      const list = await getBpt().dreamList() as DreamReportEntry[];
      setReports(Array.isArray(list) ? list : []);
    } catch {
      setReports([]);
    }
  }, []);

  const loadInsights = useCallback(async () => {
    try {
      const lib = await getBpt().dreamInsights() as InsightsLibrary;
      setInsights(lib);
    } catch {
      setInsights(null);
    }
  }, []);

  useEffect(() => {
    loadReports();
    loadInsights();
  }, [loadReports, loadInsights]);

  const handleSelectReport = async (date: string) => {
    setLoading(true);
    try {
      const report = await getBpt().dreamGet(date) as DreamReport | null;
      setSelectedReport(report);
    } catch {
      setSelectedReport(null);
    }
    setLoading(false);
  };

  const checkIcon = (issues: number) => {
    if (issues === 0) return 'bg-bpt-success';
    if (issues < 3) return 'bg-bpt-warning';
    return 'bg-bpt-error';
  };

  const insightTypeColor = (type: string) => {
    switch (type) {
      case 'trend': return 'text-bpt-accent';
      case 'gap': return 'text-bpt-warning';
      case 'anomaly': return 'text-bpt-error';
      case 'pattern': return 'text-bpt-gold';
      default: return 'text-bpt-text-dim';
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-bpt-border">
        <h2 className="text-sm font-bold text-bpt-gold">Dream Agent</h2>
        <p className="text-xs text-bpt-text-dim mt-0.5">
          Health checks, insights, and structural analysis
        </p>
        {/* View mode tabs */}
        <div className="flex gap-1 mt-2">
          <button
            onClick={() => setViewMode('reports')}
            className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
              viewMode === 'reports'
                ? 'bg-bpt-border text-bpt-text'
                : 'text-bpt-text-dim hover:text-bpt-text'
            }`}
          >
            Reports ({reports.length})
          </button>
          <button
            onClick={() => setViewMode('insights')}
            className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
              viewMode === 'insights'
                ? 'bg-bpt-border text-bpt-text'
                : 'text-bpt-text-dim hover:text-bpt-text'
            }`}
          >
            Insights ({insights?.insights.length ?? 0})
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {viewMode === 'reports' && (
          <>
            {/* Report detail view */}
            {selectedReport && (
              <div className="border-b border-bpt-border">
                <div className="px-3 py-2 flex items-center justify-between">
                  <span className="text-xs font-medium text-bpt-text">
                    {selectedReport.date}
                  </span>
                  <button
                    onClick={() => setSelectedReport(null)}
                    className="text-[10px] text-bpt-text-dim hover:text-bpt-text"
                  >
                    Close
                  </button>
                </div>

                {/* Issue summary */}
                <div className="px-3 pb-2">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`w-2 h-2 rounded-full ${checkIcon(selectedReport.phase1.issues)}`} />
                    <span className="text-[11px] text-bpt-text">
                      {selectedReport.phase1.issues} issue{selectedReport.phase1.issues !== 1 ? 's' : ''} found
                    </span>
                  </div>

                  {/* Check sections */}
                  {Object.entries(selectedReport.phase1.checks).map(([key, section]) => (
                    <CheckSection key={key} name={key} section={section} />
                  ))}

                  {/* Sentinel alerts within report */}
                  {selectedReport.phase1.sentinel && selectedReport.phase1.sentinel.alerts.length > 0 && (
                    <div className="mt-2">
                      <div className="text-[10px] font-medium text-bpt-warning mb-1">
                        Sentinel Alerts ({selectedReport.phase1.sentinel.alert_count})
                      </div>
                      {selectedReport.phase1.sentinel.alerts.map((alert, i) => (
                        <AlertRow key={i} alert={alert} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Report list */}
            {loading && (
              <p className="p-3 text-xs text-bpt-text-dim">Loading...</p>
            )}
            {reports.length === 0 && !loading && (
              <p className="p-4 text-xs text-bpt-text-dim text-center">
                No dream reports found. Check repoRoot in Settings.
              </p>
            )}
            {reports.map((entry) => (
              <button
                key={entry.date}
                onClick={() => handleSelectReport(entry.date)}
                className={`w-full px-3 py-2 text-left border-b border-bpt-border/50
                  hover:bg-bpt-border/30 transition-colors ${
                  selectedReport?.date === entry.date ? 'bg-bpt-border/50' : ''
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-bpt-text">{entry.date}</span>
                  <div className="flex items-center gap-2">
                    {entry.alertCount > 0 && (
                      <span className="text-[9px] px-1 py-0.5 bg-bpt-error/10 text-bpt-error rounded">
                        {entry.alertCount} alert{entry.alertCount > 1 ? 's' : ''}
                      </span>
                    )}
                    <span className={`w-1.5 h-1.5 rounded-full ${checkIcon(entry.issues)}`} />
                    <span className="text-[10px] text-bpt-text-dim">
                      {entry.issues} issue{entry.issues !== 1 ? 's' : ''}
                    </span>
                  </div>
                </div>
              </button>
            ))}
          </>
        )}

        {viewMode === 'insights' && (
          <>
            {(!insights || insights.insights.length === 0) && (
              <p className="p-4 text-xs text-bpt-text-dim text-center">
                No insights accumulated yet. Deep/REM sleep cycles produce insights.
              </p>
            )}
            {insights?.insights.map((insight) => (
              <div key={insight.id} className="px-3 py-3 border-b border-bpt-border/50">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className={`text-[10px] font-medium ${insightTypeColor(insight.type)}`}>
                    [{insight.type}]
                  </span>
                  {insight.auto_actionable && (
                    <span className="text-[9px] px-1 bg-bpt-success/10 text-bpt-success rounded">
                      actionable
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-bpt-text">{insight.summary}</p>
                {insight.suggested_action && (
                  <p className="text-[10px] text-bpt-gold-dim mt-1">
                    {insight.suggested_action}
                  </p>
                )}
                {insight.evidence.length > 0 && (
                  <div className="mt-1 text-[9px] text-bpt-text-dim">
                    {insight.evidence.join(' | ')}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="p-2 border-t border-bpt-border text-[10px] text-bpt-text-dim text-center">
        Reports from memory/dreams/ (read-only)
      </div>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────────────

function CheckSection({ name, section }: { name: string; section: DreamCheckSection }) {
  const [expanded, setExpanded] = useState(false);
  const label = name.replace(/_/g, ' ');

  return (
    <div className="mb-1">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-2 py-1 rounded
          hover:bg-bpt-border/30 transition-colors"
      >
        <span className="text-[10px] text-bpt-text-dim capitalize">{label}</span>
        <div className="flex items-center gap-1">
          <span className={`w-1.5 h-1.5 rounded-full ${
            section.issues === 0 ? 'bg-bpt-success' : 'bg-bpt-warning'
          }`} />
          <span className="text-[9px] text-bpt-text-dim">
            {section.issues}
          </span>
          <span className="text-[9px] text-bpt-text-dim">
            {expanded ? '^' : 'v'}
          </span>
        </div>
      </button>
      {expanded && section.lines.length > 0 && (
        <div className="ml-2 mt-0.5 space-y-0.5">
          {section.lines.map((line, i) => {
            const trimmed = line.trim();
            const isOk = trimmed.startsWith('- ok');
            const isError = trimmed.startsWith('- x');
            const isWarning = trimmed.startsWith('- ~') || trimmed.startsWith('- ?');
            return (
              <div
                key={i}
                className={`text-[9px] px-1 py-0.5 rounded ${
                  isError ? 'text-bpt-error bg-bpt-error/5' :
                  isWarning ? 'text-bpt-warning bg-bpt-warning/5' :
                  isOk ? 'text-bpt-text-dim' :
                  'text-bpt-text-dim'
                }`}
              >
                {trimmed}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AlertRow({ alert }: { alert: SentinelAlert }) {
  const levelColor = {
    red: 'bg-bpt-error text-bpt-error',
    orange: 'bg-bpt-warning text-bpt-warning',
    yellow: 'bg-bpt-gold text-bpt-gold',
  }[alert.level] ?? 'bg-bpt-text-dim text-bpt-text-dim';

  const [dotColor, textColor] = levelColor.split(' ');

  return (
    <div className="px-2 py-1.5 mb-0.5 rounded bg-bpt-border/20">
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
        <span className={`text-[10px] font-medium ${textColor}`}>
          {alert.level.toUpperCase()}
        </span>
        <span className="text-[9px] text-bpt-text-dim">
          {alert.source}
        </span>
      </div>
      <p className="text-[10px] text-bpt-text mt-0.5">{alert.message}</p>
    </div>
  );
}
