/**
 * presets.js — Turbinas, escenarios, valores por defecto y supuestos editables.
 */

import { TERRAIN_ALPHA, DEFAULT_CP, DEFAULT_EFFICIENCY } from './physics.js';

/** Turbinas predefinidas (diámetro [m], altura del buje [m], potencia nominal [W]). */
export const TURBINE_PRESETS = Object.freeze({
  pequena: { label: 'Pequeña (rural) · 10 kW', diameter: 7, hubHeight: 20, ratedPower: 10e3 },
  mediana: { label: 'Mediana · 250 kW', diameter: 30, hubHeight: 40, ratedPower: 250e3 },
  comercial: { label: 'Comercial · 2 MW', diameter: 90, hubHeight: 80, ratedPower: 2e6 },
  grande: { label: 'Moderna grande · 5 MW', diameter: 140, hubHeight: 110, ratedPower: 5e6 },
});

/** Escenarios ilustrativos (no son datos medidos). */
export const SCENARIO_PRESETS = Object.freeze({
  costa: { label: 'Costa', altitude: 0, temperature: 28, terrain: 'mar', windSpeed: 7 },
  altiplano: { label: 'Altiplano', altitude: 1000, temperature: 22, terrain: 'campo', windSpeed: 6 },
  montana: { label: 'Montaña', altitude: 2000, temperature: 15, terrain: 'campo', windSpeed: 8 },
});

/** Tipos de terreno con su exponente α. */
export const TERRAINS = Object.freeze({
  mar: { label: 'Mar / lago', alpha: TERRAIN_ALPHA.mar },
  campo: { label: 'Campo abierto', alpha: TERRAIN_ALPHA.campo },
  cultivos: { label: 'Cultivos / arbustos', alpha: TERRAIN_ALPHA.cultivos },
  bosque: { label: 'Bosque / suburbano', alpha: TERRAIN_ALPHA.bosque },
  ciudad: { label: 'Ciudad', alpha: TERRAIN_ALPHA.ciudad },
});

/** Rango de la potencia nominal (el slider usa escala logarítmica) [W]. */
export const RATED_POWER_MIN = 5e3;
export const RATED_POWER_MAX = 8e6;

/** Semilla inicial del generador de viento. */
export const DEFAULT_SEED = 2024;

/** Valores iniciales de todos los controles (unidades SI salvo la temperatura en °C). */
export const DEFAULTS = Object.freeze({
  mode: 'manual',
  windSpeed: 7,
  dailyAmplitude: 0.25,
  turbulence: 0.15,
  turbinePreset: 'comercial',
  diameter: 90,
  hubHeight: 80,
  ratedPower: 2e6,
  cp: DEFAULT_CP,
  efficiency: DEFAULT_EFFICIENCY,
  temperature: 25,
  altitude: 0,
  terrain: 'campo',
  scenario: '',
  durationHours: 24,
  playbackSpeed: 1,
  seed: DEFAULT_SEED,
  turbines: 1,
  wakeLoss: 0.10,
  weibullK: 2,
  showWeibull: true,
});

/**
 * Supuestos para las equivalencias. Edítelos para adaptarlos a su país.
 * householdMonthlyKWh: consumo de un hogar [kWh/mes].
 * co2KgPerKWh: emisiones evitadas por cada kWh eólico [kg CO₂/kWh].
 */
export const ASSUMPTIONS = {
  householdMonthlyKWh: 200,
  co2KgPerKWh: 0.5,
};

/** Horas promedio en un mes (8760 / 12). */
export const HOURS_PER_MONTH = 730;
