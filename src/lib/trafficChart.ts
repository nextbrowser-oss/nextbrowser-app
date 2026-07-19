const nodeMavenDatePattern = /^(\d{4})[.-](\d{1,2})[.-](\d{1,2})$/;
const binaryUnit = 1024;
const trafficScaleSteps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1024];

function historyDate(label: string): Date | undefined {
  const value = label.trim();
  const match = nodeMavenDatePattern.exec(value);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const parsed = new Date(year, month - 1, day, 12);
    if (
      parsed.getFullYear() === year
      && parsed.getMonth() === month - 1
      && parsed.getDate() === day
    ) {
      return parsed;
    }
    return undefined;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function formatHistoryDateLabel(label: string, locale?: string): string {
  const parsed = historyDate(label);
  return parsed?.toLocaleDateString(locale, { month: "short", day: "numeric" }) ?? label;
}

export function sortTrafficHistoryPoints<T extends { label: string }>(points: readonly T[]): T[] {
  const datedPoints = points.map((point, index) => ({
    point,
    index,
    timestamp: historyDate(point.label)?.getTime(),
  }));

  if (datedPoints.some(({ timestamp }) => timestamp == null)) return [...points];

  return datedPoints
    .sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0) || left.index - right.index)
    .map(({ point }) => point);
}

export function trafficChartTickIndices(pointCount: number, maximumTicks = 7): number[] {
  if (pointCount <= 0 || maximumTicks <= 0) return [];
  if (pointCount <= maximumTicks) return Array.from({ length: pointCount }, (_, index) => index);
  if (maximumTicks === 1) return [pointCount - 1];

  return Array.from(
    new Set(
      Array.from({ length: maximumTicks }, (_, index) =>
        Math.round(index * (pointCount - 1) / (maximumTicks - 1))),
    ),
  );
}

export function trafficChartMaximumBytes(maximumBytes: number): number {
  if (!Number.isFinite(maximumBytes) || maximumBytes <= 0) return 1;

  let unit = 1;
  while (maximumBytes / unit >= binaryUnit) unit *= binaryUnit;
  const scaled = maximumBytes / unit;
  const step = trafficScaleSteps.find((candidate) => candidate >= scaled) ?? binaryUnit;
  return step * unit;
}
