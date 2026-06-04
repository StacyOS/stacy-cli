import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_MAX_FILE_BYTES,
  FileDocumentError,
  buildFileDocumentContent,
  inferMediaType,
  safeSourceLabel,
} from "./file-document.js";

describe("inferMediaType", () => {
  it("maps known extensions", () => {
    expect(inferMediaType("a.md")).toBe("text/markdown");
    expect(inferMediaType("a.MARKDOWN")).toBe("text/markdown");
    expect(inferMediaType("a.txt")).toBe("text/plain");
    expect(inferMediaType("a.json")).toBe("application/json");
  });

  it("defaults unknown extensions to text/plain", () => {
    expect(inferMediaType("LICENSE")).toBe("text/plain");
    expect(inferMediaType("a.rst")).toBe("text/plain");
  });
});

describe("safeSourceLabel", () => {
  it("keeps in-cwd relative paths", () => {
    expect(safeSourceLabel("docs/notes.md")).toBe("docs/notes.md");
  });

  it("falls back to basename for escaping or absolute paths (no leak)", () => {
    expect(safeSourceLabel("../secret/notes.md")).toBe("notes.md");
    expect(safeSourceLabel("/Users/alice/secret/notes.md")).toBe("notes.md");
    expect(safeSourceLabel("C:/Users/alice/notes.md")).toBe("notes.md");
  });

  it("normalizes windows separators", () => {
    expect(safeSourceLabel("docs\\sub\\notes.md")).toBe("docs/sub/notes.md");
  });
});

describe("buildFileDocumentContent", () => {
  it("wraps markdown as a document envelope with text body", () => {
    const result = buildFileDocumentContent({
      path: "docs/notes.md",
      bytes: Buffer.from("# Title\n\nbody", "utf8"),
      sourceLabel: "docs/notes.md",
    });
    expect(result.contentType).toBe("application/json");
    expect(result.mediaType).toBe("text/markdown");
    expect(result.content).toEqual({
      kind: "document",
      source: "docs/notes.md",
      mediaType: "text/markdown",
      text: "# Title\n\nbody",
    });
  });

  it("parses json files into a structured data body", () => {
    const result = buildFileDocumentContent({
      path: "data/x.json",
      bytes: Buffer.from('{"a":1,"b":[2,3]}', "utf8"),
      sourceLabel: "data/x.json",
    });
    expect(result.mediaType).toBe("application/json");
    expect(result.content).toEqual({
      kind: "document",
      source: "data/x.json",
      mediaType: "application/json",
      data: { a: 1, b: [2, 3] },
    });
  });

  it("rejects a .json file that is not valid JSON", () => {
    expect(() =>
      buildFileDocumentContent({
        path: "data/x.json",
        bytes: Buffer.from("not json", "utf8"),
        sourceLabel: "data/x.json",
      }),
    ).toThrow(FileDocumentError);
  });

  it("rejects binary content (NUL byte)", () => {
    expect(() =>
      buildFileDocumentContent({
        path: "blob.txt",
        bytes: Buffer.from([0x66, 0x00, 0x6f]),
        sourceLabel: "blob.txt",
      }),
    ).toThrow(/binary/);
  });

  it("rejects invalid UTF-8", () => {
    expect(() =>
      buildFileDocumentContent({
        path: "bad.txt",
        bytes: Buffer.from([0xff, 0xfe, 0xfd]),
        sourceLabel: "bad.txt",
      }),
    ).toThrow(/UTF-8/);
  });

  it("enforces the max-bytes guard", () => {
    expect(() =>
      buildFileDocumentContent({
        path: "big.txt",
        bytes: Buffer.alloc(11, 0x61),
        sourceLabel: "big.txt",
        maxBytes: 10,
      }),
    ).toThrow(/over the 10-byte limit/);
  });

  it("uses a 1 MiB default limit", () => {
    expect(DEFAULT_MAX_FILE_BYTES).toBe(1_048_576);
    expect(() =>
      buildFileDocumentContent({
        path: "ok.txt",
        bytes: Buffer.alloc(DEFAULT_MAX_FILE_BYTES, 0x61),
        sourceLabel: "ok.txt",
      }),
    ).not.toThrow();
  });
});
