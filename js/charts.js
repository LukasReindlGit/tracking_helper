/* global Chart — loaded via UMD in index.html */

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
 * @param {{ label: string, value: number }[]} scaledData
 * @param {boolean} hasRecorded
 */
function updateScaledTable(scaledData, hasRecorded) {
  const section = document.getElementById("scaled-table-section");
  const tbody = document.getElementById("scaled-copy-tbody");
  if (!section || !tbody) return;

  wireScaledCopyButton();

  if (!hasRecorded) {
    lastScaledTsv = "";
    tbody.innerHTML = "";
    section.hidden = true;
    return;
  }

  lastScaledTsv = scaledData.map((d) => `${d.label}\t${d.value}`).join("\n");

  tbody.innerHTML = "";
  for (const d of scaledData) {
    const tr = document.createElement("tr");
    const tdLabel = document.createElement("td");
    tdLabel.textContent = d.label;
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
 */
export function updateCharts(secondsByTopic, labels) {
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
    updateScaledTable([], false);
    return;
  }

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

  const totalSec2 = rows.reduce((sum, [, sec]) => sum + sec, 0);
  const scaledData = rows.map(([id, sec]) => ({
    label: labels.get(id) ?? id,
    value: Math.round((sec / totalSec2) * 8 * 10) / 10,
  }));

  renderPie(
    "chartScaled",
    scaledCanvas,
    scaledData.map((d) => d.label),
    scaledData.map((d) => d.value),
    "Scaled to 8 h"
  );

  updateScaledTable(scaledData, true);
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
