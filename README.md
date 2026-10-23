# Oratoria Lab

Plataforma gratuita para entrenar conversaciones, con foco en la **defensa de tesis**. Simula una comisión, una entrevista o una audiencia y entrega un informe con evidencias y ejercicios. Procesamiento local por defecto, sin cuentas, telemetría ni servicios de pago obligatorios. El reconocimiento del navegador en línea y los servidores externos requieren una elección explícita.

Estado real de cada función y de cada prueba: [docs/STATUS.md](docs/STATUS.md).

## Qué puedes hacer

- **Prácticas guiadas**: defensa de tesis, entrevista laboral, presentación profesional, debate académico, exposición educativa y conversación difícil. Todas comparten el mismo motor conversacional.
- **Comisión configurable**: presidencia, metodología, teoría, especialista disciplinar, crítica y evaluación externa, con nombres ficticios. Para cada integrante eliges la **dificultad** (básica a defensa extrema) y el **temperamento** (amable a desafiante) por separado. El temperamento cambia el tono, nunca la calificación, y nunca hay insultos ni humillaciones.
- **Material académico**: carga tu tesis, tu presentación, bibliografía o instrucciones en PDF, DOCX, PPTX, TXT, Markdown o LaTeX, sin límite de caracteres. Las preguntas citan la página, diapositiva o sección y detectan cifras que no coinciden con tu documento. También puedes comparar tu presentación con la tesis.
- **Informe**: criterios con nivel, evidencia literal y método. Los criterios sin datos quedan como «No evaluado». Incluye línea de tiempo de la conversación, video opcional y ejercicios recomendados.
- **Mi progreso**: tendencias por criterio, comparación con la sesión anterior del mismo tipo y habilidades prioritarias.
- **Personas 3D animadas**: apariencias humanas, expresiones, parpadeo, movimiento corporal y sincronía labial aproximada, con recursos locales. Ilustraciones para equipos con menos recursos.
- **Ensayo por diapositiva**: centra las preguntas en una diapositiva y contrástala con la tesis seleccionada.
- **Solo escribir**: una práctica sin micrófono, cámara ni métricas vocales inventadas.
- **Práctica libre y análisis de grabaciones**: graba o importa un audio y mide ritmo, pausas, volumen, muletillas y estructura.
- **Modelos de IA** (Configuración): revisa los modelos que ya tienes en Ollama antes de recomendar descargas, asigna un modelo a cada función, instala y desinstala con la API oficial de Ollama y administra Whisper, voces Piper y MediaPipe.

Sin modelos puedes entrenar con reglas y respuestas escritas y medir audio localmente. La conversación con IA, la transcripción Whisper y las voces Piper necesitan sus modelos. No se instala ni elimina ninguno automáticamente.

## Usar la versión web

Abre la página publicada (por ejemplo `https://svn11x.github.io/oratoria_lab/`) en Chrome, Edge o Firefox. Para un modelo de lenguaje local:

1. Instala [Ollama](https://ollama.com/download).
2. Permite que la página publicada le hable. En Windows agrega la variable de entorno `OLLAMA_ORIGINS` con el valor `https://svn11x.github.io` y reinicia Ollama. En macOS: `launchctl setenv OLLAMA_ORIGINS "https://svn11x.github.io"`. En Linux con systemd: `systemctl edit ollama.service` y agrega `Environment="OLLAMA_ORIGINS=https://svn11x.github.io"`.
3. En Oratoria Lab abre **Configuración → Modelos de IA**, activa «Usar un modelo de lenguaje», elige un perfil y descarga lo que falte.

Requisitos por perfil: [docs/HARDWARE.md](docs/HARDWARE.md).

## Desarrollo

Requisitos: Node.js 22.12 o superior (24 recomendado) y pnpm 11.25.0.

```bash
npm install --global pnpm@11.25.0
pnpm install --frozen-lockfile
pnpm dev                 # http://localhost:5173
```

Comprobaciones:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test                # Vitest
pnpm build && pnpm verify:build
pnpm exec playwright install --with-deps chromium
pnpm test:e2e            # recorridos en Chromium; incluye los seis escenarios
pnpm verify:avatars     # integridad de los recursos humanos incluidos
```

Si ya tienes Chromium instalado, puedes indicar su ruta con `PW_CHROMIUM_PATH=/ruta/a/chromium pnpm test:e2e`. Las pruebas de extremo a extremo usan un servidor que imita la API de Ollama y archivos de prueba para los modelos: no descargan nada.

Para incluir la prueba de renderizado 3D por software: `$env:PW_SOFTWARE_GL = '1'; pnpm test:e2e`. [Auditoría V2](docs/AUDITORIA-V2.md), [entrega y comandos PowerShell](docs/ENTREGA-0.3.0.md), [benchmark local](docs/BENCHMARK.md).

Build para una subcarpeta (GitHub Pages): `VITE_BASE_PATH=/oratoria_lab/ pnpm build`. En PowerShell: `$env:VITE_BASE_PATH = '/oratoria_lab/'; pnpm build`.

## Escritorio (Tauri 2)

Instala los [requisitos de Tauri 2](https://v2.tauri.app/start/prerequisites/) para tu sistema (Rust, herramientas de compilación y WebView).

```bash
pnpm desktop:dev
pnpm desktop:build
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
```

La app de escritorio lee la memoria y la CPU del sistema y, en modo solo lectura, la carpeta de modelos de Ollama para medir el espacio real que libera una desinstalación. En Linux, WebKitGTK no tiene reconocimiento de voz del navegador: usa Whisper o respuestas escritas.

## Estructura

```text
apps/web            Interfaz React, workers de voz y transcripción, sala y configuración
apps/desktop        Tauri 2: SQLite y comandos de solo lectura
packages/conversation  Motor conversacional, escenarios, personas, criterios, evaluación y entrenador
packages/knowledge     Extracción de documentos, segmentación, búsqueda y comparación
packages/model-manager Cliente de Ollama, catálogo, auditoría y modelos administrados
packages/audio, core, defense, evaluation, export, storage, transcription, simulation
tests/unit, tests/e2e, tests/fixtures
docs/               Estado, arquitectura, privacidad, equipo, comparación, licencias y auditoría
```

Más detalle: [ARCHITECTURE](docs/ARCHITECTURE.md), [PRIVACY](docs/PRIVACY.md), [BENCHMARK](docs/BENCHMARK.md), [LICENSES](docs/LICENSES.md), [AUDITORIA](docs/AUDITORIA.md), [BACKUPS](docs/BACKUPS.md) y [PUBLICACION](docs/PUBLICACION.md).

## Límites

Las mediciones de voz, orientación y postura son estimaciones técnicas, no juicios sobre la persona. Los umbrales son referencias para practicar sin validación con evaluadores. La calidad de IA depende del modelo instalado. Los humanos 3D no son fotorrealistas; la sincronía labial es aproximada. Las pruebas con modelos reales y el build nativo Windows quedan pendientes.

Código bajo licencia MIT. El componente de fonemas de Piper incluye eSpeak NG (GPL-3.0); ver [LICENSES](docs/LICENSES.md).
