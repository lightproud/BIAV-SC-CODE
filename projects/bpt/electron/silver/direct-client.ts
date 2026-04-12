/**
 * direct-client.ts — Direct Python script calls for Silver Core tools
 * that don't need LLM mediation.
 *
 * Why separate from MCP: 5 of the 9 silver core tools are either
 * management operations (rebuild_indexes, memory_writeback) or
 * system-level queries (check_cache, memory_utility, recommend_context
 * for auto-injection). These should NEVER enter the LLM's tool schema
 * because that wastes token budget. Instead, the main process or renderer
 * calls them directly via this module.
 *
 * How it works: spawn a one-shot Python process per call. This is fine
 * because these calls are infrequent (once per session for recommend_context,
 * once for rebuild_indexes, etc.). For the frequent memory_search UI panel
 * calls, we reuse the MCP client's callTool() instead.
 */

import { spawn } from 'node:child_process';
import { logger } from '../core/logger';

interface DirectCallResult {
  success: boolean;
  data: unknown;
  error?: string;
}

/**
 * Run a Python script and capture its stdout as JSON.
 */
async function runPythonScript(
  pythonPath: string,
  scriptPath: string,
  args: string[],
  cwd: string,
): Promise<DirectCallResult> {
  return new Promise((resolve) => {
    const proc = spawn(pythonPath, [scriptPath, ...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    proc.on('error', (err: Error) => {
      resolve({ success: false, data: null, error: err.message });
    });

    proc.on('close', (code: number | null) => {
      if (code !== 0) {
        logger.warn('direct-client', `Script exited with code ${code}`, { stderr: stderr.slice(0, 500) });
      }

      try {
        const parsed = JSON.parse(stdout);
        resolve({ success: true, data: parsed });
      } catch {
        // Script may output non-JSON (e.g., progress messages).
        // Return raw text as the result.
        resolve({
          success: code === 0,
          data: stdout.trim(),
          error: code !== 0 ? stderr.slice(0, 500) : undefined,
        });
      }
    });
  });
}

/**
 * Silver Core direct API — for tools that bypass MCP.
 */
export class SilverDirectClient {
  constructor(
    private pythonPath: string,
    private repoRoot: string,
  ) {}

  private get scriptsDir(): string {
    return `${this.repoRoot}/scripts`;
  }

  async checkCache(query: string): Promise<DirectCallResult> {
    return runPythonScript(
      this.pythonPath,
      `${this.scriptsDir}/dream.py`,
      ['--check-cache', query],
      this.repoRoot,
    );
  }

  async memoryUtility(topN: number = 10): Promise<DirectCallResult> {
    return runPythonScript(
      this.pythonPath,
      `${this.scriptsDir}/memrl.py`,
      ['--top', String(topN), '--json'],
      this.repoRoot,
    );
  }

  async recommendContext(query: string, role: string = ''): Promise<DirectCallResult> {
    const args = ['--query', query];
    if (role) args.push('--role', role);
    args.push('--json');
    return runPythonScript(
      this.pythonPath,
      `${this.scriptsDir}/context_manager.py`,
      args,
      this.repoRoot,
    );
  }

  async rebuildIndexes(): Promise<DirectCallResult> {
    return runPythonScript(
      this.pythonPath,
      `${this.scriptsDir}/dream.py`,
      ['--rebuild'],
      this.repoRoot,
    );
  }

  async memoryWriteback(dryRun: boolean = false): Promise<DirectCallResult> {
    const args = ['--verbose'];
    if (dryRun) args.push('--dry-run');
    return runPythonScript(
      this.pythonPath,
      `${this.scriptsDir}/memory_writeback.py`,
      args,
      this.repoRoot,
    );
  }
}
