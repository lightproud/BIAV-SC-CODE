# BPT — Black Pool Terminal

> 母版终端 v0.1.0

## Quick Start

```bash
cd projects/bpt
npm install
npm run electron:dev
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requirements

- Node.js 18+
- Python 3.10+ (for Silver Core MCP server)
- Silver Core indexes built (`python scripts/memory_search.py --build` from repo root)

## Configuration

First launch: Settings > fill in API endpoint + key.

- **API Base URL**: Your company gateway endpoint (or `https://api.anthropic.com`)
- **API Key**: Your API key
- **Model**: Model ID (e.g., `claude-sonnet-4-20250514`)

## Scripts

| Command | Description |
|---------|-------------|
| `npm run electron:dev` | Start in development mode |
| `npm run build` | Build for production |
| `npm run typecheck` | Run TypeScript type checking |

## Distribution

BPT is distributed via SVN alongside Black Pool data. Team members run `svn update` to get the latest version, then `npm install && npm run electron:dev`.
