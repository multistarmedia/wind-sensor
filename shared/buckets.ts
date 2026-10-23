// Bucket sizing for history charts: roughly 600–1000 points for any range up to 31 days.

const NICE_BUCKETS_MS = [
  1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400,
].map((s) => s * 1000);

export const TARGET_POINTS = 750;

export function bucketSizeMs(rangeMs: number): number {
  const ideal = rangeMs / TARGET_POINTS;
  return NICE_BUCKETS_MS.find((b) => b >= ideal) ?? NICE_BUCKETS_MS[NICE_BUCKETS_MS.length - 1]!;
}
