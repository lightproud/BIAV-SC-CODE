# Contributing Game Data to the Morimens Wiki

This guide explains how to extract, format, and submit game data for the Morimens (忘却前夜) wiki project.

## Overview

The wiki database lives in `projects/wiki/data/db/` as structured JSON files:
- `characters.json` - Character (唤醒体) profiles, skills, and stats
- `meta.json` - Game metadata, version info
- `art_assets.json` - Asset URLs and CDN patterns

We need help filling in missing data, verifying existing data, and adding new content as the game updates.

## What Data We Need

Priority data (most needed):
1. **Character stats** - Base stats, growth curves, max-level stats
2. **Skill details** - Exact effect text, multipliers, costs, upgrade changes
3. **Equipment / Covenant data** - Set effects, stat bonuses
4. **Stage data** - Enemy compositions, drop tables
5. **Localization** - English and Japanese text for all game content

Lower priority:
- Card art and UI screenshots
- Sound/music metadata
- Event timeline data

## Method 1: Extract from Game Client (Data Mining)

### Requirements

- Morimens installed via Steam (App ID: 3052450 for CN, 4226130 for JP)
- One of the following tools:
  - [AssetStudio](https://github.com/Perfare/AssetStudio) (GUI, Windows) - easiest for beginners
  - [UnityPy](https://pypi.org/project/UnityPy/) (`pip install UnityPy`) - Python scripting
  - [UABE](https://github.com/SeriousCache/UABE) - Unity Asset Bundle Extractor
- Python 3.8+ for running the mapping script

### Step 1: Locate Game Files

**Steam (Windows):**
```
C:\Program Files (x86)\Steam\steamapps\common\Morimens\Morimens_Data\
```

**Steam (macOS):**
```
~/Library/Application Support/Steam/steamapps/common/Morimens/
```

Key directories inside `Morimens_Data/`:
| Directory | Contents |
|-----------|----------|
| `StreamingAssets/` | External config files, localization, audio |
| `Resources/` | Built-in resources |
| `Managed/` | .NET DLLs (game logic, useful for understanding data structures) |
| `data.unity3d` or `level*` | Main asset bundles containing game tables |

### Step 2: Export Assets with AssetStudio

1. Open AssetStudio
2. File -> Load Folder -> select `Morimens_Data/`
3. Wait for loading to complete
4. Filter by type: **TextAsset** (for data tables), **Texture2D** (for images)
5. Select assets -> right-click -> Export Selected
6. Save to a working directory (e.g., `~/morimens_export/`)

For TextAssets, look for files with names containing:
- `character`, `hero`, `unit`, `awakener` - character definitions
- `skill`, `card`, `ability` - skill and card data
- `equip`, `item`, `covenant` - equipment data
- `stage`, `map`, `dungeon` - stage data
- `locale`, `lang`, `text`, `i18n` - translations

### Step 3: Export with UnityPy (Alternative)

For scripted extraction, use the example in our extraction tool:

```bash
python3 projects/wiki/scripts/extract_game_data.py --show-unitypy-example
```

This prints a ready-to-use Python script that extracts TextAssets and Texture2D objects from Unity bundles.

### Step 4: Run the Mapping Script

Once you have exported files in a directory:

```bash
# Preview what would be imported (recommended first step)
python3 projects/wiki/scripts/extract_game_data.py \
    --input-dir ~/morimens_export/ \
    --dry-run

# Import character data only
python3 projects/wiki/scripts/extract_game_data.py \
    --input-dir ~/morimens_export/ \
    --type characters

# Import everything
python3 projects/wiki/scripts/extract_game_data.py \
    --input-dir ~/morimens_export/ \
    --type all
```

The script will:
- Scan for JSON, CSV, TSV, TXT, and .asset files
- Auto-classify files by name (character, skill, equipment, etc.)
- Map game field names to our schema (handles Chinese, English, camelCase, etc.)
- Normalize realm/rarity/role values
- Merge with existing data (new data fills blanks, does not overwrite curated info)
- Output a summary and raw extraction files

## Method 2: Manual Data Entry

If you cannot data mine, you can still contribute by:

1. Playing the game and recording data manually
2. Cross-referencing with existing wikis:
   - [Gamekee (CN)](https://www.gamekee.com/morimens/)
   - [BWiki (CN)](https://wiki.biligame.com/morimens/)
   - [Fandom (EN)](https://forget-last-night-morimens.fandom.com/)
   - [Gamerch (JP)](https://gamerch.com/morimens/)

### Data Format

Character data follows this structure (see `characters.json` for full examples):

```json
{
  "id": "alva",
  "name": "艾尔瓦",
  "name_en": "Alva",
  "rarity": "SSR",
  "realm": "chaos",
  "role": "defense",
  "is_limited": false,
  "obtain": "常驻/活动唤醒",
  "aliases": [],
  "tags": ["主C", "混沌核心"],
  "description": "...",
  "skills": {
    "command_cards": [
      {
        "name": "打击",
        "name_en": "Strike",
        "cost": 1,
        "effect": "标准打击卡"
      }
    ],
    "rouse": { "name": "...", "effect": "..." },
    "exalt": { "name": "...", "effect": "..." }
  }
}
```

**Field rules:**
- `id`: lowercase English, underscores for spaces (e.g., `kathigu_ra`)
- `realm`: one of `chaos`, `deep_sea`, `flesh`, `hyperdimension`
- `rarity`: `SSR` or `SR`
- `role`: one of `attack`, `sub_attack`, `defense`, `support`, `healer`, `chorus`

## Method 3: Fetch Steam Assets

Public assets (screenshots, headers, descriptions) can be fetched automatically:

```bash
# Preview available assets
python3 projects/wiki/scripts/fetch_steam_assets.py --dry-run

# Download everything
python3 projects/wiki/scripts/fetch_steam_assets.py

# Download with full store info saved
python3 projects/wiki/scripts/fetch_steam_assets.py --save-store-info
```

## How to Submit

### Option A: Pull Request (Preferred)

1. Fork the repository
2. Create a branch: `git checkout -b data/your-description`
3. Add or update data files in `projects/wiki/data/db/`
4. Run the extraction script with `--dry-run` first to verify
5. Commit and open a PR with:
   - What data was added/changed
   - Source (game version, extraction method)
   - Any uncertainties or notes

### Option B: GitHub Issue

If you cannot make a PR, open an Issue with:
- Title: `[Code-wiki] Data submission: <description>`
- Attach the data as JSON in a code block or file
- Note the game version and source

### Data Quality Guidelines

- **Always note the game version** the data was extracted from
- **Prefer exact game text** over paraphrased descriptions
- **Include Chinese original text** even if submitting English data
- **Flag uncertain values** with a comment or `"_note"` field
- **Do not submit copyrighted assets** (character art, music) as files - use URLs to official/wiki sources instead
- **Test JSON validity** before submitting: `python3 -m json.tool < yourfile.json`

## Tools Quick Reference

| Tool | Purpose | Install |
|------|---------|---------|
| AssetStudio | Browse & export Unity assets (GUI) | [GitHub releases](https://github.com/Perfare/AssetStudio/releases) |
| UnityPy | Script Unity asset extraction | `pip install UnityPy` |
| Il2CppDumper | Recover C# class definitions | [GitHub releases](https://github.com/Perfare/Il2CppDumper/releases) |
| UABE | Manual asset bundle inspection | [GitHub releases](https://github.com/SeriousCache/UABE/releases) |
| dnSpy | .NET DLL decompilation | [GitHub releases](https://github.com/dnSpy/dnSpy/releases) |
| extract_game_data.py | Map exported data to wiki schema | This repo (`projects/wiki/scripts/`) |
| fetch_steam_assets.py | Download Steam public assets | This repo (`projects/wiki/scripts/`) |

## Questions?

Open a GitHub Issue with the `[Code-wiki]` prefix, or check existing issues for similar topics.
