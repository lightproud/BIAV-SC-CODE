/**
 * Sandbox failure-with-evidence detection (G-SANDBOX).
 *
 * When a SANDBOXED command fails, the model should see whether the failure
 * matches known sandbox-restriction signatures, so it can follow the archived
 * guidance: retry with `dangerouslyDisableSandbox: true` (which prompts the
 * user) or work with the user to adjust sandbox settings. The hint text is
 * ADAPTED (faithful:false) from the archived fragments
 * -failure-evidence-condition / -retry-without-sandbox /
 * -user-permission-prompt / -adjust-settings — including the honest caveat
 * that commands fail for many reasons unrelated to the sandbox.
 *
 * Detection is deliberately conservative substring matching over stderr;
 * network signatures only count when the sandbox actually isolates the
 * network (allowNetwork false) — a network error under an open-network
 * sandbox is never sandbox evidence.
 */

/** Signatures that indicate a filesystem/permission denial by the sandbox. */
const FS_SIGNATURES: ReadonlyArray<[label: string, needle: string]> = [
  ['operation not permitted', 'operation not permitted'],
  ['permission denied', 'permission denied'],
  ['read-only file system', 'read-only file system'],
  ['EACCES', 'eacces'],
  ['EPERM', 'eperm'],
  ['EROFS', 'erofs'],
];

/** Signatures that indicate the network isolation blocked the command. */
const NET_SIGNATURES: ReadonlyArray<[label: string, needle: string]> = [
  ['network is unreachable', 'network is unreachable'],
  ['could not resolve host', 'could not resolve host'],
  ['name resolution failure', 'failure in name resolution'],
  ['connection refused', 'connection refused'],
];

/**
 * Return the matched signature label when a sandboxed failure looks
 * sandbox-caused, else null. Success (exit 0) is never evidence.
 */
export function detectSandboxEvidence(
  exitCode: number | null,
  stderr: string,
  allowNetwork: boolean,
): string | null {
  if (exitCode === 0) return null;
  const hay = stderr.toLowerCase();
  for (const [label, needle] of FS_SIGNATURES) {
    if (hay.includes(needle)) return label;
  }
  if (!allowNetwork) {
    for (const [label, needle] of NET_SIGNATURES) {
      if (hay.includes(needle)) return label;
    }
  }
  return null;
}

/**
 * The tool_result annotation appended to a sandboxed failure that matched a
 * signature. `allowEscape:false` (mandatory mode) must not advertise the
 * disabled parameter — it points at adjusting settings only.
 */
export function sandboxFailureHint(signature: string, allowEscape: boolean): string {
  const base =
    `[sandbox] This command ran inside the sandbox and the failure matches ` +
    `evidence of sandbox-caused failures (${signature}). Note that commands ` +
    `can fail for many reasons unrelated to the sandbox (missing files, wrong ` +
    `arguments, network issues, etc.).`;
  if (!allowEscape) {
    return (
      base +
      ' The `dangerouslyDisableSandbox` parameter is disabled by policy; if the ' +
      'sandbox caused this, work with the user to adjust sandbox settings instead.'
    );
  }
  return (
    base +
    ' If the sandbox caused this, retry with `dangerouslyDisableSandbox: true` ' +
    '— this will prompt the user for permission — or work with the user to ' +
    'adjust sandbox settings instead.'
  );
}
