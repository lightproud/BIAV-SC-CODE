# intel-weekly 采掘机制参考

## §1 档案层路径与 schema

- Discord 三服：`Record/Community/discord/{global|jp|volunteer}/`
  - `activity_daily/{date}.json`：`messages` / `unique_authors` / `channel_activity`（键为频道名）
  - `channel_index.json`：`{channel_id: {name, dir}}`；消息在 `channels/{dir}/{date}.jsonl`
  - 消息字段：`id / author_id / author_name / channel_id / content / timestamp`（紧凑 schema，
    读取一律 `.get(默认)`；过滤 `author_bot`）
- 平台：`Record/Community/{plat}/[{region}/{type}/]{date}.json`，条目字段
  `title / summary / lang / url / time / engagement / author / content_type`
- 平台清单以 `ls Record/Community/` 为准（当前 15 源；appstore/bahamut/note_com 低频）。

## §2 关键词扫描组（起点，按当期事件增补）

```
merch:  周边|周邊|镭射票|鐳射票|明信片|盲盒|谷子|吧唧|badge|merch|acrylic|postcard|goods|グッズ|굿즈
kr_loc: 한국어|한글|번역|korean\s*(translation|localization)|韩语|韓語.{0,6}(翻译|本地化)
bug:    \bbug\b|crash|闪退|卡死|无法登录|can'?t\s*log|freez|バグ|クラッシュ|오류
money:  抽卡|氪金|溢价|greed|monetiz|cash\s*grab|礼包|課金|과금
event:  （当期版本/联动关键词）
```
命中后必须人工读原文剔噪；东南亚语同形词（saya=我）单独小心。

## §3 引用构造

- Discord 消息直链：`https://discord.com/channels/{guild_id}/{channel_id}/{message_id}`；
  国际服 guild=1131791637933199470（其余见 `discord/guilds_seen.json`）。
- 平台条目直接用归档 `url` 字段；引原文短引（≤2 行）+ 平台·发布日期。
- 报告内时间一律 UTC+8（归档 `time`/`timestamp` 为 UTC，须换算）。

## §4 趋势计算

- Discord：global 服 `activity_daily` 按周一分桶求和，取近 13 周。
- Steam：全部 `steam/**/review/*.json` 条目按 `url` 去重 → 按发布时间（UTC+8）周分桶 →
  以 `[正面]`/`[负面]` 标题前缀计好评率。历史归档深度：Steam 至 2024-08、Discord 至 2023，
  三个月对比随取随算，不预存中间表。

## §5 同人图署名反查

fanart 月度包在 Releases `community-assets` / `fanart-archive-{YYYY-MM}.tar.gz`
（`{date}/discord_{attachment_id}.{ext}` + `gallery_manifest.json`，manifest 的 author 是数字 ID）。
署名：拿文件名里的 attachment_id 在 `Record/Community/discord/` 全档 `grep -rm1`，
命中行即原消息 JSON，取 `author_name`。查不到（bot 补录/跨月）用「…ID 尾 6 位」并注明。
嵌入前缩图（长边 ≤700px，JPEG q84）落 `projects/news/data/fanart/`（gitignored，仅渲染用）。

## §6 已知坑

1. **发布≠采集**：weibo 等源每日重采同一热帖（首期实测 2,499 采集中仅 1,036 窗口内发布）；
   不按 `time` 过滤会把旧闻当新信号（首期两处实错的根因）。
2. **engagement 是快照**：同帖多日快照的 engagement 差 = 窗口内热度增长，可用；
   但绝对值不指发布周热度。别把不同帖的快照数混读（首期把两帖互动数张冠李戴过）。
3. **字体子集化崩溃**：标题含异体装饰符（`˚✧₊⁎༚` 等）时 weasyprint/fontTools 抛
   `unicode range bit 123`；入文前只保留 CJK/假名/谚文/拉丁/常用标点。
4. **07-12 类边界日**：窗口末日归档常非全天，谷值不作趋势依据，须标注。
5. **论坛型频道**（同人创作等 type=forum）：消息散在线程档，按频道 dir 读会漏，
   反查作者用 §5 的全档 grep 而非频道内检索。
6. **volunteer 服静默**：低消息量本身可能是信号（消化期 vs 离心），报告时两可性要写明。

## §7 渲染参数（已固化在 report_render.py）

`--mobile`：120×213mm 页幅、正文 11.5pt、行高 1.65、间距层级律（章标题上距 11mm=5×段距、
小标题 6.5mm=3×、段距 2.2mm=1×、标题下距≤1×）、不逐章强制换页、图册两列。
`--theme dark|cream`：style-guide v3.0 黑金/乳白金；冷蓝系永久禁用。
