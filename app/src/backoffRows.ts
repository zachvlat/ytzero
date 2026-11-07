/**
 * The next `limit` candidates not in retry backoff. Pages past blocked rows, so a
 * handful of permanently failing videos at the head of the order can't stall everything behind them.
 */
export async function rowsOutOfBackoff<T extends { video_id: string }>(
  page: (size: number, offset: number) => Promise<T[]>,
  retry: Map<string, { nextAt: number }>,
  limit: number,
  now: number,
): Promise<T[]> {
  const size = limit * 3;
  const rows: T[] = [];
  for (let offset = 0; rows.length < limit; offset += size) {
    const batch = await page(size, offset);
    rows.push(...batch.filter((row) => (retry.get(row.video_id)?.nextAt ?? 0) <= now));
    if (batch.length < size) break;
  }
  return rows.slice(0, limit);
}
