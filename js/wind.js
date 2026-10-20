/**
 * wind.js — Generación de series de viento reproducibles.
 *
 * v(t) = v_media · (1 + A_diaria · sin(2π·(t − 9)/24)) + turbulencia(t)
 * La turbulencia es un proceso de Ornstein–Uhlenbeck (ruido correlacionado).
 */

/** Paso de tiempo de la simulación: 10 minutos [s]. */
export const TIME_STEP = 600;
/** Desfase del patrón diario [h]: con 9 h el máximo cae a las 15:00. */
export const DAILY_PHASE_HOURS = 9;
/** Duración de un día [h]. */
export const HOURS_PER_DAY = 24;
/** Tiempo de correlación de la turbulencia [s]: cuánto "recuerda" el viento su desviación. */
export const TURBULENCE_TIME_CONSTANT = 3600;
/** Semilla máxima (enteros de 32 bits sin signo). */
const MAX_SEED = 2 ** 32;

/**
 * Generador pseudoaleatorio mulberry32 con semilla.
 * @param {number} seed Semilla entera.
 * @returns {() => number} Función que devuelve números uniformes en [0, 1).
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / MAX_SEED;
  };
}

/**
 * Número aleatorio con distribución normal estándar (Box–Muller).
 * @param {() => number} rng Generador uniforme en [0, 1).
 * @returns {number} Muestra N(0, 1).
 */
export function gaussian(rng) {
  const u1 = 1 - rng(); // en (0, 1] para evitar log(0)
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Nueva semilla aleatoria (no reproducible, solo para el botón "Nueva semilla").
 * @returns {number} Entero en [1, 999999].
 */
export function randomSeed() {
  return 1 + Math.floor(Math.random() * 999999);
}

/**
 * @typedef {Object} WindSeries
 * @property {number} dt Paso de tiempo [s].
 * @property {number[]} speeds Velocidades a 10 m en cada paso [m/s].
 */

/**
 * Genera una serie de viento a la altura de referencia (10 m).
 * @param {Object} options
 * @param {number} options.meanSpeed Velocidad media v_media [m/s].
 * @param {number} options.dailyAmplitude Amplitud de la variación diaria A_diaria [0–0.5].
 * @param {number} options.turbulence Intensidad de turbulencia [fracción de v_media, 0–0.4].
 * @param {number} options.durationHours Duración de la serie [h].
 * @param {number} options.seed Semilla del generador aleatorio.
 * @param {number} [options.dt=TIME_STEP] Paso de tiempo [s].
 * @returns {WindSeries} Serie de viento.
 */
export function generateWindSeries({ meanSpeed, dailyAmplitude, turbulence, durationHours, seed, dt = TIME_STEP }) {
  const rng = mulberry32(seed);
  const steps = Math.round((durationHours * 3600) / dt);
  const sigma = turbulence * meanSpeed; // desviación estándar estacionaria [m/s]
  // Discretización exacta del proceso de Ornstein–Uhlenbeck
  const decay = Math.exp(-dt / TURBULENCE_TIME_CONSTANT);
  const noiseScale = sigma * Math.sqrt(1 - decay * decay);

  let x = sigma * gaussian(rng); // estado inicial tomado de la distribución estacionaria
  const speeds = new Array(steps);
  for (let i = 0; i < steps; i++) {
    const tHours = (i * dt) / 3600;
    const daily = 1 + dailyAmplitude * Math.sin((2 * Math.PI * (tHours - DAILY_PHASE_HOURS)) / HOURS_PER_DAY);
    speeds[i] = Math.max(0, meanSpeed * daily + x);
    x = x * decay + noiseScale * gaussian(rng);
  }
  return { dt, speeds };
}
