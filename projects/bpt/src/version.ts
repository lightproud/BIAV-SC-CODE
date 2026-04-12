/**
 * version.ts -- Single source of truth for the BPT version string.
 *
 * Why: Version was hardcoded in 4 files (main.ts, loader.ts, StatusBar.tsx,
 * sdk/index.ts). A mismatch caused plugin rejection (loader.ts had 0.3.0 while
 * main.ts had 0.4.0). Centralizing here eliminates that class of bug.
 */
export const BPT_VERSION = '0.4.0';
