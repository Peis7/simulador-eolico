# Simulador de Producción de Energía Eólica — Especificación

## Contexto

Herramienta web educativa para una clase. Permite simular la producción de una turbina eólica (o un pequeño parque), variar la velocidad del viento y las condiciones ambientales, y observar en tiempo real la potencia, la energía y la eficiencia.

- **Idioma de la interfaz:** español.
- **Público:** estudiantes universitarios (el modelo debe ser correcto, pero explicado de forma clara).
- **No es una herramienta profesional completa:** es un simulador didáctico con supuestos simplificados y documentados.

## Restricciones técnicas (obligatorias)

- Sitio **100 % estático**: debe funcionar subiendo la carpeta a **Netlify Drop** o **GitHub Pages** sin paso de build.
- **HTML + CSS + JavaScript puro** con módulos ES (`<script type="module">`). Sin frameworks, sin bundler, sin `npm install` para producción.
- Librerías externas solo por CDN: **Chart.js** (cdnjs o jsdelivr).
- Rutas **relativas** (`./js/...`) para que funcione en un subdirectorio de GitHub Pages.
- Sin backend, sin APIs externas, sin cuentas de usuario.
- Diseño responsive: debe verse bien en laptop (proyector de clase) y en celular.
- Sin dependencias de `localStorage` para funcionar (si se usa, envolver en `try/catch`).

## Estructura de archivos

```
simulador-eolico/
├── index.html
├── css/
│   └── styles.css
├── js/
│   ├── physics.js      # Funciones puras del modelo físico (sin DOM)
│   ├── wind.js         # Generación de series de viento (RNG con semilla)
│   ├── simulation.js   # Loop de tiempo, estado de la simulación
│   ├── charts.js       # Configuración de Chart.js
│   ├── turbine.js      # Animación SVG de la turbina
│   ├── presets.js      # Turbinas y escenarios predefinidos
│   └── ui.js           # Sliders, eventos, actualización de indicadores
├── tests/
│   └── physics.test.js # Pruebas con `node --test` (solo desarrollo)
└── README.md           # Explicación del modelo, supuestos y cómo desplegar
```

`physics.js` no debe tocar el DOM: todas sus funciones son puras y exportadas, para poder probarlas y explicarlas en clase.

## Modelo físico

### 1. Densidad del aire

```
p(h) = 101325 · (1 − 2.25577e-5 · h)^5.25588     [Pa]   h = altitud en m
T    = T_celsius + 273.15                         [K]
ρ    = p / (R · T)                                [kg/m³] R = 287.05 J/(kg·K)
```

### 2. Perfil vertical del viento (ley de potencia)

```
v_hub = v_ref · (H / h_ref)^α
```

- `v_ref`: velocidad medida a `h_ref = 10 m` (lo que controla el usuario).
- `H`: altura del buje (torre).
- `α` según el terreno:

| Terreno | α |
|---|---|
| Mar / lago | 0.10 |
| Campo abierto | 0.14 |
| Cultivos / arbustos | 0.20 |
| Bosque / suburbano | 0.25 |
| Ciudad | 0.35 |

### 3. Potencia

```
A        = π · (D/2)²
P_viento = ½ · ρ · A · v_hub³                      (potencia disponible)
P_aero   = P_viento · Cp                           (Cp ≤ 0.593, límite de Betz)
P_elec   = P_aero · η                              (η = eficiencia mecánica + eléctrica)
```

Curva de potencia de la turbina:

| Condición | Potencia entregada |
|---|---|
| `v_hub < v_arranque` | 0 |
| `v_arranque ≤ v_hub < v_corte` | `min(P_elec, P_nominal)` |
| `v_hub ≥ v_corte` | 0 (turbina detenida por seguridad) |

Valores por defecto: `v_arranque = 3 m/s`, `v_corte = 25 m/s`, `Cp = 0.45`, `η = 0.92`.

La **velocidad nominal** no es un parámetro: se calcula como la velocidad en la que `P_elec` alcanza `P_nominal`, y se muestra en la interfaz.

### 4. Indicadores de eficiencia

- **Cp efectivo** = `P_entregada / P_viento` (cuánto del viento se aprovecha realmente; cae por encima de la velocidad nominal).
- **% del límite de Betz** = `Cp efectivo / 0.593`.
- **Factor de capacidad** = `Energía producida / (P_nominal × horas simuladas)`.

### 5. Parque (opcional, fase 4)

- `N` turbinas idénticas.
- Pérdidas por estela: porcentaje configurable (por defecto 10 %).
- `P_parque = N · P_turbina · (1 − pérdidas_estela)`.

## Simulación en el tiempo

### Serie de viento

Paso de tiempo: **10 minutos simulados**. Para cada paso:

```
v(t) = v_media · (1 + A_diaria · sin(2π · (t_horas − 9) / 24)) + turbulencia(t)
```

- El patrón diario alcanza su máximo a media tarde (~15:00).
- `A_diaria` configurable (0 a 0.5, por defecto 0.25).
- `turbulencia(t)`: proceso de Ornstein–Uhlenbeck (ruido correlacionado, no saltos bruscos), con intensidad configurable (0 a 0.4 × `v_media`, por defecto 0.15).
- Recortar a `v ≥ 0`.
- Usar un generador aleatorio **con semilla** (por ejemplo `mulberry32`) para que la misma configuración produzca la misma serie. Botón "Nueva semilla" para generar otra.

### Modos

1. **Manual:** el slider controla directamente la velocidad del viento; no avanza el tiempo, solo se actualizan los indicadores instantáneos.
2. **Tiempo:** reproducción de la serie generada con controles ▶ Play / ⏸ Pausa / ⟲ Reiniciar y velocidad de reproducción (1×, 10×, 60×). Duración: 1 día, 1 semana.

Energía acumulada: `E += P · Δt` (en kWh o MWh según la escala).

### Estimación anual (Weibull) — fase 4

- Distribución de Weibull con forma `k` (por defecto 2, Rayleigh) y escala `c = v_media / Γ(1 + 1/k)`.
- `Energía anual = 8760 · Σ P(v) · f(v) · Δv` integrando de 0 a 30 m/s con `Δv = 0.1`.
- Implementar `Γ` con la aproximación de Lanczos dentro de `physics.js`.
- Mostrar el histograma de Weibull superpuesto con la curva de potencia.

## Controles del usuario

| Grupo | Control | Rango | Defecto |
|---|---|---|---|
| Viento | Velocidad media a 10 m | 0 – 30 m/s | 7 |
| Viento | Variación diaria | 0 – 0.5 | 0.25 |
| Viento | Turbulencia | 0 – 0.4 | 0.15 |
| Turbina | Preset | ver tabla | Comercial 2 MW |
| Turbina | Diámetro del rotor | 5 – 170 m | 90 |
| Turbina | Altura de la torre | 10 – 150 m | 80 |
| Turbina | Potencia nominal | 5 kW – 8 MW | 2 MW |
| Turbina | Cp | 0.20 – 0.593 | 0.45 |
| Turbina | Eficiencia η | 0.80 – 0.98 | 0.92 |
| Ambiente | Temperatura | −10 – 45 °C | 25 |
| Ambiente | Altitud | 0 – 3000 m | 0 |
| Ambiente | Terreno | ver tabla α | Campo abierto |
| Simulación | Modo | Manual / Tiempo | Manual |
| Simulación | Duración | 1 día / 1 semana | 1 día |

Cada control debe tener un ícono "ⓘ" con una explicación corta en lenguaje sencillo.

### Presets de turbina

| Nombre | D (m) | H (m) | P nominal |
|---|---|---|---|
| Pequeña (rural) | 7 | 20 | 10 kW |
| Mediana | 30 | 40 | 250 kW |
| Comercial | 90 | 80 | 2 MW |
| Moderna grande | 140 | 110 | 5 MW |

### Presets de escenario (ubicación ficticia o genérica)

- "Costa" → altitud 0 m, 28 °C, mar, viento 7 m/s.
- "Altiplano" → altitud 1000 m, 22 °C, campo abierto, viento 6 m/s.
- "Montaña" → altitud 2000 m, 15 °C, campo abierto, viento 8 m/s.

Etiquetarlos como escenarios ilustrativos, no como datos medidos.

## Salidas visuales

1. **Turbina animada (SVG):** las aspas giran a una velocidad proporcional al viento; se detienen por debajo del arranque y por encima del corte (con un aviso "Detenida por seguridad").
2. **Tarjetas de indicadores:**
   - Viento a la altura del buje (m/s)
   - Densidad del aire (kg/m³)
   - Potencia disponible del viento
   - Potencia entregada
   - Cp efectivo y % del límite de Betz
   - Energía acumulada
   - Factor de capacidad
   - Estado: "Sin generar" / "Generando" / "A potencia nominal" / "Detenida"
3. **Gráfica de la curva de potencia** (Chart.js): eje x velocidad 0–30 m/s, eje y potencia; línea de Betz como referencia; punto móvil que indica la condición actual.
4. **Gráfica temporal:** viento y potencia en el tiempo (dos ejes y).
5. **Equivalencias:** hogares abastecidos y CO₂ evitado. Usar constantes editables en `presets.js` y mostrarlas como supuestos:
   - Consumo de un hogar: 200 kWh/mes (supuesto).
   - Factor de emisión evitado: 0.5 kg CO₂/kWh (supuesto).

Las unidades deben escalarse automáticamente (W, kW, MW; Wh, kWh, MWh).

## Sección "Cómo funciona"

Una sección plegable o una pestaña en la página que explique, en lenguaje claro:

- Por qué la potencia depende del cubo de la velocidad (ejemplo: duplicar el viento multiplica la potencia por 8).
- Qué es el límite de Betz.
- Por qué la altitud y la temperatura cambian la densidad del aire.
- Por qué las torres altas producen más.
- Qué es el factor de capacidad y valores típicos (25–45 %).
- Lista explícita de simplificaciones del modelo.

Mostrar las fórmulas principales (se pueden escribir en HTML/CSS sin librería de LaTeX).

## Diseño de la interfaz

- Layout de dos columnas en escritorio: controles a la izquierda, visualización a la derecha. Una columna en móvil.
- Paleta limpia con tonos de cielo/verde; soporte de modo oscuro con `prefers-color-scheme`.
- Tipografía legible en proyector (tamaño base ≥ 16 px; indicadores grandes).
- Los cambios en los sliders actualizan todo de inmediato (sin botón "Calcular").
- Accesible: etiquetas `<label>` en todos los controles, contraste suficiente, navegable con teclado.

## Fases de implementación

Implementar en este orden y verificar cada fase antes de seguir.

### Fase 1 — MVP
- `physics.js` con densidad, perfil de viento, potencia y curva de potencia.
- Sliders de viento, diámetro, potencia nominal y Cp.
- Tarjetas de indicadores instantáneos.
- Gráfica de la curva de potencia con punto actual.
- **Criterio:** al mover el viento de 0 a 30 m/s se ve 0 → crecimiento cúbico → meseta nominal → 0 tras el corte.

### Fase 2 — Ambiente
- Temperatura, altitud, altura de torre y terreno.
- Presets de turbina y de escenario.
- **Criterio:** subir la altitud reduce la potencia; subir la torre la aumenta.

### Fase 3 — Tiempo
- `wind.js` con serie diaria + turbulencia y RNG con semilla.
- Modo Tiempo con Play/Pausa/Reiniciar, energía acumulada, factor de capacidad y gráfica temporal.
- **Criterio:** la misma semilla produce siempre la misma energía total.

### Fase 4 — Pulido y extras
- Turbina SVG animada.
- Sección "Cómo funciona".
- Equivalencias (hogares, CO₂).
- Estimación anual con Weibull.
- Parque de N turbinas con pérdidas por estela.

### Fase 5 — Despliegue
- `README.md` con descripción, capturas, supuestos y pasos para Netlify Drop y GitHub Pages.
- Verificar que `index.html` funciona abierto desde un servidor estático simple (`python3 -m http.server`).

## Pruebas

`tests/physics.test.js` usando `node --test` (Node solo para desarrollo, no para desplegar). Casos mínimos:

| Caso | Esperado |
|---|---|
| ρ a 0 m, 15 °C | ≈ 1.225 kg/m³ (± 0.005) |
| ρ a 1000 m, 15 °C | ≈ 1.087 kg/m³ (± 0.005) |
| P_viento, D = 90 m, v = 10 m/s, ρ = 1.225 | ≈ 3.90 MW (± 1 %) |
| Potencia con v < v_arranque | 0 |
| Potencia con v ≥ v_corte | 0 |
| Potencia nunca supera P_nominal | verdadero para v en 0–30 |
| Cp efectivo nunca supera 0.593 | verdadero |
| v_hub con H = h_ref | igual a v_ref |
| RNG con la misma semilla | misma secuencia |

## Fuera de alcance

- Datos meteorológicos reales o APIs de clima.
- Modelado de aspas (BEM), control de pitch detallado o dinámica estructural.
- Conexión a la red eléctrica, almacenamiento o costos (LCOE).
- Backend, base de datos o autenticación.

## Convenciones de código

- Comentarios en español, nombres de variables y funciones en inglés o español, pero consistentes en todo el proyecto.
- Funciones pequeñas y documentadas con JSDoc (unidades en cada parámetro).
- Sin números mágicos: constantes con nombre en `physics.js` o `presets.js`.
- Unidades SI internamente (m, m/s, W, J, K); conversión solo al mostrar.
