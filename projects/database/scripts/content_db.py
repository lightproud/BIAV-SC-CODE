"""
忘却前夜 (Morimens) 官方内容数据库加载与查询工具 v2.0。

支持两种数据源：
  1. 模块化文件 (data/db/*.json) — 推荐，按类型拆分
  2. 单体文件 (data/content_database.json) — 向后���容

用法示例:
    from content_db import ContentDB

    db = ContentDB()

    # 角色查询
    char = db.get_character("图鲁")
    chars = db.get_characters_by_realm("deep_sea")
    t0 = db.get_characters_by_tier("T0")
    limited = db.get_limited_characters()

    # 界域查询
    realm = db.get_realm("chaos")
    realms = db.get_all_realms()

    # 术语查询
    term = db.get_term("���轮")

    # 战斗/抽卡/培养系统
    combat = db.combat
    gacha = db.gacha
    progression = db.progression

    # 世界观/剧情
    lore = db.lore

    # 版本历史
    versions = db.versions

    # 全文搜索
    results = db.search("混沌")
"""

import json
import os
from typing import Optional


DB_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "db")
LEGACY_DB_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "content_database.json")


def _load_json(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


class ContentDB:
    """忘却前夜官方内容数据库查询接口 v2.0。"""

    def __init__(self, db_dir: str = DB_DIR, legacy_path: str = LEGACY_DB_PATH):
        self._modules = {}
        if os.path.isdir(db_dir):
            for fname in os.listdir(db_dir):
                if fname.endswith(".json"):
                    key = fname[:-5]  # strip .json
                    self._modules[key] = _load_json(os.path.join(db_dir, fname))

        # Fallback to legacy single-file
        self._legacy = None
        if os.path.isfile(legacy_path):
            self._legacy = _load_json(legacy_path)

        # Build character indexes
        self._char_index_name = {}
        self._char_index_id = {}
        for c in self._get_characters_list():
            self._char_index_name[c["name"]] = c
            self._char_index_id[c["id"]] = c
            if c.get("name_en"):
                self._char_index_name[c["name_en"].lower()] = c
            for alias in c.get("aliases", []):
                self._char_index_name[alias.lower()] = c

    def _get_characters_list(self) -> list[dict]:
        if "characters" in self._modules:
            return self._modules["characters"].get("characters", [])
        if self._legacy:
            return self._legacy.get("characters", [])
        return []

    # ── 元数据 ──

    @property
    def meta(self) -> dict:
        return self._modules.get("meta", {})

    @property
    def raw_modules(self) -> dict:
        return self._modules

    # ── 界域查询 ──

    def get_all_realms(self) -> list[dict]:
        if "realms" in self._modules:
            return self._modules["realms"].get("realms", [])
        if self._legacy:
            return self._legacy.get("attributes", [])
        return []

    def get_realm(self, realm_id: str) -> Optional[dict]:
        for r in self.get_all_realms():
            if r["id"] == realm_id or r["name"] == realm_id or r.get("name_en", "").lower() == realm_id.lower():
                return r
        return None

    # Legacy alias
    get_attribute = get_realm
    get_attributes = get_all_realms

    # ── 角色��询 ──

    def get_character(self, name_or_id: str) -> Optional[dict]:
        key = name_or_id.strip()
        return (self._char_index_name.get(key)
                or self._char_index_name.get(key.lower())
                or self._char_index_id.get(key))

    def get_all_characters(self) -> list[dict]:
        return self._get_characters_list()

    def get_characters_by_realm(self, realm: str) -> list[dict]:
        return [c for c in self._get_characters_list() if c.get("realm") == realm]

    # Legacy alias
    get_characters_by_attribute = get_characters_by_realm

    def get_characters_by_tier(self, tier: str) -> list[dict]:
        return [c for c in self._get_characters_list() if c.get("tier") == tier]

    def get_characters_by_rarity(self, rarity: str) -> list[dict]:
        r = rarity.upper()
        return [c for c in self._get_characters_list() if c.get("rarity", "").upper() == r]

    def get_characters_by_role(self, role: str) -> list[dict]:
        return [c for c in self._get_characters_list() if c.get("role") == role]

    def get_limited_characters(self) -> list[dict]:
        return [c for c in self._get_characters_list() if c.get("is_limited")]

    def get_notable_groups(self) -> list[dict]:
        if "characters" in self._modules:
            return self._modules["characters"].get("notable_groups", [])
        return []

    # ── 战斗/抽卡/培养系统 ──

    @property
    def combat(self) -> dict:
        return self._modules.get("combat", {})

    @property
    def gacha(self) -> dict:
        return self._modules.get("gacha", {})

    @property
    def progression(self) -> dict:
        return self._modules.get("progression", {})

    # ── 世界观/剧情 ──

    @property
    def lore(self) -> dict:
        return self._modules.get("lore", {})

    # ── 装备查询 ──

    @property
    def equipment(self) -> dict:
        return self._modules.get("equipment", {})

    def get_wheels_by_rarity(self, rarity: str) -> list[dict]:
        eq = self.equipment
        key = f"{rarity.lower()}_wheels"
        return eq.get(key, [])

    def get_covenants(self) -> list[dict]:
        return self.equipment.get("covenants", [])

    def get_signature_wheel(self, character_name: str) -> Optional[dict]:
        for w in self.get_wheels_by_rarity("ssr"):
            if character_name in w.get("signature_for", ""):
                return w
        return None

    # ── 配队查询 ──

    @property
    def teams(self) -> dict:
        return self._modules.get("teams", {})

    def get_teams_by_realm(self, realm: str) -> list[dict]:
        return self.teams.get("teams_by_realm", {}).get(realm, [])

    def get_beginner_teams(self) -> list[dict]:
        return self.teams.get("beginner_priority", [])

    def get_endgame_teams(self) -> list[dict]:
        return self.teams.get("endgame_teams", {}).get("recommended", [])

    def get_synergies(self) -> list[dict]:
        return self.teams.get("character_synergies", [])

    # ── 钥令查询 ──

    @property
    def key_commands(self) -> dict:
        return self._modules.get("key_commands", {})

    def get_all_posses(self) -> list[dict]:
        return self.key_commands.get("posses", [])

    def get_posse(self, name_or_id: str) -> Optional[dict]:
        key = name_or_id.lower()
        for p in self.get_all_posses():
            if p["id"] == key or p["name"] == name_or_id or p.get("name_en", "").lower() == key:
                return p
        return None

    def get_posses_by_realm(self, realm: str) -> list[dict]:
        return [p for p in self.get_all_posses() if p.get("realm_affinity") == realm]

    # ── 技能查询 ──

    @property
    def skills(self) -> dict:
        return self._modules.get("skills", {})

    def get_character_skills(self, name: str) -> Optional[dict]:
        for cs in self.skills.get("character_skills", []):
            if cs.get("name") == name or cs.get("name_en", "").lower() == name.lower():
                return cs
        return None

    # ── 美术资产 ──

    @property
    def art_assets(self) -> dict:
        return self._modules.get("art_assets", {})

    # ── 道具/地图 ──

    @property
    def items(self) -> dict:
        return self._modules.get("items", {})

    @property
    def maps(self) -> dict:
        return self._modules.get("maps", {})

    # ── 版本历史 ──

    @property
    def versions(self) -> dict:
        return self._modules.get("versions", {})

    def get_version(self, ver: str) -> Optional[dict]:
        for v in self._modules.get("versions", {}).get("versions", []):
            if v["version"] == ver:
                return v
        return None

    # ── 术语查询 ──

    def get_term(self, term: str) -> Optional[dict]:
        terms = self._modules.get("terminology", {}).get("terms", {})
        if term in terms:
            return terms[term]
        if self._legacy and term in self._legacy.get("terminology", {}):
            return self._legacy["terminology"][term]
        return None

    def get_all_terms(self) -> dict:
        return self._modules.get("terminology", {}).get("terms", {})

    def get_terms_by_category(self, category: str) -> dict:
        return {k: v for k, v in self.get_all_terms().items() if v.get("category") == category}

    # ── 全文搜索 ──

    def search(self, keyword: str) -> dict:
        """全库关键词搜索。"""
        kw = keyword.lower()
        results = {"characters": [], "terms": [], "realms": [], "versions": [],
                   "teams": [], "posses": [], "equipment": []}

        for c in self._get_characters_list():
            searchable = " ".join([
                c.get("name", ""), c.get("name_en", ""),
                c.get("description", ""), c.get("realm", ""),
                " ".join(c.get("tags", [])), " ".join(c.get("aliases", []))
            ]).lower()
            if kw in searchable:
                results["characters"].append(c)

        for term_key, term_val in self.get_all_terms().items():
            searchable = " ".join([
                term_key, term_val.get("en", ""),
                term_val.get("description", ""), term_val.get("category", "")
            ]).lower()
            if kw in searchable:
                results["terms"].append({"key": term_key, **term_val})

        for realm in self.get_all_realms():
            searchable = " ".join([
                realm.get("name", ""), realm.get("name_en", ""),
                realm.get("core_mechanic", ""), realm.get("starter_tip", "")
            ]).lower()
            if kw in searchable:
                results["realms"].append(realm)

        for ver in self._modules.get("versions", {}).get("versions", []):
            searchable = " ".join([
                ver.get("version", ""), ver.get("title", ""),
                " ".join(ver.get("highlights", []))
            ]).lower()
            if kw in searchable:
                results["versions"].append(ver)

        for p in self.get_all_posses():
            searchable = " ".join([
                p.get("name", ""), p.get("name_en", ""),
                p.get("effect", ""), p.get("realm_affinity", "")
            ]).lower()
            if kw in searchable:
                results["posses"].append(p)

        for realm_key, team_list in self.teams.get("teams_by_realm", {}).items():
            for t in team_list:
                searchable = " ".join([
                    t.get("name", ""), t.get("name_en", ""),
                    " ".join(t.get("members", [])), t.get("notes", "")
                ]).lower()
                if kw in searchable:
                    results["teams"].append(t)

        return results

    # ── 统计 ──

    def stats(self) -> dict:
        chars = self._get_characters_list()
        realms = self.get_all_realms()
        return {
            "total_characters": len(chars),
            "by_realm": {r["name"]: len(self.get_characters_by_realm(r["id"])) for r in realms},
            "by_rarity": {
                "SSR": len(self.get_characters_by_rarity("SSR")),
                "SR": len(self.get_characters_by_rarity("SR")),
            },
            "by_tier": {t: len(self.get_characters_by_tier(t)) for t in ["T0", "T1", "T2", "T3"]},
            "limited_count": len(self.get_limited_characters()),
            "total_terms": len(self.get_all_terms()),
            "total_realms": len(realms),
            "total_posses": len(self.get_all_posses()),
            "total_covenants": len(self.get_covenants()),
            "db_modules": sorted(self._modules.keys()),
        }


if __name__ == "__main__":
    db = ContentDB()
    m = db.meta
    print(f"=== {m.get('game', '?')} ({m.get('game_en', '?')}) 内容数据库 v2.0 ===")
    print(f"开发商: {m.get('developer', '?')}")
    print(f"当前版本: {m.get('current_version', '?')}\n")

    s = db.stats()
    print(f"数据库模块: {', '.join(s['db_modules'])}")
    print(f"��色总数: {s['total_characters']}")
    print(f"按界域: {s['by_realm']}")
    print(f"按强度: {s['by_tier']}")
    print(f"限定角色: {s['limited_count']}")
    print(f"钥令: {s['total_posses']}")
    print(f"密契: {s['total_covenants']}")
    print(f"术语条目: {s['total_terms']}")

    print("\n--- T0 角色 ---")
    for c in db.get_characters_by_tier("T0"):
        realm = db.get_realm(c.get("realm", ""))
        icon = realm["icon"] if realm else "?"
        rname = realm["name"] if realm else "?"
        limited = " [限定]" if c.get("is_limited") else ""
        print(f"  {icon} {c['name']} ({c.get('name_en','')}) - {rname} {c.get('role','')}{limited}")

    print("\n--- 界域机制 ---")
    for r in db.get_all_realms():
        talent = r.get("realm_talent", {})
        print(f"  {r['icon']} {r['name']}: {talent.get('name', '')} - {talent.get('description', '')[:50]}...")

    print("\n--- 角色组合 ---")
    for g in db.get_notable_groups():
        print(f"  {g['name']}: {', '.join(g['members'])}")

    print("\n--- 术语分类 ---")
    categories = {}
    for k, v in db.get_all_terms().items():
        cat = v.get("category", "其他")
        categories.setdefault(cat, []).append(k)
    for cat, terms in categories.items():
        print(f"  {cat}: {', '.join(terms[:5])}{'...' if len(terms) > 5 else ''}")
