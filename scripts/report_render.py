#!/usr/bin/env python3
"""银芯报告渲染器 — 结构化 markdown → 统一视觉风格的 PDF + HTML。

用途：把 deliverables 下的报告 markdown 渲染成银芯标准视觉（封面 + 目录 +
暗金主题 + Noto Serif/Sans CJK + 大字号手机适配）的 PDF 与 HTML。视觉规范见
memory/style-guide.md（CLAUDE.md §6.12）；生产流程见 .claude/skills/biav-report。

依赖（ephemeral 容器每次会话可能需重装）：
    pip install weasyprint markdown
    # 字体：Noto Serif CJK SC / Noto Sans CJK SC（缺失则 weasyprint 自动 fallback）

用法：
    python scripts/report_render.py deliverables/2026-05/foo.md
    # 默认从 markdown frontmatter 读取 title/subtitle/basis/author/generated 拼装封面
    python scripts/report_render.py foo.md --title "标题" --subtitle "副标题" --meta "封面落款<br>第二行"

frontmatter 约定（YAML 风格 key: value）：
    title / subtitle / basis / author / generated
封面 meta 默认 = basis + "产出：{author} · {generated}"，可用 --meta 覆盖。
"""
import re, os, argparse


def parse_frontmatter(raw):
    m = re.match(r'^---\n(.*?)\n---\n', raw, re.S)
    fm = {}
    if not m:
        return fm, raw
    for line in m.group(1).splitlines():
        if ':' in line:
            k, v = line.split(':', 1)
            fm[k.strip()] = v.strip().strip('"').strip("'")
    return fm, raw[m.end():]


CSS = r'''
@page { size:150mm 210mm; margin:12mm 11mm 12mm 11mm; background:#0a0b10;
  @bottom-center{content:"— " counter(page) " —"; font-family:'Noto Sans CJK SC',sans-serif; font-size:11pt; color:#6b6040;} }
@page :first{ @bottom-center{content:none;} }
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Noto Sans CJK SC',sans-serif;font-size:12.5pt;line-height:1.68;color:#cdc2a1;background:#0a0b10;}
.cover{page-break-after:always;padding-top:34mm;text-align:center;}
.cover-rule{border:none;border-top:2px solid #c5a356;width:64%;margin:0 auto 11mm;}
.cover-rule-b{border:none;border-top:1px solid #3a3520;width:82%;margin:11mm auto 6mm;}
.cover h1{font-family:'Noto Serif CJK SC',serif;font-size:24pt;font-weight:700;color:#e2c97e;line-height:1.5;margin-bottom:7mm;letter-spacing:1pt;}
.cover .sub{font-size:14pt;color:#b09a5e;margin-bottom:10mm;line-height:1.7;}
.cover .meta{font-size:12pt;color:#7a7050;line-height:2;margin-top:8mm;}
.cover .erica{font-family:'Noto Serif CJK SC',serif;font-size:14pt;color:#8a8068;margin-top:13mm;letter-spacing:3pt;}
.toc{page-break-after:always;padding-top:14mm;}
.toc h2{font-family:'Noto Serif CJK SC',serif;font-size:19pt;color:#e2c97e;text-align:center;margin-bottom:4mm;letter-spacing:4pt;}
.toc-rule{border:none;border-top:2px solid #c5a356;width:40%;margin:0 auto 7mm;}
.toc-item{font-size:12.5pt;line-height:1.95;color:#c5a356;text-align:center;}
h2.section-title{font-family:'Noto Serif CJK SC',serif;font-size:18pt;font-weight:700;color:#e2c97e;margin-top:1mm;margin-bottom:2mm;letter-spacing:1pt;page-break-before:always;page-break-after:avoid;}
hr.section-rule{border:none;border-top:2px solid #c5a356;margin-bottom:5mm;page-break-after:avoid;}
h3{font-family:'Noto Serif CJK SC',serif;page-break-after:avoid;font-size:14pt;font-weight:700;color:#c5a356;margin-top:6mm;margin-bottom:3mm;}
p{margin-bottom:2.6mm;text-align:justify;orphans:3;widows:3;}
strong{color:#e2c97e;font-weight:700;}
em{color:#a99a6a;font-style:normal;}
ul,ol{margin:2mm 0 3.5mm 7mm;}
li{margin-bottom:1.8mm;line-height:1.6;}
blockquote{border-left:3px solid #c5a356;background:#13141c;padding:2.5mm 4mm;margin:3mm 0;color:#b3a67e;font-size:11.5pt;}
blockquote p{margin-bottom:1.8mm;}
code{font-family:'Noto Sans Mono CJK SC','DejaVu Sans Mono',monospace;font-size:12.5pt;color:#c5a356;background:#15161e;padding:0 2px;word-break:break-all;}
hr.ornament{border:none;text-align:center;margin:5mm 0;}
hr.ornament::after{content:"\25C7  \25C7  \25C7";color:#6b6040;font-size:14pt;letter-spacing:4pt;}
table{width:100%;border-collapse:collapse;margin:3mm 0 3.5mm;font-size:11pt;page-break-inside:avoid;}
th{background:#1e1a10;color:#e2c97e;font-weight:700;padding:2.2mm 2.6mm;text-align:left;border:0.5px solid #3a3520;}
td{padding:2mm 2.6mm;border:0.5px solid #26220f;vertical-align:top;line-height:1.65;color:#c0b488;}
img{max-width:100%;height:auto;display:block;margin:3mm auto 1mm;border:1px solid #3a3520;}
.gallery-cap{font-size:10.5pt;color:#7a7050;text-align:center;margin-bottom:4mm;}
.quote-orig{color:#b3a67e;font-size:13pt;}
.quote-zh{color:#9a8d5e;font-size:12.5pt;}
.lead{font-size:13pt;color:#d8cba0;border-left:3px solid #c5a356;background:#13141c;padding:4mm 6mm;margin:3mm 0 5mm;line-height:1.9;}
.callout{border:1px solid #3a3520;background:#12130d;padding:3.5mm 5mm;margin:4mm 0;page-break-inside:avoid;}
.callout-risk{border-left:3px solid #b5683e;}
.callout-pos{border-left:3px solid #6f8f4a;}
.dim{border-left:3px solid #c5a356;background:#13141c;padding:1mm 5mm;margin:5mm 0 2mm;}
.dim h3{margin:2mm 0;color:#e2c97e;}
.badge{font-size:10.5pt;color:#0a0b10;background:#c5a356;padding:0 4px;border-radius:2px;font-weight:700;}
.badge-b{background:#a99a6a;}.badge-c{background:#7a7050;color:#13141c;}
.qq{border-left:2px solid #6b6040;padding:1mm 0 1mm 5mm;margin:2.5mm 0;}
.qq .o{color:#b3a67e;font-size:11.5pt;}
.qq .z{color:#8f8358;font-size:11pt;display:block;margin-top:1mm;}
.grid{margin:2mm 0 4mm;font-size:0;}
.grid img{width:31.5%;display:inline-block;vertical-align:top;margin:0.7%;border:1px solid #3a3520;}
.grid-day{font-size:12pt;color:#e2c97e;font-weight:700;margin:4mm 0 1mm;}
'''


def render(src, title, subtitle, meta, cover_note='弥萨格大学数据库终端 · 艾瑞卡'):
    import markdown
    from weasyprint import HTML

    base = os.path.splitext(src)[0]
    out_html, out_pdf = base + '.html', base + '.pdf'
    raw = open(src, encoding='utf-8').read()
    _, body_md = parse_frontmatter(raw)

    # 切掉 h1 标题行（封面已含标题），从首个 ## 章节起
    idx = body_md.find('## §0')
    if idx < 0:
        idx = body_md.find('## ')
    if idx > 0:
        body_md = body_md[idx:]
    body_md = body_md.replace('◇ ◇ ◇', '\n\n<DIVIDER>\n\n')

    md = markdown.Markdown(extensions=['tables', 'sane_lists', 'fenced_code'])
    body_html = md.convert(body_md).replace('<p><DIVIDER></p>', '<hr class="ornament">')

    toc = []

    def h2_repl(mt):
        anchor = 'sec' + str(len(toc))
        toc.append((anchor, mt.group(1)))
        return f'<h2 class="section-title" id="{anchor}">{mt.group(1)}</h2>'

    body_html = re.sub(r'<h2>(.*?)</h2>', h2_repl, body_html)
    body_html = body_html.replace('</h2>', '</h2><hr class="section-rule">')
    toc_html = '\n'.join(f'<div class="toc-item">{t}</div>' for _, t in toc)

    cover = (f'<div class="cover"><hr class="cover-rule"><h1>{title}</h1>'
             f'<div class="sub">{subtitle}</div><div class="meta">{meta}</div>'
             f'<hr class="cover-rule-b"><div class="erica">{cover_note}</div></div>'
             f'<div class="toc"><h2>目 录</h2><hr class="toc-rule">{toc_html}</div>')

    doc = (f'<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">'
           f'<style>{CSS}</style></head><body>{cover}'
           f'<div class="content">{body_html}</div></body></html>')
    open(out_html, 'w', encoding='utf-8').write(doc)
    # base_url=cwd 让正文 markdown 的相对图片路径（相对仓库根）可被解析嵌入
    HTML(string=doc, base_url=os.getcwd()).write_pdf(out_pdf)
    return out_html, out_pdf, len(toc), os.path.getsize(out_pdf)


def main():
    ap = argparse.ArgumentParser(description='银芯报告渲染器：markdown → PDF + HTML')
    ap.add_argument('src', help='报告 markdown 路径')
    ap.add_argument('--title', help='封面主标题（默认取 frontmatter title）')
    ap.add_argument('--subtitle', help='封面副标题（默认取 frontmatter subtitle）')
    ap.add_argument('--meta', help='封面落款（HTML，<br> 换行；默认由 basis/author/generated 拼装）')
    ap.add_argument('--cover-note', default='弥萨格大学数据库终端 · 艾瑞卡', help='封面底部署名行')
    a = ap.parse_args()

    fm, _ = parse_frontmatter(open(a.src, encoding='utf-8').read())
    title = a.title or fm.get('title', '银芯报告')
    subtitle = a.subtitle or fm.get('subtitle', '')
    if a.meta:
        meta = a.meta
    else:
        parts = []
        if fm.get('basis'):
            parts.append(fm['basis'])
        tail = ' · '.join(filter(None, [fm.get('author', ''), fm.get('generated', '')]))
        if tail:
            parts.append('产出：' + tail)
        meta = '<br>'.join(parts)

    html, pdf, n_toc, size = render(a.src, title, subtitle, meta, a.cover_note)
    print(f'HTML: {html}\nPDF:  {pdf}  ({size} bytes, 目录 {n_toc} 章)')


if __name__ == '__main__':
    main()
