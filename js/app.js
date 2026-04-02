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

/** @type {import('./state.js').AppState} */
let appState = state.createEmptyState();
let persist = false;

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

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function showConsent(show) {
  if (els.consentOverlay) els.consentOverlay.hidden = !show;
}

function save() {
  storage.savePersistedState(appState, persist);
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
  const day = todayKey();
  const now = Date.now();
  let sum = 0;
  for (const r of state.getRows(appState, day)) {
    sum += state.effectiveSecondsForRow(appState, day, r, now) / 3600;
  }
  return sum;
}

function updateChartsSection() {
  const day = todayKey();
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

  updateCharts(secMap, labels);
}

/**
 * @param {HTMLInputElement} hoursInp
 * @param {import('./state.js').TrackRow} row
 */
function setHoursInputValue(hoursInp, row) {
  const day = todayKey();
  const sec = state.effectiveSecondsForRow(appState, day, row, Date.now());
  hoursInp.value = timeMath.formatSecondsAsHhMmSs(sec);
}

function tickLiveHours() {
  const at = appState.activeTimer;
  if (!at || at.dayKey !== todayKey()) return;
  const row = state.getRows(appState, at.dayKey).find((r) => r.id === at.rowId);
  if (!row || !els.trackingRows) return;
  const wrap = els.trackingRows.querySelector(`[data-row-id="${at.rowId}"]`);
  const inp = wrap?.querySelector(".track-hours");
  if (inp instanceof HTMLInputElement) {
    setHoursInputValue(inp, row);
  }
}

function renderTrackingRows() {
  if (!els.trackingRows) return;
  const day = todayKey();
  const rows = state.getRows(appState, day);
  els.trackingRows.innerHTML = "";

  for (const row of rows) {
    const wrap = document.createElement("div");
    wrap.className = "track-row";
    wrap.dataset.rowId = row.id;

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

    wrap.append(
      labelInp,
      hoursInp,
      btnStart,
      btnPause,
      btnCopy,
      btnRemove
    );
    els.trackingRows.appendChild(wrap);
  }
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
  renderTrackingRows();
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
  state.addRow(appState, todayKey());
  save();
  renderAll();
});

els.btnResetConsent?.addEventListener("click", () => {
  storage.clearConsentDecision();
  persist = false;
  showConsent(true);
});

initFromConsent();
renderAll();

setInterval(() => {
  tickLiveHours();
}, 1000);
