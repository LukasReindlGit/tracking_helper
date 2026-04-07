import { defaultScaledRoundingPrefs, trackingDayKey } from "./state.js";

const CONSENT_KEY = "tracking-helper-consent";
const DATA_KEY = "tracking-helper-v1";

/** @typedef {'pending' | 'accepted' | 'declined'} ConsentStatus */

/**
 * @returns {ConsentStatus}
 */
export function readConsentStatus() {
  try {
    const v = localStorage.getItem(CONSENT_KEY);
    if (v === "accepted" || v === "declined") return v;
  } catch {
    /* ignore */
  }
  return "pending";
}

/**
 * @param {'accepted' | 'declined'} status
 */
export function writeConsentStatus(status) {
  try {
    localStorage.setItem(CONSENT_KEY, status);
  } catch {
    /* ignore */
  }
}

/** Clears saved consent so the banner shows again; keeps stored app data if any. */
export function clearConsentDecision() {
  try {
    localStorage.removeItem(CONSENT_KEY);
  } catch {
    /* ignore */
  }
}

/** Removes consent and all saved tracking data. */
export function clearAllStored() {
  try {
    localStorage.removeItem(CONSENT_KEY);
    localStorage.removeItem(DATA_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * @param {boolean} canPersist
 * @returns {import('./state.js').AppState | null}
 */
export function loadPersistedState(canPersist) {
  if (!canPersist) return null;
  try {
    const raw = localStorage.getItem(DATA_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data && typeof data === "object") return migrateState(data);
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * @param {import('./state.js').AppState} state
 * @param {boolean} canPersist
 */
export function savePersistedState(state, canPersist) {
  if (!canPersist) return;
  try {
    localStorage.setItem(DATA_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

/**
 * @param {unknown} raw
 * @returns {import('./state.js').AppState}
 */
function migrateState(raw) {
  if (
    raw.rowsByDay &&
    typeof raw.rowsByDay === "object" &&
    !Array.isArray(raw.rowsByDay)
  ) {
    return normalizeRowsState(raw);
  }
  return migrateFromLegacyTopicsSegments(raw);
}

/**
 * @param {unknown} raw
 * @returns {import('./state.js').AppState}
 */
function normalizeRowsState(raw) {
  /** @type {Record<string, import('./state.js').TrackRow[]>} */
  const rowsByDay = {};
  for (const [day, list] of Object.entries(raw.rowsByDay)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (!Array.isArray(list)) continue;
    rowsByDay[day] = list
      .filter((r) => r && typeof r.id === "string")
      .map((r) => ({
        id: r.id,
        label: typeof r.label === "string" ? r.label : "",
        linkBaseUrl:
          typeof r.linkBaseUrl === "string" ? r.linkBaseUrl : "",
        seconds:
          typeof r.seconds === "number" && r.seconds >= 0 ? r.seconds : 0,
        hidden: typeof r.hidden === "boolean" ? r.hidden : false,
        ...(r.scalable === false ? { scalable: false } : {}),
      }));
  }
  let activeTimer = null;
  if (
    raw.activeTimer &&
    typeof raw.activeTimer === "object" &&
    typeof raw.activeTimer.rowId === "string" &&
    typeof raw.activeTimer.dayKey === "string" &&
    typeof raw.activeTimer.startedAt === "number"
  ) {
    activeTimer = {
      rowId: raw.activeTimer.rowId,
      dayKey: raw.activeTimer.dayKey,
      startedAt: raw.activeTimer.startedAt,
    };
  }
  return {
    rowsByDay,
    activeTimer,
    scaledRoundingPrefs: parseScaledRoundingPrefs(raw.scaledRoundingPrefs),
    showHiddenTrackingRows:
      typeof raw.showHiddenTrackingRows === "boolean"
        ? raw.showHiddenTrackingRows
        : false,
  };
}

/**
 * @param {unknown} raw
 * @returns {import('./state.js').ScaledRoundingPrefs}
 */
function parseScaledRoundingPrefs(raw) {
  const def = defaultScaledRoundingPrefs();
  if (!raw || typeof raw !== "object") return def;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const out = { ...def };
  const m = o.mode;
  if (m === "none" || m === "quarter" || m === "half" || m === "hour") {
    out.mode = m;
  }
  const rtm = o.remainderThresholdMinutes;
  if (rtm === 0 || rtm === 5 || rtm === 10 || rtm === 15) {
    out.remainderThresholdMinutes = rtm;
  } else if (typeof o.fiveMinThreshold === "boolean") {
    out.remainderThresholdMinutes = o.fiveMinThreshold ? 5 : 0;
  }
  return out;
}

/**
 * @param {unknown} raw
 * @returns {import('./state.js').AppState}
 */
function migrateFromLegacyTopicsSegments(raw) {
  const topics = Array.isArray(raw.topics) ? raw.topics : [];
  const segmentsByDay =
    raw.segmentsByDay && typeof raw.segmentsByDay === "object"
      ? raw.segmentsByDay
      : {};
  const normalized = normalizeSegments(
    /** @type {Record<string, unknown>} */ (segmentsByDay)
  );

  /** @type {Record<string, import('./state.js').TrackRow[]>} */
  const rowsByDay = {};
  const topicList = topics
    .filter((t) => t && typeof t.id === "string" && typeof t.label === "string")
    .map((t) => ({
      id: t.id,
      label: (t.label || "").trim() || t.id,
    }));

  if (topicList.length > 0) {
    const days = new Set([...Object.keys(normalized), trackingDayKey()]);
    for (const day of days) {
      rowsByDay[day] = topicList.map((t) => {
        let sec = 0;
        for (const s of normalized[day] ?? []) {
          if (s.topicId === t.id) {
            sec += Math.max(0, (s.endMs - s.startMs) / 1000);
          }
        }
        return {
          id: t.id,
          label: t.label,
          linkBaseUrl: "",
          seconds: sec,
          hidden: false,
        };
      });
    }
  } else {
    for (const day of Object.keys(normalized)) {
      /** @type {Record<string, number>} */
      const byTopic = {};
      for (const s of normalized[day] ?? []) {
        const dur = Math.max(0, (s.endMs - s.startMs) / 1000);
        byTopic[s.topicId] = (byTopic[s.topicId] ?? 0) + dur;
      }
      rowsByDay[day] = Object.entries(byTopic).map(([id, sec]) => ({
        id,
        label: id,
        linkBaseUrl: "",
        seconds: sec,
        hidden: false,
      }));
    }
  }

  let activeTimer = null;
  if (
    raw.activeTimer &&
    typeof raw.activeTimer === "object" &&
    typeof raw.activeTimer.topicId === "string" &&
    typeof raw.activeTimer.startedAt === "number"
  ) {
    const tid = raw.activeTimer.topicId;
    if (topicList.some((t) => t.id === tid)) {
      activeTimer = {
        dayKey: trackingDayKey(),
        rowId: tid,
        startedAt: raw.activeTimer.startedAt,
      };
    }
  }

  return {
    rowsByDay,
    activeTimer,
    scaledRoundingPrefs: defaultScaledRoundingPrefs(),
    showHiddenTrackingRows: false,
  };
}

/**
 * @param {Record<string, unknown>} byDay
 */
function normalizeSegments(byDay) {
  /** @type {Record<string, { topicId: string, startMs: number, endMs: number }[]>} */
  const out = {};
  for (const [day, segs] of Object.entries(byDay)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (!Array.isArray(segs)) continue;
    out[day] = segs
      .filter(
        (s) =>
          s &&
          typeof s.topicId === "string" &&
          typeof s.startMs === "number" &&
          typeof s.endMs === "number"
      )
      .map((s) => ({
        topicId: s.topicId,
        startMs: s.startMs,
        endMs: s.endMs,
      }));
  }
  return out;
}
