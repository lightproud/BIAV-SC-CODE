"""wiki 运行时数据桥契约测试——生成端与消费端的「对菜单」。

生成端：scripts/generate_wiki_pages.py generate_runtime_data() 产出
characters.runtime.json（已有单测钉生成行为）。
消费端：projects/wiki/docs/.vitepress/theme/data/characters.ts 以
MorimensCharacter 接口消费该 JSON——但 TS 无运行时校验，生成端改字段名
VitePress 构建照样绿，图鉴页运行时才空（P2-1 轻方案，2026-07-11 提案获批）。

本档用正则解析 characters.ts 的接口声明与标签表，对着仓内已提交的
runtime JSON 逐条对账：必填字段齐全、枚举值在标签表内、双查找键唯一。
"""

import json
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
THEME_DATA = REPO / "projects" / "wiki" / "docs" / ".vitepress" / "theme" / "data"
TS_PATH = THEME_DATA / "characters.ts"
RUNTIME_PATH = THEME_DATA / "characters.runtime.json"


@pytest.fixture(scope="module")
def ts_source() -> str:
    return TS_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def runtime() -> list:
    data = json.loads(RUNTIME_PATH.read_text(encoding="utf-8"))
    assert isinstance(data, list) and data, "runtime JSON 必须是非空数组"
    return data


def _interface_fields(ts: str) -> tuple[set, set]:
    """从 MorimensCharacter 接口抽 (必填字段集, 可选字段集)。"""
    m = re.search(r"export interface MorimensCharacter \{(.*?)\n\}", ts, re.S)
    assert m, "characters.ts 中找不到 MorimensCharacter 接口声明"
    required, optional = set(), set()
    for line in m.group(1).splitlines():
        field = re.match(r"\s{2}(\w+)(\??):", line)
        if field:
            (optional if field.group(2) else required).add(field.group(1))
    return required, optional


def _label_keys(ts: str, const_name: str) -> set:
    m = re.search(const_name + r"[^=]*= \{(.*?)\}", ts, re.S)
    assert m, f"characters.ts 中找不到 {const_name}"
    return set(re.findall(r"(\w+):\s*'", m.group(1)))


# ── 契约主体 ────────────────────────────────────────────────────────────

def test_interface_parse_sanity(ts_source):
    required, optional = _interface_fields(ts_source)
    # 抽样锚定：解析器本身失灵时响亮失败，而非空集互为子集假绿
    assert {"id", "slug", "name_zh", "status", "realm"} <= required
    assert "skills" in optional
    assert len(required) >= 15


def test_every_record_has_all_required_fields(ts_source, runtime):
    required, _ = _interface_fields(ts_source)
    for rec in runtime:
        missing = required - set(rec)
        assert not missing, f"角色 {rec.get('id')} 缺消费端必填字段: {sorted(missing)}"


def test_no_unknown_fields_leak_from_generator(ts_source, runtime):
    """生成端新增字段必须同步进接口声明——防「菜单没写就上菜」的单向漂移。"""
    required, optional = _interface_fields(ts_source)
    known = required | optional
    for rec in runtime:
        unknown = set(rec) - known
        assert not unknown, f"角色 {rec.get('id')} 有接口未声明字段: {sorted(unknown)}"


def test_status_values_within_keeper_taxonomy(ts_source, runtime):
    # status = 守密人 2026-06-16 逐一裁定类目，消费端标签表为唯一展示映射
    labels = _label_keys(ts_source, "STATUS_LABELS")
    seen = {rec["status"] for rec in runtime}
    assert seen <= labels, f"runtime 出现标签表外的 status: {sorted(seen - labels)}"


def test_realm_values_within_label_table(ts_source, runtime):
    labels = _label_keys(ts_source, "REALM_LABELS")
    seen = {rec["realm"] for rec in runtime if rec.get("realm")}
    assert seen <= labels, f"runtime 出现标签表外的 realm: {sorted(seen - labels)}"


def test_lookup_keys_unique(runtime):
    # findById / findBySlug 均为 find 单值语义，键重复即静默丢数据
    ids = [rec["id"] for rec in runtime]
    slugs = [rec["slug"] for rec in runtime if rec.get("has_page")]
    assert len(ids) == len(set(ids)), "id 重复"
    assert len(slugs) == len(set(slugs)), "has_page 角色 slug 重复"


def test_portraits_shape(runtime):
    # portraits 为接口内嵌结构，消费端直接解构，缺键即运行时 undefined
    for rec in runtime:
        p = rec.get("portraits")
        assert isinstance(p, dict), f"角色 {rec.get('id')} portraits 非对象"
        assert {"default", "awaker", "skins"} <= set(p)
        assert isinstance(p["skins"], list)
