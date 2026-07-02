#!/usr/bin/env python3
"""银芯报告渲染器 — 结构化 markdown → 统一视觉风格的 PDF + HTML。

用途：把 Public-Info-Pool/Resource 下的报告 markdown 渲染成银芯标准视觉（封面 + 目录 +
暗金主题 + Noto Serif/Sans CJK + 大字号手机适配）的 PDF 与 HTML。视觉规范见
memory/style-guide.md（CLAUDE.md §6.12）；生产流程见 .claude/skills/biav-report。

依赖（ephemeral 容器每次会话可能需重装）：
    pip install weasyprint markdown
    # 字体：Noto Serif CJK SC / Noto Sans CJK SC（缺失则 weasyprint 自动 fallback）

用法：
    python scripts/report_render.py Public-Info-Pool/Resource/daily-news/foo.md
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
@page { size:210mm 297mm; margin:16mm 18mm 16mm 18mm; background:#0a0b10;
  @bottom-center{content:"— " counter(page) " —"; font-family:'Noto Sans CJK SC',sans-serif; font-size:9pt; color:#6b6040;} }
@page :first{ @bottom-center{content:none;} }
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Noto Sans CJK SC',sans-serif;font-size:10.5pt;line-height:1.5;color:#d2c69e;background:#0a0b10;}
a{color:#bfa15a;text-decoration:none;}
.cover{page-break-after:always;padding-top:52mm;text-align:center;}
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
h2.section-title{font-family:'Noto Serif CJK SC',serif;font-size:16pt;font-weight:700;color:#e2c97e;margin-top:1mm;margin-bottom:2mm;letter-spacing:1pt;page-break-before:always;page-break-after:avoid;}
hr.section-rule{border:none;border-top:2px solid #c5a356;margin-bottom:4mm;page-break-after:avoid;}
h3{font-family:'Noto Serif CJK SC',serif;page-break-after:avoid;font-size:12pt;font-weight:700;color:#c5a356;margin-top:4.5mm;margin-bottom:2mm;}
p{margin-bottom:2.2mm;text-align:justify;orphans:3;widows:3;}
strong{color:#e2c97e;font-weight:700;}
em{color:#a99a6a;font-style:normal;}
ul,ol{margin:2mm 0 3.5mm 7mm;}
li{margin-bottom:1.8mm;line-height:1.6;}
blockquote{border-left:3px solid #c5a356;background:#13141c;padding:2mm 4mm;margin:2.5mm 0;color:#b3a67e;font-size:10pt;}
blockquote p{margin-bottom:1.5mm;}
code{font-family:'Noto Sans Mono CJK SC','DejaVu Sans Mono',monospace;font-size:10.5pt;color:#c5a356;background:#15161e;padding:0 2px;word-break:break-all;}
hr.ornament{border:none;text-align:center;margin:5mm 0;}
hr.ornament::after{content:"\25C7  \25C7  \25C7";color:#6b6040;font-size:14pt;letter-spacing:4pt;}
table{width:100%;border-collapse:collapse;margin:2.5mm 0 3mm;font-size:9.5pt;page-break-inside:avoid;}
th{background:#1e1a10;color:#e2c97e;font-weight:700;padding:1.8mm 2.2mm;text-align:left;border:0.5px solid #3a3520;}
td{padding:1.6mm 2.2mm;border:0.5px solid #26220f;vertical-align:top;line-height:1.5;color:#c0b488;}
img{max-width:100%;height:auto;display:block;margin:3mm auto 1mm;border:1px solid #3a3520;}
.gallery-cap{font-size:10.5pt;color:#7a7050;text-align:center;margin-bottom:4mm;}
.quote-orig{color:#b3a67e;font-size:13pt;}
.quote-zh{color:#9a8d5e;font-size:12.5pt;}
.lead{font-size:11pt;color:#d8cba0;border-left:3px solid #c5a356;background:#13141c;padding:3mm 5mm;margin:2.5mm 0 4mm;line-height:1.65;}
.callout{border:1px solid #3a3520;background:#12130d;padding:3mm 4.5mm;margin:3mm 0;page-break-inside:avoid;}
.callout-risk{border-left:3px solid #b5683e;}
.callout-pos{border-left:3px solid #6f8f4a;}
.dim{border-left:3px solid #c5a356;background:#13141c;padding:1mm 5mm;margin:4mm 0 2mm;}
.dim h3{margin:1.5mm 0;color:#e2c97e;}
.badge{font-size:9.5pt;color:#0a0b10;background:#c5a356;padding:0 4px;border-radius:2px;font-weight:700;}
.badge-b{background:#a99a6a;}.badge-c{background:#7a7050;color:#13141c;}
.qq{border-left:2px solid #6b6040;padding:0.8mm 0 0.8mm 4mm;margin:2mm 0;}
.qq .o{color:#b3a67e;font-size:10pt;}
.qq .z{color:#8f8358;font-size:9.5pt;display:block;margin-top:0.6mm;}
.grid{margin:2mm 0 4mm;font-size:0;}
.grid img{width:31.5%;display:inline-block;vertical-align:top;margin:0.7%;border:1px solid #3a3520;}
.grid-day{font-size:11pt;color:#e2c97e;font-weight:700;margin:4mm 0 1mm;}
.gwrap{font-size:0;margin:1mm 0 3mm;}
.gcard{display:inline-block;width:23.4%;margin:0.8%;vertical-align:top;}
.gcard img{width:100%;height:auto;display:block;margin:0;border:1px solid #3a3520;}
.gcap{display:block;font-size:7.6pt;color:#7a7050;margin-top:0.6mm;line-height:1.3;}
.gcap a{color:#8a7438;}
.swhat{font-family:'Noto Serif CJK SC',serif;font-size:9.5pt;color:#8a8068;margin:-1.5mm 0 4mm;letter-spacing:0.5pt;}
.swhat::before{content:"\25B8  ";color:#c5a356;}
.statgrid{font-size:0;margin:2mm 0 3.5mm;}
.stat{display:inline-block;width:23%;margin:0.9%;vertical-align:top;background:#13141c;border:1px solid #3a3520;border-top:2px solid #c5a356;padding:2mm 1.5mm;text-align:center;}
.stat .n{display:block;font-family:'Noto Serif CJK SC',serif;font-size:15pt;font-weight:700;color:#e2c97e;line-height:1.1;}
.stat .l{display:block;font-size:8.5pt;color:#8a8068;margin-top:0.8mm;}
.bar{font-size:0;margin:1.3mm 0;page-break-inside:avoid;}
.bar .lab{display:inline-block;width:26%;font-size:9pt;color:#c0b488;vertical-align:middle;}
.bar .track{display:inline-block;width:58%;height:3mm;background:#15161e;vertical-align:middle;border:0.5px solid #26220f;}
.bar .fill{display:block;height:100%;background:#c5a356;}
.bar .fill.neg{background:#b5683e;}.bar .fill.pos{background:#6f8f4a;}
.bar .val{display:inline-block;width:14%;font-size:8.5pt;color:#a99a6a;text-align:right;vertical-align:middle;padding-left:1.2mm;}
.srccard{border:1px solid #3a3520;background:#101119;padding:2mm 3.5mm 1.2mm;margin:2.5mm 0;page-break-inside:avoid;}
.srchead{font-size:0;margin-bottom:1.2mm;}
.srchead .src{display:inline-block;font-size:10pt;font-weight:700;color:#0a0b10;background:#c5a356;padding:0.2mm 2.2mm;border-radius:2px;letter-spacing:0.5pt;}
.srchead .cnt{display:inline-block;font-size:8.5pt;color:#7a7050;margin-left:2.2mm;vertical-align:middle;}
.srccard .sum{font-size:10pt;color:#c5bb90;margin:0.8mm 0 1.2mm;line-height:1.55;}
.review{border-left:3px solid #6b6040;background:#13141c;padding:1.6mm 3.5mm;margin:1.8mm 0;page-break-inside:avoid;}
.review.pos{border-left-color:#6f8f4a;}.review.neg{border-left-color:#b5683e;}
.review .o{color:#b3a67e;font-size:10pt;}
.review .z{display:block;color:#8f8358;font-size:9.5pt;margin-top:0.6mm;}
.review .meta{display:block;font-size:8.5pt;color:#6b6040;margin-top:0.8mm;}
.pull{font-family:'Noto Serif CJK SC',serif;font-size:12.5pt;line-height:1.5;color:#e2c97e;border-left:4px solid #c5a356;padding:1.6mm 0 1.6mm 5mm;margin:3.5mm 0;}
.pull .z{display:block;font-family:'Noto Sans CJK SC',sans-serif;font-size:10pt;color:#9a8d5e;margin-top:1.2mm;}
.qqs{margin:1.6mm 0;padding-left:3.5mm;border-left:1px solid #3a3520;}
.qqs .o{color:#b3a67e;font-size:9.8pt;}
.qqs .z{color:#80764f;font-size:9pt;display:block;margin-top:0.4mm;}
.qqs .m{display:block;font-size:8pt;color:#6b6040;margin-top:0.5mm;}
.qqs .m a{color:#8a7438;}
.repro{border:1px solid #3a3520;background:#12130d;padding:2mm 3.5mm;margin:2mm 0;page-break-inside:avoid;font-size:10pt;}
.repro b{color:#e2c97e;}
'''


def slice_body(body_md):
    """切掉 h1 标题行（封面已含标题），从首个 ## 章节起；divider 换占位符。纯函数。"""
    idx = body_md.find('## §0')
    if idx < 0:
        idx = body_md.find('## ')
    if idx > 0:
        body_md = body_md[idx:]
    return body_md.replace('◇ ◇ ◇', '\n\n<DIVIDER>\n\n')


def decorate_body_html(body_html):
    """正文 HTML 装饰：divider 占位符 → 饰线 hr；h2 → 带锚点章节标题 + 章节线。
    返回 (装饰后 HTML, toc 列表 [(anchor, 标题), ...])。纯函数。"""
    body_html = body_html.replace('<p><DIVIDER></p>', '<hr class="ornament">')
    toc = []

    def h2_repl(mt):
        anchor = 'sec' + str(len(toc))
        toc.append((anchor, mt.group(1)))
        return f'<h2 class="section-title" id="{anchor}">{mt.group(1)}</h2>'

    body_html = re.sub(r'<h2>(.*?)</h2>', h2_repl, body_html)
    body_html = body_html.replace('</h2>', '</h2><hr class="section-rule">')
    return body_html, toc


def build_document(body_html, toc, title, subtitle, meta, cover_note):
    """封面 + 目录 + 正文拼装成完整 HTML 文档。纯函数。"""
    toc_html = '\n'.join(f'<div class="toc-item">{t}</div>' for _, t in toc)
    cover = (f'<div class="cover"><hr class="cover-rule"><h1>{title}</h1>'
             f'<div class="sub">{subtitle}</div><div class="meta">{meta}</div>'
             f'<hr class="cover-rule-b"><div class="erica">{cover_note}</div></div>'
             f'<div class="toc"><h2>目 录</h2><hr class="toc-rule">{toc_html}</div>')
    return (f'<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">'
            f'<style>{CSS}</style></head><body>{cover}'
            f'<div class="content">{body_html}</div></body></html>')


def build_html(body_md, title, subtitle, meta, cover_note):
    """markdown 正文 → 完整 HTML 文档字符串 + 目录条数。仅依赖 markdown（轻）。"""
    import markdown

    md = markdown.Markdown(extensions=['tables', 'sane_lists', 'fenced_code'])
    body_html, toc = decorate_body_html(md.convert(slice_body(body_md)))
    return build_document(body_html, toc, title, subtitle, meta, cover_note), len(toc)


def render(src, title, subtitle, meta, cover_note='弥萨格大学数据库终端 · 艾瑞卡'):
    """读盘 + build_html + 写 HTML/PDF 的薄壳；仅此处需要 weasyprint（重）。"""
    from weasyprint import HTML

    base = os.path.splitext(src)[0]
    out_html, out_pdf = base + '.html', base + '.pdf'
    raw = open(src, encoding='utf-8').read()
    _, body_md = parse_frontmatter(raw)
    doc, n_toc = build_html(body_md, title, subtitle, meta, cover_note)
    open(out_html, 'w', encoding='utf-8').write(doc)
    # base_url=cwd 让正文 markdown 的相对图片路径（相对仓库根）可被解析嵌入
    HTML(string=doc, base_url=os.getcwd()).write_pdf(out_pdf)
    return out_html, out_pdf, n_toc, os.path.getsize(out_pdf)


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
