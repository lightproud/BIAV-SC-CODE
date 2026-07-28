"""OKF 生成器的数据源在场守卫（守密人 2026-07-26 裁定，产品审视会话附带发现）。

守的是「生成取代对账」这套投资的**背面**。招一的立论是「生成严格强于哨兵——它让漂移
不可能发生」，但那句话有一个默认前提：**生成器的输入在场**。输入静默降级时，生成器不但
不喊，反而会理直气壮地把「磁盘上没有」如实反映成「概念不该存在」。

具体形状（2026-07-26 一天之内亲历两次）：`build_okf_bundle.main()` 是**先
`shutil.rmtree(okf/)` 再整体重建**。数据湖 2026-07-20 迁出 code 仓后，本地会话若没设
`BIAV_SC_DATA_ROOT`，17 个平台的存在性检查全部落空 → 指针一个不生成 → 重建完少 17 个
community 概念 + 对应 sources 概念，**7,968 行删除**，退出码 0，不告警。
CI 侧安全（`build-okf-bundle.yml` clone 数据仓并设 env），风险全在本地：一个不知情的
会话跑一次生成器再提交，整层就没了。

**「删除」在这里根本不是决策，是「先擦后写」遇上降级输入的副作用。** 所以守卫必须落在
rmtree 之前——本档最要紧的一条断言就是「拒绝之后 bundle 毫发无损」。
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
import _paths  # noqa: F401  直跑路径引导（pytest 侧见 pyproject.toml）
import okf_pointer_layers as opl  # noqa: E402

BUILDER = REPO / "scripts" / "build_okf_bundle.py"
INDEX = REPO / "projects" / "news" / "index" / "community_index.json"


def _expected_platforms() -> list[str]:
    if not INDEX.exists():
        return []
    return sorted(json.loads(INDEX.read_text(encoding="utf-8")).get("platforms", {}))


def _run(*args: str, env_root: str | None = None) -> subprocess.CompletedProcess[str]:
    import os

    env = dict(os.environ)
    if env_root is not None:
        env["BIAV_SC_DATA_ROOT"] = env_root
    else:
        env.pop("BIAV_SC_DATA_ROOT", None)
    return subprocess.run(
        [sys.executable, str(BUILDER), *args],
        capture_output=True, text=True, cwd=REPO, env=env, timeout=600,
    )


@pytest.fixture
def absent_root(tmp_path: Path) -> str:
    """一个存在但空的数据根——「数据湖没 clone / env 没设」的精确复现。"""
    root = tmp_path / "empty-data-repo"
    (root / "Record" / "Community").mkdir(parents=True)
    return str(root)


def test_guard_refuses_when_the_archive_source_is_entirely_absent(
    absent_root: str, monkeypatch: pytest.MonkeyPatch,
) -> None:
    if not _expected_platforms():
        pytest.skip("community_index.json 无平台声明，本守卫无对象")
    # env 装配移出 raises 块（原先连同 try/finally 一起塞在里面）：装配语句一旦
    # 自己抛出同型异常，这条测试就会**因错误的原因通过**。monkeypatch 亦自动收尾,
    # 手写 try/finally 恢复 env 的那一段随之整段消失。
    monkeypatch.setenv("BIAV_SC_DATA_ROOT", absent_root)
    with pytest.raises(opl.ArchiveSourceMissing) as exc:
        opl.preflight_archive_source()
    message = str(exc.value)
    # 报文必须自带出路，否则撞上的人只知道被拦、不知道怎么办。
    assert "BIAV_SC_DATA_ROOT" in message
    assert "--allow-missing-archive" in message


def test_escape_hatch_downgrades_the_refusal_to_a_warning(absent_root: str) -> None:
    """守卫不能变成不可绕过的墙——数据湖真废弃时须有显式放行口。"""
    import os

    old = os.environ.get("BIAV_SC_DATA_ROOT")
    os.environ["BIAV_SC_DATA_ROOT"] = absent_root
    try:
        flags = opl.preflight_archive_source(allow_missing=True)
    finally:
        if old is None:
            os.environ.pop("BIAV_SC_DATA_ROOT", None)
        else:
            os.environ["BIAV_SC_DATA_ROOT"] = old
    assert flags and "整体缺席" in flags[0]


def test_refusal_leaves_the_bundle_byte_for_byte_untouched(absent_root: str) -> None:
    """**本档最要紧的一条**：拒绝必须发生在 rmtree 之前。

    守卫若跑在擦除之后，报文再漂亮也没有意义——概念已经没了。
    """
    if not _expected_platforms():
        pytest.skip("community_index.json 无平台声明，本守卫无对象")
    bundle = REPO / "okf"
    before = sorted((p.relative_to(bundle).as_posix(), p.stat().st_size)
                    for p in bundle.rglob("*") if p.is_file())
    assert before, "okf/ 为空，本测试无从判断"
    proc = _run(env_root=absent_root)
    assert proc.returncode == 2, f"守卫未拦下：exit={proc.returncode}\n{proc.stderr[:400]}"
    assert "拒绝生成" in proc.stderr
    after = sorted((p.relative_to(bundle).as_posix(), p.stat().st_size)
                   for p in bundle.rglob("*") if p.is_file())
    assert after == before, "拒绝之后 bundle 被改动了——守卫跑在 rmtree 之后就没有意义"


def test_a_single_retired_platform_is_NOT_treated_as_source_absence(tmp_path: Path) -> None:
    """判据定在根级的理由：单个平台目录消失 = 该平台真退役，逐平台跳过是对的。

    只有「索引声明了 N 个、一个都解析不到」才算数据源缺席。把判据放在平台级会让
    任何一次正常退役都拦住生成，那样的守卫会被第一个撞上的人删掉。
    """
    import os

    expected = _expected_platforms()
    if len(expected) < 2:
        pytest.skip("平台不足 2 个，构造不出「退役一个仍有其余」的情形")
    root = tmp_path / "partial"
    community = root / "Record" / "Community"
    community.mkdir(parents=True)
    # 造出除第一个之外的全部平台目录 —— 第一个视作已退役。
    for name in expected[1:]:
        (community / name).mkdir(parents=True, exist_ok=True)
    old = os.environ.get("BIAV_SC_DATA_ROOT")
    os.environ["BIAV_SC_DATA_ROOT"] = str(root)
    try:
        flags = opl.preflight_archive_source()  # 不抛
    finally:
        if old is None:
            os.environ.pop("BIAV_SC_DATA_ROOT", None)
        else:
            os.environ["BIAV_SC_DATA_ROOT"] = old
    # 只缺一个，远不到过半，故连告警都不该有。
    assert flags == []


def test_more_than_half_missing_warns_loudly_without_blocking(tmp_path: Path) -> None:
    """过半消失是响亮告警而非拦截——真实迁移期拦下来会变成墙。"""
    import os

    expected = _expected_platforms()
    if len(expected) < 4:
        pytest.skip("平台不足 4 个，构造不出「过半缺席仍非全无」的情形")
    root = tmp_path / "half"
    community = root / "Record" / "Community"
    community.mkdir(parents=True)
    for name in expected[: max(1, len(expected) // 4)]:
        (community / name).mkdir(parents=True, exist_ok=True)
    old = os.environ.get("BIAV_SC_DATA_ROOT")
    os.environ["BIAV_SC_DATA_ROOT"] = str(root)
    try:
        flags = opl.preflight_archive_source()
    finally:
        if old is None:
            os.environ.pop("BIAV_SC_DATA_ROOT", None)
        else:
            os.environ["BIAV_SC_DATA_ROOT"] = old
    assert flags and "过半缺席" in flags[0]
