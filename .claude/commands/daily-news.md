Run the news aggregator and verify output:

1. Run `python projects/news/scripts/aggregator.py`
2. Check the failure sentinel `aggregator-failure.flag` (written into `projects/news/`,
   next to `output/`; runtime file, not tracked in git). The aggregator
   **never exits non-zero** (§4.2 R1: 输出已落盘保全数据), and on an all-sources-empty run it
   **preserves the previous `news.json` intact** — so "item count > 0" alone cannot tell a good
   run from a total failure. Sentinel present = failed run: report it and do NOT commit.
3. Check the run-dir `news.json` (`archive_layout.news_run_root()`, default
   `projects/news/run/`, gitignored) is non-empty (item count > 0) and its `updated_at`
   is from this run; if empty or unchanged, report error and stop
4. Run `python projects/news/scripts/split_output.py`, then
   `python projects/news/scripts/archive_platforms.py` — the split products are consumed by
   the archiver **in the same run**; the archive lake (`Record/Community/`, via
   `BIAV_SC_DATA_ROOT`) is where the data actually lands
5. Nothing from the run dir is committed to this repo (the 输出展示层 was deleted 2026-08-21).
   What CI commits back here is only the cross-run state under `projects/news/data/`
   (`source-health.json` / `validation-drops.json`); the archive itself goes to BIAV-SC-DATA.
