#!/usr/bin/env python3
"""本地拉取 sherpa-onnx 模型(需联网)。云端容器不建议跑(无麦克风、模型大)。

用法:
    python scripts/fetch_model.py                 # 拉默认模型
    python scripts/fetch_model.py <model_id>      # 拉指定模型
    python scripts/fetch_model.py --list          # 列清单
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bpt_v2t import models  # noqa: E402


def main(argv: list[str]) -> int:
    if "--list" in argv:
        for mid, spec in models.MODELS.items():
            print(f"{mid}\t{spec['desc']}")
        return 0
    model_id = next((a for a in argv if not a.startswith("-")), models.DEFAULT_MODEL_ID)
    models.ensure(model_id)
    print(models.resolve(model_id))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
