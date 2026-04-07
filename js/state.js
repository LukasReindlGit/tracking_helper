/** @typedef {{ id: string, label: string, linkBaseUrl: string, seconds: number, hidden?: boolean, scalable?: boolean }} TrackRow */
/** @typedef {{ dayKey: string, rowId: string, startedAt: number }} ActiveTimer */
/**
 * Minutes past the lower step required before rounding up; 0 = always round up to next step.
 * @typedef {0 | 5 | 10 | 15} RemainderThresholdMinutes
 */
/**
 * @typedef {{
 *   mode: 'none' | 'quarter' | 'half' | 'hour',
 *   remainderThresholdMinutes: RemainderThresholdMinutes
 * }} ScaledRoundingPrefs
 */
/**
 * @typedef {{
 *   rowsByDay: Record<string, TrackRow[]>,
 *   activeTimer: ActiveTimer | null,
 *   scaledRoundingPrefs: ScaledRoundingPrefs,
 *   showHiddenTrackingRows: boolean
 * }} AppState
 */

/**
 * @returns {ScaledRoundingPrefs}
 */
export function defaultScaledRoundingPrefs() {
  return { mode: "quarter", remainderThresholdMinutes: 0 };
}

/**
 * @returns {AppState}
 */
export function createEmptyState() {
  return {
    rowsByDay: {},
    activeTimer: null,
    scaledRoundingPrefs: defaultScaledRoundingPrefs(),
    showHiddenTrackingRows: false,
  };
}

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `t-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Tracking “day” rolls at this local hour (not midnight), so work past midnight stays on the prior day. */
const TRACKING_DAY_CUTOFF_HOUR = 3;

function formatYmdLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Local tracking day key (`YYYY-MM-DD`). Before {@link TRACKING_DAY_CUTOFF_HOUR}:00, still the previous calendar day.
 * @param {Date} [date]
 * @returns {string}
 */
export function trackingDayKey(date = new Date()) {
  const d = new Date(date.getTime());
  if (d.getHours() < TRACKING_DAY_CUTOFF_HOUR) {
    d.setDate(d.getDate() - 1);
  }
  return formatYmdLocal(d);
}

/**
 * Previous calendar date as `YYYY-MM-DD` (for the tracking-day label `dayKey`).
 * @param {string} dayKey
 * @returns {string | null}
 */
export function previousCalendarDayKey(dayKey) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  return formatYmdLocal(d);
}

/**
 * First time we see this tracking day: copy row structure from the previous calendar day, seconds reset to 0.
 * @param {AppState} state
 * @param {string} dayKey
 */
function seedCurrentTrackingDayFromPrevious(state, dayKey) {
  const prevKey = previousCalendarDayKey(dayKey);
  const prev = prevKey ? state.rowsByDay[prevKey] : undefined;
  if (prev && prev.length > 0) {
    state.rowsByDay[dayKey] = prev.map((r) => ({
      id: newId(),
      label: typeof r.label === "string" ? r.label : "",
      linkBaseUrl: typeof r.linkBaseUrl === "string" ? r.linkBaseUrl : "",
      seconds: 0,
      hidden: r.hidden === true,
      ...(r.scalable === false ? { scalable: false } : {}),
    }));
  } else {
    state.rowsByDay[dayKey] = [];
  }
}

/**
 * @param {AppState} state
 * @param {string} dayKey
 * @param {number} [nowMs]
 * @returns {TrackRow[]}
 */
export function getRows(state, dayKey, nowMs = Date.now()) {
  if (state.rowsByDay[dayKey] == null) {
    const cur = trackingDayKey(new Date(nowMs));
    if (dayKey === cur) {
      seedCurrentTrackingDayFromPrevious(state, dayKey);
    } else {
      state.rowsByDay[dayKey] = [];
    }
  }
  return state.rowsByDay[dayKey];
}

/**
 * @param {AppState} state
 * @param {string} dayKey
 * @returns {TrackRow}
 */
export function addRow(state, dayKey) {
  const row = {
    id: newId(),
    label: "",
    linkBaseUrl: "",
    seconds: 0,
    hidden: false,
  };
  getRows(state, dayKey).push(row);
  return row;
}

/**
 * Move rowId to immediately before beforeRowId, or to the end if beforeRowId is null.
 * @param {AppState} state
 * @param {string} dayKey
 * @param {string} rowId
 * @param {string | null} beforeRowId
 */
export function moveRowBefore(state, dayKey, rowId, beforeRowId) {
  if (rowId === beforeRowId) return;
  const rows = getRows(state, dayKey);
  const from = rows.findIndex((r) => r.id === rowId);
  if (from < 0) return;
  const [item] = rows.splice(from, 1);
  if (beforeRowId === null) {
    rows.push(item);
    return;
  }
  const to = rows.findIndex((r) => r.id === beforeRowId);
  if (to < 0) {
    rows.push(item);
    return;
  }
  rows.splice(to, 0, item);
}

/**
 * @param {AppState} state
 * @param {string} dayKey
 * @param {string} rowId
 * @param {boolean} hidden
 */
export function setRowHidden(state, dayKey, rowId, hidden) {
  const row = getRows(state, dayKey).find((r) => r.id === rowId);
  if (row) row.hidden = hidden;
}

/**
 * @param {AppState} state
 * @param {string} dayKey
 * @param {string} rowId
 */
export function removeRow(state, dayKey, rowId) {
  const rows = getRows(state, dayKey);
  const idx = rows.findIndex((r) => r.id === rowId);
  if (idx >= 0) rows.splice(idx, 1);
  const at = state.activeTimer;
  if (at && at.dayKey === dayKey && at.rowId === rowId) {
    state.activeTimer = null;
  }
}

/**
 * @param {AppState} state
 * @param {number} nowMs
 */
export function pauseAnyRunning(state, nowMs) {
  const at = state.activeTimer;
  if (!at) return;
  const rows = getRows(state, at.dayKey);
  const row = rows.find((r) => r.id === at.rowId);
  if (row && nowMs > at.startedAt) {
    row.seconds += (nowMs - at.startedAt) / 1000;
  }
  state.activeTimer = null;
}

/**
 * @param {AppState} state
 * @param {string} dayKey
 * @param {string} rowId
 * @param {number} nowMs
 */
export function startRowTimer(state, dayKey, rowId, nowMs) {
  pauseAnyRunning(state, nowMs);
  state.activeTimer = { dayKey, rowId, startedAt: nowMs };
}

/**
 * @param {AppState} state
 * @param {number} nowMs
 */
export function pauseRowTimer(state, nowMs) {
  pauseAnyRunning(state, nowMs);
}

/**
 * Sets seconds to 0 for every row on dayKey. Pauses an active timer on that day first.
 * @param {AppState} state
 * @param {string} dayKey
 * @param {number} nowMs
 */
export function resetSecondsForDay(state, dayKey, nowMs) {
  const at = state.activeTimer;
  if (at && at.dayKey === dayKey) {
    pauseRowTimer(state, nowMs);
  }
  for (const r of getRows(state, dayKey)) {
    r.seconds = 0;
  }
}

/**
 * @param {AppState} state
 * @param {string} dayKey
 * @param {string} rowId
 */
export function isRowRunning(state, dayKey, rowId) {
  const at = state.activeTimer;
  return !!at && at.dayKey === dayKey && at.rowId === rowId;
}

/**
 * @param {AppState} state
 * @param {string} dayKey
 * @param {TrackRow} row
 * @param {number} nowMs
 */
export function effectiveSecondsForRow(state, dayKey, row, nowMs) {
  let s = row.seconds;
  if (isRowRunning(state, dayKey, row.id) && state.activeTimer) {
    s += Math.max(0, (nowMs - state.activeTimer.startedAt) / 1000);
  }
  return s;
}

/**
 * @param {AppState} state
 * @param {string} dayKey
 * @returns {Map<string, string>}
 */
export function rowLabelMap(state, dayKey) {
  const m = new Map();
  for (const r of getRows(state, dayKey)) {
    m.set(r.id, r.label.trim() || r.id);
  }
  return m;
}

/**
 * @param {AppState} state
 * @param {string} dayKey
 * @returns {Map<string, string>} row id → full URL for scaled-table link (may be empty)
 */
export function rowLinkBaseMap(state, dayKey) {
  const m = new Map();
  for (const r of getRows(state, dayKey)) {
    const u =
      typeof r.linkBaseUrl === "string" ? r.linkBaseUrl : "";
    m.set(r.id, u);
  }
  return m;
}

/**
 * @param {AppState} state
 * @param {string} dayKey
 * @returns {Map<string, boolean>} row id → include in proportional scaling (`false` = fixed actual hours)
 */
export function rowScalableMap(state, dayKey) {
  const m = new Map();
  for (const r of getRows(state, dayKey)) {
    m.set(r.id, r.scalable !== false);
  }
  return m;
}

/**
 * @param {AppState} state
 * @param {string} dayKey
 * @param {number} nowMs
 * @returns {Record<string, number>}
 */
export function secondsMapForDay(state, dayKey, nowMs) {
  /** @type {Record<string, number>} */
  const acc = {};
  for (const r of getRows(state, dayKey)) {
    const sec = effectiveSecondsForRow(state, dayKey, r, nowMs);
    if (sec > 0) acc[r.id] = sec;
  }
  return acc;
}
