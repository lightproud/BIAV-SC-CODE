#!/usr/bin/env python3
"""Black Pool（黑池）品牌图标生成器（守密人 2026-08-02 品牌换装补漏 #2：应用图标）。

单一源图 → 全套消费尺寸，产出落 build/brand-assets/（rebrand.py ASSET_OVERLAYS
组装期覆盖进树）。换图流程 = 守密人把新源图放到 build/brand-assets/source.png
→ 重跑本脚本 → 重跑 build/rebrand.py 重生成补丁 → 提交。

源图解析顺序：build/brand-assets/source.png（守密人正式供图位，优先）→
仓内占位 assets/images/portraits/erica.png（守密人 2026-08-02 裁定「另行供图」，
正式图未落仓前以艾瑞卡立绘占位）。

产出（均方形）：
  icon.png             256px  electron-builder 图标基座（apps/desktop/assets/icon.png）
  icon.ico             16-256 win exe / 任务栏 / 托盘（apps/desktop/assets/icon.ico）
  apple-touch-icon.png 180px  运行时窗口图标 + favicon（apps/desktop/public/）
  brand-tile.jpg       512px  About 页 BrandMark 品牌位（覆盖 public/nous-girl.jpg，
                              白底合成——组件把它摆在白色圆角 tile 上）

依赖：Pillow（仅生成期用，运行面零依赖）。
"""
from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = HERE / "brand-assets"
REPO = HERE.parent.parent.parent
SOURCE_CANDIDATES = [
    OUT / "source.png",
    REPO / "assets" / "images" / "portraits" / "erica.png",
]
ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]


def pick_source() -> Path:
    for p in SOURCE_CANDIDATES:
        if p.is_file():
            return p
    raise SystemExit(f"no source image found, tried: {SOURCE_CANDIDATES}")


def square(im: Image.Image) -> Image.Image:
    """居中裁成方形（源图通常已方形，此步幂等）。"""
    w, h = im.size
    side = min(w, h)
    left, top = (w - side) // 2, (h - side) // 2
    return im.crop((left, top, left + side, top + side))


def main() -> int:
    src_path = pick_source()
    im = square(Image.open(src_path).convert("RGBA"))
    OUT.mkdir(exist_ok=True)

    resample = Image.LANCZOS

    im.resize((256, 256), resample).save(OUT / "icon.png")
    im.resize((256, 256), resample).save(
        OUT / "icon.ico", sizes=[(s, s) for s in ICO_SIZES])
    im.resize((180, 180), resample).save(OUT / "apple-touch-icon.png")

    tile = Image.new("RGBA", (512, 512), (255, 255, 255, 255))
    tile.alpha_composite(im.resize((512, 512), resample))
    tile.convert("RGB").save(OUT / "brand-tile.jpg", quality=92)

    print(f"source: {src_path}")
    for p in sorted(OUT.iterdir()):
        if p.name != "source.png":
            print(f"  wrote {p.name} ({p.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
