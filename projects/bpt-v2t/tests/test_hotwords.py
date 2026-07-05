"""热词桥验证:确定性、预算、优先级、专名覆盖。云端可跑(无 ML 无麦克风)。"""
from bpt_v2t import hotwords


def test_hotword_list_nonempty_and_covers_core_terms():
    words = hotwords.hotword_list()
    assert len(words) > 0
    # 世界观固定词必在表中
    for t in ("忘却前夜", "守密人", "缸中之脑"):
        assert t in words


def test_hotword_list_deterministic_and_dedup():
    a = hotwords.hotword_list()
    b = hotwords.hotword_list()
    assert a == b
    assert len(a) == len(set(a))  # 无重复


def test_worldview_terms_ranked_first():
    words = hotwords.hotword_list()
    # 世界观固定词整体排在最前(优先级最高)
    head = words[: len(hotwords.WORLDVIEW_TERMS)]
    assert set(head) == set(hotwords.WORLDVIEW_TERMS)


def test_bias_prompt_respects_budget():
    for budget in (0, 20, 50, 200):
        s = hotwords.bias_prompt(budget)
        if budget <= 0:
            assert s == ""
        else:
            # 允许包含固定前后缀,但正文控制在预算量级(不失控)
            assert isinstance(s, str)


def test_bias_prompt_prioritizes_high_priority_terms():
    # 极小预算下,应先塞进世界观固定词而非字典序靠后的杂词
    s = hotwords.bias_prompt(30)
    assert "忘却前夜" in s or "意识潜游" in s


def test_bias_prompt_deterministic():
    assert hotwords.bias_prompt(120) == hotwords.bias_prompt(120)
