export interface TelemetrySeriesInput {
  label: string;
  stroke: string;
  scale: string;
  timecodes: number[];
  values: number[];
  offsetMs?: number;
}

export interface AlignedTelemetryData {
  xSeconds: number[];
  ySeries: Array<Array<number | null>>;
  series: Array<Pick<TelemetrySeriesInput, "label" | "stroke" | "scale">>;
  scaleNames: string[];
}

export function normalizeTimecodes(timecodes: number[], offsetMs = 0): number[] {
  return timecodes.map((timecode) => timecode - offsetMs);
}

export function buildAlignedTelemetryData(
  inputs: TelemetrySeriesInput[]
): AlignedTelemetryData | null {
  const series = inputs
    .map((input) => ({
      ...input,
      normalizedTimecodes: normalizeTimecodes(
        input.timecodes,
        input.offsetMs ?? 0
      ),
    }))
    .filter(
      (input) => input.normalizedTimecodes.length > 0 && input.values.length > 0
    );

  if (series.length === 0) {
    return null;
  }

  const xMs = Array.from(
    new Set(series.flatMap((input) => input.normalizedTimecodes))
  ).sort((a, b) => a - b);

  const ySeries = series.map((input) => {
    const points = new Map<number, number>();
    const pointCount = Math.min(
      input.normalizedTimecodes.length,
      input.values.length
    );

    for (let i = 0; i < pointCount; i++) {
      const timecode = input.normalizedTimecodes[i];
      const value = input.values[i];
      if (!Number.isFinite(timecode) || !Number.isFinite(value)) {
        continue;
      }
      points.set(timecode, value);
    }

    return xMs.map((timecode) => points.get(timecode) ?? null);
  });

  return {
    xSeconds: xMs.map((timecode) => timecode / 1000),
    ySeries,
    series: series.map(({ label, stroke, scale }) => ({
      label,
      stroke,
      scale,
    })),
    scaleNames: Array.from(new Set(series.map((input) => input.scale))),
  };
}
