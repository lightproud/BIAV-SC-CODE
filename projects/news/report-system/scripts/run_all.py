#!/usr/bin/env python3
"""
一键运行: 收集 → 私人分析 → 生成报告 → 通知推送
Usage: python scripts/run_all.py
"""

from collector import collect_all
from analyst import analyze
from reporter import generate_report
from notifier import notify


def main():
    print("=" * 50)
    print("  忘却前夜 全球情报报告系统 - 一键运行")
    print("=" * 50)

    print("\n[Step 1/4] Collecting data...")
    raw = collect_all()

    print("\n[Step 2/4] Private Claude analysis...")
    analysis = analyze(raw.get("items", []))

    print("\n[Step 3/4] Generating report...")
    report = generate_report(analysis=analysis)

    print("\n[Step 4/4] Sending notifications...")
    results = notify(report)

    report_num = analysis.get("report_number", "?")
    sent = results.get("sent", [])
    print(f"\n✓ Done! Report #{report_num} generated.")
    if sent:
        print(f"  → Notified via: {', '.join(sent)}")
    print("  → index.html        (interactive dashboard)")
    print("  → data/report.html  (standalone report)")
    print("  → data/report.json  (structured data)")
    print("  → data/feed.xml     (RSS feed)")


if __name__ == "__main__":
    main()
