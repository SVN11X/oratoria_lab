# Auditoría técnica del repositorio (Fase 0)

Auditoría histórica. Para la revisión y cambios del 23 de octubre de 2026, consultar [AUDITORIA-V2](AUDITORIA-V2.md) y [STATUS](STATUS.md).

Fecha: 17 de octubre de 2026. Commit de partida: `6861e06` (rama `main`). Esta auditoría se hizo leyendo todo el código fuente y ejecutando las comprobaciones existentes antes de modificar nada. Las cifras de esta página son resultados reales del entorno de trabajo, no estimaciones.

## Cómo está construido

Oratoria Lab es un monorepositorio pnpm con una aplicación web React 19 + Vite 7 (`apps/web`), una base de escritorio Tauri 2 (`apps/desktop`) que reutiliza la misma interfaz, y nueve paquetes TypeScript (`packages/*`). No hay backend. La web se publica en GitHub Pages con rutas hash. Las sesiones de audio se guardan en IndexedDB (web) o SQLite (escritorio); el simulador de defensa guardaba sus informes aparte, en `localStorage`.

## Comprobaciones de partida

| Comprobación                                                  | Resultado real                                                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm install --frozen-lockfile`                              | Correcto (Node 22.22, pnpm 11.25)                                                                                                                                  |
| `pnpm check` (lint, typecheck, 70 tests, build, verify:build) | Correcto. Build de 86 recursos, 65,43 MiB                                                                                                                          |
| Playwright con Chromium local                                 | 8 de 9 pasan. Falla «copia completa restaura audio» por un selector ambiguo de la propia prueba (`getByRole('status')` encuentra dos elementos), no por la función |
| `cargo test` del escritorio                                   | Compila y pasan 3 de 3 pruebas Rust. Es la primera vez que se compilan: el estado anterior decía «no compilados ni ejecutados»                                     |
| Acceso a Hugging Face, ollama.com, storage.googleapis.com     | Bloqueado por la red de este entorno. No se pueden descargar pesos reales aquí                                                                                     |

## Estado real de cada módulo

Se usan seis categorías: **verificado** (ejecutado con éxito en una prueba real), **implementado sin verificar** (el código existe pero nunca se ejecutó en condiciones reales), **parcial**, **simulado**, **inoperativo** y **no implementado**.

| Módulo                                                 | Estado                                        | Evidencia y observaciones                                                                                                                                                 |
| ------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Grabación MediaRecorder                                | Verificado                                    | E2E con micrófono sintético de Chromium                                                                                                                                   |
| Importar, analizar, guardar, exportar y eliminar audio | Verificado                                    | E2E y pruebas unitarias del DSP                                                                                                                                           |
| Permiso de micrófono rechazado                         | Verificado                                    | E2E                                                                                                                                                                       |
| Copias completas y cifradas                            | Verificado (cifrada) / prueba rota (completa) | La prueba de copia completa falla por su selector, no por la función                                                                                                      |
| Uso sin conexión (Service Worker)                      | Verificado                                    | E2E de recarga offline                                                                                                                                                    |
| Simulador de defensa, ronda de preguntas escrita       | Verificado                                    | E2E sin servicios externos                                                                                                                                                |
| Transcripción Whisper en el navegador                  | Implementado sin verificar                    | El modelo nunca se ejecutó; requiere descarga desde Hugging Face                                                                                                          |
| Análisis de cámara MediaPipe                           | Implementado sin verificar                    | Solo se probó el motor WASM con un modelo falso                                                                                                                           |
| Transcripción en vivo del simulador                    | Implementado sin verificar                    | Usa el reconocimiento del navegador, que en Chrome/Edge envía audio a Google/Microsoft                                                                                    |
| Voces de la comisión                                   | Parcial                                       | Voces del sistema operativo (Web Speech). Suenan robóticas en muchos equipos; no hay voces neuronales locales                                                             |
| Comisión con IA                                        | Implementado sin verificar                    | Cliente `chat/completions` genérico; nunca se probó contra Ollama real                                                                                                    |
| Prácticas guiadas                                      | Parcial                                       | Seis escenarios con 6 preguntas fijas cada uno, respuesta escrita, sin voz ni IA                                                                                          |
| Defensa de tesis                                       | Duplicado                                     | Existe dos veces: como práctica guiada escrita (preguntas fijas) y como simulador independiente con voz, cámara e IA. Profundidad muy distinta                            |
| Comisión virtual                                       | Simulado                                      | Tres personajes SVG esquemáticos con estados fijos (atento, asiente, escribe). La atención del público es una simulación declarada                                        |
| Dificultad y temperamento                              | Mal acoplados                                 | Un único selector (amable, estándar, exigente) mezcla dificultad académica con hostilidad. No existe temperamento por profesor                                            |
| Material de la tesis                                   | Parcial con límite arbitrario                 | Un campo de texto de 20.000 caracteres y archivos .txt/.md/.tex de hasta 2 MB. Sin PDF, DOCX ni PPTX. El texto se recorta en silencio a 6.000 caracteres en el prompt     |
| Preguntas fundamentadas en la tesis                    | No implementado                               | Las preguntas por reglas usan términos frecuentes; no citan página ni sección                                                                                             |
| RAG local                                              | No implementado                               |                                                                                                                                                                           |
| Administrador de modelos                               | Parcial                                       | Solo Whisper y MediaPipe (descarga, verificación y borrado de CacheStorage). El LLM es un formulario de conexión; no lista, instala ni desinstala modelos de Ollama       |
| Inventario de modelos ya instalados                    | No implementado                               | La app no consulta qué modelos tiene el usuario en Ollama                                                                                                                 |
| Selección de modelos por función y perfiles            | No implementado                               |                                                                                                                                                                           |
| Detección de hardware                                  | No implementado                               |                                                                                                                                                                           |
| Rúbricas                                               | Parcial                                       | Editor completo pero exige configurar muchos campos; la valoración es manual con citas; no se conecta con el simulador                                                    |
| Estudio de grabación                                   | Aislado                                       | Mide y guarda, pero obliga a navegar a la sesión para ver resultados; no se integra con las prácticas                                                                     |
| Historial                                              | Desconectado                                  | Las sesiones de audio están en IndexedDB y los informes de defensa en `localStorage` (máximo 10). La pantalla de inicio no ve los informes de defensa                     |
| Seguimiento y entrenador adaptativo                    | No implementado                               | Solo una comparación con el intento anterior en el informe de defensa                                                                                                     |
| Escritorio: sesiones SQLite                            | Verificado (Rust)                             | 3 pruebas Rust pasan; la app nativa no se había compilado                                                                                                                 |
| Escritorio: comisión con IA y cámara                   | Inoperativo                                   | La CSP de `tauri.conf.json` no permite `localhost:11434` ni `storage.googleapis.com`, así que el escritorio no puede hablar con Ollama ni descargar los modelos de cámara |
| Diseño visual                                          | Funcional                                     | Paleta verde predominante con más de 200 colores fijos repartidos en el CSS, en lugar de tokens                                                                           |

## Problemas concretos encontrados en el código

1. `packages/defense/src/committee.ts`: `Difficulty = 'amable' | 'estandar' | 'exigente'` define a la vez cuánto sabe preguntar la comisión y cómo se comporta. Con «exigente» siempre hay más interrupciones y repreguntas, aunque el usuario quiera un profesor amable con preguntas difíciles.
2. `apps/web/src/pages/Defense.tsx`: el texto se recorta a 20.000 caracteres al cargarlo y `packages/defense/src/llm.ts` lo vuelve a recortar a 6.000 o 2.500 caracteres en cada prompt sin avisar.
3. `Defense.tsx` concentra 1.650 líneas con estado, temporizadores, voz, IA e informe en un solo componente. No hay una máquina de estados explícita reutilizable por otras prácticas.
4. `packages/simulation`: las seis prácticas son listas de preguntas en orden fijo; el nivel solo rota el orden.
5. `apps/desktop/src-tauri/tauri.conf.json`: CSP sin Ollama ni Google Storage (ver tabla).
6. `tests/e2e/app.spec.ts:127`: selector `getByRole('status')` ambiguo.
7. `apps/web/src/defense/store.ts`: informes en `localStorage`, límite de 10 y sin esquema validado al leer.
8. Rutas: `#/defense` y `#/practice` compiten como entrada para la defensa de tesis.

## Lo que se conserva

El DSP (`packages/audio`), la grabación con borradores en IndexedDB, las copias cifradas, la verificación SHA-256 de modelos, la CSP restrictiva, el Service Worker con preparación explícita, las señales de cámara (`packages/defense/src/signals.ts`), la construcción de hallazgos de voz y cuerpo (`report.ts`) y el adaptador SQLite. Todo eso funciona y está probado; se reutiliza en la nueva arquitectura.

## Decisiones que siguen de esta auditoría

- Un motor conversacional único (`packages/conversation`) con estados explícitos, memoria y escenarios declarativos, usado por las seis prácticas.
- La defensa de tesis deja de existir como simulador aparte: `#/defense` redirige a Prácticas guiadas → Defensa de tesis.
- Dificultad académica (5 niveles) y temperamento (6 estilos) pasan a ser dos parámetros independientes por profesor.
- Un módulo de material académico (`packages/knowledge`) con extracción de PDF, DOCX, PPTX y texto, segmentación por estructura e índice local, sin límite de 20.000 caracteres.
- El administrador de modelos consulta primero lo que el usuario ya tiene (Ollama y modelos propios de la app) antes de recomendar descargas.
- Historial y progreso unificados en IndexedDB, con migración de los informes guardados en `localStorage`.
