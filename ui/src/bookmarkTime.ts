export { formatBookmarkTime } from "../../shared/bookmarkTime";

export function parseBookmarkTime(value: string): number | null {
  const parts = value.trim().split(":");
  if (parts.length < 1 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const numbers = parts.map(Number);
  if (numbers.some((part, index) => index > 0 && part > 59)) return null;
  const seconds = parts.length === 3
    ? numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
    : parts.length === 2
      ? numbers[0] * 60 + numbers[1]
      : numbers[0];
  return Number.isSafeInteger(seconds) && seconds <= 1_000_000_000 ? seconds : null;
}
