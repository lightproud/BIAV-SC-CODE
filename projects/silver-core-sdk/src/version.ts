/**
 * Single source of the SDK version inside shipped runtime code (audit
 * 2026-07-10 D9): the User-Agent headers and the init message's
 * claude_code_version previously hardcoded "0.1.0" while package.json moved
 * on. Runtime code cannot read package.json without a filesystem dependency
 * at import time, so the version is mirrored here as a constant and
 * scripts/check-version-bump.mjs REDS any commit where the two disagree.
 */

export const SDK_VERSION = '0.63.1';

/** User-Agent both transports send. */
export const SDK_USER_AGENT = `silver-core-sdk/${SDK_VERSION}`;
