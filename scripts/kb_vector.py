"""kb_vector.py — 银芯向量检索腿（长尾语义召回后端，import-only 库）。

§八「厚锚撑向量」的银芯侧参照实现（守密人 2026-07-05 裁定(A) 解除零 ML 红线）。
脊柱（OKF / kb_navigator）托底可审计，本模块给长尾（社区全量档案）上色——对
**换了说法、脊柱与 grep 都到不了**的散句做模糊语义召回。

与 kb_navigator 的分工（§8.3 合流）：
  - kb_navigator.search / activate ：脊柱概念（白盒、带类型边）——「锚」。
  - kb_vector.search               ：长尾消息片段（黑盒语义相似）——「扩」。
  合流由 LLM 总指挥编排：先锚（脊柱定身份/边界）后扩（向量在锚周边捞正文）。

嵌入后端**可插拔**：
  - 生产 = Voyage API（需 ``VOYAGE_API_KEY``，CI secret 注入）。
  - 测试 = 确定性本地桩（token 哈希袋，零网络、可复现）——让管线/落存/检索/降级
    全部离线可验，契合仓内「测试零网络」纪律。真·语义召回质量只有 Voyage 后端有。

放指针不放本体：索引存 embedding + **紧凑指针（来源+日期）+ 短预览**，不复刻全量正文；
全文回落 dated 原文件 ripgrep（同 community_index 的钻取范式）。索引本体（可 MB→GB）
不进 git（见 .gitignore），由 CI 构建并上传 Release ``community-assets``，运行时经
``scripts/restore_release_data.py`` 同源还原（§1.1-HC 防火墙无涉：银芯自有公开档案）。

本模块**无 __main__**（import-only 部件）；索引构建走 ``scripts/build_kb_vectors.py``，
MCP 工具由 ``scripts/mcp_server.py`` 的 ``kb_vector_search`` 注册。
"""
from __future__ import annotations

import gzip
import hashlib
import json
import math
import os
from functools import lru_cache
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_INDEX = REPO / "okf" / "kb_vectors.json.gz"

# 桩后端维度（小；仅供离线测试的确定性伪嵌入，非语义）。
_STUB_DIM = 64
# Voyage 默认模型（可被 build_kb_vectors 覆盖；随索引 meta 落存以便查询对齐）。
_VOYAGE_MODEL = "voyage-3-lite"


class KBVectorIndexMissing(FileNotFoundError):
    """向量索引尚未构建 / 未还原时抛出（调用方应优雅降级到关键词检索）。"""


# --------------------------------------------------------------------------- #
# 嵌入后端（可插拔）
# --------------------------------------------------------------------------- #
def default_backend() -> str:
    """有 VOYAGE_API_KEY → 'voyage'（生产），否则 'stub'（离线确定性桩）。"""
    return "voyage" if os.environ.get("VOYAGE_API_KEY") else "stub"


def _stub_tokens(text: str) -> list[str]:
    try:
        from silver_tokenizer import tokenize
        return tokenize(text)
    except Exception:
        return [w for w in text.lower().split() if w]


def embed_stub(texts: list[str], dim: int = _STUB_DIM) -> list[list[float]]:
    """确定性伪嵌入：token 哈希袋 + L2 归一化。

    非语义——仅让「共享 token 的文本更相似」，供离线测试检索/排序/落存管线。
    同输入必得同向量（可复现），零网络、零 ML 模型。
    """
    out = []
    for t in texts:
        v = [0.0] * dim
        for tok in _stub_tokens(t or ""):
            h = int(hashlib.md5(tok.encode("utf-8")).hexdigest(), 16)
            v[h % dim] += 1.0
        out.append(_l2_normalize(v))
    return out


def embed_voyage(texts: list[str], model: str = _VOYAGE_MODEL,
                 input_type: str = "document") -> list[list[float]]:
    """Voyage 嵌入（生产后端）。需 voyageai 包 + VOYAGE_API_KEY。"""
    import voyageai  # 可选依赖，缺失时由调用方降级

    client = voyageai.Client()  # 读 VOYAGE_API_KEY
    result = client.embed(texts, model=model, input_type=input_type)
    return [list(v) for v in result.embeddings]


def embed(texts: list[str], backend: str | None = None,
          model: str = _VOYAGE_MODEL, input_type: str = "document") -> list[list[float]]:
    """按后端嵌入一批文本。backend=None → default_backend()。"""
    backend = backend or default_backend()
    if backend == "voyage":
        return embed_voyage(texts, model=model, input_type=input_type)
    if backend == "stub":
        return embed_stub(texts)
    raise ValueError(f"未知嵌入后端: {backend}")


# --------------------------------------------------------------------------- #
# 向量数学（纯 Python，有界原型无需 numpy/ANN 库；量产阶段再上 faiss）
# --------------------------------------------------------------------------- #
def _l2_normalize(v: list[float]) -> list[float]:
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def _cosine_prenorm(a: list[float], b: list[float]) -> float:
    """两个**已归一化**向量的余弦 = 点积。"""
    return sum(x * y for x, y in zip(a, b))


# --------------------------------------------------------------------------- #
# 索引读写
# --------------------------------------------------------------------------- #
def write_index(path: Path, items: list[dict], meta: dict) -> None:
    """落 gzip JSON 索引（沿用退役栈 vectors.json.gz 的紧凑格式）。

    items: [{ref, source, date, preview, vec:[...]}]（vec 已 L2 归一化）。
    meta : {backend, model, dim, count, generated?, data_layer, ...}。
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"_meta": meta, "items": items}
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    # 字节确定性：gzip 头默认内嵌 mtime + 源文件名，会让同内容两次写出字节不同
    # → 若索引入 git，CI 的 `git diff --staged --quiet` 每次都判为变、平白 churn 历史。
    # 固定 mtime=0 + 空 filename，令「同 rows → 同字节」，只在真内容变更时才产生 diff。
    with open(path, "wb") as raw:
        with gzip.GzipFile(filename="", mtime=0, fileobj=raw, mode="wb") as gz:
            gz.write(data)


@lru_cache(maxsize=2)
def load_index(path: str | None = None) -> dict:
    p = Path(path) if path else DEFAULT_INDEX
    if not p.exists():
        raise KBVectorIndexMissing(
            f"{p} 未生成/未还原 — 先跑 scripts/build_kb_vectors.py，"
            "或从 Release 还原（scripts/restore_release_data.py）。"
        )
    with gzip.open(p, "rt", encoding="utf-8") as fh:
        return json.load(fh)


# --------------------------------------------------------------------------- #
# 检索（长尾语义召回；缺索引优雅降级）
# --------------------------------------------------------------------------- #
def search(query: str, limit: int = 8, path: str | None = None,
           backend: str | None = None) -> dict:
    """对长尾语料做语义召回，返回带指针的片段命中（放指针不放本体）。

    缺索引 → 不抛栈，返回 ``degraded`` 标记 + 关键词回退提示（调用方可转 kb_search）。
    结果形状：{query, backend, degraded, returned, results:[{score, source, date,
    preview, ref, data_layer}]}。
    """
    try:
        idx = load_index(path)
    except KBVectorIndexMissing as e:
        return {
            "query": query,
            "degraded": True,
            "reason": str(e),
            "fallback": "改用 kb_search（关键词）——向量索引缺失时的白盒回退",
            "results": [],
        }

    meta = idx.get("_meta", {})
    items = idx.get("items", [])
    # 查询嵌入必须与索引同后端/同模型，否则向量空间对不上。
    q_backend = backend or meta.get("backend") or default_backend()
    q_model = meta.get("model", _VOYAGE_MODEL)
    # 围栏**仅** embed 调用：voyage 后端索引在运行时若缺 voyageai 包或 VOYAGE_API_KEY，
    # embed_voyage 会抛 ImportError/鉴权错——不捕获则穿透 search、把「脊柱托底」一起带崩
    # （厚锚合流依赖此处就地降级，见 §八 8.3）。窄捕获不吞 cosine 等真 bug。
    try:
        qvec = embed([query], backend=q_backend, model=q_model, input_type="query")[0]
    except Exception as e:
        return {
            "query": query,
            "backend": q_backend,
            "degraded": True,
            "reason": f"查询嵌入不可用（需 voyageai 包 + VOYAGE_API_KEY）：{type(e).__name__}: {e}",
            "fallback": "改用 kb_search（关键词）白盒回退",
            "results": [],
        }

    scored = []
    for it in items:
        vec = it.get("vec")
        if not vec:
            continue
        scored.append((_cosine_prenorm(qvec, vec), it))
    # 确定性 tie-break：分数降序，然后 ref 升序。
    scored.sort(key=lambda r: (-r[0], (r[1].get("ref") or "")))

    limit = max(1, min(int(limit or 8), 50))
    results = [
        {
            "score": round(sc, 4),
            "source": it.get("source"),
            "date": it.get("date"),
            "preview": it.get("preview"),
            "ref": it.get("ref"),
            "data_layer": meta.get("data_layer", "full_archive"),
        }
        for sc, it in scored[:limit]
    ]
    return {
        "query": query,
        "backend": q_backend,
        "degraded": False,
        "total_indexed": len(items),
        "returned": len(results),
        "results": results,
    }
