# BPT Plugin Protocol (Draft)

> Status: **Protocol only — no implementation in Phase 0.**

## Plugin Manifest

Each plugin is a directory with a `manifest.json`:

```json
{
  "name": "example-plugin",
  "version": "1.0.0",
  "description": "An example BPT plugin",
  "entry": "index.js",
  "permissions": ["tools:register", "ui:sidebar-tab"],
  "minBptVersion": "0.2.0"
}
```

## Permission Model

Plugins may request:

| Permission | Description |
|------------|-------------|
| `tools:register` | Register new tools in the tool registry |
| `tools:call` | Call existing tools |
| `ui:sidebar-tab` | Add a tab to the sidebar |
| `ui:menu-item` | Add items to the context menu |
| `config:read` | Read app configuration |
| `config:write` | Write app configuration |
| `fs:read` | Read files from the repo |
| `fs:write` | Write files (requires explicit user approval) |

## Sandbox

- Plugins run in a Node.js worker thread (not the main process)
- No direct access to Electron APIs
- Communication through a `PluginContext` API object
- Version mismatch → refuse to load

## Plugin Context API

```typescript
interface PluginContext {
  registerTool(descriptor: ToolDescriptor): void;
  callTool(name: string, input: Record<string, unknown>): Promise<unknown>;
  addSidebarTab(config: { title: string; icon: string; component: string }): void;
  getConfig(key: string): unknown;
  setConfig(key: string, value: unknown): void;
  log(level: string, message: string): void;
}
```

## Isolation Rules

1. Plugin cannot access other plugins' state
2. Plugin cannot modify core BPT source code
3. Plugin cannot bypass permission model
4. Core version mismatch → plugin refused at load time
5. Plugin errors do not crash the main process
