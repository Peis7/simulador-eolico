// Pruebas del modelo físico. Ejecutar con: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  airDensity, hubWindSpeed, rotorArea, windPower, turbinePower, ratedWindSpeed,
  turbineState, effectiveCp, capacityFactor, parkPower, gamma, weibullScale,
  weibullPdf, annualEnergy, BETZ_LIMIT, TERRAIN_ALPHA,
} from '../js/physics.js';
import { mulberry32, generateWindSeries } from '../js/wind.js';
import { computeSnapshot, seriesEnergy } from '../js/simulation.js';

const turbine = { diameter: 90, hubHeight: 80, ratedPower: 2e6, cp: 0.45, efficiency: 0.92, cutIn: 3, cutOut: 25 };
const RHO_STD = 1.225;

const near = (actual, expected, tol, msg) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${msg ?? ''} esperado ${expected} ± ${tol}, obtenido ${actual}`);

test('ρ a 0 m y 15 °C ≈ 1.225 kg/m³', () => {
  near(airDensity(0, 15), 1.225, 0.005);
});

test('ρ a 1000 m y 15 °C ≈ 1.087 kg/m³', () => {
  near(airDensity(1000, 15), 1.087, 0.005);
});

test('P_viento con D = 90 m, v = 10 m/s, ρ = 1.225 ≈ 3.90 MW (± 1 %)', () => {
  const p = windPower(RHO_STD, rotorArea(90), 10);
  near(p, 3.90e6, 3.90e6 * 0.01);
});

test('potencia 0 por debajo del arranque', () => {
  for (const v of [0, 1, 2.9, 2.999]) assert.equal(turbinePower(v, RHO_STD, turbine), 0);
});

test('potencia 0 desde la velocidad de corte', () => {
  for (const v of [25, 26, 30]) assert.equal(turbinePower(v, RHO_STD, turbine), 0);
});

test('la potencia nunca supera la nominal (0–30 m/s)', () => {
  for (let v = 0; v <= 30; v += 0.05) {
    assert.ok(turbinePower(v, RHO_STD, turbine) <= turbine.ratedPower + 1e-9, `v = ${v}`);
  }
});

test('Cp efectivo nunca supera 0.593', () => {
  const extreme = { ...turbine, cp: 0.7, efficiency: 1, ratedPower: 1e12 };
  for (let v = 0; v <= 30; v += 0.05) {
    for (const t of [turbine, extreme]) {
      const cpEff = effectiveCp(turbinePower(v, RHO_STD, t), windPower(RHO_STD, rotorArea(t.diameter), v));
      assert.ok(cpEff <= 0.593, `v = ${v}, Cp = ${cpEff}`);
    }
  }
});

test('v_hub con H = h_ref es igual a v_ref', () => {
  for (const alpha of Object.values(TERRAIN_ALPHA)) assert.equal(hubWindSpeed(7, 10, alpha), 7);
});

test('una torre más alta da más viento', () => {
  assert.ok(hubWindSpeed(7, 120, 0.14) > hubWindSpeed(7, 80, 0.14));
});

test('RNG con la misma semilla produce la misma secuencia', () => {
  const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
  const sa = Array.from({ length: 100 }, a);
  const sb = Array.from({ length: 100 }, b);
  const sc = Array.from({ length: 100 }, c);
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  assert.ok(sa.every((x) => x >= 0 && x < 1));
});

test('la misma semilla produce la misma energía total', () => {
  const opts = { meanSpeed: 7, dailyAmplitude: 0.25, turbulence: 0.15, durationHours: 24, seed: 2024 };
  const cfg = { turbine, altitude: 0, temperature: 25, alpha: 0.14, turbines: 1, wakeLoss: 0.1 };
  const e1 = seriesEnergy(generateWindSeries(opts), cfg);
  const e2 = seriesEnergy(generateWindSeries(opts), cfg);
  assert.equal(e1, e2);
  assert.ok(e1 > 0);
});

test('serie de viento: 144 pasos por día y nunca negativa', () => {
  const s = generateWindSeries({ meanSpeed: 2, dailyAmplitude: 0.5, turbulence: 0.4, durationHours: 24, seed: 1 });
  assert.equal(s.speeds.length, 144);
  assert.ok(s.speeds.every((v) => v >= 0));
});

test('velocidad nominal: P_elec alcanza P_nominal', () => {
  const vNom = ratedWindSpeed(RHO_STD, turbine);
  const pElec = windPower(RHO_STD, rotorArea(90), vNom) * turbine.cp * turbine.efficiency;
  near(pElec, turbine.ratedPower, 1);
  assert.equal(turbineState(vNom + 0.1, RHO_STD, turbine), 'nominal');
  assert.equal(turbineState(vNom - 0.1, RHO_STD, turbine), 'generando');
  assert.equal(turbineState(2, RHO_STD, turbine), 'sin-generar');
  assert.equal(turbineState(25, RHO_STD, turbine), 'detenida');
});

test('más altitud reduce la potencia; más torre la aumenta', () => {
  const cfg = { turbine, altitude: 0, temperature: 15, alpha: 0.14, turbines: 1, wakeLoss: 0 };
  const base = computeSnapshot(5, cfg).delivered;
  assert.ok(computeSnapshot(5, { ...cfg, altitude: 2000 }).delivered < base);
  assert.ok(computeSnapshot(5, { ...cfg, turbine: { ...turbine, hubHeight: 120 } }).delivered > base);
});

test('parque: N·P·(1 − pérdidas), sin pérdidas con una turbina', () => {
  assert.equal(parkPower(1e6, 1, 0.1), 1e6);
  near(parkPower(1e6, 10, 0.1), 9e6, 1e-6);
});

test('factor de capacidad', () => {
  near(capacityFactor(1e6 * 3600 * 12, 2e6, 3600 * 24), 0.25, 1e-12);
  assert.equal(capacityFactor(0, 2e6, 0), 0);
});

test('Γ (Lanczos): Γ(5) = 24, Γ(1/2) = √π, Γ(1 + 1/2) = √π/2', () => {
  near(gamma(5), 24, 1e-10);
  near(gamma(0.5), Math.sqrt(Math.PI), 1e-12);
  near(gamma(1.5), Math.sqrt(Math.PI) / 2, 1e-12);
});

test('Weibull: la densidad integra ≈ 1 y la media es v_media', () => {
  const k = 2, mean = 7, c = weibullScale(mean, k);
  let area = 0, m = 0;
  for (let v = 0.005; v < 60; v += 0.01) {
    area += weibullPdf(v, k, c) * 0.01;
    m += v * weibullPdf(v, k, c) * 0.01;
  }
  near(area, 1, 1e-3);
  near(m, mean, 1e-2);
});

test('energía anual: positiva y menor que P_nominal × 8760 h', () => {
  const e = annualEnergy((v) => turbinePower(v, RHO_STD, turbine), 8, 2);
  assert.ok(e > 0);
  assert.ok(e < turbine.ratedPower * 8760 * 3600);
  assert.equal(annualEnergy((v) => turbinePower(v, RHO_STD, turbine), 0, 2), 0);
});

test('BETZ_LIMIT ≈ 0.593', () => near(BETZ_LIMIT, 0.593, 0.001));
