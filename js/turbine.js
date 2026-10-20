/**
 * turbine.js — Turbina animada en SVG.
 * Las aspas giran a una velocidad proporcional al viento en el buje y se
 * detienen (con desaceleración suave) cuando la turbina no genera.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
/** Velocidad angular visual por cada m/s de viento [grados/s]. No es la velocidad real del rotor. */
const VISUAL_DEG_PER_MPS = 18;
/** Rapidez con que la animación alcanza la velocidad objetivo [1/s]. */
const SPIN_RESPONSE = 1.5;
/** Velocidad visual de las líneas de viento por cada m/s [px/s]. */
const STREAK_PX_PER_MPS = 12;
const HUB = { x: 110, y: 80 };

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

/**
 * Dibuja la turbina dentro de un contenedor y arranca su animación.
 * @param {HTMLElement} container Contenedor.
 * @returns {{ update: (opts: { vHub: number, spinning: boolean }) => void }} Controlador.
 */
export function createTurbine(container) {
  const svg = el('svg', {
    viewBox: '0 0 220 250',
    role: 'img',
    'aria-label': 'Turbina eólica animada',
    class: 'turbine-svg',
  });

  // Líneas de viento
  const streaks = [36, 120, 170].map((y, i) =>
    el('line', { x1: 0, y1: y, x2: 220, y2: y, class: 'wind-streak', 'stroke-dasharray': `${18 + i * 6} ${40 + i * 10}` }, svg));

  // Suelo, torre y góndola
  el('path', { d: 'M0 238 Q 110 222 220 238 L220 250 L0 250 Z', class: 'ground' }, svg);
  el('polygon', { points: `${HUB.x - 6},240 ${HUB.x + 6},240 ${HUB.x + 2.5},${HUB.y} ${HUB.x - 2.5},${HUB.y}`, class: 'tower' }, svg);
  el('rect', { x: HUB.x - 6, y: HUB.y - 6, width: 22, height: 12, rx: 4, class: 'nacelle' }, svg);

  // Rotor: tres aspas a 120°
  const rotor = el('g', { transform: `translate(${HUB.x} ${HUB.y})` }, svg);
  for (const angle of [0, 120, 240]) {
    el('path', { d: 'M -3.5 0 Q -7 -38 -1.2 -72 L 1.2 -72 Q 5 -34 3.5 0 Z', class: 'blade', transform: `rotate(${angle})` }, rotor);
  }
  el('circle', { cx: 0, cy: 0, r: 6, class: 'hub' }, rotor);
  container.appendChild(svg);

  let angle = 0;
  let omega = 0;          // velocidad angular actual [°/s]
  let targetOmega = 0;    // velocidad angular objetivo [°/s]
  let streakSpeed = 0;    // [px/s]
  let streakOffset = 0;
  let lastTime = null;

  function frame(now) {
    if (lastTime !== null) {
      const dt = Math.min((now - lastTime) / 1000, 0.1);
      omega += (targetOmega - omega) * Math.min(1, dt * SPIN_RESPONSE);
      if (Math.abs(omega) < 0.05 && targetOmega === 0) omega = 0;
      angle = (angle + omega * dt) % 360;
      rotor.setAttribute('transform', `translate(${HUB.x} ${HUB.y}) rotate(${angle.toFixed(2)})`);
      streakOffset = (streakOffset - streakSpeed * dt) % 1000;
      for (const s of streaks) s.setAttribute('stroke-dashoffset', streakOffset.toFixed(1));
    }
    lastTime = now;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    update({ vHub, spinning }) {
      targetOmega = spinning ? vHub * VISUAL_DEG_PER_MPS : 0;
      streakSpeed = vHub * STREAK_PX_PER_MPS;
      svg.classList.toggle('calm', vHub < 0.5);
    },
  };
}
