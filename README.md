# Oratoria Lab

Un laboratorio de práctica de comunicación en español, gratuito y local-first. Permite grabar audio, observar mediciones explicables, editar transcripciones y valorar evidencias con rúbricas. La interfaz web se comparte con una base de aplicación de escritorio Tauri 2.

Esta entrega implementa el núcleo P0 web y parte de P1. No afirma superar a Yoodli. La validación de micrófono real, codecs, PWA, Whisper y escritorio requiere pruebas de navegador y equipos nativos; consulta [el informe de verificación](docs/STATUS.md).

## Funcionalidades implementadas

- Grabación con MediaRecorder: micrófono seleccionable, pausa, reanudación, detención, duración y nivel real mediante AudioWorklet o AnalyserNode. Recursos liberados al detener o abandonar la pantalla.
- Grabación comprimida por bloques temporales en IndexedDB. Límite de 10 minutos y 25 MiB; confirmación al salir del estudio con trabajo sin guardar.
- Importación de WAV, MP3, OGG, WebM, MP4/M4A y FLAC cuando el navegador puede leer la duración y decodificar el audio. Validación de cabecera y tamaño.
- DSP en Web Worker: duración, actividad acústica estimada, silencio, pausas internas, nivel RMS en dBFS, variación relativa de energía, muestras cercanas al límite y frecuencia fundamental cuando hay suficiente periodicidad.
- Historial y sesiones persistidos localmente; reproducción y eliminación de cada sesión. En escritorio, un adaptador usa comandos Rust y SQLite.
- Editor de transcripción manual con segmentos y tiempos opcionales. No se calculan palabras o muletillas sin texto guardado.
- Conteo de palabras, ritmo sobre duración total y candidatos a muletilla con diccionario personalizable. Coincidencias por palabras completas, con normalización de tildes y mayúsculas.
- Dashboard ECharts con registros reales de ritmo, candidatos por 100 palabras y pausas por minuto. Las pausas se comparan con el mismo umbral. Gráficos con alternativas textuales.
- Seis rúbricas iniciales, copias editables, versiones persistidas, pesos, niveles y exclusión de criterios no evaluables. Valoración **manual** con citas exactas verificadas y justificación obligatoria de cada nivel; cambiar la transcripción retira la valoración anterior.
- Seis prácticas escritas guiadas por una máquina de estados: tesis, entrevista, presentación, debate, exposición educativa y conversación difícil. Usan preguntas fijas; el nivel cambia su orden. Cada respuesta conserva su pregunta como contexto, separada del texto analizado.
- Adaptador Whisper Tiny multilingüe Q8 con Transformers.js en worker: descarga explícita, revisión fijada, SHA-256 por archivo, procesamiento local y cancelación por terminación del worker. **La ejecución real del modelo en navegador aún necesita validación.**
- TXT, JSON, CSV y grabación original. El JSON incluye método, rúbrica, revisión de texto, análisis disponible y diccionario aplicado. El audio se exporta por separado. CSV protege los campos de texto de fórmulas.
- Copia completa por sesión, restaurable desde el historial: audio binario exacto, transcripción, contexto, métricas y snapshot de valoración/rúbrica. Cifrado opcional por contraseña mediante AES-256-GCM y PBKDF2-SHA256; validación de tamaños, SHA-256 del audio, revisiones y citas antes de guardar una sesión nueva.
- Tema claro/oscuro, diseño responsive, controles con etiquetas, navegación por teclado, foco visible, movimiento reducido y confirmaciones de eliminación.
- PWA con recursos locales en producción, rutas hash compatibles con subdirectorios y workflows de calidad, publicación Pages y compilación de escritorio.

## Pendiente

LLM semántico, conversación dinámica y repreguntas basadas en respuestas, adaptación avanzada de ejercicios, MediaPipe, voz sintética local e informes PDF. No se crearon paquetes vacíos ni botones que aparenten esas capacidades.

También están pendientes la validación nativa de SQLite/IPC/micrófono en cada OS, la integración whisper.cpp/llama.cpp, optimizaciones para audios mayores y estudios comparativos. Las recomendaciones actuales son reglas explícitas sobre saturación, poca actividad detectada y coincidencias léxicas; no son evaluaciones mediante IA.

## Requisitos

Para desarrollar: **Node.js 24 recomendado**, mínimo 22.12; **pnpm 11.25.0**. Los visitantes de la web compilada no necesitan Node, Rust ni Python. Para grabar, usa HTTPS o localhost y un navegador con MediaRecorder y Web Audio.

El procesamiento utiliza CPU, RAM, almacenamiento y energía del dispositivo. No se prometen recursos ilimitados, precisión universal ni conservación garantizada del almacenamiento del navegador.

## Instalar y ejecutar web

```bash
npm install --global pnpm@11.25.0
cd oratoria-lab
pnpm install --frozen-lockfile
pnpm dev
```

Abre `http://localhost:5173`. `pnpm dev` prepara el runtime WASM desde las dependencias instaladas. En desarrollo no se activa Service Worker y se retira la CSP del HTML para permitir el preámbulo/HMR de Vite. Producción conserva una CSP restrictiva.

Primera práctica: Estudio → Grabar → Detener → Escuchar → Analizar audio → Guardar sesión. También puedes importar un WAV/MP3, analizarlo y guardarlo. En la sesión, abre Transcripción, añade texto y guárdalo. La transcripción manual permite trabajar sin modelos.

## Comprobaciones y compilación

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm preview
```

`pnpm check` ejecuta lint, typecheck, Vitest y build. El resultado web queda en `apps/web/dist`; preview sirve `http://localhost:4173`.

Pruebas de navegador, en un equipo o CI con Chromium:

```bash
pnpm build
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

En Windows puede omitirse `--with-deps`. Hay ocho recorridos de Playwright, incluyendo importación, MediaRecorder con dispositivo sintético, permiso rechazado, persistencia/exportación/eliminación, privacidad, accesibilidad con axe, apertura offline y copias completas/cifradas con restauración. Un listado de pruebas no equivale a haberlas ejecutado. La captura sintética sirve para validar el flujo, no la precisión con hablantes reales. `pnpm check` incluye `pnpm verify:build`, que comprueba SHA-256/tamaño de todos los recursos offline, referencias HTML, CSP y sintaxis del Service Worker sin ejecutar un navegador.

`pnpm benchmark` ejecuta solo DSP sobre una señal sintética de 10 minutos. No mide captura, decodificación, resampling, Whisper ni rendimiento del navegador. El informe de esta entrega registra sus resultados reales.

## Escritorio

Instala los [requisitos oficiales de Tauri 2](https://v2.tauri.app/start/prerequisites/): Rust/Cargo, herramientas nativas de compilación y WebView. En Windows se requieren las herramientas C++ de Microsoft y WebView2; en macOS, Xcode Command Line Tools; en Linux, las bibliotecas indicadas en esa documentación.

```bash
pnpm desktop:dev
pnpm desktop:build
```

Para consultar el diagnóstico: `pnpm --filter @oratoria/desktop run info`. Para pruebas Rust: `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`.

La base Tauri reutiliza `apps/web/dist`, tiene capacidades limitadas a la ventana local `main` y cinco comandos de sesiones. SQLite guarda metadata y audio BLOB de forma conjunta; no expone una API general de archivos o shell. La primera resolución Cargo genera `Cargo.lock`, que debe revisarse y versionarse antes de distribuir binarios. Los requisitos nativos faltaban en el entorno de esta entrega: **no se incluye ejecutable ni se declara compilación nativa exitosa**.

El workflow manual `Verificar escritorio` prepara Linux/Windows/macOS y genera artefactos. Micrófono, MediaRecorder, codecs y CacheStorage del WebView deben probarse en cada plataforma. La transcripción nativa con whisper.cpp todavía no existe; el adaptador disponible usa WASM cuando el WebView lo permite.

## Modelos y uso offline

Whisper está en Modelos locales. No se descarga automáticamente. El catálogo inicial contiene un modelo de 43.615.928 bytes (41,6 MiB); el tamaño exacto y cada hash están en `packages/model-manager/src/manifest.json`. Procedencia: `onnx-community/whisper-tiny`, revisión `ff4177021cc41f7db950912b73ea4fdf7d01d8e7`, conversión del modelo multilingüe de OpenAI.

La instalación conserva únicamente archivos verificados. Cancelar descarta el archivo parcial en memoria y permite reutilizar archivos completos previamente verificados. Eliminar el modelo conserva las sesiones. Antes de inferir se vuelve a comprobar SHA-256; se deshabilitan modelos remotos y las solicitudes del worker se restringen al runtime local.

Los pesos no se incluyen en el repositorio. El runtime ONNX se copia durante dev/build; no se carga desde CDN. Se fija la versión WASM que declara Transformers.js 3.8.1. `sharp` y `onnxruntime-node` se excluyen mediante overrides de pnpm: no se utilizan en el adaptador de navegador ni en Tauri, que comparte ese frontend. No se admite inferencia Transformers desde Node con esta configuración.

En producción, pulsa Preferencias → Preparar o actualizar uso offline. Esta acción instala/actualiza el Service Worker y descarga o reutiliza los recursos estáticos, incluyendo bundles y WASM, comprobando SHA-256 de cada archivo. La preparación inicial requiere conexión, cuota suficiente y puede ser considerable; instalar la interfaz no instala pesos. El navegador puede comprobar el pequeño script del Service Worker, pero las versiones nuevas del shell no se descargan/preparan sin esa acción explícita. Se mantiene la última versión preparada hasta completar y verificar todos los recursos de otra versión; se conserva una versión anterior para sus chunks abiertos.

Confirma el estado en Preferencias y prueba una recarga offline. El navegador puede borrar datos bajo presión de espacio o al limpiar el sitio. Solicitar persistencia no garantiza que la conceda. Modelos y sesiones están separados del caché estático; limpiar versiones antiguas de la interfaz no elimina esas sesiones.

## Arquitectura y archivos

```text
oratoria-lab/
├── apps/
│   ├── web/                  React, Vite, CSS, rutas y workers
│   └── desktop/src-tauri/    Rust, SQLite, permisos y configuración
├── packages/
│   ├── core/                 Esquemas Zod y contratos
│   ├── audio/                DSP y resampling
│   ├── evaluation/           Reglas de texto, evidencias y rúbricas
│   ├── simulation/           Bancos de preguntas y máquina de estados
│   ├── storage/              IndexedDB, drafts y adaptador Tauri
│   ├── export/               Informes, copias/restauración y cifrado
│   ├── model-manager/        Catálogo, descargas e integridad
│   └── transcription/        Contrato y validación de resultados
├── tests/{unit,e2e}/
├── scripts/                  Preparación WASM y benchmark
├── docs/                     Arquitectura, privacidad, roadmap y estado
├── .github/workflows/        Calidad, Pages y escritorio
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── package.json
└── LICENSE
```

La UI se concentra en una app reutilizada por Tauri; se evita duplicar frontend o crear paquetes vacíos de capacidades futuras. El coaching por reglas comparte evaluación. Los modelos y escenarios están junto a sus módulos consumidores, sin duplicar catálogos.

## Publicar en GitHub y Pages

No se creó ni modificó un repositorio remoto en esta entrega. Crea un repositorio vacío llamado `oratoria-lab` en tu cuenta y ejecuta dentro de esta carpeta:

```bash
git init
git branch -M main
git add .
git commit -m "Implementar núcleo local de Oratoria Lab"
git remote add origin https://github.com/SVN11X/oratoria-lab.git
git push -u origin main
```

Sustituye `SVN11X` si usas otra cuenta. Configura Settings → Pages → Source: GitHub Actions. Ejecuta manualmente Actions → Publicar web en GitHub Pages. Ese workflow calcula `/nombre-del-repositorio/` y publica `apps/web/dist`; no depende de cabeceras HTTP especiales ni SharedArrayBuffer. El workflow de publicación es manual para que subir código no publique el sitio automáticamente.

Para otro alojamiento estático, utiliza el contenido de `apps/web/dist`. Compilación de subdirectorio en Bash: `VITE_BASE_PATH=/oratoria-lab/ pnpm build`. En PowerShell establece `$env:VITE_BASE_PATH = '/oratoria-lab/'` antes de `pnpm build` y retíralo después con `Remove-Item Env:VITE_BASE_PATH`. Para escritorio y raíz usa el valor predeterminado `./`.

La disponibilidad de Pages/Actions depende del plan de GitHub. El código publicado y los archivos de la interfaz son visibles; las sesiones siguen siendo locales. Publicar el sitio no transmite ni comparte grabaciones. El uso de la aplicación no requiere Actions ni servicios de inferencia.

## Privacidad, límites y contribución

Lee [PRIVACY](docs/PRIVACY.md), [ARCHITECTURE](docs/ARCHITECTURE.md), [ROADMAP](docs/ROADMAP.md), [STATUS](docs/STATUS.md) y [licencias](docs/LICENSES.md).

El detector energético puede confundir ruido/música con actividad y perder voz suave. Pausas y ritmo no son defectos por sí mismos. RMS está referido a muestras digitales; no mide dB SPL calibrados. El análisis trabaja sobre una mezcla mono a 16 kHz con filtro antialias; canales en oposición de fase pueden cancelarse. Frecuencia fundamental solo entre 70–400 Hz con suficiente periodicidad; no identifica emociones, género, identidad ni confianza.

La importación decodifica el audio completo dentro de los límites indicados porque Web Audio lo requiere. No es procesamiento streaming de archivos arbitrariamente grandes. WebM sin duración verificable puede ser rechazado al importar; un WAV/MP3 con metadata correcta es la ruta más interoperable. La transcripción Whisper puede fallar o producir errores; no se midió precisión regional ni latencia ASR en esta entrega.

Los datos guardados en la app no están cifrados en reposo. Para conservar o trasladar una sesión, pulsa Copia completa en su página; la protección por contraseña está seleccionada inicialmente. Restaura ese archivo desde Historial → Restaurar copia, revisa la vista previa y pulsa Guardar como sesión nueva. El informe JSON ordinario no es una copia completa. Se conservan la fecha, la revisión de texto y la rúbrica de la sesión; no se reemplazan otras sesiones ni se importan modelos/preferencias. Los cálculos léxicos se vuelven a mostrar con el diccionario del dispositivo de destino. Más detalles y límites en [BACKUPS](docs/BACKUPS.md).

No hay sincronización, backup global del dispositivo ni recuperación automática de grabaciones interrumpidas. Una puntuación manual depende de la rúbrica, cobertura y evidencias; no constituye una medición objetiva de capacidad. Las valoraciones no tienen comparación longitudinal automática.

Para contribuir: conserva los contratos y métodos versionados, usa señales conocidas al cambiar DSP, agrega evidencia a reglas nuevas y ejecuta las comprobaciones. No introduzcas cuentas, telemetría, servicios obligatorios de inferencia o resultados sintéticos en el historial real. Actualiza metodología/rúbrica cuando cambie su significado. Código bajo MIT; las dependencias y modelos conservan sus propias licencias.
