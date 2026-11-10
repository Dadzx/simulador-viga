// Simulador 3D de la viga de pino pátula — Proyecto de Mecánica de Sólidos UIS 2026
// Viga simplemente apoyada, L = 1000 mm, Euler–Bernoulli, superposición de cargas puntuales + peso propio.
import { useMemo, useRef, useState, useEffect } from "react";
import * as THREE from "three";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Environment, Lightformer, ContactShadows, Grid, Html } from "@react-three/drei";

/* ============================================================
   1. FÍSICA  (unidades: mm, N, MPa → N/mm²)
   ============================================================ */
export const LAB = {
  L: 1000,          // luz entre apoyos (mm)
  E: 9000,          // módulo de elasticidad de diseño NSR-10 (MPa)
  w: 0.001619,      // peso propio (N/mm), igual en ambas orientaciones (A = 300 mm²)
  Fb: 12.6,         // esfuerzo admisible a flexión, pino pátula NSR-10 Tabla G-B.6 (MPa)
  g: 9.81,
  rhoAgua: 1.0,     // agua pigmentada ≈ 1 kg/L
  lb: 0.5,          // en el informe 1 lb = 500 g
};

export const SECCIONES = {
  plano: { b: 30, h: 10, nombre: "De plano", dims: "30 × 10 mm" },
  canto: { b: 10, h: 30, nombre: "De canto", dims: "10 × 30 mm" },
};

// Datos del informe entregado (Tablas 6.1, 6.2 y 6.3), carga a 300 mm
export const PRACTICA = {
  plano: [
    { lb: 2,   an: [7.163, 8.144],  ft: [7.165, 8.122],  ex: [2.5, 3] },
    { lb: 2.5, an: [8.773, 9.929],  ft: [8.767, 9.918],  ex: [3.5, 4] },
    { lb: 3,   an: [10.376, 11.728], ft: [10.368, 11.714], ex: [4, 5] },
    { lb: 3.5, an: [11.978, 13.526], ft: [11.969, 13.511], ex: [5, 6] },
    { lb: 4,   an: [13.58, 15.325], ft: [13.573, 15.309], ex: [6.5, 7] },
  ],
  canto: [
    { lb: 6,  an: [2.211, 2.502], ft: [2.219, 2.5],   ex: [1, 1.5] },
    { lb: 7,  an: [2.577, 2.902], ft: [2.575, 2.898], ex: [1.5, 2] },
    { lb: 8,  an: [2.933, 3.301], ft: [2.931, 3.298], ex: [2, 2.5] },
    { lb: 9,  an: [3.289, 3.701], ft: [3.287, 3.697], ex: [2, 2.5] },
    { lb: 10, an: [3.645, 4.101], ft: [3.642, 4.096], ex: [2.5, 3] },
  ],
};

const N_SEG = 240; // divisiones de la malla a lo largo de la viga

// Deflexión (positiva hacia abajo) de una carga puntual P a una distancia a del apoyo A
function deflPuntual(P, a, x, EI, L) {
  const b = L - a;
  if (x <= a) return (P * b * x * (L * L - b * b - x * x)) / (6 * EI * L);
  return (P * a * (L - x) * (2 * L * x - x * x - a * a)) / (6 * EI * L);
}
// Deflexión por carga uniforme w
function deflUniforme(w, x, EI, L) {
  return (w * x * (L ** 3 - 2 * L * x * x + x ** 3)) / (24 * EI);
}

export function resolverViga({ E, b, h, cargas, pesoPropio }) {
  const L = LAB.L;
  const I = (b * h ** 3) / 12;
  const EI = E * I;
  const w = pesoPropio ? LAB.w : 0;
  const v = (x) => cargas.reduce((s, c) => s + deflPuntual(c.P, c.a, x, EI, L), 0) + deflUniforme(w, x, EI, L);
  const Ay = (w * L) / 2 + cargas.reduce((s, c) => s + (c.P * (L - c.a)) / L, 0);
  const By = (w * L) / 2 + cargas.reduce((s, c) => s + (c.P * c.a) / L, 0);
  const M = (x) => Ay * x - (w * x * x) / 2 - cargas.reduce((s, c) => s + (x > c.a ? c.P * (x - c.a) : 0), 0);

  const xs = new Float32Array(N_SEG + 1), vs = new Float32Array(N_SEG + 1), ths = new Float32Array(N_SEG + 1), Ms = new Float32Array(N_SEG + 1);
  const d = 0.25;
  for (let i = 0; i <= N_SEG; i++) {
    const x = (L * i) / N_SEG;
    xs[i] = x; vs[i] = v(x); ths[i] = (v(x + d) - v(x - d)) / (2 * d); Ms[i] = M(x);
  }
  // máximos con muestreo fino
  let vMax = 0, xMax = 0, MMax = 0, xMMax = 0;
  for (let i = 0; i <= 4000; i++) {
    const x = (L * i) / 4000;
    const vi = v(x), Mi = M(x);
    if (vi > vMax) { vMax = vi; xMax = x; }
    if (Math.abs(Mi) > Math.abs(MMax)) { MMax = Mi; xMMax = x; }
  }
  const sigma = (Math.abs(MMax) * (h / 2)) / I;
  return { I, EI, w, Ay, By, xs, vs, ths, Ms, vMax, xMax, MMax, xMMax, sigma, v300: v(300), v500: v(500), deflAt: v };
}

/* ============================================================
   2. UTILIDADES
   ============================================================ */
const fmt = (n, d = 2) => Number(n).toLocaleString("es-CO", { minimumFractionDigits: d, maximumFractionDigits: d });
const MM = 0.001; // mm → m (unidad de la escena)
const PISO = -0.62;
const COLOR = { holo: "#6FD8EE", carga: "#F08A3E", reac: "#7CE3A6", agua: "#E2742B", w: "#A9C4E4" };

function muestrearCampo(arr, xmm) {
  const s = Math.min(Math.max((xmm / LAB.L) * N_SEG, 0), N_SEG);
  const i = Math.min(Math.floor(s), N_SEG - 1), f = s - i;
  return arr[i] * (1 - f) + arr[i + 1] * f;
}

function texturaMadera() {
  const c = document.createElement("canvas");
  c.width = 2048; c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = "#E2C08C"; g.fillRect(0, 0, c.width, c.height);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 110; i++) {
    const y0 = rnd() * c.height, amp = 1 + rnd() * 4, fq = 0.002 + rnd() * 0.004, ph = rnd() * 6.28;
    g.strokeStyle = `rgba(${140 + rnd() * 30},${92 + rnd() * 20},${48},${0.06 + rnd() * 0.2})`;
    g.lineWidth = 0.4 + rnd() * 1.8;
    g.beginPath();
    for (let x = 0; x <= c.width; x += 16) {
      const y = y0 + Math.sin(x * fq + ph) * amp;
      x === 0 ? g.moveTo(x, y) : g.lineTo(x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/* ============================================================
   3. ESCENA 3D
   ============================================================ */

// Interpola suavemente el campo de deformación hacia la solución actual y lo comparte con toda la escena
function Motor({ sol, escala, campo, anatomia, anat }) {
  useFrame((_, dt) => {
    const k = 1 - Math.exp(-Math.min(dt, 0.05) * 7);
    const c = campo.current;
    let cambio = 0;
    for (let i = 0; i <= N_SEG; i++) {
      const tv = sol.vs[i] * MM * escala;
      const tt = Math.atan(sol.ths[i] * escala);
      const dv = (tv - c.v[i]) * k, dt2 = (tt - c.th[i]) * k;
      c.v[i] += dv; c.th[i] += dt2;
      cambio = Math.max(cambio, Math.abs(dv), Math.abs(dt2));
    }
    c.cambio = cambio;
    const objetivo = anatomia ? 1 : 0;
    anat.current += (objetivo - anat.current) * (1 - Math.exp(-Math.min(dt, 0.05) * 6));
  });
  return null;
}

function Viga({ sec, campo, anat, tex, z = 0, soloPesoPropio = null, opacidadBase = 1 }) {
  const bM = sec.b * MM, hM = sec.h * MM;
  const geo = useMemo(() => new THREE.BoxGeometry(1, hM, bM, N_SEG, 3, 3), [hM, bM]);
  const base = useMemo(() => geo.attributes.position.array.slice(), [geo]);
  const madera = useRef(), holo = useRef(), alambre = useRef();
  const primera = useRef(true);
  const ultimoRef = useRef(null);
  useEffect(() => { primera.current = true; }, [geo]);

  useFrame(() => {
    const c = campo.current;
    const pos = geo.attributes.position.array;
    const refCambio = soloPesoPropio && ultimoRef.current !== soloPesoPropio;
    if (primera.current || refCambio || (!soloPesoPropio && c.cambio > 1e-8)) {
      ultimoRef.current = soloPesoPropio;
      for (let i = 0; i < pos.length; i += 3) {
        const x0 = base[i], y0 = base[i + 1];
        const xmm = (x0 + 0.5) * LAB.L;
        const v = soloPesoPropio ? soloPesoPropio.v(xmm) : muestrearCampo(c.v, xmm);
        const t = soloPesoPropio ? soloPesoPropio.t(xmm) : muestrearCampo(c.th, xmm);
        pos[i] = x0 + y0 * Math.sin(t);
        pos[i + 1] = y0 * Math.cos(t) - v;
        pos[i + 2] = base[i + 2];
      }
      geo.attributes.position.needsUpdate = true;
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      primera.current = false;
    }
    const a = anat.current;
    if (madera.current) {
      madera.current.opacity = opacidadBase * (1 - a);
      madera.current.transparent = madera.current.opacity < 0.999;
      madera.current.depthWrite = madera.current.opacity > 0.5;
    }
    if (holo.current) holo.current.opacity = 0.16 * a;
    if (alambre.current) alambre.current.opacity = 0.32 * a;
  });

  return (
    <group position={[0, 0, z]}>
      <mesh geometry={geo} castShadow receiveShadow>
        <meshStandardMaterial ref={madera} map={tex} roughness={0.62} metalness={0} color={opacidadBase < 1 ? "#d8c6a6" : "#ffffff"} />
      </mesh>
      {opacidadBase === 1 && (
        <>
          <mesh geometry={geo}>
            <meshBasicMaterial ref={holo} color={COLOR.holo} transparent opacity={0} depthWrite={false} toneMapped={false} />
          </mesh>
          <mesh geometry={geo}>
            <meshBasicMaterial ref={alambre} color={COLOR.holo} wireframe transparent opacity={0} depthWrite={false} toneMapped={false} />
          </mesh>
        </>
      )}
    </group>
  );
}

function Banquito({ x, color, sec }) {
  const hM = sec.h * MM;
  const ySup = -hM / 2 - 0.011;           // centro de la varilla
  const yTapa = ySup - 0.011 - 0.0125;     // centro de la tapa
  const patas = [[0.11, 0.11], [-0.11, 0.11], [0.11, -0.11], [-0.11, -0.11]];
  const altoPata = yTapa - 0.0125 - PISO;
  return (
    <group>
      {/* varilla de acero corrugado que hace de apoyo */}
      <mesh position={[x > 0 ? 0.5 : -0.5, ySup, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[0.0055, 0.0055, 0.2, 20]} />
        <meshStandardMaterial color="#8d939b" metalness={0.85} roughness={0.35} />
      </mesh>
      <group position={[x, 0, 0]}>
        <mesh position={[0, yTapa, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.17, 0.165, 0.025, 48]} />
          <meshStandardMaterial color={color} roughness={0.35} metalness={0.05} />
        </mesh>
        {patas.map(([px, pz], i) => (
          <mesh key={i} position={[px, yTapa - 0.0125 - altoPata / 2, pz]} castShadow>
            <cylinderGeometry args={[0.009, 0.009, altoPata, 12]} />
            <meshStandardMaterial color="#1b1e24" metalness={0.6} roughness={0.4} />
          </mesh>
        ))}
        <mesh position={[0, PISO + 0.16, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.155, 0.006, 10, 48]} />
          <meshStandardMaterial color="#1b1e24" metalness={0.6} roughness={0.4} />
        </mesh>
      </group>
    </group>
  );
}

// Botella PET (≤ 2,5 L) o balde (> 2,5 L) con agua pigmentada, colgando de una cuerda
function Recipiente({ carga, sec, campo, anat }) {
  const grupo = useRef(), agua = useRef(), envase = useRef();
  const hM = sec.h * MM;
  const esBalde = carga.vol > 2.5;
  const cuerda = esBalde ? 0.06 : 0.1;

  const perfil = useMemo(() => {
    if (esBalde) {
      return [[0.0, 0], [0.095, 0], [0.12, 0.22], [0.123, 0.22], [0.098, 0.004], [0.0, 0.004]].map(([r, y]) => new THREE.Vector2(r, y));
    }
    const p = [[0, 0], [0.045, 0], [0.056, 0.012], [0.056, 0.25], [0.04, 0.29], [0.015, 0.315], [0.015, 0.335]];
    return p.map(([r, y]) => new THREE.Vector2(r, y));
  }, [esBalde]);
  const altoEnvase = esBalde ? 0.22 : 0.335;

  // altura del agua
  const area = esBalde ? Math.PI * 0.105 ** 2 : Math.PI * 0.054 ** 2;
  const hAgua = Math.min((carga.vol / 1000) / area, esBalde ? 0.21 : 0.25);
  const rAgua = esBalde ? 0.096 + (0.022 * hAgua) / 0.22 : 0.0535;

  useFrame(() => {
    const v = muestrearCampo(campo.current.v, carga.a);
    if (grupo.current) grupo.current.position.y = -hM / 2 - v;
    const a = anat.current;
    if (agua.current) agua.current.opacity = 0.88 * (1 - 0.75 * a);
    if (envase.current) envase.current.opacity = opEnvase * (1 - 0.6 * a);
  });

  const yBase = -cuerda - (esBalde ? 0.115 : 0) - altoEnvase;
  const opEnvase = esBalde ? 0.6 : 0.28;
  return (
    <group ref={grupo} position={[carga.a * MM - 0.5, 0, 0]}>
      <mesh position={[0, -cuerda / 2, 0]}>
        <cylinderGeometry args={[0.0012, 0.0012, cuerda, 6]} />
        <meshStandardMaterial color="#d9b54a" roughness={0.8} />
      </mesh>
      {esBalde && (
        <mesh position={[0, -cuerda - 0.115, 0]}>
          <torusGeometry args={[0.115, 0.003, 8, 40, Math.PI]} />
          <meshStandardMaterial color="#c9ced6" metalness={0.7} roughness={0.3} />
        </mesh>
      )}
      <group position={[0, yBase, 0]}>
        <mesh castShadow>
          <latheGeometry args={[perfil, 48]} />
          <meshPhysicalMaterial ref={envase} color={esBalde ? "#2f8fe0" : "#dff1ff"} transparent opacity={esBalde ? 0.6 : 0.28} roughness={0.12} metalness={0} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
        {hAgua > 0.001 && (
          <mesh position={[0, 0.006 + hAgua / 2, 0]}>
            <cylinderGeometry args={[rAgua, esBalde ? 0.094 : 0.0535, hAgua, 40]} />
            <meshStandardMaterial ref={agua} color={COLOR.agua} transparent opacity={0.88} roughness={0.15} emissive="#5a1e05" emissiveIntensity={0.35} />
          </mesh>
        )}
        {!esBalde && (
          <mesh position={[0, 0.338, 0]}>
            <cylinderGeometry args={[0.017, 0.017, 0.016, 20]} />
            <meshStandardMaterial color="#2c8a3e" roughness={0.5} />
          </mesh>
        )}
      </group>
    </group>
  );
}

function Flecha({ largo, color, radio = 0.0032, opacidad = 0.95 }) {
  // flecha que apunta hacia +y con la punta en el origen
  const cabeza = Math.min(0.028, largo * 0.38);
  const cuerpo = Math.max(largo - cabeza, 0.001);
  return (
    <group>
      <mesh position={[0, -cabeza - cuerpo / 2, 0]}>
        <cylinderGeometry args={[radio, radio, cuerpo, 12]} />
        <meshBasicMaterial color={color} transparent opacity={opacidad} toneMapped={false} />
      </mesh>
      <mesh position={[0, -cabeza / 2, 0]}>
        <coneGeometry args={[radio * 3.2, cabeza, 18]} />
        <meshBasicMaterial color={color} transparent opacity={opacidad} toneMapped={false} />
      </mesh>
    </group>
  );
}

// Flecha hacia abajo cuya punta sigue la cara superior deformada de la viga
function FlechaSobreViga({ xmm, largo, color, radio, campo, sec, children, offset = 0 }) {
  const ref = useRef();
  const hM = sec.h * MM;
  useFrame(() => {
    if (ref.current) ref.current.position.y = hM / 2 + offset - muestrearCampo(campo.current.v, xmm);
  });
  return (
    <group ref={ref} position={[xmm * MM - 0.5, hM / 2, 0]}>
      <group rotation={[0, 0, Math.PI]}>
        <Flecha largo={largo} color={color} radio={radio} />
      </group>
      {children}
    </group>
  );
}

const largoFuerza = (F) => Math.min(0.04 + Math.sqrt(Math.max(F, 0)) * 0.022, 0.2);

function Etiqueta({ children, tono = "holo", posicion }) {
  return (
    <Html position={posicion} center zIndexRange={[12, 0]} style={{ pointerEvents: "none" }}>
      <div className={`tag tag-${tono}`}>{children}</div>
    </Html>
  );
}

function Anatomia({ sol, sec, cargas, campo, anat, pesoPropio, mostrar }) {
  const raiz = useRef();
  const curva = useRef();
  const hM = sec.h * MM, bM = sec.b * MM;
  const curvaGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array((N_SEG + 1) * 3), 3));
    return g;
  }, []);
  const lineaCurva = useMemo(() => new THREE.Line(curvaGeo, new THREE.LineBasicMaterial({ color: COLOR.holo, transparent: true, opacity: 1, toneMapped: false })), [curvaGeo]);

  // diagrama de momento flector (detrás de la viga, del lado de la tensión)
  const zM = -(bM / 2 + 0.07);
  const alturaM = 0.13;
  const { geoM, lineaM } = useMemo(() => {
    const Mmax = Math.max(Math.abs(sol.MMax), 1e-9);
    const pos = [];
    const borde = [];
    for (let i = 0; i < N_SEG; i++) {
      const x1 = (sol.xs[i] / LAB.L) - 0.5, x2 = (sol.xs[i + 1] / LAB.L) - 0.5;
      const y1 = -(sol.Ms[i] / Mmax) * alturaM - 0.03, y2 = -(sol.Ms[i + 1] / Mmax) * alturaM - 0.03;
      pos.push(x1, -0.03, 0, x2, -0.03, 0, x2, y2, 0, x1, -0.03, 0, x2, y2, 0, x1, y1, 0);
    }
    for (let i = 0; i <= N_SEG; i++) borde.push(new THREE.Vector3(sol.xs[i] / LAB.L - 0.5, -(sol.Ms[i] / Mmax) * alturaM - 0.03, 0));
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    const lg = new THREE.BufferGeometry().setFromPoints(borde);
    return { geoM: g, lineaM: new THREE.Line(lg, new THREE.LineBasicMaterial({ color: "#B79CFF", transparent: true, opacity: 0.9, toneMapped: false })) };
  }, [sol]);

  useFrame(() => {
    const a = anat.current;
    if (raiz.current) {
      raiz.current.visible = a > 0.02;
      raiz.current.scale.y = 0.25 + 0.75 * a;
    }
    const p = curvaGeo.attributes.position.array;
    const c = campo.current;
    for (let i = 0; i <= N_SEG; i++) {
      p[i * 3] = i / N_SEG - 0.5;
      p[i * 3 + 1] = -c.v[i];
      p[i * 3 + 2] = bM / 2 + 0.004;
    }
    curvaGeo.attributes.position.needsUpdate = true;
  });

  const yApoyo = -hM / 2 - 0.022;
  const flechasW = pesoPropio ? Array.from({ length: 19 }, (_, i) => 50 * (i + 1)).filter((x) => !cargas.some((c) => Math.abs(c.a - x) < 30)) : [];

  return (
    <group ref={raiz} visible={false}>
      <primitive object={lineaCurva} />
      {/* reacciones */}
      {[{ x: -0.5, F: sol.Ay, n: "A" }, { x: 0.5, F: sol.By, n: "B" }].map((r) => (
        <group key={r.n} position={[r.x, yApoyo, 0]}>
          <Flecha largo={largoFuerza(r.F)} color={COLOR.reac} radio={0.0036} />
          {mostrar && (<Etiqueta tono="reac" posicion={[0, -largoFuerza(r.F) - 0.03, 0]}>
            {r.n}<sub>y</sub> = {fmt(r.F, 2)} N
          </Etiqueta>)}
        </group>
      ))}
      {/* cargas puntuales */}
      {cargas.map((c, i) => (
        <FlechaSobreViga key={i} xmm={c.a} largo={largoFuerza(c.P)} color={COLOR.carga} radio={0.0036} campo={campo} sec={sec} offset={0.004}>
          {mostrar && (<Etiqueta tono="carga" posicion={[0, largoFuerza(c.P) + 0.03, 0]}>
            P{cargas.length > 1 ? <sub>{i + 1}</sub> : null} = {fmt(c.P, 2)} N · a = {fmt(c.a, 0)} mm
          </Etiqueta>)}
        </FlechaSobreViga>
      ))}
      {/* peso propio */}
      {flechasW.map((x) => (
        <FlechaSobreViga key={x} xmm={x} largo={0.032} color={COLOR.w} radio={0.0014} campo={campo} sec={sec} offset={0.003} />
      ))}
      {pesoPropio && mostrar && (
        <Etiqueta tono="w" posicion={[0.36, hM / 2 + 0.06, 0]}>w = 0,001619 N/mm</Etiqueta>
      )}
      {/* diagrama de momento */}
      <group position={[0, 0, zM]}>
        <mesh geometry={geoM}>
          <meshBasicMaterial color="#B79CFF" transparent opacity={0.16} side={THREE.DoubleSide} depthWrite={false} toneMapped={false} />
        </mesh>
        <primitive object={lineaM} />
        {mostrar && (<Etiqueta tono="m" posicion={[sol.xMMax / LAB.L - 0.5, -(Math.abs(sol.MMax) / Math.max(Math.abs(sol.MMax), 1e-9)) * alturaM - 0.065, 0]}>
          M<sub>máx</sub> = {fmt(sol.MMax / 1000, 3)} N·m
        </Etiqueta>)}
      </group>
      {/* deflexión máxima */}
      {mostrar && (<Etiqueta tono="holo" posicion={[sol.xMax / LAB.L - 0.5, -hM / 2 - 0.05, bM / 2 + 0.01]}>
        δ<sub>máx</sub> = {fmt(sol.vMax, 2)} mm
      </Etiqueta>)}
    </group>
  );
}

function Escena({ sol, sec, cargas, escala, anatomia, pesoPropio, referencia, controles }) {
  const campo = useRef({ v: new Float32Array(N_SEG + 1), th: new Float32Array(N_SEG + 1), cambio: 1 });
  const anat = useRef(0);
  const tex = useMemo(() => texturaMadera(), []);

  // la regleta de referencia solo se deforma por su peso propio, igual que en el montaje
  const solRef = useMemo(() => resolverViga({ E: sol.E, b: sec.b, h: sec.h, cargas: [], pesoPropio: true }), [sol.E, sec]);
  const pesoRef = useMemo(() => ({
    v: (xmm) => solRef.deflAt(xmm) * MM * escala,
    t: (xmm) => Math.atan(((solRef.deflAt(xmm + 0.25) - solRef.deflAt(xmm - 0.25)) / 0.5) * escala),
  }), [solRef, escala]);

  return (
    <>
      <color attach="background" args={["#0D131D"]} />
      <fog attach="fog" args={["#0D131D", 3.2, 7]} />
      <Motor sol={sol} escala={escala} campo={campo} anatomia={anatomia} anat={anat} />

      <ambientLight intensity={0.25} />
      <directionalLight position={[1.2, 2.2, 1.4]} intensity={1.4} castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}>
        <orthographicCamera attach="shadow-camera" args={[-1.2, 1.2, 1.2, -1.2, 0.1, 6]} />
      </directionalLight>
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={2.2} position={[0, 3, 1]} scale={[4, 1.2, 1]} rotation-x={Math.PI / 2} />
        <Lightformer form="rect" intensity={1.2} position={[-3, 1, 1]} scale={[2, 2, 1]} rotation-y={Math.PI / 2} />
        <Lightformer form="rect" intensity={0.9} position={[3, 1, -1]} scale={[2, 2, 1]} rotation-y={-Math.PI / 2} />
        <Lightformer form="ring" color="#6FD8EE" intensity={0.6} position={[0, 1, -3]} scale={2} />
      </Environment>

      <Viga sec={sec} campo={campo} anat={anat} tex={tex} />
      {referencia && (
        <Viga sec={sec} campo={campo} anat={anat} tex={tex} z={-(sec.b * MM + 0.016)} soloPesoPropio={pesoRef} opacidadBase={0.55} />
      )}
      <Banquito x={-0.56} color="#F2B705" sec={sec} />
      <Banquito x={0.56} color="#62C93A" sec={sec} />
      {cargas.map((c, i) => (c.vol > 0.001 ? <Recipiente key={i + (c.vol > 2.5 ? "b" : "p")} carga={c} sec={sec} campo={campo} anat={anat} /> : null))}
      <Anatomia sol={sol} sec={sec} cargas={cargas} campo={campo} anat={anat} pesoPropio={pesoPropio} mostrar={anatomia} />

      <ContactShadows position={[0, PISO + 0.001, 0]} opacity={0.55} scale={3} blur={2.4} far={1} resolution={1024} color="#000000" />
      <Grid position={[0, PISO, 0]} infiniteGrid cellSize={0.1} sectionSize={0.5} cellThickness={0.6} sectionThickness={1.1} cellColor="#1E2A3C" sectionColor="#2E4260" fadeDistance={5} fadeStrength={1.4} />

      <OrbitControls ref={controles} makeDefault enableDamping dampingFactor={0.08} target={[0, -0.2, 0]} minDistance={0.25} maxDistance={4.5} maxPolarAngle={Math.PI * 0.62} />
    </>
  );
}

/* ============================================================
   4. INTERFAZ
   ============================================================ */
function Deslizador({ id, etiqueta, valor, min, max, paso, onChange, sufijo }) {
  return (
    <div className="campo">
      <div className="campo-cab">
        <label htmlFor={id}>{etiqueta}</label>
        <output htmlFor={id}>{sufijo(valor)}</output>
      </div>
      <input id={id} type="range" min={min} max={max} step={paso} value={valor} onChange={(e) => onChange(parseFloat(e.target.value))} />
    </div>
  );
}

function Interruptor({ id, etiqueta, valor, onChange }) {
  return (
    <label className="interruptor" htmlFor={id}>
      <input id={id} type="checkbox" checked={valor} onChange={(e) => onChange(e.target.checked)} />
      <span className="pista" aria-hidden="true"><span className="perilla" /></span>
      <span>{etiqueta}</span>
    </label>
  );
}

function ControlRecipiente({ n, rec, setRec }) {
  const masa = rec.vol * LAB.rhoAgua;
  return (
    <div className="bloque-rec">
      <div className="rec-cab">
        <span className="rec-num">{n}</span>
        <span className="rec-tipo">{rec.vol > 2.5 ? "Balde" : "Botella"} con agua pigmentada</span>
      </div>
      <Deslizador id={`vol${n}`} etiqueta="Volumen de agua" valor={rec.vol} min={0} max={6} paso={0.05} onChange={(v) => setRec({ ...rec, vol: v })} sufijo={(v) => `${fmt(v, 2)} L`} />
      <Deslizador id={`pos${n}`} etiqueta="Posición desde el apoyo A" valor={rec.a} min={50} max={950} paso={5} onChange={(v) => setRec({ ...rec, a: v })} sufijo={(v) => `${fmt(v, 0)} mm`} />
      <p className="lectura mono">{fmt(masa, 2)} kg · {fmt(masa * LAB.g, 2)} N · {fmt(masa / LAB.lb, 1)} lb</p>
    </div>
  );
}

function GraficaCargaDeflexion({ orient, sec, E, pesoPropio, r1, r2, usarR2, sol }) {
  const P_MAX = 50;
  const W = 264, H = 168;
  const pad = { l: 30, r: 10, t: 10, b: 26 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;

  // Curvas calculadas con resolverViga de P = 0 a 50 N
  const muestras = useMemo(() => {
    const pasos = 25;
    const extra = usarR2 ? [{ ...r2, P: r2.vol * LAB.rhoAgua * LAB.g }] : [];
    const pts = [];
    for (let i = 0; i <= pasos; i++) {
      const P = (P_MAX * i) / pasos;
      const res = resolverViga({
        E,
        b: sec.b,
        h: sec.h,
        cargas: [{ a: r1.a, P }, ...extra],
        pesoPropio,
      });
      pts.push({ P, v300: res.v300, v500: res.v500 });
    }
    return pts;
  }, [E, sec, r1.a, r2, usarR2, pesoPropio]);

  // Puntos de la práctica (analítico y ensayo en 300 mm y 500 mm)
  const ptsPractica = useMemo(() => {
    return PRACTICA[orient].map((p) => ({
      lb: p.lb,
      P: p.lb * LAB.lb * LAB.rhoAgua * LAB.g,
      an300: p.an[0],
      an500: p.an[1],
      ex300: p.ex[0],
      ex500: p.ex[1],
    }));
  }, [orient]);

  const PActual = r1.vol * LAB.rhoAgua * LAB.g;

  // Escala vertical dinámica en mm
  const yMax = useMemo(() => {
    let m = Math.max(sol.v300, sol.v500, 1);
    for (const s of muestras) m = Math.max(m, s.v300, s.v500);
    for (const p of ptsPractica) m = Math.max(m, p.an500, p.ex500);
    const paso = m <= 6 ? 1 : m <= 15 ? 2.5 : 5;
    return Math.ceil((m * 1.08) / paso) * paso;
  }, [muestras, ptsPractica, sol.v300, sol.v500]);

  const xPx = (P) => pad.l + (Math.min(Math.max(P, 0), P_MAX) / P_MAX) * plotW;
  const yPx = (v) => pad.t + plotH - (Math.min(Math.max(v, 0), yMax) / yMax) * plotH;

  const ruta300 = muestras.map((s, i) => `${i === 0 ? "M" : "L"}${xPx(s.P).toFixed(1)},${yPx(s.v300).toFixed(1)}`).join(" ");
  const ruta500 = muestras.map((s, i) => `${i === 0 ? "M" : "L"}${xPx(s.P).toFixed(1)},${yPx(s.v500).toFixed(1)}`).join(" ");

  const ticksX = [0, 10, 20, 30, 40, 50];
  const ticksY = [0, yMax / 2, yMax];
  const xAct = xPx(PActual);

  return (
    <div className="grafica-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="grafica-svg" role="img" aria-label="Gráfica carga contra deflexión en 300 mm y 500 mm">
        {/* Cuadrícula y ejes */}
        {ticksY.map((yv, i) => {
          const y = yPx(yv);
          return (
            <g key={i}>
              <line x1={pad.l} y1={y} x2={W - pad.r} y2={y} className="graf-grid" />
              <text x={pad.l - 5} y={y + 3} textAnchor="end" className="graf-tick">{fmt(yv, yMax % 1 !== 0 ? 1 : 0)}</text>
            </g>
          );
        })}
        {ticksX.map((xv) => {
          const x = xPx(xv);
          return (
            <g key={xv}>
              <line x1={x} y1={pad.t} x2={x} y2={pad.t + plotH} className="graf-grid" />
              <text x={x} y={H - 12} textAnchor="middle" className="graf-tick">{xv}</text>
            </g>
          );
        })}
        <text x={pad.l + plotW / 2} y={H - 1} textAnchor="middle" className="graf-eje">P (N)</text>
        <text x={9} y={pad.t + plotH / 2} textAnchor="middle" transform={`rotate(-90 9 ${pad.t + plotH / 2})`} className="graf-eje">δ (mm)</text>

        {/* Curvas del simulador */}
        <path d={ruta300} fill="none" stroke="var(--reac)" strokeWidth="1.8" />
        <path d={ruta500} fill="none" stroke="var(--holo)" strokeWidth="1.8" />

        {/* Puntos de la práctica: Analítico (círculos huecos) y Ensayo (rombos) */}
        {ptsPractica.map((p) => {
          const xp = xPx(p.P);
          return (
            <g key={p.lb}>
              <circle cx={xp} cy={yPx(p.an300)} r="2.6" fill="var(--bg)" stroke="var(--reac)" strokeWidth="1.3">
                <title>{`Analítico 300 mm (${p.lb} lb): ${fmt(p.an300, 2)} mm`}</title>
              </circle>
              <circle cx={xp} cy={yPx(p.an500)} r="2.6" fill="var(--bg)" stroke="var(--holo)" strokeWidth="1.3">
                <title>{`Analítico 500 mm (${p.lb} lb): ${fmt(p.an500, 2)} mm`}</title>
              </circle>
              <polygon
                points={`${xp},${yPx(p.ex300) - 3.2} ${xp + 3.2},${yPx(p.ex300)} ${xp},${yPx(p.ex300) + 3.2} ${xp - 3.2},${yPx(p.ex300)}`}
                fill="var(--agua)"
                opacity="0.75"
              >
                <title>{`Ensayo 300 mm (${p.lb} lb): ${fmt(p.ex300, 1)} mm`}</title>
              </polygon>
              <polygon
                points={`${xp},${yPx(p.ex500) - 3.2} ${xp + 3.2},${yPx(p.ex500)} ${xp},${yPx(p.ex500) + 3.2} ${xp - 3.2},${yPx(p.ex500)}`}
                fill="var(--agua)"
              >
                <title>{`Ensayo 500 mm (${p.lb} lb): ${fmt(p.ex500, 1)} mm`}</title>
              </polygon>
            </g>
          );
        })}

        {/* Línea y puntos de la carga actual del simulador */}
        <line x1={xAct} y1={pad.t} x2={xAct} y2={pad.t + plotH} stroke="var(--agua)" strokeWidth="1" strokeDasharray="3 3" opacity="0.7" />
        <circle cx={xAct} cy={yPx(sol.v300)} r="4" fill="var(--reac)" stroke="var(--bg)" strokeWidth="1.4">
          <title>{`Actual 300 mm (P = ${fmt(PActual, 2)} N): ${fmt(sol.v300, 3)} mm`}</title>
        </circle>
        <circle cx={xAct} cy={yPx(sol.v500)} r="4" fill="var(--holo)" stroke="var(--bg)" strokeWidth="1.4">
          <title>{`Actual 500 mm (P = ${fmt(PActual, 2)} N): ${fmt(sol.v500, 3)} mm`}</title>
        </circle>
      </svg>

      <div className="grafica-leyenda">
        <span><i className="ley-linea ley-500" />δ 500 mm</span>
        <span><i className="ley-linea ley-300" />δ 300 mm</span>
        <span><i className="ley-pto ley-act" />Actual</span>
        <span><i className="ley-pto ley-an" />Analítico</span>
        <span><i className="ley-rombo" />Ensayo</span>
      </div>
    </div>
  );
}

export default function SimuladorViga() {
  const [orient, setOrient] = useState("plano");
  const [r1, setR1] = useState({ vol: 1.0, a: 300 });
  const [r2, setR2] = useState({ vol: 0.5, a: 700 });
  const [usarR2, setUsarR2] = useState(false);
  const [E, setE] = useState(LAB.E);
  const [pesoPropio, setPesoPropio] = useState(true);
  const [escala, setEscala] = useState(1);
  const [anatomia, setAnatomia] = useState(false);
  const [referencia, setReferencia] = useState(true);
  const controles = useRef();

  const sec = SECCIONES[orient];
  const cargas = useMemo(() => {
    const lista = [{ ...r1, P: r1.vol * LAB.rhoAgua * LAB.g }];
    if (usarR2) lista.push({ ...r2, P: r2.vol * LAB.rhoAgua * LAB.g });
    return lista;
  }, [r1, r2, usarR2]);
  const sol = useMemo(() => ({ ...resolverViga({ E, b: sec.b, h: sec.h, cargas, pesoPropio }), E }), [E, sec, cargas, pesoPropio]);

  const ensayo = PRACTICA[orient].find((p) => !usarR2 && Math.abs(r1.a - 300) < 0.5 && Math.abs(r1.vol - p.lb * LAB.lb) < 0.001 && E === LAB.E && pesoPropio);
  const usoFb = sol.sigma / LAB.Fb;
  const estado = usoFb < 0.8 ? { cls: "ok", txt: "Rango elástico" } : usoFb <= 1 ? { cls: "warn", txt: "Cerca del límite" } : { cls: "bad", txt: "Supera Fb" };

  const cargarEnsayo = (o, lb) => {
    setOrient(o); setUsarR2(false); setE(LAB.E); setPesoPropio(true);
    setR1({ vol: lb * LAB.lb, a: 300 });
  };
  const vista = (tipo) => {
    const c = controles.current;
    if (!c) return;
    if (tipo === "frontal") { c.object.position.set(0, -0.12, 1.95); c.target.set(0, -0.12, 0); }
    else { c.object.position.set(0.7, 0.26, 1.85); c.target.set(0, -0.2, 0); }
    c.update();
  };

  return (
    <div className="app">
      <div className="escenario">
        <Canvas shadows dpr={[1, 2]} camera={{ position: [0.7, 0.26, 1.85], fov: 36, near: 0.01, far: 30 }} gl={{ antialias: true }}>
          <Escena sol={sol} sec={sec} cargas={cargas} escala={escala} anatomia={anatomia} pesoPropio={pesoPropio} referencia={referencia} controles={controles} />
        </Canvas>
      </div>

      <header className="marca">
        <p className="ceja">Simulador 3D · Mecánica de Sólidos UIS 2026</p>
        <h1>Viga de pino pátula</h1>
        <p className="sub">{sec.nombre} · {sec.dims} · L = 1000 mm · E = {fmt(E, 0)} MPa</p>
      </header>

      <aside className="panel controles" aria-label="Controles">
        <section>
          <h2>Sección transversal</h2>
          <div className="segmentado" role="group" aria-label="Orientación de la sección">
            {Object.entries(SECCIONES).map(([k, s]) => (
              <button key={k} type="button" className={orient === k ? "activo" : ""} aria-pressed={orient === k} onClick={() => setOrient(k)}>
                <span className={`icono-sec icono-${k}`} aria-hidden="true" />
                {s.nombre}<small>{s.dims}</small>
              </button>
            ))}
          </div>
        </section>
        <section>
          <h2>Ensayos de la práctica <small>carga a 300 mm</small></h2>
          <div className="chips">
            {PRACTICA[orient].map((p) => (
              <button key={p.lb} type="button" className={ensayo && ensayo.lb === p.lb ? "chip activo" : "chip"} onClick={() => cargarEnsayo(orient, p.lb)}>
                {fmt(p.lb * LAB.lb, 2).replace(/,?0+$/, "")} kg
              </button>
            ))}
          </div>
        </section>
        <section>
          <h2>Recipientes</h2>
          <ControlRecipiente n={1} rec={r1} setRec={setR1} />
          <Interruptor id="usar-r2" etiqueta="Agregar un segundo recipiente" valor={usarR2} onChange={setUsarR2} />
          {usarR2 && <ControlRecipiente n={2} rec={r2} setRec={setR2} />}
        </section>
        <section>
          <h2>Material y vista</h2>
          <Deslizador id="modulo" etiqueta="Módulo de elasticidad E" valor={E} min={5000} max={16000} paso={100} onChange={setE} sufijo={(v) => `${fmt(v, 0)} MPa`} />
          <Interruptor id="peso" etiqueta="Incluir peso propio (0,001619 N/mm)" valor={pesoPropio} onChange={setPesoPropio} />
          <Deslizador id="escala" etiqueta="Escala de la deformación" valor={escala} min={1} max={10} paso={1} onChange={setEscala} sufijo={(v) => (v === 1 ? "×1 · real" : `×${v}`)} />
          <Interruptor id="ref" etiqueta="Mostrar regleta de referencia" valor={referencia} onChange={setReferencia} />
        </section>
      </aside>

      <aside className="panel datos" aria-label="Resultados">
        <section>
          <h2>Deflexión máxima</h2>
          <p className="cifra mono">{fmt(sol.vMax, 2)}<span> mm</span></p>
          <p className="nota">en x = {fmt(sol.xMax, 0)} mm · L/δ = {fmt(LAB.L / Math.max(sol.vMax, 1e-9), 0)}</p>
        </section>
        <section className="rejilla">
          <div><span>δ en 300 mm</span><b className="mono">{fmt(sol.v300, 3)} mm</b></div>
          <div><span>δ en 500 mm</span><b className="mono">{fmt(sol.v500, 3)} mm</b></div>
          <div><span>Reacción A<sub>y</sub></span><b className="mono">{fmt(sol.Ay, 3)} N</b></div>
          <div><span>Reacción B<sub>y</sub></span><b className="mono">{fmt(sol.By, 3)} N</b></div>
          <div><span>M<sub>máx</sub></span><b className="mono">{fmt(sol.MMax / 1000, 3)} N·m</b></div>
          <div><span>σ<sub>máx</sub></span><b className="mono">{fmt(sol.sigma, 2)} MPa</b></div>
        </section>
        <section>
          <div className="estado-fila">
            <span className={`pastilla ${estado.cls}`}>{estado.txt}</span>
            <span className="nota mono">{fmt(usoFb * 100, 0)} % de F<sub>b</sub> = 12,6 MPa</span>
          </div>
          <div className="barra" role="img" aria-label={`Esfuerzo al ${fmt(usoFb * 100, 0)} % del admisible`}>
            <span className={estado.cls} style={{ width: `${Math.min(usoFb, 1.2) / 1.2 * 100}%` }} />
            <i style={{ left: `${100 / 1.2}%` }} />
          </div>
        </section>
        <section className="seccion-props">
          <div><span>I</span><b className="mono">{fmt(sol.I, 0)} mm⁴</b></div>
          <div><span>EI</span><b className="mono">{fmt(sol.EI / 1e6, 1)} N·m²</b></div>
        </section>
        <section>
          <h2>Carga–deflexión <small>P = 0–50 N</small></h2>
          <GraficaCargaDeflexion orient={orient} sec={sec} E={E} pesoPropio={pesoPropio} r1={r1} r2={r2} usarR2={usarR2} sol={sol} />
        </section>
        <section>
          <h2>Contra la práctica</h2>
          {ensayo ? (
            <div className="tabla-wrap">
              <table className="mono">
                <thead><tr><th>mm</th><th>300</th><th>500</th></tr></thead>
                <tbody>
                  <tr className="sim"><td>Simulador</td><td>{fmt(sol.v300, 3)}</td><td>{fmt(sol.v500, 3)}</td></tr>
                  <tr><td>Analítico</td><td>{fmt(ensayo.an[0], 3)}</td><td>{fmt(ensayo.an[1], 3)}</td></tr>
                  <tr><td>Ftool</td><td>{fmt(ensayo.ft[0], 3)}</td><td>{fmt(ensayo.ft[1], 3)}</td></tr>
                  <tr className="exp"><td>Ensayo</td><td>{fmt(ensayo.ex[0], 1)}</td><td>{fmt(ensayo.ex[1], 1)}</td></tr>
                </tbody>
              </table>
            </div>
          ) : (
            <p className="nota">Elige un ensayo de la práctica para comparar el simulador con los valores del informe.</p>
          )}
        </section>
      </aside>

      <nav className="dock" aria-label="Vistas">
        <button type="button" className={anatomia ? "primario activo" : "primario"} aria-pressed={anatomia} onClick={() => setAnatomia(!anatomia)}>
          {anatomia ? "Salir de la anatomía" : "Anatomía estructural"}
        </button>
        <button type="button" onClick={() => vista("frontal")}>Vista frontal</button>
        <button type="button" onClick={() => vista("libre")}>Vista 3D</button>
      </nav>
    </div>
  );
}
