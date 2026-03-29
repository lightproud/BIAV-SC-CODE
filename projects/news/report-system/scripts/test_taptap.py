#!/usr/bin/env python3
"""
验证 fetch_taptap() 功能的测试脚本。
运行: python scripts/test_taptap.py
需要: ANTHROPIC_API_KEY 环境变量
输出: data/test_output_taptap.json
"""

import json
import sys
from pathlib import Path

# 添加脚本目录到路径
sys.path.insert(0, str(Path(__file__).parent))

from collector import fetch_taptap, _parse_taptap_time, BASE_DIR

OUTPUT = BASE_DIR / "data" / "test_output_taptap.json"


def main():
    print("=== 测试 fetch_taptap() ===")
    print("正在抓取 TapTap 页面...")

    items = fetch_taptap()

    result = {
        "count": len(items),
        "items": items,
    }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)

    print(f"获得 {len(items)} 条帖子，已保存到 {OUTPUT}")
    if items:
        print("\n示例数据（前3条）:")
        for item in items[:3]:
            print(f"  - [{item['author']}] {item['title']} | 互动:{item['engagement']} | 时间:{item['time']}")
    else:
        print("警告：未获得任何帖子数据")


if __name__ == "__main__":
    main()
