/**
 * charts.js — Configuración de las gráficas con Chart.js (cargado por CDN como global `Chart`).
 * Si Chart.js no está disponible (sin internet), las funciones devuelven null y
 * el resto del simulador sigue funcionando.
 * Los colores se leen del tema CSS al crear cada gráfica (Chart.js guarda en caché
 * los estilos de los puntos), así que al cambiar de tema hay que volver a crearlas.
 */

const hasChartJs = () => typeof window !== 'undefined' && typeof window.Chart !== 'undefined';

/** Lee los colores del tema actual desde las variables CSS. */
function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  return {
    text: v('--text'), muted: v('--muted'), grid: v('--grid'), surface: v('--surface'),
    curve: v('--accent'), betz: v('--muted'), point: v('--danger'),
    wind: v('--primary'), power: v('--accent'), weibull: v('--primary'),
  };
}

/** Convierte #rrggbb en rgba con opacidad. */
function withAlpha(hex, alpha) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function numberTick(value) {
  return Number(value).toLocaleString('es-MX', { maximumFractionDigits: 2 });
}

function axisTitle(text, colors) {
  return { display: true, text, color: colors.muted, font: { size: 14, weight: '600' } };
}

function baseOptions(colors) {
  return {
    animation: false,
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
    plugins: {
      colors: { enabled: false }, // los colores salen del tema CSS
      legend: { labels: { color: colors.text, boxWidth: 18, font: { size: 13 } } },
      tooltip: { callbacks: {} },
    },
  };
}

function applyColors(chart, colors) {
  chart.options.plugins.legend.labels.color = colors.text;
  for (const scale of Object.values(chart.options.scales)) {
    scale.ticks = { ...scale.ticks, color: colors.muted };
    scale.grid = { ...scale.grid, color: colors.grid };
    if (scale.title) scale.title.color = colors.muted;
  }
}

/**
 * Gráfica de la curva de potencia con límite de Betz, punto actual e histograma de Weibull.
 * @param {HTMLCanvasElement} canvas Lienzo.
 * @returns {Object|null} Instancia de Chart.js.
 */
export function createPowerCurveChart(canvas) {
  if (!hasChartJs()) return null;
  const colors = themeColors();
  const options = baseOptions(colors);
  options.scales = {
    x: {
      type: 'linear', min: 0, max: 30,
      ticks: { stepSize: 5 },
      title: axisTitle('Velocidad del viento en el buje (m/s)', colors),
    },
    y: { min: 0, ticks: { callback: numberTick }, title: axisTitle('Potencia', colors) },
    y2: {
      position: 'right', min: 0, display: false,
      grid: { drawOnChartArea: false },
      ticks: { callback: (v) => `${numberTick(v)} %` },
      title: axisTitle('Frecuencia del viento (%)', colors),
    },
  };
  options.plugins.tooltip.callbacks.label = (ctx) => {
    const unit = ctx.dataset.yAxisID === 'y2' ? '%' : ctx.chart.$powerUnit ?? '';
    return `${ctx.dataset.label}: ${numberTick(ctx.parsed.y)} ${unit}`;
  };

  const chart = new window.Chart(canvas, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Condición actual', data: [], showLine: false, pointRadius: 9, pointHoverRadius: 10, borderWidth: 3,
          backgroundColor: colors.point, borderColor: colors.surface, yAxisID: 'y', order: 0,
        },
        {
          label: 'Curva de potencia (por turbina)', data: [], borderWidth: 3, pointRadius: 0,
          borderColor: colors.curve, backgroundColor: colors.curve, yAxisID: 'y', order: 1,
        },
        {
          label: 'Límite de Betz (59.3 % del viento)', data: [], borderWidth: 2, borderDash: [7, 5], pointRadius: 0,
          borderColor: colors.betz, backgroundColor: colors.betz, yAxisID: 'y', order: 2,
        },
        {
          type: 'bar', label: 'Frecuencia del viento (Weibull)', data: [], yAxisID: 'y2', order: 3,
          barPercentage: 1, categoryPercentage: 1,
          backgroundColor: withAlpha(colors.weibull, 0.22), borderColor: withAlpha(colors.weibull, 0.5), borderWidth: 1,
        },
      ],
    },
    options,
  });
  applyColors(chart, colors);
  return chart;
}

/**
 * Actualiza la curva de potencia.
 * @param {Object|null} chart Gráfica.
 * @param {Object} d Datos ya escalados a la unidad `unit`.
 * @param {{x:number,y:number}[]} d.curve Curva de potencia.
 * @param {{x:number,y:number}[]} d.betz Límite de Betz.
 * @param {{x:number,y:number}} d.point Condición actual.
 * @param {{x:number,y:number}[]|null} d.weibull Histograma (%) o null para ocultarlo.
 * @param {string} d.unit Unidad de potencia (W, kW, MW).
 * @param {number} d.yMax Máximo del eje de potencia.
 */
export function updatePowerCurveChart(chart, { curve, betz, point, weibull, unit, yMax }) {
  if (!chart) return;
  const [pointDs, curveDs, betzDs, weibullDs] = chart.data.datasets;
  pointDs.data = [point];
  curveDs.data = curve;
  betzDs.data = betz;
  weibullDs.data = weibull ?? [];
  weibullDs.hidden = !weibull;
  chart.$powerUnit = unit;
  chart.options.scales.y.max = yMax;
  chart.options.scales.y.title.text = `Potencia (${unit})`;
  chart.options.scales.y2.display = Boolean(weibull);
  chart.update('none');
}

/**
 * Gráfica temporal: viento en el buje y potencia entregada (dos ejes y).
 * @param {HTMLCanvasElement} canvas Lienzo.
 * @returns {Object|null} Instancia de Chart.js.
 */
export function createTimeChart(canvas) {
  if (!hasChartJs()) return null;
  const colors = themeColors();
  const options = baseOptions(colors);
  options.scales = {
    x: { type: 'linear', min: 0, max: 24, ticks: { stepSize: 3 }, title: axisTitle('Tiempo', colors) },
    y: { position: 'left', min: 0, ticks: { callback: numberTick }, title: axisTitle('Viento en el buje (m/s)', colors) },
    y2: { position: 'right', min: 0, grid: { drawOnChartArea: false }, ticks: { callback: numberTick }, title: axisTitle('Potencia', colors) },
  };
  options.plugins.tooltip.callbacks.title = (items) => items.length ? formatClock(items[0].parsed.x) : '';
  options.plugins.tooltip.callbacks.label = (ctx) => {
    const unit = ctx.dataset.yAxisID === 'y' ? 'm/s' : ctx.chart.$powerUnit ?? '';
    return `${ctx.dataset.label}: ${numberTick(ctx.parsed.y)} ${unit}`;
  };

  const chart = new window.Chart(canvas, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'Viento en el buje', data: [], borderWidth: 2, pointRadius: 0, yAxisID: 'y', tension: 0.2,
          borderColor: colors.wind, backgroundColor: colors.wind,
        },
        {
          label: 'Potencia entregada', data: [], borderWidth: 2, pointRadius: 0, yAxisID: 'y2', fill: 'origin', stepped: 'before',
          borderColor: colors.power, backgroundColor: withAlpha(colors.power, 0.2),
        },
      ],
    },
    options,
  });
  applyColors(chart, colors);
  return chart;
}

/**
 * Texto "Día d · hh:mm" a partir de horas simuladas.
 * @param {number} hours Tiempo [h].
 * @returns {string} Texto.
 */
export function formatClock(hours) {
  const totalMinutes = Math.round(hours * 60);
  const day = Math.floor(totalMinutes / 1440) + 1;
  const h = Math.floor((totalMinutes % 1440) / 60);
  const m = totalMinutes % 60;
  return `Día ${day} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Actualiza la gráfica temporal.
 * @param {Object|null} chart Gráfica.
 * @param {Object} d Datos.
 * @param {number} d.durationHours Duración total [h].
 * @param {{x:number,y:number}[]} d.wind Viento en el buje [m/s].
 * @param {{x:number,y:number}[]} d.power Potencia escalada a `unit`.
 * @param {string} d.unit Unidad de potencia.
 * @param {number} d.windMax Máximo del eje de viento [m/s].
 * @param {number} d.powerMax Máximo del eje de potencia (en `unit`).
 */
export function updateTimeChart(chart, { durationHours, wind, power, unit, windMax, powerMax }) {
  if (!chart) return;
  const [windDs, powerDs] = chart.data.datasets;
  windDs.data = wind;
  powerDs.data = power;
  chart.$powerUnit = unit;
  const x = chart.options.scales.x;
  x.max = durationHours;
  const week = durationHours > 24;
  x.ticks.stepSize = week ? 24 : 3;
  x.ticks.callback = week ? (v) => `Día ${v / 24 + 1}` : (v) => `${v} h`;
  x.title.text = week ? 'Tiempo (días)' : 'Hora del día';
  chart.options.scales.y.max = windMax;
  chart.options.scales.y2.max = powerMax;
  chart.options.scales.y2.title.text = `Potencia (${unit})`;
  chart.update('none');
}
