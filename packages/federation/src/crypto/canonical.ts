import { Buffer } from "node:buffer";

export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanonicalizationError";
  }
}

export function canonicalize(value: unknown): string {
  return serializeCanonical(value, new WeakSet<object>());
}

export function canonicalBytes(value: unknown): Buffer {
  return Buffer.from(canonicalize(value), "utf8");
}

function serializeCanonical(value: unknown, seen: WeakSet<object>): string {
  if (value === null) {
    return "null";
  }

  const valueType = typeof value;

  if (valueType === "string") {
    return JSON.stringify(value);
  }

  if (valueType === "boolean") {
    return value ? "true" : "false";
  }

  if (valueType === "number") {
    if (!Number.isFinite(value)) {
      throw new CanonicalizationError("Canonical JSON does not support non-finite numbers");
    }

    return JSON.stringify(value);
  }

  if (valueType !== "object") {
    throw new CanonicalizationError(
      `Canonical JSON does not support values of type ${valueType}`,
    );
  }

  const objectValue = value as object;

  if (seen.has(objectValue)) {
    throw new CanonicalizationError("Canonical JSON does not support circular references");
  }

  seen.add(objectValue);
  try {
    if (Array.isArray(value)) {
      if (value.some((entry) => entry === undefined)) {
        throw new CanonicalizationError(
          "Canonical JSON does not support undefined array entries",
        );
      }

      return `[${value.map((entry) => serializeCanonical(entry, seen)).join(",")}]`;
    }

    const entries = Object.entries(objectValue).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );

    return `{${entries
      .map(([key, entry]) => {
        if (entry === undefined) {
          throw new CanonicalizationError(
            `Canonical JSON does not support undefined at key ${key}`,
          );
        }

        return `${JSON.stringify(key)}:${serializeCanonical(entry, seen)}`;
      })
      .join(",")}}`;
  } finally {
    seen.delete(objectValue);
  }
}
