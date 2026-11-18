export type ReleaseVersionScheme = "legacy" | "calver";

export interface ParsedReleaseTag {
  scheme: ReleaseVersionScheme;
  parts: [string, string, string];
}

/** The narrow release-tag grammar shared by the server and the web UI. */
export function parseReleaseTag(value: string): ParsedReleaseTag | null {
  // Accepting arbitrary three-number strings here would make malformed CalVer
  // tags such as 2026.8.1 look like valid SemVer releases.
  const calver = value.match(/^([1-9]\d{3})\.(0[1-9]|1[0-2])\.([1-9]\d*)$/);
  if (calver) return { scheme: "calver", parts: [calver[1], calver[2], calver[3]] };

  const legacy = value.match(/^v?0\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
  if (legacy) return { scheme: "legacy", parts: ["0", legacy[1], legacy[2]] };

  return null;
}

export function compareReleaseParts(left: readonly string[], right: readonly string[]): -1 | 0 | 1 {
  for (let index = 0; index < left.length; index++) {
    const a = left[index]!;
    const b = right[index]!;
    if (a.length !== b.length) return a.length > b.length ? 1 : -1;
    if (a !== b) return a > b ? 1 : -1;
  }
  return 0;
}
