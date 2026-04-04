Run the news aggregator and verify output:

1. Run `python projects/news/scripts/aggregator.py`
2. Check `projects/news/output/news.json` is non-empty (item count > 0)
3. If result is empty, report error and do NOT commit
4. If result has data, commit and push to main with message: `chore: update community news [skip ci]`
