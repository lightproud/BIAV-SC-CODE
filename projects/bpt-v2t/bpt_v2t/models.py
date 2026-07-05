"""sherpa-onnx 模型管理:清单进 git、权重(onnx,数百 MB)不进 git。

仓库只存「藏宝图」(archive URL + 解压后目录名 + 四件文件的匹配规则);首次本地运行
`ensure()` 按图下载解压到缓存目录。云端可测的是清单结构 + 路径解析 + 缺文件报错;
真下载(联网、大文件)只在守密人本机。

缓存目录:环境变量 `BPT_V2T_MODEL_DIR` 优先,否则 `~/.cache/bpt-v2t/models`。
"""
from __future__ import annotations

import os
from pathlib import Path

# 默认:中文流式 zipformer(cjkchar 建模单元,支持热词/contextual biasing)。
# archive_sha256 留 None = 首次下载后由守密人核对补填(不编造校验码,见 CONTEXT)。
MODELS: dict[str, dict] = {
    "zh-streaming-zipformer-14m": {
        "desc": "中文流式 zipformer transducer(cjkchar,支持热词),约 14M 参数,CPU 友好",
        "archive_url": (
            "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/"
            "sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23.tar.bz2"
        ),
        "archive_sha256": None,
        "root": "sherpa-onnx-streaming-zipformer-zh-14M-2023-02-23",
        # 四件文件按 glob 匹配(避免不同发行版精确文件名漂移;优先非 int8)
        "globs": {
            "tokens": ["tokens.txt"],
            "encoder": ["encoder-*.onnx"],
            "decoder": ["decoder-*.onnx"],
            "joiner": ["joiner-*.onnx"],
        },
        "modeling_unit": "cjkchar",
    },
}

DEFAULT_MODEL_ID = "zh-streaming-zipformer-14m"


def cache_root() -> Path:
    env = os.environ.get("BPT_V2T_MODEL_DIR")
    if env:
        return Path(env)
    return Path.home() / ".cache" / "bpt-v2t" / "models"


def model_dir(model_id: str) -> Path:
    spec = _spec(model_id)
    return cache_root() / spec["root"]


def _spec(model_id: str) -> dict:
    if model_id not in MODELS:
        raise ValueError(f"未知 model_id: {model_id!r}(可用: {', '.join(MODELS)})")
    return MODELS[model_id]


def _pick(base: Path, patterns: list[str]) -> Path:
    # 优先非 int8 权重(更准);找不到再收 int8
    hits: list[Path] = []
    for pat in patterns:
        hits.extend(sorted(base.glob(pat)))
    non_int8 = [h for h in hits if "int8" not in h.name]
    chosen = non_int8 or hits
    if not chosen:
        raise FileNotFoundError(f"{base} 下未找到匹配 {patterns} 的文件")
    return chosen[0]


def resolve(model_id: str) -> dict:
    """把 model_id 解析成四件模型绝对路径(tokens/encoder/decoder/joiner)。

    模型目录缺失 / 文件不全时抛可读错,提示先跑 ensure(或 scripts/fetch_model.py)。
    """
    spec = _spec(model_id)
    base = model_dir(model_id)
    if not base.is_dir():
        raise FileNotFoundError(
            f"模型未就绪:{base} 不存在。先在本机跑 "
            f"`python scripts/fetch_model.py {model_id}` 下载(需联网)。"
        )
    paths = {key: str(_pick(base, pats)) for key, pats in spec["globs"].items()}
    paths["modeling_unit"] = spec["modeling_unit"]
    return paths


def ensure(model_id: str, *, quiet: bool = False) -> Path:
    """确保模型就绪:缺则下载 archive 到缓存并解压。返回模型目录。本地/联网。"""
    spec = _spec(model_id)
    base = model_dir(model_id)
    if base.is_dir():
        try:
            resolve(model_id)
            return base
        except FileNotFoundError:
            pass  # 目录在但文件不全,重新解压

    import hashlib
    import tarfile
    import tempfile
    import urllib.request

    root = cache_root()
    root.mkdir(parents=True, exist_ok=True)
    url = spec["archive_url"]
    if not quiet:
        print(f"[bpt-v2t] 下载模型 {model_id}: {url}")
    with tempfile.NamedTemporaryFile(suffix=".tar.bz2", delete=False) as tmp:
        urllib.request.urlretrieve(url, tmp.name)  # noqa: S310 - 官方发行地址
        archive = Path(tmp.name)

    want_sha = spec.get("archive_sha256")
    if want_sha:
        got = hashlib.sha256(archive.read_bytes()).hexdigest()
        if got != want_sha:
            archive.unlink(missing_ok=True)
            raise ValueError(f"模型 archive sha256 不匹配:want {want_sha}, got {got}")
    elif not quiet:
        print("[bpt-v2t] 警告:清单未登记 archive_sha256,跳过校验(下载后请核对补填)")

    with tarfile.open(archive, "r:bz2") as tf:
        tf.extractall(root)  # noqa: S202 - 官方发行归档
    archive.unlink(missing_ok=True)
    resolve(model_id)  # 校验解压后四件齐全
    if not quiet:
        print(f"[bpt-v2t] 模型就绪:{base}")
    return base
