# 事实圣经 Fact Bible

> Morimens 领域知识的结构化存储。供 AI 会话按需加载，回答游戏世界观、设计哲学、叙事结构等问题。

## 文件清单

| 文件 | 说明 | 大小 |
|------|------|------|
| `interview-2026-04.json` | 53 问制作人深度采访结构化提取（Light + 主文案霁月） | 大 |
| `narrative-structure.json` | 三部叙事结构、各章压缩细节、角色线 | 中 |
| `design-decisions.json` | 设计哲学、被砍机制、平衡理念 | 小 |
| `VERSION.md` | 事实圣经版本追踪 | 小 |
| `validate.py` | 数据校验脚本（检查 JSON 完整性和一致性） | 小 |

## 使用方式

```bash
# 校验所有数据文件
python assets/data/validate.py
```

AI 会话根据用户提问按需读取对应文件即可，无需全部加载。详见 `CLAUDE.md` 知识模块索引。

## 运营数据已迁移

社区聚合数据（新闻、Discord 归档等）已迁移至 `projects/news/output/`。本目录仅保留领域知识文件。
