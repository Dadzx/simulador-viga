# Simulador 3D — Viga de pino pátula

Viga simplemente apoyada (L = 1000 mm, sección 30 × 10 mm) del proyecto de Mecánica de Sólidos UIS 2026.
React + react-three-fiber + drei. Física de Euler–Bernoulli por superposición (cargas puntuales + peso propio).

## Ejecutar
```bash
npm install
npm run dev      # abre http://localhost:5173
npm run build    # versión de producción en dist/
```

## Archivos
- `src/SimuladorViga.jsx` — todo el simulador: física, escena 3D e interfaz.
- `src/styles.css` — estilos de los paneles.
- `src/main.jsx` — punto de entrada.

## Física (unidades mm, N, MPa)
- Carga puntual P en a (b = L − a):
  - x ≤ a: δ = P·b·x·(L² − b² − x²) / (6EIL)
  - x > a: δ = P·a·(L − x)·(2Lx − x² − a²) / (6EIL)
- Peso propio: δ = w·x·(L³ − 2Lx² + x³) / (24EI), w = 0,001619 N/mm
- Reacciones: Ay = wL/2 + Σ P(L − a)/L ; By = wL/2 + Σ P·a/L
- La malla gira cada sección con la pendiente θ = atan(dδ/dx) (secciones planas).
- Agua pigmentada ≈ 1 kg/L; 1 lb = 500 g como en el informe.
