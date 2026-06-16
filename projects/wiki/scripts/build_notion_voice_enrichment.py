#!/usr/bin/env python3
"""Build per-character voice-line enrichment for the Notion character database.

Source: projects/wiki/data/processed/voice_character_map.json (Voice.lua + AwakerConfig.lua,
runtime memory extraction). Output: a name-keyed JSON with a ready-to-insert Notion
Markdown body section plus the voice line count, so the Notion fill is reproducible
and auditable. Only real unpacked data is emitted; no fixtures or placeholders.
"""
import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
SRC = ROOT / "data" / "processed" / "voice_character_map.json"
OUT = ROOT / "data" / "processed" / "notion_voice_enrichment.json"

RELATION_LABEL = {
    "about": "他人评述",
    "unlock_requires": "羁绊解锁",
}


def build_body(name: str, entry: dict) -> str:
    lines = entry.get("voice_lines", [])
    out = ["## 角色语音 · 闲话（Voice.lua 解包真实数据）", ""]
    out.append(f"> 来源：voice_character_map.json（Voice.lua + AwakerConfig.lua 文本匹配） · 共 {len(lines)} 条")
    out.append("")
    for ln in lines:
        title = ln.get("title", "").strip()
        content = ln.get("content", "").strip()
        rel = RELATION_LABEL.get(ln.get("relation"), ln.get("relation") or "")
        vid = ln.get("voice_id")
        unlock = (ln.get("unlock_desc") or "").strip()
        header = f"**{title}**"
        meta = f"（id {vid}"
        if rel:
            meta += f" · {rel}"
        meta += "）"
        out.append(f"{header} {meta}")
        out.append(f"> {content}")
        if unlock:
            out.append(f"_解锁：{unlock}_")
        out.append("")
    return "\n".join(out).rstrip() + "\n"


def main() -> None:
    data = json.loads(SRC.read_text(encoding="utf-8"))
    cv = data["character_voices"]
    result = {
        "_meta": {
            "source": data.get("_meta", {}).get("source", ""),
            "generated_from": "voice_character_map.json",
            "character_count": len(cv),
            "note": "Real Voice.lua extraction only. Skills/trinkets/story remain pending upstream and are intentionally NOT emitted.",
        },
        "characters": {},
    }
    for name, entry in cv.items():
        result["characters"][name] = {
            "character_ids": entry.get("character_ids", []),
            "voice_line_count": entry.get("voice_line_count", len(entry.get("voice_lines", []))),
            "notion_body": build_body(name, entry),
        }
    OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    total = sum(v["voice_line_count"] for v in result["characters"].values())
    print(f"wrote {OUT.relative_to(ROOT.parent.parent)}  characters={len(cv)}  total_lines={total}")


if __name__ == "__main__":
    main()
