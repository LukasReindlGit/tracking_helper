/** @typedef {{ topicId: string, startMs: number, endMs: number }} Segment */

/**
 * @param {number} seconds
 * @returns {number} one decimal place hours
 */
export function secondsToDecimalHours(seconds) {
  const h = seconds / 3600;
  return Math.round(h * 10) / 10;
}

/**
 * @param {number} n
 * @param {number} fractionDigits
 * @returns {string} comma as decimal separator
 */
export function formatDecimalDigitsForUi(n, fractionDigits) {
  if (!Number.isFinite(n)) return "0";
  const factor = 10 ** fractionDigits;
  const r = Math.round(n * factor) / factor;
  if (Number.isInteger(r)) return String(r);
  return r.toFixed(fractionDigits).replace(".", ",");
}

/**
 * Round then trim trailing zeros; comma as decimal separator (for scaled hours, sums).
 * @param {number} n
 * @param {number} maxDecimals
 */
export function formatTrimmedDecimalForUi(n, maxDecimals) {
  if (!Number.isFinite(n)) return "0";
  const r = Math.round(n * 10 ** maxDecimals) / 10 ** maxDecimals;
  if (Number.isInteger(r)) return String(r);
  const s = r.toFixed(maxDecimals);
  const trimmed = s.replace(/\.?0+$/, "");
  return trimmed.replace(".", ",");
}

export function formatDecimalHours(seconds) {
  return formatDecimalDigitsForUi(secondsToDecimalHours(seconds), 1);
}

/**
 * @param {number} seconds
 * @returns {string} h:mm:ss (hours unbounded; minutes and seconds zero-padded)
 */
export function formatSecondsAsHhMmSs(seconds) {
  const sec = Math.max(0, Math.floor(seconds));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Accepts decimal hours (e.g. 5.3), h:mm:ss, or mm:ss.
 * @param {string} raw
 * @returns {number} seconds, >= 0
 */
export function parseTimeInputToSeconds(raw) {
  const str = String(raw ?? "").trim().replace(/,/g, ".");
  if (!str) return 0;

  if (!str.includes(":")) {
    const h = parseFloat(str);
    return Number.isFinite(h) && h >= 0 ? h * 3600 : 0;
  }

  const parts = str.split(":").map((p) => p.trim());
  const nums = parts.map((p) => {
    const n = parseFloat(p);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  });
  if (nums.some((n) => Number.isNaN(n))) return 0;

  if (parts.length === 2) {
    return nums[0] * 60 + nums[1];
  }
  if (parts.length === 3) {
    return nums[0] * 3600 + nums[1] * 60 + nums[2];
  }
  return 0;
}

/**
 * @param {Segment[]} segments
 * @param {string | null} activeTopicId
 * @param {number | null} activeStartedAt
 * @param {number} nowMs
 * @returns {Record<string, number>} topicId -> seconds
 */
export function totalsPerTopic(segments, activeTopicId, activeStartedAt, nowMs) {
  /** @type {Record<string, number>} */
  const acc = {};
  for (const s of segments) {
    const dur = Math.max(0, (s.endMs - s.startMs) / 1000);
    acc[s.topicId] = (acc[s.topicId] ?? 0) + dur;
  }
  if (activeTopicId && activeStartedAt != null) {
    const extra = Math.max(0, (nowMs - activeStartedAt) / 1000);
    acc[activeTopicId] = (acc[activeTopicId] ?? 0) + extra;
  }
  return acc;
}

/**
 * @param {Record<string, number>} secondsByTopic
 * @param {Map<string, string>} topicLabels topicId -> label
 * @returns {{ label: string, hours: number }[]}
 */
export function rowsForDisplay(secondsByTopic, topicLabels) {
  return Object.entries(secondsByTopic)
    .map(([topicId, sec]) => ({
      topicId,
      label: topicLabels.get(topicId) ?? topicId,
      seconds: sec,
      hours: secondsToDecimalHours(sec),
    }))
    .filter((r) => r.seconds > 0)
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Remainder hours to reach 8h from recorded sum (not counting running timer in chart data separately — caller passes full seconds map).
 * @param {Record<string, number>} secondsByTopic
 * @returns {number} hours remainder, >= 0
 */
export function remainderHoursToEight(secondsByTopic) {
  const totalH =
    Object.values(secondsByTopic).reduce((s, v) => s + v, 0) / 3600;
  return Math.max(0, Math.round((8 - totalH) * 10) / 10);
}

/**
 * How to round scaled (proportional) hours for billing-style reporting.
 * @typedef {'none' | 'quarter' | 'half' | 'hour'} ScaledRoundingMode
 */

/**
 * @param {number} h
 * @returns {number}
 */
function quantizeScaledHour(h) {
  return Math.round(h * 10000) / 10000;
}

/**
 * Round a proportional scaled hour value for display/export. Only used on scaled totals per topic.
 * @param {number} proportionalHours
 * @param {ScaledRoundingMode} mode
 * @param {number} [remainderThresholdMinutes=0] if > 0 (and mode uses a step), round up only when the remainder above the lower step exceeds this many minutes; otherwise round down. 0 = always round up to the next step.
 * @returns {number}
 */
export function applyScaledHoursRounding(
  proportionalHours,
  mode,
  remainderThresholdMinutes = 0
) {
  const h = proportionalHours;
  if (!Number.isFinite(h) || h <= 0) return 0;
  if (mode === "none" || mode == null) {
    return Math.round(h * 10) / 10;
  }
  const step = mode === "quarter" ? 0.25 : mode === "half" ? 0.5 : 1;

  const thrMin = Number(remainderThresholdMinutes);
  if (!Number.isFinite(thrMin) || thrMin <= 0) {
    const n = Math.ceil(h / step - 1e-10) * step;
    return quantizeScaledHour(n);
  }

  const flo = Math.floor(h / step + 1e-10) * step;
  const cei = Math.ceil(h / step - 1e-10) * step;
  if (Math.abs(cei - flo) < 1e-9) {
    return quantizeScaledHour(flo);
  }
  // Compare remainder past the lower step in whole minutes so “exactly N min” is stable vs float noise.
  const remainderMinutes = (h - flo) * 60;
  const chosen =
    remainderMinutes > thrMin + 1e-9 ? cei : flo;
  return quantizeScaledHour(chosen);
}

/**
 * After per-topic threshold rounding, move whole steps between scalable rows so their scaled
 * hours sum to `budget` (largest-remainder style: adjust topics with the biggest raw vs rounded gap).
 * @param {{ topicId: string, raw: number, scaledHours: number }[]} scalableRows
 * @param {number} budget
 * @param {number} step quarter 0.25, half 0.5, hour 1, none 0.1
 */
function reconcileScalableHoursToBudget(scalableRows, budget, step) {
  if (scalableRows.length === 0 || !Number.isFinite(budget)) return;
  const tol = 1e-7;
  const maxIter = 10000;

  for (let iter = 0; iter < maxIter; iter++) {
    let sum = 0;
    for (const r of scalableRows) sum += r.scaledHours;
    const diff = budget - sum;
    if (Math.abs(diff) < tol) return;

    /** @type {{ i: number, delta: number, newErr: number }[]} */
    const moves = [];
    for (let i = 0; i < scalableRows.length; i++) {
      for (const delta of [step, -step]) {
        const next = scalableRows[i].scaledHours + delta;
        if (next < -tol) continue;
        const newSum = sum + delta;
        const newErr = Math.abs(budget - newSum);
        moves.push({ i, delta, newErr });
      }
    }

    const errBefore = Math.abs(diff);
    let minErr = Infinity;
    for (const m of moves) {
      if (m.newErr < minErr - 1e-15) minErr = m.newErr;
    }
    if (minErr + 1e-12 >= errBefore) return;

    const bestMoves = moves.filter((m) => Math.abs(m.newErr - minErr) < 1e-12);
    if (bestMoves.length === 0) return;

    bestMoves.sort((a, b) => {
      const ra = scalableRows[a.i];
      const rb = scalableRows[b.i];
      const underA = ra.raw - ra.scaledHours;
      const underB = rb.raw - rb.scaledHours;
      const overA = ra.scaledHours - ra.raw;
      const overB = rb.scaledHours - rb.raw;
      if (a.delta > 0 && b.delta > 0) {
        if (Math.abs(underB - underA) > 1e-12) return underB - underA;
      } else if (a.delta < 0 && b.delta < 0) {
        if (Math.abs(overB - overA) > 1e-12) return overB - overA;
      }
      if (a.i !== b.i) return a.i - b.i;
      return b.delta - a.delta;
    });

    const pick = bestMoves[0];
    scalableRows[pick.i].scaledHours = quantizeScaledHour(
      scalableRows[pick.i].scaledHours + pick.delta
    );
  }
}

/**
 * @param {Record<string, number>} secondsByTopic
 * @param {number} targetHours total hours to scale to (e.g. 8)
 * @param {ScaledRoundingMode} [roundingMode='quarter'] step grid for each topic’s scaled hours (¼, ½, 1 h, or one decimal)
 * @param {number} [remainderThresholdMinutes=0] past-step threshold in minutes (see applyScaledHoursRounding)
 * @param {Map<string, boolean> | null} [scalableByTopic] if set, rows with value `false` are not proportionally scaled; their hours are still rounded with the same mode and threshold. Omitted or other values = scalable.
 * @returns {{ topicId: string, scaledHours: number }[]} Scalable rows are proportional to recorded time, each rounded with the threshold rule, then adjusted in whole steps so their total equals the scalable budget (target minus fixed rows).
 */
export function scaledToTargetHours(
  secondsByTopic,
  targetHours,
  roundingMode = "quarter",
  remainderThresholdMinutes = 0,
  scalableByTopic = null
) {
  const t = Number(targetHours);
  if (!Number.isFinite(t) || t < 0) return [];
  const entries = Object.entries(secondsByTopic).filter(([, sec]) => sec > 0);
  if (entries.length === 0) return [];

  const isScalable = (topicId) =>
    scalableByTopic == null || scalableByTopic.get(topicId) !== false;

  const fixedSum = entries
    .filter(([id]) => !isScalable(id))
    .reduce((s, [, sec]) => {
      const actualH = sec / 3600;
      return (
        s +
        applyScaledHoursRounding(
          actualH,
          roundingMode,
          remainderThresholdMinutes
        )
      );
    }, 0);

  const scalableEntries = entries.filter(([id]) => isScalable(id));
  const totalScalableSec = scalableEntries.reduce((a, [, sec]) => a + sec, 0);
  const budget = Math.max(0, t - fixedSum);

  const step =
    roundingMode === "quarter"
      ? 0.25
      : roundingMode === "half"
        ? 0.5
        : roundingMode === "hour"
          ? 1
          : 0.1;

  /** @type {{ topicId: string, raw: number, scaledHours: number }[]} */
  const scalableWork = [];

  for (const [topicId, sec] of scalableEntries) {
    if (totalScalableSec <= 0 || budget <= 0) {
      scalableWork.push({ topicId, raw: 0, scaledHours: 0 });
      continue;
    }
    const raw = (sec / totalScalableSec) * budget;
    const scaledHours = applyScaledHoursRounding(
      raw,
      roundingMode,
      remainderThresholdMinutes
    );
    scalableWork.push({ topicId, raw, scaledHours });
  }

  if (scalableWork.length > 0 && budget > 0 && totalScalableSec > 0) {
    reconcileScalableHoursToBudget(scalableWork, budget, step);
  }

  const scaledByTopicId = new Map(
    scalableWork.map((r) => [r.topicId, r.scaledHours])
  );

  return entries.map(([topicId, sec]) => {
    if (!isScalable(topicId)) {
      const actualH = sec / 3600;
      return {
        topicId,
        scaledHours: applyScaledHoursRounding(
          actualH,
          roundingMode,
          remainderThresholdMinutes
        ),
      };
    }
    if (totalScalableSec <= 0 || budget <= 0) {
      return { topicId, scaledHours: 0 };
    }
    return {
      topicId,
      scaledHours: /** @type {number} */ (scaledByTopicId.get(topicId)),
    };
  });
}

/**
 * @param {Record<string, number>} secondsByTopic
 * @returns {{ topicId: string, scaledHours: number }[]}
 */
export function scaledToEightHours(secondsByTopic) {
  return scaledToTargetHours(secondsByTopic, 8);
}

/**
 * Single total from raw seconds (one decimal), for “total recorded” display.
 * @param {Record<string, number>} secondsByTopic
 * @returns {number}
 */
export function totalRecordedDecimalHours(secondsByTopic) {
  const totalSec = Object.values(secondsByTopic).reduce((a, b) => a + b, 0);
  return secondsToDecimalHours(totalSec);
}

/**
 * @typedef {'scaled' | 'actual'} EffectiveScaledMode
 */

/**
 * Scales proportional rows to `targetHours` when the sum of per-row one-decimal hours is at or
 * below the target; when that sum exceeds the target, returns actual hours per topic (no compression).
 * @param {Record<string, number>} secondsByTopic
 * @param {number} targetHours
 * @param {ScaledRoundingMode} [roundingMode='quarter']
 * @param {number} [remainderThresholdMinutes=0]
 * @param {Map<string, boolean> | null} [scalableByTopic]
 * @returns {{ mode: EffectiveScaledMode, rows: { topicId: string, scaledHours: number }[], totalRecordedHours: number, targetHours: number }}
 */
export function effectiveScaledRows(
  secondsByTopic,
  targetHours,
  roundingMode = "quarter",
  remainderThresholdMinutes = 0,
  scalableByTopic = null
) {
  const t = Number(targetHours);
  const totalSec = Object.values(secondsByTopic).reduce((a, b) => a + b, 0);
  const totalRecordedHours = secondsToDecimalHours(totalSec);

  if (!Number.isFinite(t) || t < 0) {
    return {
      mode: "scaled",
      rows: [],
      totalRecordedHours,
      targetHours: t,
    };
  }

  const entries = Object.entries(secondsByTopic).filter(([, sec]) => sec > 0);
  if (entries.length === 0) {
    return {
      mode: "scaled",
      rows: [],
      totalRecordedHours,
      targetHours: t,
    };
  }

  // Sum of per-row one-decimal hours (same basis as the “Recorded vs 8 h” chart). Using raw
  // totalSec/3600 here wrongly flipped to “actual” when the raw sum barely exceeded the target
  // while displayed row totals still summed to at most the target — which skipped scaling/rounding.
  const totalDisplayedHours = entries.reduce(
    (s, [, sec]) => s + secondsToDecimalHours(sec),
    0
  );

  if (totalDisplayedHours > t + 1e-9) {
    const rows = entries.map(([topicId, sec]) => ({
      topicId,
      scaledHours: secondsToDecimalHours(sec),
    }));
    return {
      mode: "actual",
      rows,
      totalRecordedHours,
      targetHours: t,
    };
  }

  const rows = scaledToTargetHours(
    secondsByTopic,
    t,
    roundingMode,
    remainderThresholdMinutes,
    scalableByTopic
  );
  return {
    mode: "scaled",
    rows,
    totalRecordedHours,
    targetHours: t,
  };
}
