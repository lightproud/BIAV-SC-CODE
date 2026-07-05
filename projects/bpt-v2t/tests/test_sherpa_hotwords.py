"""sherpa 热词桥验证:cjkchar 分字格式、专名覆盖、确定性、落盘。云端可跑。"""
import pytest

from bpt_v2t import hotwords


def test_lines_are_space_split_chars():
    lines = hotwords.sherpa_hotwords_lines()
    assert lines
    # 每行是空格分字:去空格后应是连续 CJK,且字数 = token 数
    for ln in lines[:20]:
        chars = ln.split(" ")
        assert all(len(c) == 1 for c in chars)
        joined = "".join(chars)
        assert 2 <= len(joined) <= 8


def test_lines_cover_worldview_terms():
    lines = set(hotwords.sherpa_hotwords_lines())
    assert " ".join("忘却前夜") in lines   # 忘 却 前 夜
    assert " ".join("守密人") in lines


def test_lines_deterministic():
    assert hotwords.sherpa_hotwords_lines() == hotwords.sherpa_hotwords_lines()


def test_unsupported_modeling_unit_raises():
    with pytest.raises(ValueError):
        hotwords.sherpa_hotwords_lines(modeling_unit="bpe")


def test_write_hotwords_file(tmp_path):
    dest = tmp_path / "sub" / "hw.txt"
    out = hotwords.write_hotwords_file(dest)
    assert out == dest
    assert dest.exists()
    content = dest.read_text(encoding="utf-8")
    assert " ".join("忘却前夜") in content.splitlines()
    # 与生成器一致
    assert content.strip().splitlines() == hotwords.sherpa_hotwords_lines()
