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

  renderPie(
    "chartVs8",
    vs8Canvas,
    vs8Labels,
    vs8Data,
    "Recorded vs 8 h"
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
}

/** @type {Record<string, { destroy: () => void }>} */
const instances = {};

/**
 * @param {string} key
 * @param {HTMLCanvasElement | null} canvas
 * @param {string[]} chartLabels
 * @param {number[]} data
 * @param {string} title
 */
function renderPie(key, canvas, chartLabels, data, title) {
  if (!canvas) return;
  destroyIfExists(key);
  const ChartCtor = /** @type {any} */ (globalThis).Chart;
  instances[key] = new ChartCtor(canvas, {
    type: "pie",
    data: {
      labels: chartLabels,
      datasets: [
        {
          label: title,
          data,
          backgroundColor: chartLabels.map(
            (_, i) => COLORS[i % COLORS.length]
          ),
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
