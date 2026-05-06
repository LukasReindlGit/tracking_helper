/* global Chart — loaded via UMD in index.html */

import * as timeMath from "./timeMath.js";

/**
 * Chart style for both “Recorded vs 8 h” and scaled breakdown.
 * Use `"decomposition"` for a horizontal stacked bar, or `"pie"` for pie charts.
 * @type {"decomposition" | "pie"}
 */
const CHART_TYPE = "decomposition";

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

/** Grey segment for “Remaining” hours up to an 8 h day (vs-8 chart). */
const REMAINDER_SLICE_COLOR = "#d8dde6";

/** @type {string} */
let lastScaledTsv = "";

const SCALED_TARGET_MIN = 4;
const SCALED_TARGET_MAX = 12;
const SCALED_TARGET_DEFAULT = 8;

/**
 * @param {number} sum
 */
function formatScaledSumForUi(sum) {
  if (!Number.isFinite(sum)) return "0";
  const r = Math.round(sum * 100) / 100;
  return timeMath.formatTrimmedDecimalForUi(r, 2);
}

/**
 * @param {{ value: number }[]} scaledData
 */
function scaledDataSumHours(scaledData) {
  return scaledData.reduce((s, d) => s + (Number(d.value) || 0), 0);
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

/** @returns {number} 0, 5, 10, or 15 */
function readScaledRemainderThresholdMinutes() {
  const el = document.getElementById("scaled-remainder-threshold");
  const v = el ? parseInt(/** @type {HTMLSelectElement} */ (el).value, 10) : 0;
  if (v === 0 || v === 5 || v === 10 || v === 15) return v;
  return 0;
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
 * @param {boolean} hasRecorded
 * @param {number} totalRecordedHours
 */
function updateChartsTotalLine(hasRecorded, totalRecordedHours) {
  const el = document.getElementById("charts-total-recorded");
  if (!el) return;
  if (!hasRecorded) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.hidden = false;
  const label = timeMath.formatTrimmedDecimalForUi(totalRecordedHours, 2);
  el.textContent = `Total recorded today: ${label} h`;
}

/**
 * @param {{ label: string, value: number, linkBase: string }[]} scaledData
 * @param {boolean} hasRecorded
 * @param {string} scaledTotalLabel formatted sum of scaled row hours (after rounding)
 * @param {'scaled' | 'actual'} [mode]
 * @param {number} [targetHours]
 */
function updateScaledTable(
  scaledData,
  hasRecorded,
  scaledTotalLabel,
  mode = "scaled",
  targetHours = 8
) {
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

  const targetStr = timeMath.formatTrimmedDecimalForUi(targetHours, 1);
  if (titleEl) {
    titleEl.textContent =
      mode === "actual"
        ? `Actual hours (${scaledTotalLabel} h total) — over ${targetStr} h target — copy`
        : `Scaled to ${scaledTotalLabel} h — copy`;
  }
  if (thScaled) {
    thScaled.textContent =
      mode === "actual"
        ? "Hours (actual — not scaled down)"
        : `Hours (scaled to ${scaledTotalLabel} h)`;
  }

  lastScaledTsv = scaledData
    .map(
      (d) =>
        `${d.label}\t${timeMath.formatTrimmedDecimalForUi(d.value, 4)}`
    )
    .join("\n");

  tbody.innerHTML = "";
  for (const d of scaledData) {
    const tr = document.createElement("tr");
    const tdLabel = document.createElement("td");
    const urlField = typeof d.linkBase === "string" ? d.linkBase : "";
    const href = urlField.trim() === "" ? null : urlField;
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
    tdH.textContent = timeMath.formatTrimmedDecimalForUi(d.value, 4);
    tr.append(tdLabel, tdH);
    tbody.appendChild(tr);
  }
  section.hidden = false;
}

/**
 * @param {Record<string, number>} secondsByTopic
 * @param {Map<string, string>} labels
 * @param {Map<string, string> | undefined} linkBases row id → full URL for scaled-table link (optional)
 * @param {Map<string, boolean> | undefined} scalableByRow row id → false = fixed hours in scaled view
 */
export function updateCharts(secondsByTopic, labels, linkBases, scalableByRow) {
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
    updateChartsTotalLine(false, 0);
    updateScaledTable([], false, "", "scaled", 0);
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

  renderTopicChart(
    "chartVs8",
    vs8Canvas,
    vs8Labels,
    vs8Data,
    "Recorded vs 8 h",
    vs8BackgroundColors
  );

  const secRecord = Object.fromEntries(rows);
  const effective = timeMath.effectiveScaledRows(
    secRecord,
    targetScaledH,
    readScaledRoundingMode(),
    readScaledRemainderThresholdMinutes(),
    scalableByRow ?? null
  );
  updateChartsTotalLine(true, effective.totalRecordedHours);

  const scaledById = new Map(
    effective.rows.map((r) => [r.topicId, r.scaledHours])
  );
  const scaledData = rows.map(([id]) => ({
    label: labels.get(id) ?? id,
    value: /** @type {number} */ (scaledById.get(id)),
    linkBase: bases.get(id) ?? "",
  }));

  const scaledTotalLabel = formatScaledSumForUi(scaledDataSumHours(scaledData));
  const scaledTitle =
    effective.mode === "actual"
      ? `Actual hours (${scaledTotalLabel} h total)`
      : `Scaled to ${scaledTotalLabel} h`;

  const scaledLabels = scaledData.map((d) => d.label);
  const scaledValues = scaledData.map((d) => d.value);
  const scaledBg = scaledLabels.map((_, i) => COLORS[i % COLORS.length]);
  renderTopicChart("chartScaled", scaledCanvas, scaledLabels, scaledValues, scaledTitle, scaledBg);

  updateScaledTable(
    scaledData,
    true,
    scaledTotalLabel,
    effective.mode,
    effective.targetHours
  );
}

/** @type {Record<string, { destroy: () => void }>} */
const instances = {};

/**
 * @param {string} key
 * @param {HTMLCanvasElement | null} canvas
 * @param {string[]} chartLabels
 * @param {number[]} data
 * @param {string} title
 * @param {string[] | undefined} backgroundColors per-segment colors (defaults to COLORS rotation)
 */
function renderTopicChart(key, canvas, chartLabels, data, title, backgroundColors) {
  if (CHART_TYPE === "pie") {
    renderPie(key, canvas, chartLabels, data, title, backgroundColors);
  } else {
    renderDecomposition(key, canvas, chartLabels, data, title, backgroundColors);
  }
}

/**
 * @param {string} key
 * @param {HTMLCanvasElement | null} canvas
 * @param {string[]} chartLabels
 * @param {number[]} data
 * @param {string} title
 * @param {string[] | undefined} backgroundColors
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
              const h = timeMath.formatTrimmedDecimalForUi(Number(v), 4);
              return `${ctx.label}: ${h} h`;
            },
          },
        },
      },
    },
  });
}

/**
 * Horizontal stacked bar: one row, segments left-to-right (same order as pie slices).
 * @param {string} key
 * @param {HTMLCanvasElement | null} canvas
 * @param {string[]} chartLabels
 * @param {number[]} data
 * @param {string} title
 * @param {string[] | undefined} backgroundColors
 */
function renderDecomposition(key, canvas, chartLabels, data, title, backgroundColors) {
  if (!canvas) return;
  destroyIfExists(key);
  const ChartCtor = /** @type {any} */ (globalThis).Chart;
  const bg =
    backgroundColors ??
    chartLabels.map((_, i) => COLORS[i % COLORS.length]);
  instances[key] = new ChartCtor(canvas, {
    type: "bar",
    data: {
      labels: [""],
      datasets: chartLabels.map((label, i) => ({
        label,
        data: [data[i] ?? 0],
        backgroundColor: bg[i],
        borderWidth: 1,
        borderColor: "#fff",
      })),
    },
    options: {
      indexAxis: "y",
      responsive: true,
      maintainAspectRatio: false,
      datasets: {
        bar: { maxBarThickness: 44 },
      },
      scales: {
        x: {
          stacked: true,
          beginAtZero: true,
          ticks: {
            font: { size: 10 },
            callback(v) {
              return `${v} h`;
            },
          },
        },
        y: {
          stacked: true,
          display: false,
        },
      },
      plugins: {
        title: {
          display: true,
          text: title,
          font: { size: 12, weight: "600" },
          padding: { bottom: 8 },
        },
        legend: {
          position: "bottom",
          labels: { boxWidth: 12, font: { size: 10 } },
        },
        tooltip: {
          callbacks: {
            label(ctx) {
              const v = ctx.raw;
              const h = timeMath.formatTrimmedDecimalForUi(Number(v), 4);
              const name = ctx.dataset?.label ?? "";
              return `${name}: ${h} h`;
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
