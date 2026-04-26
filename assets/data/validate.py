#!/usr/bin/env python3
"""
事实圣经 (Fact Bible) 数据校验脚本

交叉比对 assets/data/ 与 projects/wiki/data/db/，输出一致性报告。
v2 扩展为 11 项审计：原 7 项历史校验 + 4 项 Mooncell 对标缺口基线。

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
DB_DIR = REPO_ROOT / "projects" / "wiki" / "data" / "db"
PROCESSED_DIR = REPO_ROOT / "projects" / "wiki" / "data" / "processed"
CHARACTERS_JSON = DB_DIR / "characters.json"
TRINKETS_JSON = DB_DIR / "trinkets.json"
BANNERS_JSON = DB_DIR / "banners.json"
SUMMON_JSON = PROCESSED_DIR / "summon.json"
DROPS_INDEX_JSON = PROCESSED_DIR / "drops_by_item.json"
INTERVIEW_JSON = REPO_ROOT / "assets" / "data" / "interview-2026-04.json"

# 制作人声明的角色总数（约数）
EXPECTED_TOTAL_APPROX = 63

# 已知缺失角色（审计 #4, #5, #7）
KNOWN_MISSING = ["herbert", "juliette", "nautila"]


def load_characters():
    """加载角色数据库，返回 (data, all_characters_list)。

    现实形态是顶层数组；保留对旧 dict-with-characters-key 形态的回退。
    """
    with open(CHARACTERS_JSON, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return data, data
    all_chars = list(data.get("characters", []))
    all_chars.extend(data.get("sr_characters", []))
    return data, all_chars


def load_json_safe(path):
    """加载 JSON，失败返回 None。"""
    if not path.exists():
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


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
    if isinstance(data, list):
        ssr_chars = [c for c in all_chars if c.get("rarity") in (None, "SSR")]
        sr_chars = [c for c in all_chars if c.get("rarity") == "SR"]
    else:
        ssr_chars = data.get("characters", [])
        sr_chars = data.get("sr_characters", [])

    # --- Check 1: 角色总数 (审计 #6) ---
    total = len(all_chars)
    if total >= EXPECTED_TOTAL_APPROX:
        results.append((True, f"角色总数 = {total}（SSR {len(ssr_chars)} + SR {len(sr_chars)}），达到制作人声明的 ~{EXPECTED_TOTAL_APPROX}"))
    else:
        results.append((False, f"角色总数 = {total}（SSR {len(ssr_chars)} + SR {len(sr_chars)}），低于制作人声明的 ~{EXPECTED_TOTAL_APPROX}，差 {EXPECTED_TOTAL_APPROX - total} 个"))

    # --- Check 2: 已知缺失角色 (审计 #4, #5, #7) ---
    all_ids = {str(c["id"]).lower() for c in all_chars}
    all_slugs = {(c.get("slug") or "").lower() for c in all_chars}
    all_names_en = {(c.get("name_en") or "").lower() for c in all_chars}
    for name in KNOWN_MISSING:
        found = (
            any(name in cid for cid in all_ids)
            or any(name in slug for slug in all_slugs)
            or any(name in n for n in all_names_en)
        )
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

    # --- Check 7: characters.schema.json 与实际数据形态一致 ---
    schema_path = REPO_ROOT / "projects" / "wiki" / "data" / "schemas" / "characters.schema.json"
    schema = load_json_safe(schema_path)
    if schema is None:
        results.append((False, "characters.schema.json 缺失或不可解析"))
    else:
        top_type = schema.get("type")
        if top_type == "array" and isinstance(data, list):
            results.append((True, f"characters.schema.json 与数据形态一致（顶层 array，{total} 条记录）"))
        elif top_type == "object" and isinstance(data, dict):
            results.append((True, "characters.schema.json 与数据形态一致（顶层 object）"))
        else:
            results.append((False, f"characters.schema.json (type={top_type}) 与实际数据形态 ({type(data).__name__}) 不匹配"))

    # --- Check 8 (Mooncell 基线): 神器 effect 缺失率 ---
    trinkets_data = load_json_safe(TRINKETS_JSON)
    if trinkets_data is None:
        results.append((False, "trinkets.json 缺失，无法统计神器 effect 缺口"))
    else:
        trinkets = trinkets_data.get("trinkets", [])
        if not trinkets:
            results.append((True, "神器 effect 缺口基线：trinkets.json 为空 stub（待 Phase 3 填入 29 条）"))
        else:
            with_effect = sum(1 for t in trinkets if t.get("effect") and t.get("effect") != "pending")
            pct = (with_effect / len(trinkets)) * 100
            verdict = pct >= 50
            results.append((verdict, f"神器 effect 填充率 = {with_effect}/{len(trinkets)} ({pct:.1f}%)"))

    # --- Check 9 (Mooncell 基线): 卡池数值化率 (curated banners.json) ---
    banners_data = load_json_safe(BANNERS_JSON)
    if banners_data is None:
        results.append((False, "banners.json 缺失，无法统计卡池数值化率"))
    else:
        banners = banners_data.get("banners", [])
        if not banners:
            summon = load_json_safe(SUMMON_JSON)
            raw_count = len(summon.get("banners", [])) if summon else 0
            results.append((True, f"卡池数值化基线：banners.json 为空 stub（待 Phase 3 从 {raw_count} 条 summon.json 整理）"))
        else:
            with_rates = sum(1 for b in banners if isinstance(b.get("rates"), dict))
            pct = (with_rates / len(banners)) * 100
            verdict = pct >= 80
            results.append((verdict, f"卡池数值化率 = {with_rates}/{len(banners)} ({pct:.1f}%)"))

    # --- Check 10 (Mooncell 基线): 关卡反向掉落索引完整性 ---
    drops_index = load_json_safe(DROPS_INDEX_JSON)
    if drops_index is None:
        results.append((False, f"反向掉落索引缺失：{DROPS_INDEX_JSON.name}（执行 build_drop_index.py 生成）"))
    else:
        meta = drops_index.get("_meta", {})
        item_count = meta.get("items_with_sources", 0)
        ref_count = meta.get("total_drop_references", 0)
        scanned = meta.get("stages_scanned", 0)
        if scanned == 0:
            results.append((True, f"反向索引基线：尚未扫描 stage 数据（db/stages.json 为空 stub）"))
        else:
            verdict = item_count > 0
            results.append((verdict, f"反向掉落索引：{item_count} 物品 / {ref_count} 边 / {scanned} stage 扫描"))

    # --- Check 11 (Mooncell 基线): 角色 skills 非 pending 率 ---
    skills_filled = sum(1 for c in all_chars if c.get("skills") and c.get("skills") != "pending")
    pct = (skills_filled / total) * 100 if total else 0
    verdict = pct >= 50
    results.append((verdict, f"角色 skills 非 pending 率 = {skills_filled}/{total} ({pct:.1f}%)"))

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
