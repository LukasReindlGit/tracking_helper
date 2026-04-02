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
 * @param {Record<string, number>} secondsByTopic
 * @returns {{ topicId: string, scaledHours: number }[]}
 */
export function scaledToEightHours(secondsByTopic) {
  const totalSec = Object.values(secondsByTopic).reduce((a, b) => a + b, 0);
  if (totalSec <= 0) return [];
  return Object.entries(secondsByTopic)
    .filter(([, sec]) => sec > 0)
    .map(([topicId, sec]) => ({
      topicId,
      scaledHours: Math.round((sec / totalSec) * 8 * 10) / 10,
    }));
}
