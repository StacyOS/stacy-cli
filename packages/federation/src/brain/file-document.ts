import { Buffer } from "node:buffer";
import { basename, extname } from "node:path";

import type { CanonicalJsonValue } from "../crypto/canonical.js";

/**
 * Builds a signed-KO content envelope from a local file's bytes. Pure: it does
 * NOT touch the filesystem — the caller reads the bytes and computes the
 * source label, this function only validates + wraps. That keeps media-type
 * inference, binary detection, and JSON parsing unit-testable without disk.
 *
 *   file bytes ──► buildFileDocumentContent ──► { content, contentType, ... }
 *                       │
 *                       ├─ infer mediaType from extension
 *                       ├─ reject binary / non-UTF8 (NUL byte or bad decode)
 *                       ├─ enforce maxBytes guard
 *                       └─ wrap in { kind:"document", source, mediaType, text|data }
 *
 * The envelope is a uniform `kind: "document"` shape so it matches what a future
 * filesystem *connector* would emit, and so AI runs can consume it the same way
 * they consume connector-ingested KOs.
 */

export const FILE_DOCUMENT_KIND = "document";
export const DEFAULT_MAX_FILE_BYTES = 1_048_576; // 1 MiB

export interface BuildFileDocumentOptions {
  /** Path as the user supplied it — used for extension inference only. */
  readonly path: string;
  /** Raw file bytes. */
  readonly bytes: Buffer | Uint8Array;
  /**
   * Provenance label stored in the KO. MUST already be safe to persist/share —
   * the caller is responsible for using a relative path or basename, never a
   * leak-prone absolute path. See `safeSourceLabel`.
   */
  readonly sourceLabel: string;
  /** Skip files larger than this (bytes). Default {@link DEFAULT_MAX_FILE_BYTES}. */
  readonly maxBytes?: number;
}

export interface FileDocumentResult {
  /** KO content envelope. */
  readonly content: CanonicalJsonValue;
  /** KO content type — always `application/json` (the envelope is JSON). */
  readonly contentType: string;
  /** Inferred original media type (e.g. `text/markdown`). */
  readonly mediaType: string;
  /** Provenance source label echoed back. */
  readonly source: string;
}

/** Raised when a file cannot become a document KO (binary, too big, bad JSON). */
export class FileDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FileDocumentError";
  }
}

const MEDIA_TYPE_BY_EXT: Record<string, string> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".txt": "text/plain",
  ".text": "text/plain",
  ".json": "application/json",
};

export function inferMediaType(path: string): string {
  return MEDIA_TYPE_BY_EXT[extname(path).toLowerCase()] ?? "text/plain";
}

/**
 * Derives a provenance label that will not leak local machine context. Prefers
 * a relative path under `cwd`; if the file sits outside `cwd` (relative path
 * escapes with `..`) or is absolute, falls back to the bare filename.
 */
export function safeSourceLabel(relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/");
  if (
    normalized.length === 0 ||
    normalized.startsWith("..") ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:\//.test(normalized) // windows drive-absolute
  ) {
    return basename(normalized) || normalized;
  }
  return normalized;
}

function looksBinary(bytes: Buffer): boolean {
  // A NUL byte is the cheapest, most reliable binary signal for text formats.
  return bytes.includes(0x00);
}

function decodeUtf8(bytes: Buffer): string {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  return decoder.decode(bytes);
}

export function buildFileDocumentContent(
  options: BuildFileDocumentOptions,
): FileDocumentResult {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_FILE_BYTES;
  const buffer = Buffer.isBuffer(options.bytes)
    ? options.bytes
    : Buffer.from(options.bytes);

  if (buffer.byteLength > maxBytes) {
    throw new FileDocumentError(
      `File ${options.sourceLabel} is ${buffer.byteLength} bytes, over the ${maxBytes}-byte limit. Pass --max-bytes to raise it.`,
    );
  }

  if (looksBinary(buffer)) {
    throw new FileDocumentError(
      `File ${options.sourceLabel} looks binary (contains NUL bytes); only UTF-8 text/markdown/json files can become Knowledge Objects.`,
    );
  }

  let text: string;
  try {
    text = decodeUtf8(buffer);
  } catch {
    throw new FileDocumentError(
      `File ${options.sourceLabel} is not valid UTF-8 text.`,
    );
  }

  const mediaType = inferMediaType(options.path);

  let body: { readonly text: string } | { readonly data: CanonicalJsonValue };
  if (mediaType === "application/json") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new FileDocumentError(
        `File ${options.sourceLabel} has a .json extension but is not valid JSON: ${(error as Error).message}`,
      );
    }
    body = { data: parsed as CanonicalJsonValue };
  } else {
    body = { text };
  }

  const content: CanonicalJsonValue = {
    kind: FILE_DOCUMENT_KIND,
    source: options.sourceLabel,
    mediaType,
    ...body,
  };

  return {
    content,
    contentType: "application/json",
    mediaType,
    source: options.sourceLabel,
  };
}
