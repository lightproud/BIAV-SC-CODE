# Best Game Wiki Features & UX Patterns Research

> Research date: 2026-03-30
> Purpose: Inform Morimens Wiki design decisions by cataloging what the best game wikis do well.

## Sites Surveyed

| Site | Game | Type | Strength |
|------|------|------|----------|
| [Honey Hunter World](https://gensh.honeyhunterworld.com/) | Genshin Impact | Datamine DB | Speed, raw data completeness |
| [Paimon.moe](https://paimon.moe/) | Genshin Impact | Tool suite | Interactive planners, local-first data |
| [Genshin.gg](https://genshin.gg/) | Genshin Impact | Tier list | Quick reference, clean layout |
| [Genshin Optimizer](https://frzyc.github.io/genshin-optimizer/) | Genshin Impact | Build optimizer | Deep min-max calculations |
| [KQM / Keqing Mains](https://keqingmains.com/) | Genshin Impact | Theorycrafting | Expert-vetted analysis, evidence-based |
| [Prydwen Institute](https://www.prydwen.gg/star-rail/) | Honkai: Star Rail | Wiki + guides | Data-driven builds, community stats |
| [Game8](https://game8.co/) | Multiple | Walkthrough wiki | Event calendars, banner timelines |
| [Arknights Terra Wiki](https://arknights.wiki.gg/) | Arknights | Community wiki | Comprehensive lore + mechanics |
| [PRTS Wiki](https://prts.wiki/) | Arknights (CN) | CN community wiki | Operator DB, interactive tools |
| [Aceship Tools](https://aceship.github.io/AN-EN-Tags/akhr.html) | Arknights | Toolbox | Recruitment calc, multi-server |
| [PoE Wiki](https://www.poewiki.net/) | Path of Exile | Community wiki | Data query API, structured data |
| [Craft of Exile](https://www.craftofexile.com/) | Path of Exile | Crafting sim | Statistical simulation, mod DB |
| [gcsim](https://gcsim.app/) | Genshin Impact | Team simulator | Team DPS simulation |
| [Fandom Wikis](https://genshin-impact.fandom.com/) | Multiple | General wiki | Lore depth, community editing |

---

## 1. Character/Unit Pages

### What the Best Sites Show

**Core Info Block (Infobox)**
- Character portrait / full art (often with skin/alt art switcher)
- Rarity (stars), element/type, weapon type, role/class
- Voice actor (JP / EN / CN / KR)
- Release date, version introduced
- Affiliation / faction
- Obtain method (gacha, event, free)

**Stats Section**
- Base stats at level 1 and max level
- Stat growth curves (expandable per-level tables)
- Ascension stat bonuses
- Comparison radar charts vs. other units of same role (Prydwen)

**Skills & Abilities**
- Each skill with: icon, name, description, scaling values per level
- Talent/trace trees with visual node map (Prydwen HSR)
- Passive abilities
- Constellation/dupe bonuses listed with clear unlock indicators

**Build Guide (Prydwen, Game8, KQM)**
- Recommended weapons/light cones with ranking and usage rates
- Recommended artifact/relic sets with community usage percentages
- Stat priority (main stat + sub-stat)
- Team compositions with synergy explanations
- Endgame performance data (e.g., MoC/Abyss usage rates)

**Lore & Profile (Fandom, wiki.gg)**
- Character story entries
- Voice lines (with audio playback)
- Birthday, height, constellation/zodiac
- Relationships and story connections

**Gallery**
- Official art, in-game screenshots, promotional art
- Alt skins / outfits
- Namecard, icon assets

### Best Practices Observed

| Practice | Example Site |
|----------|-------------|
| Tabbed panels to separate Kit / Review / Build / Lore | Prydwen |
| Collapsible per-level stat tables | Honey Hunter, wiki.gg |
| Usage-rate data from real player scans | Prydwen (Spiral Stats collab) |
| Evidence Vault backing each claim | KQM TCL |
| Side-by-side DPS simulation charts | gcsim |
| Multi-server toggle (CN/JP/EN/KR) | Aceship |

---

## 2. Interactive Tools

### Tier A: Essential Tools

| Tool | Description | Best Example |
|------|-------------|-------------|
| **Wish/Gacha Tracker** | Import pull history, count pity, show 50/50 status, probability charts | Paimon.moe |
| **Ascension/Material Calculator** | Select target character + level, output exact material list + resin cost | Paimon.moe |
| **Recruitment Calculator** | Input available tags, output possible units with guaranteed combos | Aceship, Arknights Toolbox |
| **Team Builder** | Drag-and-drop team composition with synergy indicators | Prydwen, gcsim |
| **Tier List** | Filterable by role/element, with community voting | Game8, Prydwen |
| **Event Calendar / Banner Timeline** | Visual timeline of current + upcoming events, countdowns | Game8, Paimon.moe |

### Tier B: Advanced Tools

| Tool | Description | Best Example |
|------|-------------|-------------|
| **Damage Calculator** | Input char stats + weapon + artifacts, compute damage per hit/rotation | Genshin Optimizer, gcsim |
| **Artifact/Relic Optimizer** | Auto-optimize artifact assignments across roster | Genshin Optimizer |
| **Build Simulator** | Simulate crafting outcomes with probability distributions | Craft of Exile |
| **Gacha Simulator** | Simulate pulls without spending currency | Gyattcha (NIKKE) |
| **Achievement Tracker** | Checklist of all achievements with completion status | Paimon.moe |
| **Todo List / Planner** | Aggregate daily/weekly farming tasks | Paimon.moe |
| **OCR Tag Scanner** | Photograph recruitment tags, auto-detect via OCR | Arknights Toolbox |

### Tier C: Nice-to-Have Tools

| Tool | Description | Best Example |
|------|-------------|-------------|
| **Map / Interactive World Map** | Explorable map with collectible markers | PRTS.Map, Teyvat Interactive Map |
| **Music / Soundtrack Player** | In-game BGM playback | Various fan sites |
| **Loot Simulator** | Test item filter rules against simulated drops | FilterBlade (PoE) |
| **Data Export API** | Cargo/SQL-like query API for structured data | PoE Wiki |

---

## 3. Search & Filtering

### Best Patterns

**Character List Filtering (Prydwen, Genshin.gg)**
- Filter by: element, weapon type, rarity, role/path, release version
- Sort by: name, rarity, release date, tier rating, specific stat
- Visual filter chips (toggleable icons, not dropdowns)
- Instant results (no page reload, client-side filtering)
- Stat overlay on cards when sorting by a specific stat (Arknights in-game UI pattern)

**Full-Text Search**
- Fuzzy search with autocomplete suggestions
- Search across all content types (characters, items, quests, lore)
- Hotkey support (PoE Wiki browser extension: ALT+W)
- Cross-page search that returns relevant sections, not just page titles

**Advanced Data Query (PoE Wiki)**
- Cargo-based SQL-like API for programmatic access
- `LIKE` operator for partial matching
- Structured tables for items, mods, stats
- Template-driven item tables with auto-formatting

### Anti-Patterns to Avoid
- Dropdown-only filters (slow, bad on mobile)
- Search that only matches exact page titles
- No filtering on list pages
- Requiring page reload for filter changes

---

## 4. Data Visualization

### Charts & Graphs
| Visualization | Use Case | Example |
|--------------|----------|---------|
| **Radar/Spider Chart** | Stat comparison between characters | Prydwen |
| **Bar Chart** | Usage rates by endgame mode | Prydwen (MoC analytics) |
| **Pie/Donut Chart** | Wish result distribution, element breakdown | Paimon.moe |
| **Line Chart** | Pity probability curves, soft pity visualization | Paimon.moe |
| **Stat Growth Curve** | Level-by-level stat progression | Honey Hunter |
| **Heatmap** | Tag combination success rates | Arknights recruitment tools |
| **Distribution Histogram** | Mod roll probabilities, crafting outcomes | Craft of Exile |

### Tables
- Sortable columns (click header to sort)
- Sticky headers on long tables
- Alternating row colors for readability
- Inline icons (element, rarity stars, class icons)
- Compact mode toggle for dense data
- Expandable/collapsible rows for per-level data

### Comparison Features
- Side-by-side character comparison (select 2-4 units)
- Stat diff highlighting (green/red for better/worse)
- Tier list visual with drag-and-drop community voting (Game8)

---

## 5. Navigation & Information Architecture

### Top-Level Navigation Patterns

**Mega-Menu with Categories (Game8, Prydwen)**
- Characters, Tier List, Guides, Tools, Database
- Sub-categories visible on hover
- "New in [version]" prominently featured

**Sidebar Navigation (wiki.gg, Fandom)**
- Collapsible section tree
- Quick links to most-visited pages
- Recent changes feed

**Best IA Patterns**
| Pattern | Description | Who Does It Well |
|---------|-------------|-----------------|
| Version-based landing pages | "New in 6.5" showing all new content | Honey Hunter |
| Role-based entry points | "I'm a new player" vs "I'm optimizing" | KQM |
| Breadcrumbs | Character > Element > Specific Character | wiki.gg |
| Related content links | "Characters who use same materials" | Game8 |
| Sticky TOC | Table of contents that follows scroll | Prydwen, KQM |
| Quick-nav anchor links | Jump to Stats / Skills / Build / Lore | Prydwen |

### Page Cross-Linking
- Material pages link to all characters that need them
- Character pages link to their best weapons/artifacts
- Weapon pages link to characters who benefit most
- Quest pages link to prerequisite quests and rewards

---

## 6. Mobile Experience

### Best Practices Observed

| Feature | Description |
|---------|-------------|
| **Responsive grid** | Character cards reflow from 4-5 columns to 2 columns on mobile |
| **Touch-friendly filters** | Large tap targets, swipeable filter chips |
| **Collapsible sections** | Stats, skills, lore behind accordions to reduce scroll |
| **Bottom navigation** | Key sections accessible from bottom bar (PWA pattern) |
| **Swipeable tabs** | Switch between Kit/Review/Build with horizontal swipe |
| **Offline support** | PWA with service worker for cached data (Paimon.moe) |
| **Portable Infobox** | Fandom's mobile-first infobox syntax |

### Mobile Anti-Patterns
- Wide tables that require horizontal scroll
- Hover-dependent interactions (tooltips, mega-menus)
- Fixed sidebars that eat screen width
- Pop-ups that don't resize properly
- Desktop-only tools with no mobile fallback

---

## 7. Community Features

| Feature | Description | Example |
|---------|-------------|---------|
| **Community tier list voting** | Users vote on character rankings | Game8 Tier List Maker |
| **Comment sections** | Per-page discussion | Fandom, Game8 |
| **Discord integration** | Link to community Discord for discussion | KQM, wiki.gg |
| **Contribution system** | Anyone can edit (wiki model) | Fandom, wiki.gg |
| **Evidence submission pipeline** | Structured process for verified findings | KQM TCL tickets |
| **Player data submission** | Users submit UID for aggregated statistics | Prydwen (Spiral Stats) |
| **Achievement sharing** | Share completion status with friends | Paimon.moe |
| **Google Drive sync** | Cross-device backup of personal data | Paimon.moe |

### Community Trust Models
| Model | How It Works | Pros | Cons |
|-------|-------------|------|------|
| **Open wiki** (Fandom, wiki.gg) | Anyone can edit, moderators review | Fast coverage | Quality variance |
| **Expert-driven** (KQM, Prydwen) | Curated team writes content | High accuracy | Slower updates |
| **Datamine-first** (Honey Hunter) | Auto-generated from game data | Fastest data | No editorial insight |
| **Hybrid** (Prydwen) | Data-driven + expert review | Best of both | Needs both infrastructure |

---

## 8. Data Freshness & Update Speed

| Tier | Speed | Approach | Example |
|------|-------|----------|---------|
| **Same day as beta** | Hours after beta client drops | Datamining | Honey Hunter, Project Amber |
| **Patch day** | Within hours of live patch | Automated extraction + manual review | Prydwen, Game8 |
| **Within 1-2 days** | Community contributors update pages | Open wiki editing | wiki.gg, Fandom |
| **Within 1 week** | Expert analysis after testing | Theorycrafting review | KQM guides |

### Strategies for Fast Updates
- Automated data extraction from game files
- "New in [version]" pages pre-built from beta data
- Separate "beta" data flag so users know what's unconfirmed
- Structured data schemas that can be bulk-updated
- RSS/changelog feeds for tracking updates

---

## 9. Multi-Language Support

### Approaches Observed

| Approach | Description | Example |
|----------|-------------|---------|
| **Separate language sites** | Entirely different site per language | PRTS (CN) vs wiki.gg (EN) |
| **Language toggle** | Same site, switchable UI language | Honey Hunter (?lang=EN/JP/CN/KR) |
| **i18n framework** | Code-level internationalization | Paimon.moe (community translations) |
| **Multilingual wiki extension** | MediaWiki Language Extension Bundle | Wikipedia model |
| **Per-language subdirectories** | /en/, /ja/, /zh/ content dirs | Our current wiki structure |

### Key Considerations
- In-game terms must match official localization per language
- Character names differ across servers (e.g., CN vs EN names)
- Right-to-left (RTL) language support if needed
- 76% of consumers prefer content in their own language (CSA Research)
- CSS `:lang()` selectors needed for per-language layout fixes
- Continuous localization pipeline: machine translate first pass, human post-edit

### What Works Best for Game Wikis
- **URL-based language switching** (`?lang=` or `/en/`) -- allows linking to specific language
- **Shared data layer** with translated UI strings -- avoid duplicating raw numbers
- **Official term glossary** per language -- ensures consistency
- **Community translation contributions** with review pipeline

---

## 10. Visual Design & Branding

### Design Patterns

| Element | Best Practice | Example |
|---------|--------------|---------|
| **Dark mode default** | Most game wikis default to dark theme | Prydwen, Honey Hunter |
| **Game-themed color palette** | Colors match the game's visual identity | PRTS (Arknights blue/white) |
| **Element/type color coding** | Consistent colors for fire/water/etc | All major wikis |
| **Rarity star indicators** | Gold/purple/blue borders or backgrounds | Universal |
| **Custom typography** | Headers in a font matching game aesthetic | Prydwen |
| **High-quality character art** | Official art, not screenshots | All top wikis |
| **Micro-animations** | Subtle hover effects, loading transitions | Paimon.moe |
| **Light/dark toggle** | User choice with system preference detection | Fandom, Paimon.moe |

### Branding Differentiation
| Site | Brand Identity |
|------|---------------|
| Prydwen | Clean, data-scientist aesthetic. Lots of charts and statistics. Professional feel. |
| Paimon.moe | Playful, matches Genshin's whimsical style. Paimon mascot throughout. |
| Honey Hunter | Functional/utilitarian. Dense data, minimal decoration. Speed over style. |
| KQM | Academic/scholarly. Evidence-based, research paper feel. |
| Game8 | Magazine layout. Ad-supported, mass-market appeal. |
| wiki.gg / Fandom | Wikipedia-like. Neutral, encyclopedic. |
| PRTS | Matches Arknights' sci-fi terminal aesthetic. |

---

## Summary: Top Features by Priority for Morimens Wiki

### Must-Have (Phase 1)
1. **Character pages** with infobox, stats, skills, recommended builds
2. **Filterable character list** with element/rarity/role filters (client-side, no reload)
3. **Sortable data tables** for stats with collapsible per-level details
4. **Dark mode** as default with light mode toggle
5. **Mobile-responsive** layout with collapsible sections
6. **Multi-language** support (zh/en/ja using existing `/lang/` structure)
7. **Search** with autocomplete across all content types
8. **Version-based content pages** ("New in X.X")

### Should-Have (Phase 2)
1. **Material calculator** -- input target character/level, output farming list
2. **Team builder** -- drag-and-drop with synergy indicators
3. **Tier list** with community voting
4. **Event calendar / banner timeline**
5. **Gacha simulator** for the game's pull system
6. **Side-by-side character comparison**
7. **Structured data API** for external tool developers

### Nice-to-Have (Phase 3)
1. **Damage calculator / team DPS simulator**
2. **Achievement tracker** with personal progress
3. **Interactive map** (if game has exploration)
4. **Community data aggregation** (player-submitted usage stats)
5. **Build optimizer** (auto-suggest best equipment from inventory)
6. **Recruitment/pull calculator** (if applicable to game mechanics)
7. **Data export / API** for community developers

---

## Sources

- [Honey Hunter World](https://gensh.honeyhunterworld.com/)
- [Paimon.moe](https://paimon.moe/)
- [Paimon.moe GitHub](https://github.com/MadeBaruna/paimon-moe)
- [Genshin.gg](https://genshin.gg/)
- [Genshin Optimizer](https://frzyc.github.io/genshin-optimizer/)
- [KQM Theorycrafting Library](https://library.keqingmains.com/)
- [KQM Tools](https://library.keqingmains.com/resources/tools)
- [Prydwen Institute - HSR](https://www.prydwen.gg/star-rail/)
- [Prydwen Characters](https://www.prydwen.gg/star-rail/characters/)
- [Game8 Genshin Impact](https://game8.co/games/Genshin-Impact)
- [Game8 HSR](https://game8.co/games/Honkai-Star-Rail)
- [Arknights Terra Wiki](https://arknights.wiki.gg/)
- [PRTS Wiki](https://prts.wiki/)
- [Aceship Recruitment Calculator](https://aceship.github.io/AN-EN-Tags/akhr.html)
- [Arknights Toolbox](https://deepwiki.com/arkntools/arknights-toolbox/3.3-recruitment-calculator)
- [PoE Wiki](https://www.poewiki.net/)
- [PoE Wiki Data Query API](https://www.poewiki.net/wiki/Path_of_Exile_Wiki:Data_query_API)
- [Craft of Exile](https://www.craftofexile.com/)
- [FilterBlade](https://www.filterblade.xyz/)
- [gcsim](https://gcsim.app/)
- [Genshin Impact Fandom Wiki](https://genshin-impact.fandom.com/)
- [ProWiki - Best MediaWiki Themes](https://www.pro.wiki/articles/best-mediawiki-skins)
- [Fandom Theme Designer](https://community.fandom.com/wiki/Help:Theme_Designer)
- [Fandom Portable Infobox](https://community.fandom.com/wiki/Help:Infoboxes)
- [Wikimedia Responsive Design](https://diff.wikimedia.org/2018/03/26/responsive-web-design-templatestyles/)
