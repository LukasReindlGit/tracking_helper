/* global Chart — loaded via UMD in index.html */

import * as timeMath from "./timeMath.js";

const COLORS = [
  "#0176D3",
  "#2E844A",
  "#8E4AAB",
  "#DD7A01",
  "#BA0517",
  "#032D60",
  "#5867E8",
  "#3BA755",
];

/** Fills the 8 h pie when recorded total is under 8 h */
const REMAINDER_SLICE_COLOR = "#d8dde6";

/** @type {string} */
let lastScaledTsv = "";

const SCALED_TARGET_MIN = 4;
const SCALED_TARGET_MAX = 12;
const SCALED_TARGET_DEFAULT = 8;

/**
 * @param {number} v
 */
function formatTargetHoursForUi(v) {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

function readScaledTargetHours() {
  const el = document.getElementById("scaled-target-hours");
  const v = el ? parseFloat(/** @type {HTMLInputElement} */ (el).value) : NaN;
  if (!Number.isFinite(v)) return SCALED_TARGET_DEFAULT;
  const clamped = Math.min(
    SCALED_TARGET_MAX,
    Math.max(SCALED_TARGET_MIN, Math.round(v * 10) / 10)
  );
  return clamped;
}

/** @returns {import('./timeMath.js').ScaledRoundingMode} */
function readScaledRoundingMode() {
  const el = document.getElementById("scaled-rounding-mode");
  const v = el ? /** @type {HTMLSelectElement} */ (el).value : "quarter";
  if (v === "none" || v === "quarter" || v === "half" || v === "hour") return v;
  return "quarter";
}

function readScaledFiveMinThreshold() {
  const el = document.getElementById("scaled-five-min-threshold");
  return !!(el && /** @type {HTMLInputElement} */ (el).checked);
}

/**
 * @param {string} baseRaw
 * @param {string} ticketRaw
 * @returns {string | null}
 */
function buildTicketTrackingUrl(baseRaw, ticketRaw) {
  const base = baseRaw.trim();
  const ticket = ticketRaw.trim();
  if (!base || !ticket) return null;
  if (base.endsWith("=")) {
    return base + encodeURIComponent(ticket);
  }
  const b = base.replace(/\/+$/, "");
  return `${b}/${encodeURIComponent(ticket)}`;
}

function copyTextToClipboard(text) {
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

function wireScaledCopyButton() {
  const btn = document.getElementById("btn-copy-scaled-tsv");
  if (!btn || btn.dataset.wired === "1") return;
  btn.dataset.wired = "1";
  btn.addEventListener("click", () => {
    if (lastScaledTsv) copyTextToClipboard(lastScaledTsv);
  });
}

/**
 * @param {{ label: string, value: number, linkBase: string }[]} scaledData
 * @param {boolean} hasRecorded
 * @param {number} targetHours
 */
function updateScaledTable(scaledData, hasRecorded, targetHours) {
  const section = document.getElementById("scaled-table-section");
  const tbody = document.getElementById("scaled-copy-tbody");
  const titleEl = document.querySelector(".scaled-table-title");
  const thScaled = document.querySelector(
    ".scaled-copy-table thead th:last-child"
  );
  if (!section || !tbody) return;

  wireScaledCopyButton();

  if (!hasRecorded) {
    lastScaledTsv = "";
    tbody.innerHTML = "";
    section.hidden = true;
    return;
  }

  const hLabel = formatTargetHoursForUi(targetHours);
  if (titleEl) {
    titleEl.textContent = `Scaled to ${hLabel} h — copy`;
  }
  if (thScaled) {
    thScaled.textContent = `Hours (scaled to ${hLabel} h)`;
  }

  lastScaledTsv = scaledData.map((d) => `${d.label}\t${d.value}`).join("\n");

  tbody.innerHTML = "";
  for (const d of scaledData) {
    const tr = document.createElement("tr");
    const tdLabel = document.createElement("td");
    const href = buildTicketTrackingUrl(d.linkBase, d.label);
    if (href) {
      const a = document.createElement("a");
      a.href = href;
      a.textContent = d.label;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      tdLabel.appendChild(a);
    } else {
      tdLabel.textContent = d.label;
    }
    const tdH = document.createElement("td");
    tdH.textContent = String(d.value);
    tr.append(tdLabel, tdH);
    tbody.appendChild(tr);
  }
  section.hidden = false;
}

/**
 * @param {Record<string, number>} secondsByTopic
 * @param {Map<string, string>} labels
 * @param {Map<string, string> | undefined} linkBases row id → URL prefix for ticket links
 */
export function updateCharts(secondsByTopic, labels, linkBases) {
  const bases = linkBases ?? new Map();
  const ChartCtor = /** @type {any} */ (globalThis).Chart;
  if (!ChartCtor) return;

  const vs8Canvas = /** @type {HTMLCanvasElement | null} */ (
    document.getElementById("chart-vs8")
  );
  const scaledCanvas = /** @type {HTMLCanvasElement | null} */ (
    document.getElementById("chart-scaled")
  );
  const vs8Empty = document.getElementById("chart-vs8-empty");
  const scaledEmpty = document.getElementById("chart-scaled-empty");

  const totalSec = Object.values(secondsByTopic).reduce((a, b) => a + b, 0);
  const hasRecorded = totalSec > 0;

  if (vs8Empty) {
    vs8Empty.hidden = hasRecorded;
    if (vs8Canvas) vs8Canvas.style.display = hasRecorded ? "" : "none";
  }
  if (scaledEmpty) {
    scaledEmpty.hidden = hasRecorded;
    if (scaledCanvas) scaledCanvas.style.display = hasRecorded ? "" : "none";
  }

  if (!hasRecorded) {
    destroyIfExists("chartVs8");
    destroyIfExists("chartScaled");
    updateScaledTable([], false, SCALED_TARGET_DEFAULT);
    return;
  }

  const targetScaledH = readScaledTargetHours();

  const rows = Object.entries(secondsByTopic)
    .filter(([, s]) => s > 0)
    .sort(([a], [b]) =>
      (labels.get(a) ?? a).localeCompare(labels.get(b) ?? b)
    );

  const hoursList = rows.map(([, sec]) => Math.round((sec / 3600) * 10) / 10);
  const totalH = hoursList.reduce((a, b) => a + b, 0);
  const remainder = Math.max(0, Math.round((8 - totalH) * 10) / 10);

  const vs8Labels = rows.map(([id]) => labels.get(id) ?? id);
  const vs8Data = [...hoursList];
  if (remainder > 0) {
    vs8Labels.push("Remaining");
    vs8Data.push(remainder);
  }

  let colorIdx = 0;
  const vs8BackgroundColors = vs8Labels.map((lab) => {
    if (lab === "Remaining") return REMAINDER_SLICE_COLOR;
    const c = COLORS[colorIdx % COLORS.length];
    colorIdx += 1;
    return c;
  });

  renderPie(
    "chartVs8",
    vs8Canvas,
    vs8Labels,
    vs8Data,
    "Recorded vs 8 h",
    vs8BackgroundColors
  );

  const secRecord = Object.fromEntries(rows);
  const scaledById = new Map(
    timeMath
      .scaledToTargetHours(
        secRecord,
        targetScaledH,
        readScaledRoundingMode(),
        readScaledFiveMinThreshold()
      )
      .map((r) => [r.topicId, r.scaledHours])
  );
  const scaledData = rows.map(([id]) => ({
    label: labels.get(id) ?? id,
    value: /** @type {number} */ (scaledById.get(id)),
    linkBase: bases.get(id) ?? "",
  }));

  const scaledTitle = `Scaled to ${formatTargetHoursForUi(targetScaledH)} h`;

  renderPie(
    "chartScaled",
    scaledCanvas,
    scaledData.map((d) => d.label),
    scaledData.map((d) => d.value),
    scaledTitle
  );

  updateScaledTable(scaledData, true, targetScaledH);
}

/** @type {Record<string, { destroy: () => void }>} */
const instances = {};

/**
 * @param {string} key
 * @param {HTMLCanvasElement | null} canvas
 * @param {string[]} chartLabels
 * @param {number[]} data
 * @param {string} title
 * @param {string[] | undefined} backgroundColors per-slice colors (defaults to COLORS rotation)
 */
function renderPie(key, canvas, chartLabels, data, title, backgroundColors) {
  if (!canvas) return;
  destroyIfExists(key);
  const ChartCtor = /** @type {any} */ (globalThis).Chart;
  const bg =
    backgroundColors ??
    chartLabels.map((_, i) => COLORS[i % COLORS.length]);
  instances[key] = new ChartCtor(canvas, {
    type: "pie",
    data: {
      labels: chartLabels,
      datasets: [
        {
          label: title,
          data,
          backgroundColor: bg,
          borderWidth: 1,
          borderColor: "#fff",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { boxWidth: 12, font: { size: 10 } },
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              const v = ctx.raw;
              return `${ctx.label}: ${v} h`;
            },
          },
        },
      },
    },
  });
}

/**
 * @param {string} key
 */
function destroyIfExists(key) {
  if (instances[key]) {
    instances[key].destroy();
    delete instances[key];
  }
}
