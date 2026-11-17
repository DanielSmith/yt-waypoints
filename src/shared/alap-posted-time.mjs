// Query-input normalization only; does not collect, persist or infer publication time.
export function readPostedTime(value) {
  const valid = (n) => Number.isSafeInteger(n) && n > 0 && n <= 8640000000000000;
  if (typeof value === "number") return valid(value) ? value : null;
  if (typeof value !== "string") return null;
  // Exact seconds and an explicit offset are required; date-only/local times
  // would invent precision or depend on the machine's timezone. Millisecond max.
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) return null;
  const [, year, month, day, hour, minute, second, , zone] = match;
  const y = Number(year),
    m = Number(month),
    d = Number(day);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > days[m - 1] ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59
  )
    return null;
  if (zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59)) return null;
  const timestamp = Date.parse(value);
  return valid(timestamp) ? timestamp : null;
}
