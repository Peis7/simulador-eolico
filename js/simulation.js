/**
 * simulation.js — Cálculo de una condición instantánea y reproducción en el tiempo.
 */

import {
  airDensity, hubWindSpeed, rotorArea, windPower, turbinePower,
  turbineState, effectiveCp, betzFraction, parkPower,
} from './physics.js';

/** Pasos de 10 min simulados por segundo real a velocidad 1×. */
export const STEPS_PER_SECOND_AT_1X = 1;
/** Máximo de tiempo real que se procesa en un cuadro [s] (evita saltos al volver a la pestaña). */
const MAX_FRAME_SECONDS = 0.25;

/**
 * @typedef {Object} SimConfig
 * @property {import('./physics.js').Turbine} turbine Turbina.
 * @property {number} altitude Altitud [m].
 * @property {number} temperature Temperatura [°C].
 * @property {number} alpha Exponente del terreno.
 * @property {number} turbines Número de turbinas del parque.
 * @property {number} wakeLoss Pérdidas por estela [fracción].
 */

/**
 * Calcula todos los indicadores instantáneos para una velocidad a 10 m.
 * @param {number} vRef Velocidad del viento a 10 m [m/s].
 * @param {SimConfig} cfg Configuración.
 * @returns {Object} Indicadores (potencias en W, velocidades en m/s, densidad en kg/m³).
 */
export function computeSnapshot(vRef, cfg) {
  const { turbine } = cfg;
  const rho = airDensity(cfg.altitude, cfg.temperature);
  const vHub = hubWindSpeed(vRef, turbine.hubHeight, cfg.alpha);
  const available = windPower(rho, rotorArea(turbine.diameter), vHub);
  const single = turbinePower(vHub, rho, turbine);
  const availableTotal = available * Math.max(1, cfg.turbines);
  const delivered = parkPower(single, cfg.turbines, cfg.wakeLoss);
  const cpEff = effectiveCp(delivered, availableTotal);
  return {
    vRef, vHub, rho,
    available, single,
    availableTotal, delivered,
    cpEff, betz: betzFraction(cpEff),
    state: turbineState(vHub, rho, turbine),
  };
}

/**
 * Energía total que produciría la serie completa con una configuración fija.
 * @param {import('./wind.js').WindSeries} series Serie de viento.
 * @param {SimConfig} cfg Configuración.
 * @returns {number} Energía [J].
 */
export function seriesEnergy(series, cfg) {
  let energy = 0;
  for (const v of series.speeds) energy += computeSnapshot(v, cfg).delivered * series.dt;
  return energy;
}

/**
 * Reproductor de la serie de viento: avanza pasos de 10 min y acumula E += P·Δt.
 */
export class Player {
  /**
   * @param {Object} opts
   * @param {() => SimConfig} opts.getConfig Devuelve la configuración vigente en cada paso.
   * @param {() => void} opts.onUpdate Se llama tras cada cambio de estado.
   */
  constructor({ getConfig, onUpdate }) {
    this.getConfig = getConfig;
    this.onUpdate = onUpdate;
    this.series = null;
    this.speed = 1;
    this.playing = false;
    this.frameId = null;
    this.frame = this.frame.bind(this);
    this.clear();
  }

  /** Reinicia contadores sin notificar. */
  clear() {
    this.index = 0;
    this.energy = 0;
    this.last = null;
    this.carry = 0;
    this.history = { hours: [], vHub: [], power: [] };
  }

  /** @param {import('./wind.js').WindSeries} series Nueva serie (reinicia la simulación). */
  load(series) {
    this.series = series;
    this.reset();
  }

  get length() { return this.series ? this.series.speeds.length : 0; }
  get finished() { return this.index >= this.length; }
  /** Tiempo simulado transcurrido [s]. */
  get elapsed() { return this.series ? this.index * this.series.dt : 0; }

  play() {
    if (!this.series || this.playing) return;
    if (this.finished) this.clear();
    if (this.index === 0) this.advance();
    this.playing = true;
    this.lastTime = null;
    this.frameId = requestAnimationFrame(this.frame);
    this.onUpdate();
  }

  pause() {
    this.playing = false;
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.onUpdate();
  }

  reset() {
    this.playing = false;
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.clear();
    this.onUpdate();
  }

  /** Avanza un paso de 10 min con la configuración vigente. */
  advance() {
    if (this.finished) return;
    const snap = computeSnapshot(this.series.speeds[this.index], this.getConfig());
    this.energy += snap.delivered * this.series.dt;
    this.history.hours.push((this.index * this.series.dt) / 3600);
    this.history.vHub.push(snap.vHub);
    this.history.power.push(snap.delivered);
    this.last = snap;
    this.index++;
  }

  /** @param {DOMHighResTimeStamp} now */
  frame(now) {
    if (!this.playing) return;
    if (this.lastTime != null) {
      const realSeconds = Math.min((now - this.lastTime) / 1000, MAX_FRAME_SECONDS);
      this.carry += realSeconds * STEPS_PER_SECOND_AT_1X * this.speed;
      while (this.carry >= 1 && !this.finished) {
        this.advance();
        this.carry -= 1;
      }
    }
    this.lastTime = now;
    if (this.finished) {
      this.playing = false;
      this.frameId = null;
    } else {
      this.frameId = requestAnimationFrame(this.frame);
    }
    this.onUpdate();
  }
}
