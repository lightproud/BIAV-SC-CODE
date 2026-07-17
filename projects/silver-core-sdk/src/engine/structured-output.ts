/**
 * Facade: the structured-output subsystem now lives in
 * internal/structured-output.ts (the shared-kernel layer) because TWO modules
 * consume it — the engine loop (Options.outputFormat gate) and
 * tools/workflow-engine (agent() opts.schema validation, H5 audit T49) — and
 * tools/ -> engine/ is not a declared import edge. Pure functions + types
 * only; every existing engine-side import keeps working through this
 * re-export.
 */

export * from '../internal/structured-output.js';
