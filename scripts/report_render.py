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
@page { size:210mm 297mm; margin:26mm 22mm 22mm 22mm; background:#0a0b10;
  @bottom-left{content:string(doctitle); font-family:'Noto Sans CJK SC',sans-serif; font-size:10pt; color:#7a7468; letter-spacing:1.5pt;}
  @bottom-right{content:counter(page) " / " counter(pages); font-family:'Noto Sans CJK SC',sans-serif; font-size:10pt; color:#7a7468; letter-spacing:1.5pt;} }
@page :first{ @bottom-left{content:none;} @bottom-right{content:none;} }
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Noto Sans CJK SC',sans-serif;font-size:15pt;font-weight:500;line-height:2;color:#f2ede2;background:#0a0b10;}
a{color:#d2ab58;text-decoration:none;}
.cover{page-break-after:always;padding-top:52mm;text-align:center;}
.cover-rule{border:none;border-top:2px solid #d2ab58;width:60px;margin:0 auto 14mm;}
.cover-rule-b{border:none;border-top:1px solid rgba(242,237,226,.14);width:70%;margin:14mm auto 6mm;}
.cover h1{font-family:'Noto Serif CJK SC',serif;font-size:32pt;font-weight:700;color:#ecd48d;line-height:1.7;margin-bottom:8mm;letter-spacing:3pt;string-set:doctitle content();}
.cover .sub{font-size:15pt;color:#9c8850;margin-bottom:10mm;line-height:2.1;letter-spacing:1pt;}
.cover .meta{font-size:12pt;color:#7a7468;line-height:2.3;margin-top:8mm;}
.cover .erica{font-family:'Noto Serif CJK SC',serif;font-size:14pt;color:#b8ad9c;margin-top:13mm;letter-spacing:3pt;}
.toc{page-break-after:always;padding-top:16mm;}
.toc h2{font-family:'Noto Serif CJK SC',serif;font-size:22pt;font-weight:700;color:#ecd48d;text-align:center;margin-bottom:5mm;letter-spacing:5pt;}
.toc-rule{border:none;border-top:2px solid #d2ab58;width:40px;margin:0 auto 9mm;}
.toc-item{font-size:14pt;line-height:2.2;color:#d2ab58;text-align:center;font-weight:500;}
h2.section-title{font-family:'Noto Serif CJK SC',serif;font-size:22pt;font-weight:700;color:#ecd48d;margin-top:1mm;margin-bottom:5mm;letter-spacing:1pt;page-break-before:always;page-break-after:avoid;}
hr.section-rule{border:none;border-top:2px solid #d2ab58;width:40px;margin:0 0 12mm;page-break-after:avoid;}
h3{font-family:'Noto Sans CJK SC',sans-serif;page-break-after:avoid;font-size:16pt;font-weight:700;color:#ecd48d;margin-top:9mm;margin-bottom:3mm;}
p{margin-bottom:4mm;text-align:left;orphans:3;widows:3;}
strong{color:#ecd48d;font-weight:700;}
em{color:#b8ad9c;font-style:normal;}
ul,ol{margin:2mm 0 4mm 6mm;list-style:none;}
li{margin-bottom:2mm;line-height:1.9;}
ul li::before{content:"\25C6  ";color:#d2ab58;font-size:7pt;vertical-align:1pt;}
blockquote{border-left:4px solid #d2ab58;background:rgba(210,171,88,.06);padding:4mm 6mm;margin:4mm 0;color:#f2ede2;font-size:15pt;line-height:1.9;}
blockquote p{margin-bottom:2mm;}
code{font-family:'Noto Sans Mono CJK SC','DejaVu Sans Mono',monospace;font-size:13pt;color:#d2ab58;background:#131210;padding:0 3px;word-break:break-all;}
hr.ornament{border:none;text-align:center;margin:9mm 0;}
hr.ornament::after{content:"\25C7  \25C7  \25C7";color:#3a382c;font-size:10pt;letter-spacing:6pt;}
table{width:100%;border-collapse:collapse;margin:4mm 0 5mm;font-size:13pt;}
th{background:#1a1915;color:#ecd48d;font-weight:700;padding:3mm 3mm;text-align:left;border:0.5px solid rgba(242,237,226,.14);}
td{padding:2.5mm 3mm;border:0.5px solid rgba(242,237,226,.14);vertical-align:top;line-height:1.7;color:#b8ad9c;font-weight:500;}
tr:nth-child(even) td{background:rgba(210,171,88,0.04);}
td b,td strong{color:#ecd48d;}
img{max-width:100%;height:auto;display:block;margin:4mm auto 2mm;border:1px solid rgba(242,237,226,.14);}
.gallery-cap{font-size:11pt;color:#7a7468;text-align:center;margin-bottom:4mm;letter-spacing:1pt;}
.quote-orig{color:#f2ede2;font-size:15pt;}
.quote-zh{color:#b8ad9c;font-size:13pt;}
.lead{font-size:15pt;color:#f2ede2;border-left:4px solid #d2ab58;background:rgba(210,171,88,.06);padding:5mm 6mm;margin:3mm 0 6mm;line-height:1.9;font-weight:500;}
.callout{border:0.5pt solid rgba(242,237,226,.4);border-radius:2.5mm;background:rgba(242,237,226,.05);padding:5mm 6mm;margin:4mm 0;page-break-inside:avoid;}
.callout-risk{border:none;border-left:4px solid #c25a4a;border-radius:0;background:rgba(194,90,74,.06);}
.callout-pos{border:none;border-left:4px solid #7aad5a;border-radius:0;background:rgba(122,173,90,.06);}
.dim{border-left:4px solid #d2ab58;background:rgba(210,171,88,.06);padding:2mm 6mm;margin:6mm 0 3mm;}
.dim h3{margin:2mm 0;color:#ecd48d;}
.badge{font-size:11pt;color:#0a0b10;background:#d2ab58;padding:0 5px;border-radius:2px;font-weight:700;}
.badge-b{background:#9c8850;color:#0a0b10;}.badge-c{background:#7a7468;color:#0a0b10;}
.qq{border-left:2px solid rgba(210,171,88,.5);padding:1.5mm 0 1.5mm 5mm;margin:3mm 0 4mm;page-break-inside:avoid;}
.qq .o{color:#f2ede2;font-size:15pt;line-height:1.9;}
.qq .z{color:#7a7468;font-size:11pt;display:block;margin-top:1.2mm;line-height:1.7;}
.qq .z a{color:#9c8850;}
.grid{margin:2mm 0 4mm;font-size:0;}
.grid img{width:31.5%;display:inline-block;vertical-align:top;margin:0.7%;border:1px solid rgba(242,237,226,.14);}
.grid-day{font-size:13pt;color:#ecd48d;font-weight:700;margin:4mm 0 1mm;}
.gwrap{font-size:0;margin:1mm 0 3mm;}
.gcard{display:inline-block;width:23.4%;margin:0.8%;vertical-align:top;}
.gcard img{width:100%;height:auto;display:block;margin:0;border:1px solid rgba(242,237,226,.14);}
.gcap{display:block;font-size:10pt;color:#7a7468;margin-top:0.6mm;line-height:1.4;}
.gcap a{color:#9c8850;}
.swhat{font-family:'Noto Serif CJK SC',serif;font-size:11pt;color:#b8ad9c;margin:-2mm 0 5mm;letter-spacing:1pt;}
.swhat::before{content:"\25B8  ";color:#d2ab58;}
.statgrid{font-size:0;margin:2mm 0 3.5mm;}
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


# 主题覆盖层（--theme）。dark=黑金(v3.0 基线,默认)；cream=乳白金(style-guide v3.0 基线,
# 打印/日光友好)。v3.0 禁令：冷蓝黑、青蓝及一切 B>R 中性色不入品牌交付物，原 silver 主题废除。
CREAM_CSS = r'''
@page { background:#f7f3ea; }
@page{ @bottom-left{color:#6f6656;} @bottom-right{color:#6f6656;} }
body{color:#2a2620;background:#f7f3ea;}
a{color:#96762e;}
.cover-rule{border-top:2px solid #b08c3e;}
.cover-rule-b{border-top:1px solid rgba(42,38,32,.14);}
.cover h1{color:#96762e;}
.cover .sub{color:#8a713a;}
.cover .meta{color:#6f6656;}
.cover .erica{color:#6f6656;}
.toc h2{color:#96762e;}
.toc-rule{border-top:2px solid #b08c3e;}
.toc-item{color:#96762e;}
h2.section-title{color:#96762e;}
hr.section-rule{border-top:2px solid #b08c3e;}
h3{color:#7d621f;}
strong{color:#5e4a14;}
em{color:#6f6656;}
ul li::before{color:#b08c3e;}
blockquote{border-left:4px solid #b08c3e;background:#efe9dc;color:#2a2620;}
code{color:#7d621f;background:#efe9dc;}
hr.ornament::after{color:#c4b795;}
th{background:#efe9dc;color:#5e4a14;border:0.5px solid rgba(42,38,32,.14);}
td{border:0.5px solid rgba(42,38,32,.14);color:#4a4234;}
tr:nth-child(even) td{background:rgba(176,140,62,0.05);}
td b,td strong{color:#5e4a14;}
img{border:1px solid rgba(42,38,32,.14);}
.gallery-cap{color:#6f6656;}
.quote-orig{color:#2a2620;}
.quote-zh{color:#6f6656;}
.lead{color:#2a2620;border-left:4px solid #b08c3e;background:#efe9dc;}
.callout{border:0.5pt solid rgba(42,38,32,.3);background:#f1ebdf;}
.callout-risk{border:none;border-left:4px solid #c25a4a;background:rgba(194,90,74,.07);}
.callout-pos{border:none;border-left:4px solid #7aad5a;background:rgba(122,173,90,.08);}
.dim{border-left:4px solid #b08c3e;background:#efe9dc;}
.dim h3{color:#5e4a14;}
.badge{color:#f7f3ea;background:#b08c3e;}
.badge-b{background:#8a713a;color:#f7f3ea;}.badge-c{background:#6f6656;color:#f7f3ea;}
.qq{border-left:2px solid rgba(176,140,62,.6);}
.qq .o{color:#2a2620;}
.qq .z{color:#6f6656;}
.qq .z a{color:#96762e;}
.grid img,.gcard img{border:1px solid rgba(42,38,32,.14);}
.gcap{color:#6f6656;}
.gcap a{color:#96762e;}
.swhat{color:#6f6656;}
.swhat::before{color:#b08c3e;}
'''

THEMES = {'dark': '', 'cream': CREAM_CSS}

# 手机阅读覆盖层（style-guide 移动优先：正文≥15pt / 辅助≥14pt / 表格≥14pt）。
# 页幅取 120mm×213mm（≈9:16 竖屏比例），手机「适合宽度」查看时字号即为实感大字。
MOBILE_CSS = r'''
@page { size:120mm 213mm; margin:10mm 8mm 11mm 8mm; }
body{font-size:11.5pt;line-height:1.65;}
p{margin-bottom:2.2mm;}
.cover{padding-top:34mm;}
.cover h1{font-size:20pt;}
.cover .sub{font-size:11pt;}
.cover .meta{font-size:9.5pt;}
.cover .erica{font-size:10.5pt;margin-top:8mm;}
.toc{padding-top:8mm;}
.toc h2{font-size:16pt;}
.toc-item{font-size:11pt;line-height:1.8;}
/* —— 间距层级律：h2 上距 11mm(5x段距) / h3 上距 6.5mm(3x) / 段距 2.2mm(1x)；
      标题下距一律 ≤1x,让标题紧贴自己统领的内容 —— */
h2.section-title{font-size:17pt;page-break-before:auto;margin-top:11mm;margin-bottom:1.5mm;}
hr.section-rule{margin:0 0 4mm;}
h3{font-size:13pt;margin-top:6.5mm;margin-bottom:1.2mm;}
blockquote{font-size:11pt;padding:2mm 3.5mm;margin:2.5mm 0;}
.lead{font-size:11.5pt;line-height:1.65;padding:2.5mm 3.5mm;margin:2mm 0 3.5mm;}
table{font-size:10.5pt;margin:2.5mm 0 3mm;}
th{padding:1.4mm 1.8mm;}
td{padding:1.2mm 1.8mm;line-height:1.5;}
ul,ol{margin:1.5mm 0 2.5mm 5mm;}
li{margin-bottom:1.2mm;line-height:1.6;}
code{font-size:10pt;}
.badge{font-size:9pt;}
.quote-orig{font-size:11.5pt;}
.quote-zh{font-size:10pt;}
.qq{margin:1.8mm 0 2.5mm;padding:1mm 0 1mm 4mm;}
.qq .o{font-size:11.5pt;line-height:1.6;}
.qq .z{font-size:9pt;line-height:1.5;margin-top:0.8mm;}
hr.ornament{margin:7mm 0 2mm;}
.dim{margin:6.5mm 0 2mm;padding:1.5mm 4.5mm;}
.dim h3{margin:1mm 0;}
.gallery-cap{font-size:9pt;}
small{font-size:9pt;}
.gcard{width:48%;margin:1%;}
.gcap{font-size:8.5pt;}
'''


def build_document(body_html, toc, title, subtitle, meta, cover_note, mobile=False, theme='dark'):
    """封面 + 目录 + 正文拼装成完整 HTML 文档。纯函数。"""
    toc_html = '\n'.join(f'<div class="toc-item">{t}</div>' for _, t in toc)
    cover = (f'<div class="cover"><hr class="cover-rule"><h1>{title}</h1>'
             f'<div class="sub">{subtitle}</div><div class="meta">{meta}</div>'
             f'<hr class="cover-rule-b"><div class="erica">{cover_note}</div></div>'
             f'<div class="toc"><h2>目 录</h2><hr class="toc-rule">{toc_html}</div>')
    css = CSS + THEMES.get(theme, '') + (MOBILE_CSS if mobile else '')
    return (f'<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">'
            f'<style>{css}</style></head><body>{cover}'
            f'<div class="content">{body_html}</div></body></html>')


def build_html(body_md, title, subtitle, meta, cover_note, mobile=False, theme='dark'):
    """markdown 正文 → 完整 HTML 文档字符串 + 目录条数。仅依赖 markdown（轻）。"""
    import markdown

    md = markdown.Markdown(extensions=['tables', 'sane_lists', 'fenced_code'])
    body_html, toc = decorate_body_html(md.convert(slice_body(body_md)))
    return build_document(body_html, toc, title, subtitle, meta, cover_note, mobile, theme), len(toc)


def render(src, title, subtitle, meta, cover_note='弥萨格大学数据库终端 · 艾瑞卡', mobile=False, theme='dark'):
    """读盘 + build_html + 写 HTML/PDF 的薄壳；仅此处需要 weasyprint（重）。"""
    from weasyprint import HTML

    base = os.path.splitext(src)[0] + (f'-{theme}' if theme != 'dark' else '') + ('-mobile' if mobile else '')
    out_html, out_pdf = base + '.html', base + '.pdf'
    raw = open(src, encoding='utf-8').read()
    _, body_md = parse_frontmatter(raw)
    doc, n_toc = build_html(body_md, title, subtitle, meta, cover_note, mobile, theme)
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
    ap.add_argument('--mobile', action='store_true',
                    help='手机阅读版：竖屏页幅 + 大字号（正文15pt/表14pt），输出加 -mobile 后缀')
    ap.add_argument('--theme', default='dark', choices=sorted(THEMES),
                    help='配色主题：dark=黑金 v3.0(默认) / cream=乳白金(style-guide v3.0,打印日光友好)')
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

    html, pdf, n_toc, size = render(a.src, title, subtitle, meta, a.cover_note, mobile=a.mobile, theme=a.theme)
    print(f'HTML: {html}\nPDF:  {pdf}  ({size} bytes, 目录 {n_toc} 章)')


if __name__ == '__main__':
    main()
