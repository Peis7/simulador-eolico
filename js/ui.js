/**
 * ui.js — Controles, eventos y actualización de indicadores.
 * Es el punto de entrada de la página (<script type="module">).
 */

import {
  airDensity, hubWindSpeed, rotorArea, windPower, turbinePower, ratedWindSpeed,
  capacityFactor, annualEnergy, weibullScale, weibullPdf,
  BETZ_LIMIT, DEFAULT_CUT_IN, DEFAULT_CUT_OUT, HOURS_PER_YEAR, SECONDS_PER_HOUR,
} from './physics.js';
import { generateWindSeries, randomSeed } from './wind.js';
import { computeSnapshot, seriesEnergy, Player } from './simulation.js';
import {
  TURBINE_PRESETS, SCENARIO_PRESETS, TERRAINS, DEFAULTS, ASSUMPTIONS,
  RATED_POWER_MIN, RATED_POWER_MAX, HOURS_PER_MONTH,
} from './presets.js';
import {
  createPowerCurveChart, updatePowerCurveChart, createTimeChart, updateTimeChart,
  formatClock,
} from './charts.js';
import { createTurbine } from './turbine.js';

// ---------------------------------------------------------------------------
// Formato de números y unidades
// ---------------------------------------------------------------------------

const LOCALE = 'es-MX';
/** Posiciones del deslizador logarítmico de potencia nominal. */
const RATED_SLIDER_STEPS = 1000;
/** El eje de la curva de potencia llega a este múltiplo de la potencia nominal. */
const POWER_AXIS_HEADROOM = 1.5;
/** Paso de la curva de potencia dibujada [m/s]. */
const CURVE_DV = 0.1;
/** Ancho de las barras del histograma de Weibull [m/s]. */
const HISTOGRAM_BIN = 1;
const J_PER_KWH = 3.6e6;

/** Número con decimales fijos en formato local. */
function fmt(x, digits = 0) {
  return x.toLocaleString(LOCALE, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Número con unas 3 cifras significativas. */
function fmtSig(x) {
  const a = Math.abs(x);
  return fmt(x, a === 0 ? 0 : a < 10 ? 2 : a < 100 ? 1 : 0);
}

/** Elige la unidad de potencia adecuada para un valor en W. */
function powerUnit(watts) {
  const a = Math.abs(watts);
  if (a >= 1e9) return { factor: 1e9, unit: 'GW' };
  if (a >= 1e6) return { factor: 1e6, unit: 'MW' };
  if (a >= 1e3) return { factor: 1e3, unit: 'kW' };
  return { factor: 1, unit: 'W' };
}

/** @param {number} watts Potencia [W]. */
function formatPower(watts) {
  const { factor, unit } = powerUnit(watts);
  return `${fmtSig(watts / factor)} ${unit}`;
}

/** @param {number} joules Energía [J]. */
function formatEnergy(joules) {
  const wh = joules / SECONDS_PER_HOUR;
  const { factor, unit } = powerUnit(wh);
  return `${fmtSig(wh / factor)} ${unit}h`;
}

/** @param {number} kg Masa de CO₂ [kg]. */
function formatMass(kg) {
  return kg >= 1000 ? `${fmtSig(kg / 1000)} t` : `${fmtSig(kg)} kg`;
}

function formatPercent(fraction, digits = 1) {
  return `${fmt(fraction * 100, digits)} %`;
}

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

const state = { ...DEFAULTS };
const $ = (id) => document.getElementById(id);

/** Configuración física a partir del estado de los controles. */
function getConfig() {
  return {
    turbine: {
      diameter: state.diameter,
      hubHeight: state.hubHeight,
      ratedPower: state.ratedPower,
      cp: state.cp,
      efficiency: state.efficiency,
      cutIn: DEFAULT_CUT_IN,
      cutOut: DEFAULT_CUT_OUT,
    },
    altitude: state.altitude,
    temperature: state.temperature,
    alpha: TERRAINS[state.terrain].alpha,
    turbines: state.turbines,
    wakeLoss: state.wakeLoss,
  };
}

const installedPower = () => state.ratedPower * state.turbines;

// Deslizador logarítmico de potencia nominal
const ratedFromSlider = (s) => {
  const raw = RATED_POWER_MIN * Math.pow(RATED_POWER_MAX / RATED_POWER_MIN, s / RATED_SLIDER_STEPS);
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)) - 1); // 2 cifras significativas
  return Math.round(raw / magnitude) * magnitude;
};
const sliderFromRated = (p) =>
  Math.round((RATED_SLIDER_STEPS * Math.log(p / RATED_POWER_MIN)) / Math.log(RATED_POWER_MAX / RATED_POWER_MIN));

// ---------------------------------------------------------------------------
// Definición de los deslizadores
// ---------------------------------------------------------------------------

/**
 * kind: 'wind' regenera la serie; 'turbine' pasa el modelo a "Personalizada";
 * 'env' borra el escenario elegido.
 */
const SLIDERS = [
  { id: 'wind-speed', key: 'windSpeed', kind: 'wind', show: (v) => `${fmt(v, 1)} m/s` },
  { id: 'daily-amplitude', key: 'dailyAmplitude', kind: 'wind', show: (v) => `± ${fmt(v * 100)} %` },
  { id: 'turbulence', key: 'turbulence', kind: 'wind', show: (v) => fmt(v, 2) },
  { id: 'diameter', key: 'diameter', kind: 'turbine', show: (v) => `${fmt(v)} m` },
  { id: 'hub-height', key: 'hubHeight', kind: 'turbine', show: (v) => `${fmt(v)} m` },
  {
    id: 'rated-power', key: 'ratedPower', kind: 'turbine', show: formatPower,
    fromInput: ratedFromSlider, toInput: sliderFromRated,
  },
  { id: 'cp', key: 'cp', kind: 'other', show: (v) => fmt(v, 3) },
  { id: 'efficiency', key: 'efficiency', kind: 'other', show: (v) => fmt(v, 2) },
  { id: 'temperature', key: 'temperature', kind: 'env', show: (v) => `${fmt(v)} °C` },
  { id: 'altitude', key: 'altitude', kind: 'env', show: (v) => `${fmt(v)} m` },
  { id: 'turbines', key: 'turbines', kind: 'other', show: (v) => fmt(v) },
  { id: 'wake-loss', key: 'wakeLoss', kind: 'other', show: (v) => formatPercent(v, 0) },
  { id: 'weibull-k', key: 'weibullK', kind: 'other', show: (v) => fmt(v, 1) },
];

// ---------------------------------------------------------------------------
// Serie de viento y reproductor
// ---------------------------------------------------------------------------

let series = null;
let seriesWindMax = 1;
const player = new Player({ getConfig, onUpdate: () => scheduleRender() });

function regenerateSeries() {
  series = generateWindSeries({
    meanSpeed: state.windSpeed,
    dailyAmplitude: state.dailyAmplitude,
    turbulence: state.turbulence,
    durationHours: state.durationHours,
    seed: state.seed,
  });
  // Máximo de la serie: fija el eje del viento para que no salte durante la reproducción
  seriesWindMax = Math.max(1, ...series.speeds);
  player.speed = state.playbackSpeed;
  player.load(series);
}

// ---------------------------------------------------------------------------
// Gráficas y turbina
// ---------------------------------------------------------------------------

let powerChart = null;
let timeChart = null;
let turbineAnim = null;

/** Datos de la curva de potencia (se recalculan solo si cambia la configuración). */
let curveCache = { key: '', data: null };

function powerCurveData(cfg, rho) {
  const key = JSON.stringify([cfg.turbine, rho, state.showWeibull, state.weibullK, state.windSpeed, cfg.alpha]);
  if (curveCache.key === key) return curveCache.data;

  const { factor, unit } = powerUnit(cfg.turbine.ratedPower);
  const area = rotorArea(cfg.turbine.diameter);
  const curve = [];
  const betz = [];
  const steps = Math.round(30 / CURVE_DV);
  for (let i = 0; i <= steps; i++) {
    const v = i * CURVE_DV;
    curve.push({ x: v, y: turbinePower(v, rho, cfg.turbine) / factor });
    betz.push({ x: v, y: (windPower(rho, area, v) * BETZ_LIMIT) / factor });
  }

  let weibull = null;
  if (state.showWeibull && state.windSpeed > 0) {
    const meanHub = hubWindSpeed(state.windSpeed, cfg.turbine.hubHeight, cfg.alpha);
    const c = weibullScale(meanHub, state.weibullK);
    weibull = [];
    for (let v = HISTOGRAM_BIN / 2; v < 30; v += HISTOGRAM_BIN) {
      weibull.push({ x: v, y: weibullPdf(v, state.weibullK, c) * HISTOGRAM_BIN * 100 });
    }
  }

  const data = { curve, betz, weibull, unit, factor, yMax: (cfg.turbine.ratedPower * POWER_AXIS_HEADROOM) / factor };
  curveCache = { key, data };
  return data;
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

let renderQueued = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    render();
  });
}

const STATE_TEXT = {
  'sin-generar': { label: 'Sin generar', note: `Viento menor que el arranque (${DEFAULT_CUT_IN} m/s)` },
  generando: { label: 'Generando', note: 'Zona cúbica de la curva' },
  nominal: { label: 'A potencia nominal', note: 'El generador está al máximo' },
  detenida: { label: 'Detenida', note: `Viento ≥ ${DEFAULT_CUT_OUT} m/s: parada de seguridad` },
};

function setText(id, text) {
  const node = $(id);
  if (node.textContent !== text) node.textContent = text;
}

function render() {
  const cfg = getConfig();
  const timeMode = state.mode === 'tiempo';
  const rho = airDensity(cfg.altitude, cfg.temperature);

  // Condición actual: el deslizador (manual) o el último paso reproducido (tiempo)
  let snap;
  if (!timeMode) snap = computeSnapshot(state.windSpeed, cfg);
  else if (player.last) snap = computeSnapshot(player.last.vRef, cfg);
  else snap = computeSnapshot(series.speeds[0], cfg);

  const park = state.turbines > 1;

  // --- Tarjetas ---
  setText('card-vhub', `${fmt(snap.vHub, 1)} m/s`);
  setText('card-vhub-sub', `${fmt(snap.vRef, 1)} m/s a 10 m · torre de ${fmt(state.hubHeight)} m`);
  setText('card-rho', `${fmt(snap.rho, 3)} kg/m³`);
  setText('card-rho-sub', `${formatPercent(snap.rho / 1.225 - 1)} vs. nivel del mar a 15 °C`);
  setText('card-available', formatPower(snap.availableTotal));
  setText('card-available-sub', park ? `${fmt(state.turbines)} rotores · ${formatPower(snap.available)} cada uno` : 'En el viento que cruza el rotor');
  setText('card-delivered', formatPower(snap.delivered));
  setText('card-delivered-sub', park
    ? `${formatPercent(snap.delivered / installedPower())} de ${formatPower(installedPower())} · con estela`
    : `${formatPercent(snap.delivered / state.ratedPower)} de la nominal`);
  setText('card-cp', fmt(snap.cpEff, 3));
  setText('card-betz', `${formatPercent(snap.betz)} del límite de Betz`);
  $('betz-bar').style.width = `${Math.min(100, snap.betz * 100)}%`;

  const st = STATE_TEXT[snap.state];
  const stateNode = $('card-state');
  setText('card-state', st.label);
  stateNode.dataset.state = snap.state;
  setText('card-state-sub', st.note);

  // Energía y factor de capacidad
  if (timeMode) {
    const elapsed = player.elapsed;
    const total = seriesEnergy(series, cfg);
    setText('card-energy', formatEnergy(player.energy));
    setText('card-energy-sub', `Total previsto del periodo: ${formatEnergy(total)}`);
    setText('card-cf', elapsed > 0 ? formatPercent(capacityFactor(player.energy, installedPower(), elapsed)) : '—');
    setText('card-cf-sub', elapsed > 0 ? `En ${fmt(elapsed / SECONDS_PER_HOUR, 1)} h simuladas (típico: 25–45 %)` : 'Pulse ▶ para empezar');
  } else {
    setText('card-energy', '—');
    setText('card-energy-sub', 'Use el modo Tiempo para acumular energía');
    setText('card-cf', '—');
    setText('card-cf-sub', 'Disponible en modo Tiempo o en la estimación anual');
  }

  // --- Velocidad nominal ---
  const vRated = ratedWindSpeed(rho, cfg.turbine);
  setText('rated-speed', vRated < DEFAULT_CUT_OUT
    ? `Velocidad nominal calculada: ${fmt(vRated, 1)} m/s en el buje`
    : `Con estos valores la turbina no alcanza su potencia nominal antes del corte (${DEFAULT_CUT_OUT} m/s).`);

  // --- Turbina animada ---
  const spinning = snap.state === 'generando' || snap.state === 'nominal';
  turbineAnim?.update({ vHub: snap.vHub, spinning });
  $('turbine-warning').hidden = snap.state !== 'detenida';
  setText('turbine-caption', `D = ${fmt(state.diameter)} m · H = ${fmt(state.hubHeight)} m · ${formatPower(state.ratedPower)}${park ? ` · ×${state.turbines} turbinas` : ''}`);

  // --- Curva de potencia ---
  const curve = powerCurveData(cfg, rho);
  updatePowerCurveChart(powerChart, {
    curve: curve.curve,
    betz: curve.betz,
    weibull: curve.weibull,
    unit: curve.unit,
    yMax: curve.yMax,
    point: { x: Math.min(snap.vHub, 30), y: snap.single / curve.factor },
  });

  // --- Reproductor y gráfica temporal ---
  if (timeMode) renderTime(cfg);

  renderEquivalences(snap, timeMode);
  renderAnnual(cfg, rho);
}

function renderTime(cfg) {
  const progress = player.length ? player.index / player.length : 0;
  setText('sim-clock', formatClock(player.elapsed / SECONDS_PER_HOUR));
  $('sim-progress').value = progress;
  const playBtn = $('play-toggle');
  const label = player.playing ? '⏸ Pausa' : player.finished ? '▶ Repetir' : '▶ Reproducir';
  setText('play-toggle', label);
  playBtn.setAttribute('aria-pressed', String(player.playing));

  const { factor, unit } = powerUnit(installedPower());
  const h = player.history;
  updateTimeChart(timeChart, {
    durationHours: state.durationHours,
    wind: h.hours.map((x, i) => ({ x, y: h.vHub[i] })),
    power: h.power.map((p, i) => ({ x: h.hours[i], y: p / factor })),
    unit,
    windMax: Math.ceil(hubWindSpeed(seriesWindMax, cfg.turbine.hubHeight, cfg.alpha) + 1),
    powerMax: (installedPower() / factor) * 1.05,
  });
}

function renderEquivalences(snap, timeMode) {
  const homeKWhPerHour = ASSUMPTIONS.householdMonthlyKWh / HOURS_PER_MONTH;
  if (timeMode && player.elapsed > 0) {
    const kWh = player.energy / J_PER_KWH;
    const meanKW = kWh / (player.elapsed / SECONDS_PER_HOUR);
    setText('eq-context', `Con la energía producida en ${fmt(player.elapsed / SECONDS_PER_HOUR, 1)} h simuladas (potencia media ${formatPower(meanKW * 1000)}).`);
    setText('eq-homes', fmt(meanKW / homeKWhPerHour));
    setText('eq-co2-label', 'CO₂ evitado en el periodo');
    setText('eq-co2', formatMass(kWh * ASSUMPTIONS.co2KgPerKWh));
  } else if (timeMode) {
    setText('eq-context', 'Pulse ▶ para simular y ver las equivalencias de la energía producida.');
    setText('eq-homes', '—');
    setText('eq-co2-label', 'CO₂ evitado en el periodo');
    setText('eq-co2', '—');
  } else {
    const kW = snap.delivered / 1000;
    setText('eq-context', 'Si la potencia actual se mantuviera constante.');
    setText('eq-homes', fmt(kW / homeKWhPerHour));
    setText('eq-co2-label', 'CO₂ evitado por hora');
    setText('eq-co2', formatMass(kW * ASSUMPTIONS.co2KgPerKWh));
  }
}

function renderAnnual(cfg, rho) {
  const meanHub = hubWindSpeed(state.windSpeed, cfg.turbine.hubHeight, cfg.alpha);
  const single = annualEnergy((v) => turbinePower(v, rho, cfg.turbine), meanHub, state.weibullK);
  const energy = state.turbines > 1 ? single * state.turbines * (1 - state.wakeLoss) : single;
  const kWh = energy / J_PER_KWH;
  const c = meanHub > 0 ? weibullScale(meanHub, state.weibullK) : 0;
  setText('annual-context', `Velocidad media en el buje ${fmt(meanHub, 1)} m/s (${fmt(state.windSpeed, 1)} m/s a 10 m) · escala c = ${fmt(c, 2)} m/s.`);
  setText('annual-energy', formatEnergy(energy));
  setText('annual-cf', formatPercent(capacityFactor(energy, installedPower(), HOURS_PER_YEAR * SECONDS_PER_HOUR)));
  setText('annual-homes', fmt(kWh / (ASSUMPTIONS.householdMonthlyKWh * 12)));
  setText('annual-co2', formatMass(kWh * ASSUMPTIONS.co2KgPerKWh));
}

// ---------------------------------------------------------------------------
// Sincronización controles ⇄ estado
// ---------------------------------------------------------------------------

function syncControls() {
  for (const s of SLIDERS) {
    const input = $(s.id);
    input.value = s.toInput ? s.toInput(state[s.key]) : state[s.key];
    setText(`${s.id}-out`, s.show(state[s.key]));
  }
  $('turbine-preset').value = state.turbinePreset;
  $('terrain').value = state.terrain;
  $('scenario').value = state.scenario;
  $('duration').value = String(state.durationHours);
  $('seed').value = String(state.seed);
  $('show-weibull').checked = state.showWeibull;
  $(`mode-${state.mode}`).checked = true;
  $(`speed-${state.playbackSpeed}`).checked = true;
  $('wake-loss').disabled = state.turbines <= 1;
}

function applyMode() {
  const timeMode = state.mode === 'tiempo';
  $('player').hidden = !timeMode;
  $('time-panel').hidden = !timeMode;
  setText('wind-speed-label', timeMode ? 'Velocidad media a 10 m' : 'Velocidad del viento a 10 m');
  for (const node of document.querySelectorAll('.time-only')) {
    node.classList.toggle('inactive', !timeMode);
    for (const input of node.querySelectorAll('input, select, button:not(.info)')) input.disabled = !timeMode;
  }
  if (timeMode) {
    regenerateSeries();
    // El gráfico temporal se crea cuando su panel es visible (Chart.js necesita su tamaño)
    if (!timeChart) timeChart = createTimeChart($('time-chart'));
  } else {
    player.pause();
  }
}

function onWindParamsChanged() {
  if (state.mode === 'tiempo') regenerateSeries();
}

function fillSelect(select, entries, extra) {
  select.replaceChildren();
  if (extra) select.append(new Option(extra.label, extra.value));
  for (const [value, item] of Object.entries(entries)) select.append(new Option(item.label, value));
}

function setupInfoButtons() {
  for (const btn of document.querySelectorAll('button.info')) {
    btn.addEventListener('click', () => {
      const help = $(btn.getAttribute('aria-controls'));
      const open = btn.getAttribute('aria-expanded') !== 'true';
      btn.setAttribute('aria-expanded', String(open));
      help.hidden = !open;
    });
  }
}

function bindEvents() {
  for (const s of SLIDERS) {
    $(s.id).addEventListener('input', (e) => {
      const raw = Number(e.target.value);
      state[s.key] = s.fromInput ? s.fromInput(raw) : raw;
      setText(`${s.id}-out`, s.show(state[s.key]));
      if (s.kind === 'turbine') { state.turbinePreset = 'personalizada'; $('turbine-preset').value = 'personalizada'; }
      if (s.kind === 'env' || s.id === 'wind-speed') { state.scenario = ''; $('scenario').value = ''; }
      if (s.key === 'turbines') $('wake-loss').disabled = state.turbines <= 1;
      if (s.kind === 'wind') onWindParamsChanged();
      scheduleRender();
    });
  }

  $('turbine-preset').addEventListener('change', (e) => {
    state.turbinePreset = e.target.value;
    const preset = TURBINE_PRESETS[state.turbinePreset];
    if (preset) Object.assign(state, { diameter: preset.diameter, hubHeight: preset.hubHeight, ratedPower: preset.ratedPower });
    syncControls();
    scheduleRender();
  });

  $('scenario').addEventListener('change', (e) => {
    state.scenario = e.target.value;
    const sc = SCENARIO_PRESETS[state.scenario];
    if (sc) {
      Object.assign(state, { altitude: sc.altitude, temperature: sc.temperature, terrain: sc.terrain, windSpeed: sc.windSpeed });
      onWindParamsChanged();
    }
    syncControls();
    scheduleRender();
  });

  $('terrain').addEventListener('change', (e) => {
    state.terrain = e.target.value;
    state.scenario = '';
    $('scenario').value = '';
    scheduleRender();
  });

  for (const radio of document.querySelectorAll('input[name="mode"]')) {
    radio.addEventListener('change', (e) => {
      state.mode = e.target.value;
      applyMode();
      scheduleRender();
    });
  }

  for (const radio of document.querySelectorAll('input[name="speed"]')) {
    radio.addEventListener('change', (e) => {
      state.playbackSpeed = Number(e.target.value);
      player.speed = state.playbackSpeed;
    });
  }

  $('duration').addEventListener('change', (e) => {
    state.durationHours = Number(e.target.value);
    onWindParamsChanged();
    scheduleRender();
  });

  $('seed').addEventListener('change', (e) => {
    const value = Math.round(Number(e.target.value));
    if (Number.isFinite(value) && value >= 1) state.seed = value;
    $('seed').value = String(state.seed);
    onWindParamsChanged();
    scheduleRender();
  });

  $('new-seed').addEventListener('click', () => {
    state.seed = randomSeed();
    $('seed').value = String(state.seed);
    onWindParamsChanged();
    scheduleRender();
  });

  $('play-toggle').addEventListener('click', () => (player.playing ? player.pause() : player.play()));
  $('reset-btn').addEventListener('click', () => player.reset());

  $('show-weibull').addEventListener('change', (e) => {
    state.showWeibull = e.target.checked;
    scheduleRender();
  });

  // Cambio de tema claro/oscuro del sistema: se recrean las gráficas con los nuevos colores
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    powerChart?.destroy();
    powerChart = createPowerCurveChart($('power-chart'));
    if (timeChart) {
      timeChart.destroy();
      timeChart = createTimeChart($('time-chart'));
    }
    scheduleRender();
  });
}

// ---------------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------------

function init() {
  fillSelect($('turbine-preset'), TURBINE_PRESETS);
  $('turbine-preset').append(new Option('Personalizada', 'personalizada'));
  fillSelect($('scenario'), SCENARIO_PRESETS, { label: '— Ninguno —', value: '' });
  fillSelect($('terrain'), Object.fromEntries(
    Object.entries(TERRAINS).map(([k, t]) => [k, { label: `${t.label} (α = ${fmt(t.alpha, 2)})` }]),
  ));

  // Tabla de α en "Cómo funciona"
  $('alpha-table').replaceChildren(...Object.values(TERRAINS).map((t) => {
    const row = document.createElement('tr');
    row.innerHTML = `<td></td><td>${fmt(t.alpha, 2)}</td>`;
    row.firstChild.textContent = t.label;
    return row;
  }));

  setText('assumption-home', `${fmt(ASSUMPTIONS.householdMonthlyKWh)} kWh/mes`);
  setText('assumption-co2', `${fmt(ASSUMPTIONS.co2KgPerKWh, 2)} kg de CO₂`);

  turbineAnim = createTurbine($('turbine'));
  powerChart = createPowerCurveChart($('power-chart'));
  if (!powerChart) document.querySelector('.chart-fallback').hidden = false;

  setupInfoButtons();
  syncControls();
  bindEvents();
  applyMode();
  regenerateSeries();
  render();
}

init();
