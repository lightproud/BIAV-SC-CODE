/**
 * dream-reader.ts -- Read dream agent reports and sentinel data from filesystem.
 *
 * Why filesystem reads instead of IPC to Python: Dream reports are static JSON
 * files written by the GitHub Actions dream.yml workflow. They live in
 * memory/dreams/ under the repo root. No Python subprocess needed -- just
 * read the JSON files directly.
 */

import path from 'node:path';
import fs from 'node:fs';
import { getConfig } from '../core/config';

// ── Types matching memory/dreams/*.json format ─────────────────

export interface DreamCheckSection {
  lines: string[];
  issues: number;
}

export interface SentinelAlert {
  level: 'red' | 'orange' | 'yellow';
  source: string;
  metric: string;
  message: string;
  current: number;
  baseline: number;
}

export interface DreamReport {
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

export interface DreamInsight {
  id: string;
  type: 'trend' | 'gap' | 'anomaly' | 'pattern';
  summary: string;
  evidence: string[];
  suggested_action: string;
  auto_actionable: boolean;
}

export interface InsightsLibrary {
  meta: {
    description: string;
    created_at: string;
    schema_version: number;
  };
  insights: DreamInsight[];
}

/** Summary entry for report listing (no full content). */
export interface DreamReportEntry {
  date: string;
  issues: number;
  alertCount: number;
}

// ── Helpers ─────────────────────────────────────────────────────

function getDreamsDir(): string {
  const repoRoot = getConfig('repoRoot') as string;
  const base = repoRoot || process.cwd();
  return path.join(base, 'memory', 'dreams');
}

const EMPTY_INSIGHTS: InsightsLibrary = {
  meta: { description: '', created_at: '', schema_version: 1 },
  insights: [],
};

// ── Public API ──────────────────────────────────────────────────

/** List all dream reports, most recent first. */
export function listDreamReports(): DreamReportEntry[] {
  const dir = getDreamsDir();
  if (!fs.existsSync(dir)) return [];

  const files = fs.readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
    .reverse();

  return files.map((f) => {
    try {
      const content = fs.readFileSync(path.join(dir, f), 'utf-8');
      const report = JSON.parse(content) as DreamReport;
      return {
        date: report.date,
        issues: report.phase1.issues,
        alertCount: report.phase1.sentinel?.alert_count ?? 0,
      };
    } catch {
      return { date: f.replace('.json', ''), issues: -1, alertCount: 0 };
    }
  });
}

/** Get a specific dream report by date (YYYY-MM-DD). */
export function getDreamReport(date: string): DreamReport | null {
  // Validate date format to prevent path traversal
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const filePath = path.join(getDreamsDir(), `${date}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as DreamReport;
  } catch {
    return null;
  }
}

/** Get the most recent dream report. */
export function getLatestDreamReport(): DreamReport | null {
  const reports = listDreamReports();
  if (reports.length === 0) return null;
  return getDreamReport(reports[0].date);
}

/** Get the insights library. */
export function getDreamInsights(): InsightsLibrary {
  const filePath = path.join(getDreamsDir(), 'insights.json');
  if (!fs.existsSync(filePath)) return EMPTY_INSIGHTS;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as InsightsLibrary;
  } catch {
    return EMPTY_INSIGHTS;
  }
}

/** Get sentinel alerts from the latest report. */
export function getLatestSentinelAlerts(): SentinelAlert[] {
  const report = getLatestDreamReport();
  if (!report) return [];
  return report.phase1.sentinel?.alerts ?? [];
}
