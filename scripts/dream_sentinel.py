"""Sentinel layer — proactive anomaly detection over news data sources.

Extracted from dream.py. sentinel_scan() is the entry point (used by
dream.run_phase1); it folds in the archive-integrity scan.
"""

import json
from datetime import datetime

from dream_config import (
    ALERTS_FILE, NEGATIVE_KEYWORDS, NEWS_OUTPUT, SENTINEL_BASELINE,
    SENTINEL_THRESHOLDS, TODAY, _get_branch,
)
from dream_archive import archive_integrity_scan


def load_sentinel_baseline() -> dict:
    """Load the sliding 7-day baseline."""
    if SENTINEL_BASELINE.exists():
        try:
            return json.loads(SENTINEL_BASELINE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {"history": [], "baseline": {}}


def save_sentinel_baseline(data: dict):
    """Save sentinel baseline to disk."""
    SENTINEL_BASELINE.parent.mkdir(parents=True, exist_ok=True)
    SENTINEL_BASELINE.write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def extract_source_metrics(source: str, items: list) -> dict:
    """Extract key metrics from a data source's items."""
    metrics = {
        "item_count": len(items),
        "total_engagement": sum(it.get("engagement", 0) for it in items),
    }

    if source == "steam":
        voted_up = sum(1 for it in items if it.get("voted_up", True))
        voted_down = len(items) - voted_up
        metrics["positive_count"] = voted_up
        metrics["negative_count"] = voted_down
        metrics["negative_rate"] = voted_down / max(len(items), 1)

    if source == "discord":
        # Extract message count from summary (first item is daily summary)
        for it in items:
            title = it.get("title", "")
            if "日报" in title or "Daily" in title:
                eng = it.get("engagement", 0)
                if eng > 0:
                    metrics["daily_messages"] = eng
                break

    # Negative keyword scan across all items
    neg_hits = 0
    neg_keywords_found = []
    for it in items:
        text = " ".join([
            it.get("title", ""), it.get("summary", ""),
            it.get("review", ""),
        ]).lower()
        for kw in NEGATIVE_KEYWORDS:
            if kw in text:
                neg_hits += 1
                if kw not in neg_keywords_found:
                    neg_keywords_found.append(kw)
    metrics["negative_keyword_hits"] = neg_hits
    metrics["negative_keywords"] = neg_keywords_found

    return metrics


def compute_deviation(current: float, baseline: float) -> float:
    """Compute how many times current deviates from baseline (ratio)."""
    if baseline <= 0:
        return 0.0
    return current / baseline


def sentinel_scan() -> list[dict]:
    """
    Scan all data sources against sliding baselines.
    Returns list of alerts (may be empty if everything is normal).
    """
    baseline_data = load_sentinel_baseline()
    history = baseline_data.get("history", [])
    alerts = []

    # Collect today's metrics from each source
    today_metrics = {}
    sources = ["steam", "bilibili", "discord"]
    for src in sources:
        src_file = NEWS_OUTPUT / f"{src}-latest.json"
        if not src_file.exists():
            continue
        try:
            data = json.loads(src_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        items = data.get("items", [])
        if not items:
            continue
        today_metrics[src] = extract_source_metrics(src, items)

    if not today_metrics:
        return alerts

    # Compute baselines from history (last 7 entries)
    recent = history[-7:] if len(history) >= 2 else []
    baselines = {}
    if recent:
        for src in sources:
            src_history = [h.get(src, {}) for h in recent if src in h]
            if not src_history:
                continue
            baselines[src] = {}
            for key in ["item_count", "total_engagement", "negative_keyword_hits"]:
                vals = [h.get(key, 0) for h in src_history]
                baselines[src][key] = sum(vals) / max(len(vals), 1)
            if src == "steam":
                vals = [h.get("negative_rate", 0) for h in src_history]
                baselines[src]["negative_rate"] = sum(vals) / max(len(vals), 1)
            if src == "discord":
                vals = [h.get("daily_messages", 0) for h in src_history if h.get("daily_messages")]
                baselines[src]["daily_messages"] = sum(vals) / max(len(vals), 1) if vals else 0

    # Generate alerts by comparing today vs baseline
    for src, metrics in today_metrics.items():
        src_baseline = baselines.get(src, {})

        # Steam negative rate spike
        if src == "steam" and "negative_rate" in src_baseline:
            bl = src_baseline["negative_rate"]
            cur = metrics.get("negative_rate", 0)
            if bl > 0 and cur > bl:
                ratio = cur / bl
                if ratio >= SENTINEL_THRESHOLDS["red"]:
                    alerts.append({
                        "level": "red",
                        "source": src,
                        "metric": "negative_rate",
                        "message": f"Steam 差评率飙升：{cur:.0%}（基线 {bl:.0%}，{ratio:.1f}x）",
                        "current": cur,
                        "baseline": bl,
                    })
                elif ratio >= SENTINEL_THRESHOLDS["orange"]:
                    alerts.append({
                        "level": "orange",
                        "source": src,
                        "metric": "negative_rate",
                        "message": f"Steam 差评率上升：{cur:.0%}（基线 {bl:.0%}，{ratio:.1f}x）",
                        "current": cur,
                        "baseline": bl,
                    })

        # Discord message volume spike
        if src == "discord":
            bl = src_baseline.get("daily_messages", 0)
            cur = metrics.get("daily_messages", 0)
            if bl > 0 and cur > 0:
                ratio = cur / bl
                if ratio >= SENTINEL_THRESHOLDS["red"]:
                    alerts.append({
                        "level": "yellow",
                        "source": src,
                        "metric": "daily_messages",
                        "message": f"Discord 消息量暴涨：{cur:,}（基线 {bl:,.0f}，{ratio:.1f}x）",
                        "current": cur,
                        "baseline": bl,
                    })

        # Engagement spike (any source)
        bl_eng = src_baseline.get("total_engagement", 0)
        cur_eng = metrics.get("total_engagement", 0)
        if bl_eng > 0 and cur_eng > bl_eng:
            ratio = cur_eng / bl_eng
            if ratio >= SENTINEL_THRESHOLDS["red"]:
                alerts.append({
                    "level": "yellow",
                    "source": src,
                    "metric": "total_engagement",
                    "message": f"{src} 互动量异常：{cur_eng:,}（基线 {bl_eng:,.0f}，{ratio:.1f}x）",
                    "current": cur_eng,
                    "baseline": bl_eng,
                })

        # Negative keyword spike
        bl_neg = src_baseline.get("negative_keyword_hits", 0)
        cur_neg = metrics.get("negative_keyword_hits", 0)
        if cur_neg > 0 and (bl_neg == 0 or cur_neg / max(bl_neg, 1) >= SENTINEL_THRESHOLDS["orange"]):
            kws = metrics.get("negative_keywords", [])
            if bl_neg == 0 and cur_neg >= 3:
                alerts.append({
                    "level": "orange",
                    "source": src,
                    "metric": "negative_keywords",
                    "message": f"{src} 负面关键词突增：{cur_neg} 次（{', '.join(kws[:5])}）",
                    "current": cur_neg,
                    "baseline": bl_neg,
                })
            elif bl_neg > 0:
                ratio = cur_neg / bl_neg
                if ratio >= SENTINEL_THRESHOLDS["orange"]:
                    alerts.append({
                        "level": "orange",
                        "source": src,
                        "metric": "negative_keywords",
                        "message": f"{src} 负面关键词上升：{cur_neg} 次（基线 {bl_neg:.0f}，{', '.join(kws[:5])}）",
                        "current": cur_neg,
                        "baseline": bl_neg,
                    })

    # Update history (append today, keep last 14 entries)
    history.append(today_metrics)
    history = history[-14:]
    baseline_data["history"] = history
    baseline_data["last_scan"] = datetime.now().isoformat()
    baseline_data["baseline"] = baselines
    save_sentinel_baseline(baseline_data)

    # Archive integrity — always runs regardless of news data availability.
    try:
        archive_alerts = archive_integrity_scan()
    except Exception as exc:  # pragma: no cover - defensive guard
        archive_alerts = []
        print(f"  [archive_integrity] scan failed: {exc}")
    if archive_alerts:
        alerts.extend(archive_alerts)

    # Write alerts.json
    if alerts:
        alert_record = {
            "date": TODAY.isoformat(),
            "timestamp": datetime.now().isoformat(),
            "branch": _get_branch(),
            "alerts": alerts,
        }
        # Load existing alerts, append, keep last 30 days
        existing_alerts = []
        if ALERTS_FILE.exists():
            try:
                existing_alerts = json.loads(ALERTS_FILE.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                pass
        existing_alerts.append(alert_record)
        existing_alerts = existing_alerts[-30:]
        ALERTS_FILE.write_text(
            json.dumps(existing_alerts, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    return alerts
