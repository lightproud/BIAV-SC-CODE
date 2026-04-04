#!/usr/bin/env python3
"""
事实圣经 (Fact Bible) 数据校验脚本

交叉比对 assets/data/ 与 projects/wiki/data/db/characters.json，
输出一致性报告。基于 memory/task-wiki-data-audit-2026-04.md 中的 7 项审计发现。

用法：
    python assets/data/validate.py

退出码：
    0 = 全部通过
    1 = 存在失败项
"""

import json
import sys
from pathlib import Path

# 路径基于仓库根目录
REPO_ROOT = Path(__file__).resolve().parent.parent.parent
CHARACTERS_JSON = REPO_ROOT / "projects" / "wiki" / "data" / "db" / "characters.json"
INTERVIEW_JSON = REPO_ROOT / "assets" / "data" / "interview-2026-04.json"

# 制作人声明的角色总数（约数）
EXPECTED_TOTAL_APPROX = 63

# 已知缺失角色（审计 #4, #5, #7）
KNOWN_MISSING = ["herbert", "juliette", "nautila"]


def load_characters():
    """加载角色数据库，返回 (data_dict, all_characters_list)。"""
    with open(CHARACTERS_JSON, encoding="utf-8") as f:
        data = json.load(f)
    # 合并 SSR (characters) 和 SR (sr_characters) 列表
    all_chars = list(data.get("characters", []))
    all_chars.extend(data.get("sr_characters", []))
    return data, all_chars


def find_char(chars, char_id):
    """按 id 查找角色，返回 dict 或 None。"""
    for c in chars:
        if c["id"] == char_id:
            return c
    return None


def run_checks():
    """执行所有校验，返回 (results, pass_count, fail_count)。"""
    results = []  # list of (pass: bool, description: str)

    # --- 加载数据 ---
    if not CHARACTERS_JSON.exists():
        print(f"错误：找不到 {CHARACTERS_JSON}")
        sys.exit(2)

    data, all_chars = load_characters()
    ssr_chars = data.get("characters", [])
    sr_chars = data.get("sr_characters", [])

    # --- Check 1: 角色总数 (审计 #6) ---
    total = len(all_chars)
    if total >= EXPECTED_TOTAL_APPROX:
        results.append((True, f"角色总数 = {total}（SSR {len(ssr_chars)} + SR {len(sr_chars)}），达到制作人声明的 ~{EXPECTED_TOTAL_APPROX}"))
    else:
        results.append((False, f"角色总数 = {total}（SSR {len(ssr_chars)} + SR {len(sr_chars)}），低于制作人声明的 ~{EXPECTED_TOTAL_APPROX}，差 {EXPECTED_TOTAL_APPROX - total} 个"))

    # --- Check 2: 已知缺失角色 (审计 #4, #5, #7) ---
    all_ids = {c["id"].lower() for c in all_chars}
    all_names_en = {c.get("name_en", "").lower() for c in all_chars}
    for name in KNOWN_MISSING:
        # 检查 id 或英文名是否包含该名称
        found = any(name in cid for cid in all_ids) or any(name in n for n in all_names_en)
        if found:
            results.append((True, f"角色 {name.capitalize()} 已存在于数据库"))
        else:
            results.append((False, f"角色 {name.capitalize()} 仍缺失"))

    # --- Check 3: Helot 名称应包含 "Catena" 后缀 (审计 #1) ---
    helot = find_char(all_chars, "helot")
    if helot is None:
        results.append((False, "Helot 角色不存在"))
    else:
        name_en = helot.get("name_en", "")
        if "catena" in name_en.lower():
            results.append((True, f"Helot 英文名包含 Catena 后缀：{name_en}"))
        else:
            results.append((False, f"Helot 英文名缺少 Catena 后缀，当前值：\"{name_en}\""))

    # --- Check 4: id=24 应标注四领域适性 (审计 #2) ---
    char_24 = find_char(all_chars, "24")
    if char_24 is None:
        results.append((False, "id=24 角色不存在"))
    else:
        # 检查是否有四领域标注：可能在 realm/realms 字段或 tags/description 中
        realm = char_24.get("realm", "")
        realms = char_24.get("realms", [])
        tags = char_24.get("tags", [])
        desc = char_24.get("description", "")
        has_four_realm = (
            isinstance(realms, list) and len(realms) >= 4
            or "四领域" in desc
            or "four-realm" in desc.lower()
            or "四领域" in " ".join(tags)
            or "全领域" in desc
            or "全领域" in " ".join(tags)
        )
        if has_four_realm:
            results.append((True, f"id=24 已标注四领域适性"))
        else:
            results.append((False, f"id=24 仅标注 realm=\"{realm}\"，缺少四领域适性说明"))

    # --- Check 5: ramona-timeworn 应有获取方式信息 (审计 #3) ---
    ramona_tw = find_char(all_chars, "ramona-timeworn")
    if ramona_tw is None:
        results.append((False, "ramona-timeworn 角色不存在"))
    else:
        obtain = ramona_tw.get("obtain")
        acquisition = ramona_tw.get("acquisition")
        has_info = (obtain and obtain.strip()) or (acquisition and str(acquisition).strip())
        if has_info:
            value = obtain or acquisition
            results.append((True, f"ramona-timeworn 获取方式已填写：\"{value}\""))
        else:
            results.append((False, "ramona-timeworn 获取方式为空（obtain/acquisition 均为 null 或空）"))

    # --- Check 6: 采访数据文件存在性 ---
    if INTERVIEW_JSON.exists():
        results.append((True, f"采访数据文件存在：{INTERVIEW_JSON.name}"))
    else:
        results.append((False, f"采访数据文件缺失：{INTERVIEW_JSON.name}（预期路径：assets/data/interview-2026-04.json）"))

    return results


def main():
    print("=" * 60)
    print("  事实圣经 (Fact Bible) 数据校验报告")
    print("=" * 60)
    print()

    results = run_checks()

    pass_count = 0
    fail_count = 0

    for passed, desc in results:
        icon = "\u2713" if passed else "\u2717"
        status = "PASS" if passed else "FAIL"
        print(f"  {icon} [{status}] {desc}")
        if passed:
            pass_count += 1
        else:
            fail_count += 1

    print()
    print("-" * 60)
    print(f"  合计：{pass_count + fail_count} 项检查，{pass_count} 通过，{fail_count} 失败")
    if fail_count == 0:
        print("  状态：全部通过")
    else:
        print(f"  状态：{fail_count} 项待修正")
    print("-" * 60)

    sys.exit(0 if fail_count == 0 else 1)


if __name__ == "__main__":
    main()
