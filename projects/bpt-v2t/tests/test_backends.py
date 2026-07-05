"""后端契约验证:注册表 / 假后端 / 惰性加载。云端可跑(不下真模型)。"""
import pytest

from bpt_v2t.backends import Transcript, available, get_backend, register
from bpt_v2t.backends.base import Transcriber


def test_available_lists_expected():
    assert "fake" in available()
    assert "faster-whisper" in available()


def test_fake_backend_echoes_script():
    b = get_backend("fake", script="你好世界")
    t = b.transcribe("dummy.wav", language="zh")
    assert isinstance(t, Transcript)
    assert t.text == "你好世界"
    assert t.language == "zh"


def test_fake_backend_callable_sees_bias_prompt():
    seen = {}

    def script(audio, bias, hot):
        seen["bias"] = bias
        return "ok"

    b = get_backend("fake", script=script)
    b.transcribe("x.wav", bias_prompt="以下为可能出现的专有名词:忘却前夜。")
    assert "忘却前夜" in seen["bias"]


def test_fake_backend_default_text_from_path():
    b = get_backend("fake")
    t = b.transcribe("clip.wav")
    assert t.text == "[fake:clip.wav]"


def test_unknown_backend_raises():
    with pytest.raises(ValueError):
        get_backend("nonesuch")


def test_faster_whisper_alias_resolves_without_loading_model():
    # 别名可解析、构造成功;惰性加载保证不在此触发模型下载
    b = get_backend("faster-whisper", model="tiny")
    assert isinstance(b, Transcriber)
    assert b._model is None  # 尚未加载


def test_register_custom_backend():
    class Dummy(Transcriber):
        name = "dummy"

        def transcribe(self, audio, *, language="zh", bias_prompt=None, hotwords=None):
            return Transcript(text="d", language=language)

    register("dummy", Dummy)
    assert isinstance(get_backend("dummy"), Dummy)
