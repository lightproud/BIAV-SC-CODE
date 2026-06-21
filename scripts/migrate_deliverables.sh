#!/usr/bin/env bash
# 一次性迁移：deliverables/ -> Public-Info-Pool/Resource/{类型}/
# 命名按强约定 {主题}-{日期}[-rN].{ext}；_v2->-r2、_full->主题变体段；下划线->连字符；
# dateless 历史文件用所在月目录作月精度日期(YYYYMM，真实非捏造日)。
# 多文件捆绑(game-data-analysis 6 篇)保留为子目录。CJK 文件名 ascii 化。
set -euo pipefail
cd "$(dirname "$0")/.."
R="Public-Info-Pool/Resource"
mkdir -p "$R"/{daily-news,community-analysis,game-analysis,repo-engineering,data-diagnostics,proposal}

mv_one() { git mv "$1" "$2"; echo "  $1 -> $2"; }

# --- daily-news (2026-06) ---
for ext in md html pdf; do
  mv_one "deliverables/2026-06/morimens_daily_20260601.$ext"       "$R/daily-news/morimens-daily-20260601.$ext"
  mv_one "deliverables/2026-06/morimens_daily_20260601_v2.$ext"    "$R/daily-news/morimens-daily-20260601-r2.$ext"
  mv_one "deliverables/2026-06/morimens_daily_20260602_full.$ext"  "$R/daily-news/morimens-daily-full-20260602.$ext"
  mv_one "deliverables/2026-06/morimens_daily_20260602_v2.$ext"    "$R/daily-news/morimens-daily-20260602-r2.$ext"
  mv_one "deliverables/2026-06/morimens_period_20260512_0603.$ext" "$R/daily-news/morimens-period-20260512-0603.$ext"
  mv_one "deliverables/2026-06/morimens_window_20260602.$ext"      "$R/daily-news/morimens-window-20260602.$ext"
done

# --- community-analysis ---
for ext in md html pdf; do
  mv_one "deliverables/2026-05/community-deep-analysis-2026-05-18_26.$ext" "$R/community-analysis/community-deep-analysis-20260518-26.$ext"
done
mv_one "deliverables/2026-06/jp-discord-insights-2026-06.md"             "$R/community-analysis/jp-discord-insights-202606.md"
mv_one "deliverables/2026-06/saya-collab-community-report-20260603.md"   "$R/community-analysis/saya-collab-community-report-20260603.md"
mv_one "deliverables/2026-06/saya-collab-community-report-v2-20260603.md" "$R/community-analysis/saya-collab-community-report-20260603-r2.md"
mv_one "deliverables/2026-06/saya-collab-community-report-v3-20260603.md" "$R/community-analysis/saya-collab-community-report-20260603-r3.md"
mv_one "deliverables/2026-06/saya-collab-voices-fulldetail-20260603.xlsx" "$R/community-analysis/saya-collab-voices-fulldetail-20260603.xlsx"
mv_one "deliverables/2026-06/volunteer-management-deep-dive.md"          "$R/community-analysis/volunteer-management-deep-dive-202606.md"

# --- game-analysis ---
for ext in md html pdf; do
  mv_one "deliverables/2026-05/role-action-recommendations-2026-05.$ext" "$R/game-analysis/role-action-recommendations-202605.$ext"
  mv_one "deliverables/2026-05/bug-fault-report-2026-05-18_26.$ext"      "$R/game-analysis/bug-fault-report-20260518-26.$ext"
done
# 多文件捆绑保留子目录
git mv "deliverables/2026-04/game-data-analysis" "$R/game-analysis/game-data-analysis-202604"
echo "  deliverables/2026-04/game-data-analysis -> $R/game-analysis/game-data-analysis-202604"

# --- repo-engineering (2026-06) ---
mv_one "deliverables/2026-06/repo-audit-2026-06-03.md"               "$R/repo-engineering/repo-audit-20260603.md"
mv_one "deliverables/2026-06/repo-audit-2026-06-03-round2.md"        "$R/repo-engineering/repo-audit-20260603-r2.md"
mv_one "deliverables/2026-06/repo-health-assessment-2026-06-02.md"   "$R/repo-engineering/repo-health-assessment-20260602.md"
mv_one "deliverables/2026-06/repo-wide-orchestrated-review-20260609.md" "$R/repo-engineering/repo-wide-orchestrated-review-20260609.md"
mv_one "deliverables/2026-06/test-coverage-analysis.md"              "$R/repo-engineering/test-coverage-analysis-202606.md"
mv_one "deliverables/2026-06/retired-modules-audit.md"              "$R/repo-engineering/retired-modules-audit-202606.md"
mv_one "deliverables/2026-06/news-collector-merge-plan.md"          "$R/repo-engineering/news-collector-merge-plan-202606.md"

# --- data-diagnostics (2026-06) ---
mv_one "deliverables/2026-06/discord-data-retention-diagnosis.md"   "$R/data-diagnostics/discord-data-retention-diagnosis-202606.md"
mv_one "deliverables/2026-06/wiki-data-gap-registry.md"             "$R/data-diagnostics/wiki-data-gap-registry-20260602.md"

# --- proposal (2026-03 / 2026-04，CJK ascii 化) ---
mv_one "deliverables/2026-03/ai-collaboration-method.html"          "$R/proposal/ai-collaboration-method-202603.html"
mv_one "deliverables/2026-03/wiki-prototype.html"                   "$R/proposal/wiki-prototype-202603.html"
mv_one "deliverables/2026-03/缸中之脑计划 Brain in a Vat Project.html" "$R/proposal/biav-project-plan-202603.html"
mv_one "deliverables/2026-03/缸中之脑计划 Brain in a Vat Project.pdf"  "$R/proposal/biav-project-plan-202603.pdf"
mv_one "deliverables/2026-04/BIAV 内部AI工具平台建设方案.md"           "$R/proposal/internal-ai-platform-plan-202604.md"

# --- 废弃月目录索引 README + 空壳目录 ---
git rm "deliverables/2026-03/README.md"
rmdir deliverables/2026-03 deliverables/2026-04 deliverables/2026-05 deliverables/2026-06 deliverables 2>/dev/null || true
echo "迁移完成。"
