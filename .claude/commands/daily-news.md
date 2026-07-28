Run the news aggregator and verify output:

1. Run `python projects/news/scripts/aggregator.py`
2. Check the failure sentinel `aggregator-failure.flag` (written into `projects/news/`,
   next to `output/`; runtime file, not tracked in git). The aggregator
   **never exits non-zero** (§4.2 R1: 输出已落盘保全数据), and on an all-sources-empty run it
   **preserves the previous `news.json` intact** — so "item count > 0" alone cannot tell a good
   run from a total failure. Sentinel present = failed run: report it and do NOT commit.
3. Check `projects/news/output/news.json` is non-empty (item count > 0) and its `updated_at`
   is from this run; if empty or unchanged, report error and do NOT commit
4. Run `python projects/news/scripts/split_output.py` to regenerate the per-platform
   `output/*-latest.json` layer (CI runs it right after the aggregator; committing `news.json`
   without it leaves the layer every consumer reads out of sync with it)
5. If result has data, commit and push to main with message: `chore: update community news [skip ci]`
