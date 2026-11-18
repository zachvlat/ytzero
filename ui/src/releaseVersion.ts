import { compareReleaseParts, parseReleaseTag } from "../../shared/releaseVersion";

type ReleaseVersionKind = "legacy" | "calver";

interface ParsedReleaseVersion {
  kind: ReleaseVersionKind;
  parts: [string, string, string];
  key: string;
}

function parseReleaseVersion(value: string): ParsedReleaseVersion | null {
  const parsed = parseReleaseTag(value);
  if (!parsed) return null;
  return { kind: parsed.scheme, parts: parsed.parts, key: `${parsed.scheme}:${parsed.parts.join(".")}` };
}

export function isReleaseVersion(value: string): boolean {
  return parseReleaseVersion(value) !== null;
}

export function releaseVersionKey(value: string): string | null {
  return parseReleaseVersion(value)?.key ?? null;
}

/** Returns a positive number when left is newer, zero when equal, and null for invalid input. */
export function compareReleaseVersions(left: string, right: string): number | null {
  const a = parseReleaseVersion(left);
  const b = parseReleaseVersion(right);
  if (!a || !b) return null;
  if (a.kind !== b.kind) return a.kind === "calver" ? 1 : -1;
  return compareReleaseParts(a.parts, b.parts);
}
