/**
 * physics.js — Modelo físico del simulador.
 *
 * Todas las funciones son puras (no tocan el DOM) y trabajan en unidades SI:
 * m, m/s, W, J, K, Pa, kg/m³. La conversión a kW, MWh, °C, etc. se hace solo
 * al mostrar los resultados.
 */

// ---------------------------------------------------------------------------
// Constantes físicas y del modelo
// ---------------------------------------------------------------------------

/** Presión atmosférica estándar al nivel del mar [Pa]. */
export const SEA_LEVEL_PRESSURE = 101325;
/** Coeficiente de la fórmula barométrica estándar [1/m]. */
export const PRESSURE_LAPSE_COEF = 2.25577e-5;
/** Exponente de la fórmula barométrica estándar [adimensional]. */
export const PRESSURE_EXPONENT = 5.25588;
/** Constante específica del aire seco [J/(kg·K)]. */
export const AIR_GAS_CONSTANT = 287.05;
/** Conversión de °C a K. */
export const KELVIN_OFFSET = 273.15;

/** Límite de Betz: fracción máxima teórica de la potencia del viento (16/27 ≈ 0.593). */
export const BETZ_LIMIT = 16 / 27;

/** Altura de referencia de la medición del viento [m]. */
export const REFERENCE_HEIGHT = 10;

/** Exponente α de la ley de potencia según el tipo de terreno. */
export const TERRAIN_ALPHA = Object.freeze({
  mar: 0.10,
  campo: 0.14,
  cultivos: 0.20,
  bosque: 0.25,
  ciudad: 0.35,
});

/** Velocidad de arranque por defecto [m/s]. */
export const DEFAULT_CUT_IN = 3;
/** Velocidad de corte por defecto [m/s]. */
export const DEFAULT_CUT_OUT = 25;
/** Coeficiente de potencia por defecto [adimensional]. */
export const DEFAULT_CP = 0.45;
/** Eficiencia mecánica + eléctrica por defecto [adimensional]. */
export const DEFAULT_EFFICIENCY = 0.92;

/** Horas en un año (365 días). */
export const HOURS_PER_YEAR = 8760;
/** Segundos en una hora. */
export const SECONDS_PER_HOUR = 3600;

/** Intervalo de integración de la estimación anual [m/s]. */
export const WEIBULL_DV = 0.1;
/** Velocidad máxima de integración de la estimación anual [m/s]. */
export const WEIBULL_V_MAX = 30;

// ---------------------------------------------------------------------------
// 1. Densidad del aire
// ---------------------------------------------------------------------------

/**
 * Presión atmosférica según la atmósfera estándar.
 * @param {number} altitude Altitud sobre el nivel del mar [m].
 * @returns {number} Presión [Pa].
 */
export function airPressure(altitude) {
  return SEA_LEVEL_PRESSURE * Math.pow(1 - PRESSURE_LAPSE_COEF * altitude, PRESSURE_EXPONENT);
}

/**
 * Densidad del aire con la ley de los gases ideales: ρ = p / (R·T).
 * @param {number} altitude Altitud [m].
 * @param {number} temperatureC Temperatura del aire [°C].
 * @returns {number} Densidad [kg/m³].
 */
export function airDensity(altitude, temperatureC) {
  const temperatureK = temperatureC + KELVIN_OFFSET;
  return airPressure(altitude) / (AIR_GAS_CONSTANT * temperatureK);
}

// ---------------------------------------------------------------------------
// 2. Perfil vertical del viento
// ---------------------------------------------------------------------------

/**
 * Velocidad del viento a la altura del buje con la ley de potencia:
 * v_hub = v_ref · (H / h_ref)^α.
 * @param {number} vRef Velocidad medida a la altura de referencia [m/s].
 * @param {number} hubHeight Altura del buje [m].
 * @param {number} alpha Exponente del terreno [adimensional].
 * @param {number} [refHeight=REFERENCE_HEIGHT] Altura de la medición [m].
 * @returns {number} Velocidad en el buje [m/s].
 */
export function hubWindSpeed(vRef, hubHeight, alpha, refHeight = REFERENCE_HEIGHT) {
  return vRef * Math.pow(hubHeight / refHeight, alpha);
}

// ---------------------------------------------------------------------------
// 3. Potencia
// ---------------------------------------------------------------------------

/**
 * Área barrida por el rotor: A = π·(D/2)².
 * @param {number} diameter Diámetro del rotor [m].
 * @returns {number} Área [m²].
 */
export function rotorArea(diameter) {
  return Math.PI * (diameter / 2) ** 2;
}

/**
 * Potencia disponible en el viento: P = ½·ρ·A·v³.
 * @param {number} rho Densidad del aire [kg/m³].
 * @param {number} area Área barrida [m²].
 * @param {number} v Velocidad del viento [m/s].
 * @returns {number} Potencia [W].
 */
export function windPower(rho, area, v) {
  return 0.5 * rho * area * v ** 3;
}

/**
 * Potencia eléctrica sin límite nominal: P_elec = P_viento · Cp · η.
 * Cp se recorta al límite de Betz.
 * @param {number} rho Densidad del aire [kg/m³].
 * @param {number} area Área barrida [m²].
 * @param {number} v Velocidad del viento [m/s].
 * @param {number} cp Coeficiente de potencia [adimensional].
 * @param {number} efficiency Eficiencia mecánica + eléctrica η [adimensional].
 * @returns {number} Potencia [W].
 */
export function electricalPower(rho, area, v, cp, efficiency) {
  return windPower(rho, area, v) * Math.min(cp, BETZ_LIMIT) * efficiency;
}

/**
 * @typedef {Object} Turbine
 * @property {number} diameter Diámetro del rotor [m].
 * @property {number} hubHeight Altura del buje [m].
 * @property {number} ratedPower Potencia nominal [W].
 * @property {number} cp Coeficiente de potencia [adimensional].
 * @property {number} efficiency Eficiencia η [adimensional].
 * @property {number} [cutIn] Velocidad de arranque [m/s].
 * @property {number} [cutOut] Velocidad de corte [m/s].
 */

/**
 * Curva de potencia: potencia entregada por una turbina.
 * 0 bajo el arranque, min(P_elec, P_nominal) en operación y 0 a partir del corte.
 * @param {number} vHub Velocidad en el buje [m/s].
 * @param {number} rho Densidad del aire [kg/m³].
 * @param {Turbine} turbine Parámetros de la turbina.
 * @returns {number} Potencia entregada [W].
 */
export function turbinePower(vHub, rho, turbine) {
  const { cutIn = DEFAULT_CUT_IN, cutOut = DEFAULT_CUT_OUT } = turbine;
  if (vHub < cutIn || vHub >= cutOut) return 0;
  const pElec = electricalPower(rho, rotorArea(turbine.diameter), vHub, turbine.cp, turbine.efficiency);
  return Math.min(pElec, turbine.ratedPower);
}

/**
 * Velocidad nominal: aquella en la que P_elec alcanza P_nominal.
 * v_nom = ∛(P_nominal / (½·ρ·A·Cp·η)).
 * @param {number} rho Densidad del aire [kg/m³].
 * @param {Turbine} turbine Parámetros de la turbina.
 * @returns {number} Velocidad nominal en el buje [m/s].
 */
export function ratedWindSpeed(rho, turbine) {
  const k = 0.5 * rho * rotorArea(turbine.diameter) * Math.min(turbine.cp, BETZ_LIMIT) * turbine.efficiency;
  return Math.cbrt(turbine.ratedPower / k);
}

/**
 * Estado operativo de la turbina.
 * @param {number} vHub Velocidad en el buje [m/s].
 * @param {number} rho Densidad del aire [kg/m³].
 * @param {Turbine} turbine Parámetros de la turbina.
 * @returns {'sin-generar'|'generando'|'nominal'|'detenida'} Estado.
 */
export function turbineState(vHub, rho, turbine) {
  const { cutIn = DEFAULT_CUT_IN, cutOut = DEFAULT_CUT_OUT } = turbine;
  if (vHub >= cutOut) return 'detenida';
  if (vHub < cutIn) return 'sin-generar';
  return vHub >= ratedWindSpeed(rho, turbine) ? 'nominal' : 'generando';
}

// ---------------------------------------------------------------------------
// 4. Indicadores de eficiencia
// ---------------------------------------------------------------------------

/**
 * Cp efectivo = P_entregada / P_viento.
 * @param {number} delivered Potencia entregada [W].
 * @param {number} available Potencia disponible del viento [W].
 * @returns {number} Cp efectivo [adimensional] (0 si no hay viento).
 */
export function effectiveCp(delivered, available) {
  return available > 0 ? delivered / available : 0;
}

/**
 * Fracción del límite de Betz alcanzada.
 * @param {number} cpEff Cp efectivo [adimensional].
 * @returns {number} Fracción [0–1].
 */
export function betzFraction(cpEff) {
  return cpEff / BETZ_LIMIT;
}

/**
 * Factor de capacidad = E / (P_nominal · tiempo).
 * @param {number} energy Energía producida [J].
 * @param {number} ratedPower Potencia nominal instalada [W].
 * @param {number} duration Tiempo simulado [s].
 * @returns {number} Factor de capacidad [0–1] (0 si no ha pasado tiempo).
 */
export function capacityFactor(energy, ratedPower, duration) {
  return ratedPower > 0 && duration > 0 ? energy / (ratedPower * duration) : 0;
}

// ---------------------------------------------------------------------------
// 5. Parque eólico
// ---------------------------------------------------------------------------

/**
 * Potencia de un parque de N turbinas idénticas con pérdidas por estela:
 * P_parque = N · P_turbina · (1 − pérdidas). Con una sola turbina no hay estela.
 * @param {number} singlePower Potencia de una turbina [W].
 * @param {number} count Número de turbinas N.
 * @param {number} wakeLoss Pérdidas por estela [fracción 0–1].
 * @returns {number} Potencia del parque [W].
 */
export function parkPower(singlePower, count, wakeLoss) {
  if (count <= 1) return singlePower;
  return count * singlePower * (1 - wakeLoss);
}

// ---------------------------------------------------------------------------
// 6. Estimación anual con la distribución de Weibull
// ---------------------------------------------------------------------------

const LANCZOS_G = 7;
const LANCZOS_COEF = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/**
 * Función Gamma Γ(z) con la aproximación de Lanczos (g = 7, 9 coeficientes).
 * @param {number} z Argumento real (no entero ≤ 0).
 * @returns {number} Γ(z).
 */
export function gamma(z) {
  if (z < 0.5) {
    // Fórmula de reflexión de Euler
    return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z));
  }
  const x = z - 1;
  let sum = LANCZOS_COEF[0];
  for (let i = 1; i < LANCZOS_COEF.length; i++) sum += LANCZOS_COEF[i] / (x + i);
  const t = x + LANCZOS_G + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * sum;
}

/**
 * Parámetro de escala de Weibull a partir de la velocidad media:
 * c = v_media / Γ(1 + 1/k).
 * @param {number} meanSpeed Velocidad media [m/s].
 * @param {number} k Parámetro de forma [adimensional].
 * @returns {number} Escala c [m/s].
 */
export function weibullScale(meanSpeed, k) {
  return meanSpeed / gamma(1 + 1 / k);
}

/**
 * Densidad de probabilidad de Weibull f(v) = (k/c)·(v/c)^(k−1)·e^(−(v/c)^k).
 * @param {number} v Velocidad [m/s].
 * @param {number} k Forma [adimensional].
 * @param {number} c Escala [m/s].
 * @returns {number} Densidad [1/(m/s)].
 */
export function weibullPdf(v, k, c) {
  if (v < 0 || c <= 0) return 0;
  const r = v / c;
  return (k / c) * Math.pow(r, k - 1) * Math.exp(-Math.pow(r, k));
}

/**
 * Energía anual esperada: E = 8760 h · Σ P(v)·f(v)·Δv, de 0 a 30 m/s
 * (regla del punto medio con Δv = 0.1 m/s).
 * @param {(v: number) => number} powerAt Potencia entregada en función de la velocidad en el buje [W].
 * @param {number} meanSpeed Velocidad media en el buje [m/s].
 * @param {number} k Forma de Weibull [adimensional].
 * @returns {number} Energía anual [J].
 */
export function annualEnergy(powerAt, meanSpeed, k) {
  if (meanSpeed <= 0) return 0;
  const c = weibullScale(meanSpeed, k);
  const steps = Math.round(WEIBULL_V_MAX / WEIBULL_DV);
  let meanPower = 0;
  for (let i = 0; i < steps; i++) {
    const v = (i + 0.5) * WEIBULL_DV;
    meanPower += powerAt(v) * weibullPdf(v, k, c) * WEIBULL_DV;
  }
  return meanPower * HOURS_PER_YEAR * SECONDS_PER_HOUR;
}
