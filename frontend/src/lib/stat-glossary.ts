/**
 * Plain-language one-liners for telemetry stats. Powers the <ExplainButton>
 * (T3.5) tooltips and chat pre-fills.
 */

export const STAT_GLOSSARY: Record<string, string> = {
  throttle_smoothness:
    "How smoothly you modulate the throttle (1.0 = perfectly smooth, lower = more jab/lift).",
  braking_aggressiveness:
    "Median rate of brake-pressure change while braking — higher = sharper application/release.",
  steering_smoothness:
    "How smoothly you turn the wheel (1.0 = perfectly smooth, lower = more correction/sawing).",
  max_brake:
    "Peak brake pressure on your reference lap — useful for spotting under-braking.",
  coefficient_of_variation:
    "Lap-time variability as a percent of mean. <1.5% is very consistent; >3% is rough.",
  best_streak:
    "Longest run of consecutive laps within 1% of your best lap time.",
  delta_to_best_pct:
    "How far the average sector time was from this session's best in that sector, as %.",
  cov_pct:
    "Within-sector variability — high values mean you're inconsistent in that corner.",
  score:
    "0–100 sector consistency rating combining your delta-to-best and within-sector variability.",
  lap_trend_slope_ms_per_lap:
    "Trend in lap time across the session: positive = getting slower, negative = getting faster.",
  brake_on_distance_m:
    "Distance from start where you first hit the brakes for this corner.",
  apex_speed:
    "Minimum speed through the corner — your trail-brake / commitment indicator.",
  throttle_pickup_distance_m:
    "Distance from start where you first reach >80% throttle out of the corner.",
};

export function explainStat(key: string): string {
  return STAT_GLOSSARY[key] ?? "";
}
