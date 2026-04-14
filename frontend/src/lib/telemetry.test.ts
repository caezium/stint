import { describe, expect, it } from "vitest";

import {
  buildAlignedTelemetryData,
  normalizeTimecodes,
} from "./telemetry";

describe("telemetry helpers", () => {
  it("normalizes lap timecodes relative to the lap start", () => {
    expect(normalizeTimecodes([1010, 1030, 1060], 1000)).toEqual([10, 30, 60]);
  });

  it("aligns telemetry series by timestamp instead of array index", () => {
    const aligned = buildAlignedTelemetryData([
      {
        label: "RPM",
        stroke: "#f00",
        scale: "RPM",
        timecodes: [1000, 2000, 3000],
        values: [9000, 9500, 10000],
        offsetMs: 1000,
      },
      {
        label: "Speed",
        stroke: "#0f0",
        scale: "Speed",
        timecodes: [1500, 3000],
        values: [50, 70],
        offsetMs: 1000,
      },
    ]);

    expect(aligned).not.toBeNull();
    expect(aligned?.xSeconds).toEqual([0, 0.5, 1, 2]);
    expect(aligned?.ySeries).toEqual([
      [9000, null, 9500, 10000],
      [null, 50, null, 70],
    ]);
    expect(aligned?.scaleNames).toEqual(["RPM", "Speed"]);
  });
});
