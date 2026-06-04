import { globSync, lstatSync } from "node:fs";
import { extname, relative, resolve } from "node:path";

import { safeSourceLabel } from "./file-document.js";

/**
 * Enumerates local files to ingest as Knowledge Objects. Uses Node's native
 * `fs.globSync` (no dependency) so patterns like `docs/**​/*.md` work.
 *
 *   root + glob/ext ──► globSync ──► per-path filter ──► CollectedFile[]
 *                                        │
 *                                        ├─ skip dotfiles / dotdirs
 *                                        ├─ skip node_modules, .git
 *                                        ├─ skip symlinks (lstat)
 *                                        ├─ skip non-files (dirs)
 *                                        └─ ext allowlist (if given)
 *
 * Binary detection and the size guard happen later, per-file, in
 * `buildFileDocumentContent` — a file that passes here can still be skipped at
 * read time. Labels are leak-safe (cwd-relative or basename).
 */

const DEFAULT_EXCLUDED_DIRS = new Set(["node_modules", ".git"]);

export interface CollectedFile {
  readonly absolutePath: string;
  /** Leak-safe provenance label (cwd-relative path or basename). */
  readonly label: string;
}

export interface SkippedFile {
  readonly path: string;
  readonly reason: string;
}

export interface CollectFilesOptions {
  /** Base directory (cwd-relative or absolute). Defaults to cwd. */
  readonly root?: string;
  /** Glob pattern relative to `root`. Defaults to `**​/*`. */
  readonly glob?: string;
  /** Extension allowlist, with or without leading dots (e.g. `md`, `.txt`). */
  readonly ext?: readonly string[];
}

export interface CollectFilesResult {
  readonly files: readonly CollectedFile[];
  readonly skipped: readonly SkippedFile[];
}

/**
 * Pure path-rule check. Returns a skip reason, or `undefined` to keep the path.
 * Separated from the filesystem walk so the rules are unit-testable.
 */
export function excludeReason(
  relPath: string,
  extAllow?: ReadonlySet<string>,
): string | undefined {
  const segments = relPath.replaceAll("\\", "/").split("/").filter(Boolean);
  for (const segment of segments) {
    if (segment.startsWith(".")) return `hidden path segment "${segment}"`;
    if (DEFAULT_EXCLUDED_DIRS.has(segment)) return `excluded directory "${segment}"`;
  }
  if (extAllow && extAllow.size > 0) {
    const ext = extname(relPath).toLowerCase().replace(/^\./, "");
    if (!extAllow.has(ext)) return `extension ".${ext}" not in --ext allowlist`;
  }
  return undefined;
}

export function normalizeExtAllowlist(
  ext: readonly string[] | undefined,
): ReadonlySet<string> | undefined {
  if (!ext || ext.length === 0) return undefined;
  return new Set(ext.map((entry) => entry.trim().toLowerCase().replace(/^\./, "")).filter(Boolean));
}

export function collectFiles(options: CollectFilesOptions): CollectFilesResult {
  const root = resolve(process.cwd(), options.root?.trim() || ".");
  const pattern = options.glob?.trim() || "**/*";
  const extAllow = normalizeExtAllowlist(options.ext);

  const files: CollectedFile[] = [];
  const skipped: SkippedFile[] = [];

  const matches = globSync(pattern, { cwd: root }).sort();
  for (const relPath of matches) {
    const absolutePath = resolve(root, relPath);

    const reason = excludeReason(relPath, extAllow);
    if (reason) {
      skipped.push({ path: relPath, reason });
      continue;
    }

    let stats;
    try {
      stats = lstatSync(absolutePath);
    } catch {
      skipped.push({ path: relPath, reason: "could not stat (permission?)" });
      continue;
    }
    if (stats.isSymbolicLink()) {
      skipped.push({ path: relPath, reason: "symlink" });
      continue;
    }
    if (!stats.isFile()) continue; // directories and other non-files

    files.push({
      absolutePath,
      label: safeSourceLabel(relative(process.cwd(), absolutePath)),
    });
  }

  return { files, skipped };
}
