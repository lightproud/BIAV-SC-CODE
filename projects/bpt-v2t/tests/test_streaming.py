"""流式契约验证:FakeStreamingSession 增量/定稿语义。云端可跑(无 ML 无麦克风)。"""
from bpt_v2t.backends import (
    StreamResult,
    get_streaming_backend,
    streaming_available,
)
from bpt_v2t.backends.streaming import FakeStreamingTranscriber, StreamingTranscriber


def test_streaming_available_lists_expected():
    assert "fake-streaming" in streaming_available()
    assert "sherpa-onnx" in streaming_available()


def test_get_streaming_backend_fake():
    b = get_streaming_backend("fake-streaming", script="你好 世界")
    assert isinstance(b, StreamingTranscriber)


def test_fake_stream_emits_partials_then_final():
    b = FakeStreamingTranscriber(script="忘却 前夜 意识")
    sess = b.stream(language="zh")
    # 逐块喂,partial 前缀逐步变长
    seen_partial: list[str] = []
    for _ in range(3):
        sess.accept([0.0], 16000)
        for r in sess.poll():
            assert isinstance(r, StreamResult)
            assert not r.is_final
            seen_partial.append(r.text)
    assert seen_partial[0] == "忘却"
    assert seen_partial[-1] == "忘却 前夜 意识"
    # finish 吐 final 整句
    finals = sess.finish()
    assert len(finals) == 1
    assert finals[0].is_final
    assert finals[0].text == "忘却 前夜 意识"


def test_fake_stream_empty_script():
    sess = FakeStreamingTranscriber(script="").stream()
    sess.accept([0.0], 16000)
    assert sess.poll() == []
    assert sess.finish() == []


def test_stream_result_speaker_placeholder_none():
    r = StreamResult(text="x")
    assert r.speaker is None  # Phase C 声纹前恒 None


def test_unknown_streaming_backend_raises():
    import pytest

    with pytest.raises(ValueError):
        get_streaming_backend("nonesuch")


def test_sherpa_alias_resolves_without_loading_engine():
    # 别名可解析、构造成功;惰性保证不在此 import sherpa_onnx / 下模型
    b = get_streaming_backend("sherpa-onnx", model_id="zh-streaming-zipformer-14m")
    assert isinstance(b, StreamingTranscriber)
    assert b._recognizer is None
