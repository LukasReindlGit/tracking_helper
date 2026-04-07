import * as storage from "./storage.js";
import * as state from "./state.js";
import * as timeMath from "./timeMath.js";
import { updateCharts } from "./charts.js";

const SVG_ATTR =
  'xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"';

/** @param {string} inner */
function iconSvg(inner) {
  return `<svg ${SVG_ATTR}>${inner}</svg>`;
}

const ICON_PLAY = iconSvg(
  '<path fill="currentColor" d="M8 5v14l11-7z"/>'
);
const ICON_PAUSE = iconSvg(
  '<path fill="currentColor" d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>'
);
const ICON_COPY = iconSvg(
  '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/>' +
    '<path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>' +
    "</g>"
);
const ICON_TRASH = iconSvg(
  '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    "<path d=\"M3 6h18\"/>" +
    "<path d=\"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6\"/>" +
    "<path d=\"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2\"/>" +
    "<line x1=\"10\" x2=\"10\" y1=\"11\" y2=\"17\"/>" +
    "<line x1=\"14\" x2=\"14\" y1=\"11\" y2=\"17\"/>" +
    "</g>"
);
const ICON_GRIP = iconSvg(
  '<g fill="currentColor">' +
    '<circle cx="8" cy="6" r="1.5"/><circle cx="14" cy="6" r="1.5"/>' +
    '<circle cx="8" cy="12" r="1.5"/><circle cx="14" cy="12" r="1.5"/>' +
    '<circle cx="8" cy="18" r="1.5"/><circle cx="14" cy="18" r="1.5"/>' +
    "</g>"
);
const ICON_EYE = iconSvg(
  '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M1 12s4 8 11 8 11-8 11-8-4-8-11-8-11 8-11 8z"/>' +
    '<circle cx="12" cy="12" r="3"/>' +
    "</g>"
);
const ICON_EYE_OFF = iconSvg(
  '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M1 12s4 8 11 8 11-8 11-8-4-8-11-8-11 8-11 8z"/>' +
    '<circle cx="12" cy="12" r="3"/>' +
    '<path d="m4 4 16 16"/>' +
    "</g>"
);

const DRAG_ROW_MIME = "application/x-tracking-helper-row";

/** @type {string | null} */
let dragActiveRowId = null;

/** @type {import('./state.js').AppState} */
let appState = state.createEmptyState();
let persist = false;

/** Last seen tracking day (03:00 local rollover); used to pause timer and re-render when the day changes. */
let lastTrackingDayKey = "";

const els = {
  consentOverlay: /** @type {HTMLElement | null} */ (
    document.getElementById("consent-overlay")
  ),
  consentAccept: document.getElementById("consent-accept"),
  consentDecline: document.getElementById("consent-decline"),
  trackingRows: document.getElementById("tracking-rows"),
  btnAddRow: document.getElementById("btn-add-row"),
  chartsOverflow: document.getElementById("charts-overflow"),
  btnResetConsent: document.getElementById("btn-reset-consent"),
};

function showConsent(show) {
  if (els.consentOverlay) els.consentOverlay.hidden = !show;
}

function save() {
  storage.savePersistedState(appState, persist);
}

/** Pause and flush timer if it belongs to a prior tracking day (e.g. after reload or 03:00 rollover). */
function reconcileActiveTimerToTrackingDay() {
  const tk = state.trackingDayKey();
  if (appState.activeTimer && appState.activeTimer.dayKey !== tk) {
    state.pauseRowTimer(appState, Date.now());
    save();
  }
}

function initFromConsent() {
  const status = storage.readConsentStatus();
  if (status === "pending") {
    showConsent(true);
    persist = false;
    appState = state.createEmptyState();
    return;
  }
  showConsent(false);
  if (status === "accepted") {
    persist = true;
    appState = storage.loadPersistedState(true) ?? state.createEmptyState();
  } else {
    persist = false;
    appState = state.createEmptyState();
  }
}

function totalHoursToday() {
  const day = state.trackingDayKey();
  const now = Date.now();
  let sum = 0;
  for (const r of state.getRows(appState, day)) {
    sum += state.effectiveSecondsForRow(appState, day, r, now) / 3600;
  }
  return sum;
}

function syncScaledTargetSliderUi() {
  const slider = /** @type {HTMLInputElement | null} */ (
    document.getElementById("scaled-target-hours")
  );
  const display = document.getElementById("scaled-target-hours-display");
  if (!slider || !display) return;
  const v = parseFloat(slider.value);
  const r = Math.round(v * 10) / 10;
  display.textContent = Number.isInteger(r) ? String(r) : r.toFixed(1);
  slider.setAttribute("aria-valuenow", display.textContent);
}

function ensureScaledRoundingPrefs() {
  if (!appState.scaledRoundingPrefs) {
    appState.scaledRoundingPrefs = state.defaultScaledRoundingPrefs();
    return;
  }
  const p = appState.scaledRoundingPrefs;
  const raw = /** @type {Record<string, unknown>} */ (p);
  if (typeof p.remainderThresholdMinutes !== "number") {
    const fb = raw.fiveMinThreshold;
    p.remainderThresholdMinutes = fb === true ? 5 : 0;
  }
  const m = p.remainderThresholdMinutes;
  if (m !== 0 && m !== 5 && m !== 10 && m !== 15) {
    p.remainderThresholdMinutes = 0;
  }
  delete raw.fiveMinThreshold;
}

function ensureShowHiddenTrackingRowsPref() {
  if (typeof appState.showHiddenTrackingRows !== "boolean") {
    appState.showHiddenTrackingRows = false;
  }
}

/** Push saved rounding preferences into the chart controls (call before charts read the DOM). */
function syncScaledRoundingPrefsToDom() {
  ensureScaledRoundingPrefs();
  const p = appState.scaledRoundingPrefs;
  const sel = document.getElementById("scaled-rounding-mode");
  const thrSel = /** @type {HTMLSelectElement | null} */ (
    document.getElementById("scaled-remainder-threshold")
  );
  if (sel) sel.value = p.mode;
  if (thrSel) {
    const m = p.remainderThresholdMinutes;
    thrSel.value =
      m === 0 || m === 5 || m === 10 || m === 15 ? String(m) : "0";
  }
}

function updateChartsSection() {
  const day = state.trackingDayKey();
  const now = Date.now();
  const secMap = state.secondsMapForDay(appState, day, now);
  const labels = state.rowLabelMap(appState, day);
  const totalH = totalHoursToday();

  if (els.chartsOverflow) {
    if (totalH > 8 + 1e-6) {
      els.chartsOverflow.hidden = false;
      els.chartsOverflow.textContent =
        "Total recorded today is over 8 h; the “Remaining” slice is hidden in the first chart.";
    } else {
      els.chartsOverflow.hidden = true;
    }
  }

  const linkBases = state.rowLinkBaseMap(appState, day);
  const scalableByRow = state.rowScalableMap(appState, day);
  updateCharts(secMap, labels, linkBases, scalableByRow);
}

/**
 * @param {HTMLInputElement} hoursInp
 * @param {import('./state.js').TrackRow} row
 */
function setHoursInputValue(hoursInp, row) {
  const day = state.trackingDayKey();
  const sec = state.effectiveSecondsForRow(appState, day, row, Date.now());
  hoursInp.value = timeMath.formatSecondsAsHhMmSs(sec);
}

function tickLiveHours() {
  const at = appState.activeTimer;
  if (!at || at.dayKey !== state.trackingDayKey()) return;
  const row = state.getRows(appState, at.dayKey).find((r) => r.id === at.rowId);
  if (!row || !els.trackingRows) return;
  if (row.hidden && !appState.showHiddenTrackingRows) return;
  const wrap = els.trackingRows.querySelector(`[data-row-id="${at.rowId}"]`);
  const inp = wrap?.querySelector(".track-hours");
  if (inp instanceof HTMLInputElement) {
    setHoursInputValue(inp, row);
  }
}

function clearTrackingRowDragUi() {
  if (!els.trackingRows) return;
  for (const el of els.trackingRows.querySelectorAll(".track-row--drag-over")) {
    el.classList.remove("track-row--drag-over");
  }
  const end = els.trackingRows.querySelector(".track-row-end-drop");
  end?.classList.remove("track-row-end-drop--active");
}

function setupTrackingRowDragDrop() {
  if (!els.trackingRows || els.trackingRows.dataset.dragWired === "1") return;
  els.trackingRows.dataset.dragWired = "1";

  els.trackingRows.addEventListener("dragstart", (e) => {
    const t = e.target;
    const handle =
      t instanceof Element ? t.closest(".track-drag-handle") : null;
    if (!handle) return;
    const row = handle.closest(".track-row");
    if (!row || !(row instanceof HTMLElement)) return;
    const id = row.dataset.rowId;
    if (!id) return;
    dragActiveRowId = id;
    if (e.dataTransfer) {
      e.dataTransfer.setData(DRAG_ROW_MIME, id);
      e.dataTransfer.setData("text/plain", id);
      e.dataTransfer.effectAllowed = "move";
    }
  });

  els.trackingRows.addEventListener("dragend", () => {
    dragActiveRowId = null;
    clearTrackingRowDragUi();
  });

  els.trackingRows.addEventListener("dragover", (e) => {
    const t = e.target;
    const rowEl = t instanceof Element ? t.closest(".track-row") : null;
    const endEl =
      t instanceof Element ? t.closest(".track-row-end-drop") : null;
    if (!rowEl && !endEl) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
    clearTrackingRowDragUi();
    if (endEl) {
      endEl.classList.add("track-row-end-drop--active");
    } else if (rowEl) {
      rowEl.classList.add("track-row--drag-over");
    }
  });

  els.trackingRows.addEventListener("drop", (e) => {
    e.preventDefault();
    const id =
      e.dataTransfer?.getData(DRAG_ROW_MIME) ||
      e.dataTransfer?.getData("text/plain") ||
      dragActiveRowId;
    if (!id) {
      clearTrackingRowDragUi();
      return;
    }
    const day = state.trackingDayKey();
    const t = e.target;
    const endDrop = t instanceof Element ? t.closest(".track-row-end-drop") : null;
    if (endDrop) {
      state.moveRowBefore(appState, day, id, null);
      save();
      renderAll();
      return;
    }
    const row = t instanceof Element ? t.closest(".track-row") : null;
    if (!row || !(row instanceof HTMLElement)) {
      clearTrackingRowDragUi();
      return;
    }
    const targetId = row.dataset.rowId;
    if (!targetId || targetId === id) {
      clearTrackingRowDragUi();
      return;
    }
    state.moveRowBefore(appState, day, id, targetId);
    save();
    renderAll();
  });
}

function syncShowHiddenTrackingCheckbox() {
  const chk = document.getElementById("show-hidden-tracking-rows");
  if (chk instanceof HTMLInputElement) {
    chk.checked = appState.showHiddenTrackingRows;
  }
}

function renderTrackingRows() {
  if (!els.trackingRows) return;
  ensureShowHiddenTrackingRowsPref();
  const day = state.trackingDayKey();
  const allRows = state.getRows(appState, day);
  const rows = appState.showHiddenTrackingRows
    ? allRows
    : allRows.filter((r) => !r.hidden);
  els.trackingRows.innerHTML = "";

  for (const row of rows) {
    const wrap = document.createElement("div");
    wrap.className = "track-row";
    if (row.hidden) wrap.classList.add("track-row--hidden");
    wrap.dataset.rowId = row.id;

    const btnDrag = document.createElement("button");
    btnDrag.type = "button";
    btnDrag.className = "track-drag-handle";
    btnDrag.setAttribute("aria-label", "Drag to reorder this row");
    btnDrag.title = "Drag to reorder";
    btnDrag.draggable = true;
    btnDrag.innerHTML = ICON_GRIP;

    const linkInp = document.createElement("input");
    linkInp.type = "text";
    linkInp.className = "input track-link-base";
    linkInp.placeholder = "https://…";
    linkInp.value =
      typeof row.linkBaseUrl === "string" ? row.linkBaseUrl : "";
    linkInp.setAttribute(
      "aria-label",
      "Optional full URL for the scaled table link for this row"
    );
    linkInp.title =
      "Paste the exact URL to open for this row; it is used as-is in the scaled table link.";
    linkInp.addEventListener("change", () => {
      row.linkBaseUrl = linkInp.value;
      save();
      updateChartsSection();
    });

    const labelInp = document.createElement("input");
    labelInp.type = "text";
    labelInp.className = "input track-label";
    labelInp.placeholder = "e.g. TICK-101";
    labelInp.value = row.label;
    labelInp.setAttribute("aria-label", "Ticket or topic name");
    labelInp.addEventListener("change", () => {
      row.label = labelInp.value;
      save();
      updateChartsSection();
    });

    const scalableLbl = document.createElement("label");
    scalableLbl.className = "track-scalable-label";
    const scalableChk = document.createElement("input");
    scalableChk.type = "checkbox";
    scalableChk.checked = row.scalable !== false;
    scalableChk.setAttribute(
      "aria-label",
      "Include this row in proportional scaling for the scaled chart and billing export"
    );
    scalableChk.title =
      "Unchecked: keep actual hours in the scaled view (e.g. a fixed-length meeting). Checked: this row shares the scaled day total with other checked rows.";
    scalableChk.addEventListener("change", () => {
      if (scalableChk.checked) {
        delete row.scalable;
      } else {
        row.scalable = false;
      }
      save();
      updateChartsSection();
    });
    scalableLbl.append(scalableChk, document.createTextNode(" Scale"));

    const hoursInp = document.createElement("input");
    hoursInp.type = "text";
    hoursInp.className = "input track-hours";
    hoursInp.placeholder = "0:00:00";
    hoursInp.setAttribute(
      "aria-label",
      "Tracked time as h:mm:ss (decimal hours also accepted on edit)"
    );
    hoursInp.setAttribute("autocomplete", "off");
    setHoursInputValue(hoursInp, row);

    hoursInp.addEventListener("focus", () => {
      if (state.isRowRunning(appState, day, row.id)) {
        state.pauseRowTimer(appState, Date.now());
        save();
        renderAll();
      }
    });

    hoursInp.addEventListener("change", () => {
      row.seconds = timeMath.parseTimeInputToSeconds(hoursInp.value);
      save();
      renderAll();
    });

    const running = state.isRowRunning(appState, day, row.id);

    const btnStart = document.createElement("button");
    btnStart.type = "button";
    btnStart.className = "btn btn-primary btn-icon";
    btnStart.setAttribute(
      "aria-label",
      "Start stopwatch for this row. Any other running timer is paused first."
    );
    btnStart.title =
      "Start stopwatch for this row. Any other running timer is paused first.";
    btnStart.innerHTML = ICON_PLAY;
    btnStart.disabled = running;
    btnStart.addEventListener("click", () => {
      state.startRowTimer(appState, day, row.id, Date.now());
      save();
      renderAll();
    });

    const btnPause = document.createElement("button");
    btnPause.type = "button";
    btnPause.className = "btn btn-secondary btn-icon";
    btnPause.setAttribute(
      "aria-label",
      "Pause the stopwatch. Recorded time stays in the duration field."
    );
    btnPause.title =
      "Pause the stopwatch. Recorded time stays in the duration field.";
    btnPause.innerHTML = ICON_PAUSE;
    btnPause.disabled = !running;
    btnPause.addEventListener("click", () => {
      state.pauseRowTimer(appState, Date.now());
      save();
      renderAll();
    });

    const btnCopy = document.createElement("button");
    btnCopy.type = "button";
    btnCopy.className = "btn btn-secondary btn-icon";
    btnCopy.setAttribute(
      "aria-label",
      "Copy ticket or topic and decimal hours to the clipboard, tab-separated."
    );
    btnCopy.title =
      "Copy ticket or topic and decimal hours to the clipboard, tab-separated.";
    btnCopy.innerHTML = ICON_COPY;
    btnCopy.addEventListener("click", () => {
      const label = row.label.trim() || row.id;
      const sec = state.effectiveSecondsForRow(appState, day, row, Date.now());
      const hrs = timeMath.secondsToDecimalHours(sec);
      copyToClipboard(`${label}\t${hrs}`);
    });

    const btnRemove = document.createElement("button");
    btnRemove.type = "button";
    btnRemove.className = "btn btn-danger btn-icon";
    btnRemove.setAttribute(
      "aria-label",
      "Remove this row and delete its recorded time."
    );
    btnRemove.title = "Remove this row and delete its recorded time.";
    btnRemove.innerHTML = ICON_TRASH;
    btnRemove.addEventListener("click", () => {
      state.removeRow(appState, day, row.id);
      save();
      renderAll();
    });

    const btnHide = document.createElement("button");
    btnHide.type = "button";
    if (row.hidden) {
      btnHide.className = "btn btn-secondary btn-icon";
      btnHide.setAttribute("aria-label", "Show this row in the list again");
      btnHide.title = "Unhide row";
      btnHide.innerHTML = ICON_EYE;
      btnHide.addEventListener("click", () => {
        state.setRowHidden(appState, day, row.id, false);
        save();
        renderAll();
      });
    } else {
      btnHide.className = "btn btn-secondary btn-icon";
      btnHide.setAttribute(
        "aria-label",
        "Hide this row from the list (enable Show hidden rows to edit it again)"
      );
      btnHide.title = "Hide row from list";
      btnHide.innerHTML = ICON_EYE_OFF;
      btnHide.addEventListener("click", () => {
        state.setRowHidden(appState, day, row.id, true);
        save();
        renderAll();
      });
    }

    wrap.append(
      btnDrag,
      linkInp,
      labelInp,
      scalableLbl,
      hoursInp,
      btnStart,
      btnPause,
      btnCopy,
      btnHide,
      btnRemove
    );
    els.trackingRows.appendChild(wrap);
  }

  const endDrop = document.createElement("div");
  endDrop.className = "track-row-end-drop";
  endDrop.setAttribute("aria-hidden", "true");
  els.trackingRows.appendChild(endDrop);
}

function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).catch(() => {});
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } catch {
    /* ignore */
  }
  document.body.removeChild(ta);
}

function renderAll() {
  ensureShowHiddenTrackingRowsPref();
  renderTrackingRows();
  setupTrackingRowDragDrop();
  syncShowHiddenTrackingCheckbox();
  syncScaledRoundingPrefsToDom();
  updateChartsSection();
}

els.consentAccept?.addEventListener("click", () => {
  storage.writeConsentStatus("accepted");
  persist = true;
  appState = storage.loadPersistedState(true) ?? state.createEmptyState();
  showConsent(false);
  save();
  renderAll();
});

els.consentDecline?.addEventListener("click", () => {
  storage.writeConsentStatus("declined");
  persist = false;
  appState = state.createEmptyState();
  showConsent(false);
  renderAll();
});

els.btnAddRow?.addEventListener("click", () => {
  state.addRow(appState, state.trackingDayKey());
  save();
  renderAll();
});

document.getElementById("btn-reset-times")?.addEventListener("click", () => {
  state.resetSecondsForDay(appState, state.trackingDayKey(), Date.now());
  save();
  renderAll();
});

els.btnResetConsent?.addEventListener("click", () => {
  storage.clearConsentDecision();
  persist = false;
  showConsent(true);
});

document.getElementById("scaled-target-hours")?.addEventListener("input", () => {
  syncScaledTargetSliderUi();
  updateChartsSection();
});

document.getElementById("scaled-rounding-mode")?.addEventListener("change", (ev) => {
  ensureScaledRoundingPrefs();
  const sel = /** @type {HTMLSelectElement} */ (ev.target);
  const v = sel.value;
  if (v === "none" || v === "quarter" || v === "half" || v === "hour") {
    appState.scaledRoundingPrefs.mode = v;
  }
  save();
  updateChartsSection();
});

document.getElementById("scaled-remainder-threshold")?.addEventListener("change", (ev) => {
  ensureScaledRoundingPrefs();
  const v = parseInt(/** @type {HTMLSelectElement} */ (ev.target).value, 10);
  appState.scaledRoundingPrefs.remainderThresholdMinutes =
    v === 5 || v === 10 || v === 15 ? v : 0;
  save();
  updateChartsSection();
});

document.getElementById("show-hidden-tracking-rows")?.addEventListener("change", (ev) => {
  ensureShowHiddenTrackingRowsPref();
  appState.showHiddenTrackingRows = /** @type {HTMLInputElement} */ (
    ev.target
  ).checked;
  save();
  renderAll();
});

initFromConsent();
reconcileActiveTimerToTrackingDay();
lastTrackingDayKey = state.trackingDayKey();
renderAll();
syncScaledTargetSliderUi();

setInterval(() => {
  const k = state.trackingDayKey();
  if (k !== lastTrackingDayKey) {
    state.pauseRowTimer(appState, Date.now());
    lastTrackingDayKey = k;
    save();
    renderAll();
  } else {
    tickLiveHours();
  }
}, 1000);
