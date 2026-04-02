/** @typedef {{ topicId: string, startMs: number, endMs: number }} Segment */

/**
 * @param {number} seconds
 * @returns {number} one decimal place hours
 */
export function secondsToDecimalHours(seconds) {
  const h = seconds / 3600;
  return Math.round(h * 10) / 10;
}

export function formatDecimalHours(seconds) {
  return String(secondsToDecimalHours(seconds));
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
  const str = String(raw ?? "").trim();
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
 * Round a proportional scaled hour value for display/export. Only used on scaled totals per topic.
 * @param {number} proportionalHours
 * @param {ScaledRoundingMode} mode
 * @returns {number}
 */
export function applyScaledHoursRounding(proportionalHours, mode) {
  const h = proportionalHours;
  if (!Number.isFinite(h) || h <= 0) return 0;
  if (mode === "none" || mode == null) {
    return Math.round(h * 10) / 10;
  }
  const step = mode === "quarter" ? 0.25 : mode === "half" ? 0.5 : 1;
  const n = Math.ceil(h / step - 1e-10) * step;
  return Math.round(n * 10000) / 10000;
}

/**
 * @param {Record<string, number>} secondsByTopic
 * @param {number} targetHours total hours to scale to (e.g. 8)
 * @param {ScaledRoundingMode} [roundingMode='quarter'] round-up increment for each topic’s scaled hours
 * @returns {{ topicId: string, scaledHours: number }[]}
 */
export function scaledToTargetHours(secondsByTopic, targetHours, roundingMode = "quarter") {
  const t = Number(targetHours);
  if (!Number.isFinite(t) || t < 0) return [];
  const totalSec = Object.values(secondsByTopic).reduce((a, b) => a + b, 0);
  if (totalSec <= 0) return [];
  return Object.entries(secondsByTopic)
    .filter(([, sec]) => sec > 0)
    .map(([topicId, sec]) => {
      const raw = (sec / totalSec) * t;
      return {
        topicId,
        scaledHours: applyScaledHoursRounding(raw, roundingMode),
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
