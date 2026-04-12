/**
 * artifacts.ts -- Local artifact storage for truncated tool results.
 *
 * Why artifacts: Prime Directive T2 says tool results > 2000 tokens must
 * be truncated. But the full result is still valuable — user may want to
 * read it, copy it, or reference it later. We save full results as local
 * JSON files in the app data directory, keyed by a unique artifact ID.
 *
 * Why filesystem (not SQLite): Artifacts can be large (megabytes). Storing
 * them as blobs in SQLite bloats the DB and makes backups harder. Files
 * are simpler to inspect and clean up.
 */

import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { logger } from '../core/logger';

interface ArtifactMeta {
  id: string;
  toolName: string;
  conversationId: string;
  createdAt: number;
  /** Byte size of the full content. */
  size: number;
  /** First 200 chars of content for preview. */
  preview: string;
}

interface ArtifactFull extends ArtifactMeta {
  content: string;
}

/**
 * Get the artifacts storage directory. Created on first use.
 */
function getArtifactsDir(): string {
  const dir = path.join(app.getPath('userData'), 'artifacts');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Save a full tool result as a local artifact.
 * Returns the artifact ID and filesystem path.
 */
export function saveArtifact(
  toolName: string,
  conversationId: string,
  content: string,
): { id: string; path: string } {
  const id = `art_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const dir = getArtifactsDir();

  const artifact: ArtifactFull = {
    id,
    toolName,
    conversationId,
    createdAt: Date.now(),
    size: content.length,
    preview: content.slice(0, 200),
    content,
  };

  const filePath = path.join(dir, `${id}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify(artifact), 'utf-8');
    logger.info('artifacts', 'Saved artifact', { id, toolName, size: content.length });
  } catch (err) {
    logger.error('artifacts', 'Failed to save artifact', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return { id, path: filePath };
}

/**
 * List all artifact metadata (without full content) for a conversation.
 * If conversationId is omitted, lists all artifacts.
 */
export function listArtifacts(conversationId?: string): ArtifactMeta[] {
  const dir = getArtifactsDir();

  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const artifacts: ArtifactMeta[] = [];

    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
        const parsed = JSON.parse(raw) as ArtifactFull;
        if (conversationId && parsed.conversationId !== conversationId) continue;
        // Return meta only (no full content)
        artifacts.push({
          id: parsed.id,
          toolName: parsed.toolName,
          conversationId: parsed.conversationId,
          createdAt: parsed.createdAt,
          size: parsed.size,
          preview: parsed.preview,
        });
      } catch {
        // Skip corrupt files
      }
    }

    return artifacts.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
}

/**
 * Get the full content of an artifact by ID.
 */
export function getArtifact(id: string): ArtifactFull | null {
  const dir = getArtifactsDir();
  const filePath = path.join(dir, `${id}.json`);

  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as ArtifactFull;
  } catch {
    return null;
  }
}

/**
 * Delete an artifact by ID.
 */
export function deleteArtifact(id: string): boolean {
  const dir = getArtifactsDir();
  const filePath = path.join(dir, `${id}.json`);

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
