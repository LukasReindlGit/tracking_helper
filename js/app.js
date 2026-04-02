import * as storage from "./storage.js";
import * as state from "./state.js";
import * as timeMath from "./timeMath.js";
import { updateCharts } from "./charts.js";

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
  hoursInp.value = String(timeMath.secondsToDecimalHours(sec));
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
    hoursInp.type = "number";
    hoursInp.step = "0.1";
    hoursInp.min = "0";
    hoursInp.className = "input track-hours";
    hoursInp.setAttribute("aria-label", "Hours (decimal)");
    setHoursInputValue(hoursInp, row);

    hoursInp.addEventListener("focus", () => {
      if (state.isRowRunning(appState, day, row.id)) {
        state.pauseRowTimer(appState, Date.now());
        save();
        renderAll();
      }
    });

    hoursInp.addEventListener("change", () => {
      const h = parseFloat(hoursInp.value);
      row.seconds = Number.isFinite(h) ? Math.max(0, h) * 3600 : 0;
      save();
      renderAll();
    });

    const running = state.isRowRunning(appState, day, row.id);

    const btnStart = document.createElement("button");
    btnStart.type = "button";
    btnStart.className = "btn btn-primary";
    btnStart.textContent = "Start";
    btnStart.disabled = running;
    btnStart.addEventListener("click", () => {
      state.startRowTimer(appState, day, row.id, Date.now());
      save();
      renderAll();
    });

    const btnPause = document.createElement("button");
    btnPause.type = "button";
    btnPause.className = "btn btn-secondary";
    btnPause.textContent = "Pause";
    btnPause.disabled = !running;
    btnPause.addEventListener("click", () => {
      state.pauseRowTimer(appState, Date.now());
      save();
      renderAll();
    });

    const btnCopy = document.createElement("button");
    btnCopy.type = "button";
    btnCopy.className = "btn btn-secondary";
    btnCopy.textContent = "Copy";
    btnCopy.addEventListener("click", () => {
      const label = row.label.trim() || row.id;
      const sec = state.effectiveSecondsForRow(appState, day, row, Date.now());
      const hrs = timeMath.secondsToDecimalHours(sec);
      copyToClipboard(`${label}\t${hrs}`);
    });

    const btnRemove = document.createElement("button");
    btnRemove.type = "button";
    btnRemove.className = "btn btn-danger";
    btnRemove.textContent = "Remove";
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
