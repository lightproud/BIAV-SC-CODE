Run the community collection pass and verify it landed in the archive lake:

1. Run `python projects/news/scripts/collect_global.py` — the single collection entry
   since 2026-08-22 ("采集 → 直接入湖"): it drives every platform collector, validates
   the items and writes the run-time full layer.
2. Check the failure sentinel `collect-failure.flag` (written into `projects/news/`;
   run-time file, not tracked in git). The entry point **never exits non-zero** on a
   core-source failure — that would skip the archive steps and destroy the data this
   round did collect — so "item count > 0" alone cannot tell a good run from a bad one.
   Sentinel present = failed run: report it and do NOT advance anything.
3. Check the run-dir `news-raw.json` (`archive_layout.news_run_root()`, default
   `projects/news/run/`, gitignored) is non-empty and its `updated_at` is from this run.
4. Run `python projects/news/scripts/archive_platforms.py` — this is where the data
   actually lands: `Record/Community/{platform}/{date}.json` in BIAV-SC-DATA (set
   `BIAV_SC_DATA_ROOT` to the data-repo checkout first).
5. Nothing from the run dir is committed to this repo. What CI commits back here is only
   the cross-run state under `projects/news/data/` (`source-health.json` /
   `validation-drops.json` / collection cursor).
