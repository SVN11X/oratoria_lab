# Oratoria Lab: modernización incremental verificada

Base confirmada: `9fe3ad1b65f08212818b7e04fc9e52759744109e`, versión 0.3.0 de la rama remota. Revisión: octubre de 2026. No se incorporaron automáticamente los parches 0.3.1 de otras entregas: no figuran integrados en esta base. No se publicó nada en GitHub.

## Estado inicial y problemas confirmados

La copia de trabajo se obtuvo limpia y se conservaron el motor compartido, los seis escenarios, las voces, los avatares, los documentos y el almacenamiento existentes. La referencia pasó formato, lint, TypeScript, 129 pruebas unitarias, build, integridad y 24 recorridos de navegador.

| Archivo y función                                             | Problema confirmado                                                                                                            | Corrección                                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `packages/model-manager/src/ollama.ts`, `chat`                | Solo `stream: false`; se esperaba la respuesta completa                                                                        | `chatStream` consume NDJSON real, decodifica UTF-8 fragmentado, exige finalización, cancela y aplica timeout al cuerpo |
| `packages/conversation/src/engine.ts`, `answer`               | Decisión JSON seguida de otra generación al avanzar de tema                                                                    | Ruta `directo`: comprensión y planificación por reglas, una generación de diálogo y evaluación académica al cierre     |
| `engine.ts`, `computeRelevance`                               | Una consulta semántica secuencial por cada área antes del saludo                                                               | Preparación con índice léxico local; la consulta semántica se reserva al contexto del turno                            |
| `packages/model-manager/src/catalog.ts`, `profileForHardware` | RAM alta o nombre de GPU bastaban para recomendar calidad; se infería RAM a partir de CPU                                      | Recomendación conservadora con VRAM medida; RAM y CPU no se convierten en una capacidad de GPU inventada               |
| `catalog.ts`, `planProfile`                                   | El perfil equilibrado elegía el mayor modelo del intervalo                                                                     | Prioriza Qwen 3.5 4B instalado; evaluación comparte modelo inicialmente para reducir recargas                          |
| `apps/web/src/ai/hardware.ts`, `detectHardware`               | No obtenía VRAM nativa y dependía de WebGPU                                                                                    | `nvidia-smi` de solo lectura en Tauri, con límite de tiempo; WebGL como respaldo para nombre, sin inventar VRAM        |
| `apps/web/src/knowledge/library.ts`, `makeRetriever`          | Un error de embeddings desactivaba la recuperación semántica hasta terminar                                                    | Caché acotada, consultas idénticas compartidas, búsqueda léxica durante el fallo y reintento posterior                 |
| `packages/knowledge/src/library.ts`, `KnowledgeIndex.search`  | Filtrado por documento después del top-40 podía devolver cero aunque hubiera una coincidencia válida                           | Filtrado antes de ordenar, también por sección; se mantienen BM25, RRF y MMR                                           |
| `library.ts`, `segment`                                       | Oraciones largas sin puntuación quedaban sin acotar; una deduplicación por igualdad podía eliminar contenido repetido legítimo | División acotada y conservación del texto; prueba con una cadena de 12.000 caracteres                                  |
| `apps/web/src/voice/tts.ts`                                   | Cancelar Web Speech podía dejar la promesa esperando el temporizador; Piper podía reproducir un PCM que llegaba tarde          | Finalización inmediata de Web Speech, cancelación de solicitudes/PCM obsoletos y limpieza de analizadores              |
| `apps/web/src/practice/Room.tsx`                              | Esperas fijas entre movimientos y tras error de voz                                                                            | Se eliminaron esas esperas; se conservan las pausas lingüísticas y el tiempo de lectura del modo sin voz               |

## Decisiones e implementación

### Conversación, memoria y fuentes

La sala usa `dialogue: 'directo'` en conversación rápida; el perfil académico conserva la planificación estructurada anterior (`evaluado`). El motor analiza la respuesta, recupera evidencia, decide si repreguntar o avanzar y solicita una sola intervención al modelo. Así se conserva accesible desde la interfaz la planificación anterior, además de su contrato compatible. Las reglas siguen disponibles si el modelo falla. Después de tres fallos se abre un intervalo de recuperación de 15 segundos, sin perder las respuestas anteriores.

El texto fluye desde `/api/chat` a `OllamaPort`, al motor y al borrador de la sala. Se excluye `message.thinking`. El esquema final, el trato, las repeticiones y las referencias se validan antes de pronunciar la intervención. Los prefijos JSON incompletos se muestran como borrador, no se guardan como respuesta definitiva.

**Límite deliberado:** no se pronuncian tokens o frases de un JSON que todavía podría rechazarse. La síntesis por frases de Piper se conserva y mejora, pero empieza después de validar la intervención completa. No se implementó TTS mientras el LLM todavía genera ese JSON. El streaming visual de la ruta rápida sí está conectado de extremo a extremo. El análisis estructurado previo del perfil académico no se transmite como borrador de diálogo.

Los prompts excluyen teatralidad y elogios automáticos, mantienen temperamento y dificultad independientes y reutilizan nombre, rol, especialidad y objetivos de cada miembro de la comisión. Añaden memoria extractiva acotada de turnos anteriores, áreas tratadas y puntos por aclarar. La evidencia recuperada y las transcripciones se declaran datos no confiables, nunca instrucciones de sistema.

El presupuesto del contexto de generación de preguntas se ajusta por perfil, priorizando última respuesta, movimiento y evidencia. Es un límite aproximado de caracteres, no una afirmación de tokenización exacta. Los recortes se indican. Se rechazan identificadores de fuente inexistentes, fuentes omitidas del contexto efectivo y páginas que no coinciden con las ubicaciones citadas. Una atribución documental explícita sin fuente se descarta.

Estas comprobaciones validan ubicación e identificadores; no prueban por sí solas que una fuente respalde semánticamente toda la interpretación del modelo. Las diferencias numéricas se preguntan como discrepancias por aclarar, sin declarar automáticamente que la persona se equivocó.

La memoria se mantiene al pausar y al cambiar de interlocutor, y las conversaciones siguen en los informes guardados. **No se añadió reanudación automática de una sala activa después de cerrar o recargar la pestaña.**

### Modelos y hardware

- Perfil rápido: contexto de 4.096 tokens solicitado a Ollama, salida máxima de 256, presupuesto aproximado de 10.500 caracteres y razonamiento desactivado inicialmente cuando el modelo declara soporte.
- Perfil académico: contexto de 8.192, salida conversacional máxima de 512 y presupuesto aproximado de 22.000 caracteres.
- Evaluación: modelo asignado a evaluación, o el conversacional si está vacío; salida máxima de 4.096 al cierre. No se ejecuta una evaluación LLM exhaustiva antes de cada respuesta.
- Embeddings: modelo dedicado; cambiar el modelo conversacional no borra sus vectores. El recuperador conserva una instantánea del servidor/modelo para no consultar vectores de un servidor diferente por un cambio de configuración a mitad de sesión.
- Una cola por servidor serializa conversación, evaluación y embeddings. No descarga modelos, no los elimina ni descarga de memoria automáticamente los de otras aplicaciones. No controla procesos de otras aplicaciones ni otras pestañas.
- El perfil equilibrado propone `qwen3.5:4b` antes que los 7B/9B si está instalado. Aplicar un perfil es una acción explícita; no se sobrescriben preferencias existentes al cargar la configuración.
- El navegador conserva valores desconocidos como desconocidos. Tauri añade CPU/RAM y VRAM total/disponible de NVIDIA si la utilidad responde. La lectura nativa tiene timeout y no usa un shell.

La instalación, el progreso, el reemplazo, la confirmación y la eliminación real de modelos existentes se conservan. Los recorridos con API de prueba verifican esas operaciones; no se eliminó ni descargó ningún modelo del usuario.

### RAG y biblioteca

La extracción/segmentación de Office y texto y la construcción de la preparación se ejecutan en un worker del navegador. PDF mantiene PDF.js y su worker; la segmentación posterior también sale del hilo de interfaz. El original y su identidad se conservan.

Cada documento puede guardar un perfil académico **derivado y extractivo**: secciones, ubicación, términos, fragmentos y áreas detectadas por encabezados (problema, objetivos/hipótesis, teoría, metodología, resultados, conclusiones, limitaciones y referencias). Se reutiliza entre turnos. Es una primera capa jerárquica, no una lectura académica exhaustiva ni un resumen LLM de todos los capítulos.

La recuperación admite filtrado por documento/sección y expansión de fragmentos vecinos con ubicación conservada y presupuesto de caracteres. La caché de consultas tiene 64 entradas, evita duplicar solicitudes simultáneas y vuelve a intentar después de cinco segundos ante un fallo. Un timeout de consulta semántica, incluida la espera en cola, devuelve búsqueda por palabras; no impide continuar la práctica.

La interfaz permite reindexar desde el original. La sustitución de metadatos, fragmentos y vectores derivados es atómica en IndexedDB y afecta solamente al documento elegido. Si la extracción nueva no produce texto, se conserva el índice anterior. Las citas de sesiones ya guardadas no se reescriben.

Se conserva el límite de 60 MiB por archivo. **No se incorporaron OCR, Docling, un reranker neuronal, análisis fiable de ecuaciones/figuras ni una base vectorial externa.** Las tablas y ubicaciones actuales siguen dependiendo de la calidad de extracción del formato. Cambiar los pesos de un mismo tag de embeddings requiere reindexar manualmente; todavía no hay invalidación por digest de ese tag.

### Diagnóstico, voz y gráficos

El diagnóstico correlaciona operaciones con `T1`, `T2`, etc. Distingue captura, transcripción final, recuperación, contexto, generación, cola, primer token, carga/procesamiento de Ollama, síntesis, primer audio y final de la intervención. Calcula p50/p95 y el número de muestras presentes; no convierte valores ausentes en cero.

La exportación tiene una lista permitida de campos: modelo solicitado, proveedor, identificador y medidas. No incluye direcciones del servidor, tesis, nombres de documentos ni transcripciones. La vista también queda disponible en el informe guardado. El modo solo texto no fabrica un tiempo de primer audio. Los tiempos del cliente no se presentan como tiempos internos de Ollama. El diagnóstico no mide automáticamente toda la RAM/VRAM ni tiempos de GPU del renderizador.

Piper informa el tiempo medido en su worker y mantiene la preparación progresiva por frases. Web Speech informa el inicio de reproducción cuando el navegador lo emite. Los servidores TTS miden preparación desde el cliente, incluida la transferencia; no se afirma que sea tiempo puro de inferencia del servidor. La cancelación evita solapar un PCM antiguo con la nueva intervención. Se mantiene la protección de escucha durante la voz del personaje y el barge-in existente con audífonos; no se implantó un nuevo VAD neuronal.

Los humanos 3D se conservan con sus recursos y licencias actuales. Añadí perfiles gráficos ligero/equilibrado/alto (objetivos 24/30/45 fps, límite de resolución 1/1,5/2) y un límite de 20 fps durante la generación para reducir competencia. Los parpadeos varían entre participantes e intervalos. Son límites de configuración, **no fps medidos en la RTX del usuario**. No se sustituyeron los personajes por ilustraciones ni se añadieron recursos de fotorrealismo.

## Verificación y comparación

Entorno: Node 24.19.0, pnpm 11.25.0, Vitest 4.1.12 y Chromium Headless Shell 138 con WebGL por software. El Chromium completo no arrancó por una restricción de sockets del contenedor; Headless Shell permitió ejecutar los recorridos completos. No se alteraron los tests para omitir ese problema.

| Comprobación                                          | Referencia              | Entrega                                          |
| ----------------------------------------------------- | ----------------------- | ------------------------------------------------ |
| Formato, lint y TypeScript                            | Aprobados               | Aprobados                                        |
| Unitarias e integración local                         | 129 / 12 archivos       | 176 / 17 archivos aprobadas                      |
| Recorridos de navegador                               | 24 aprobados            | 27 aprobados (incluye tres recorridos nuevos)    |
| Build e integridad                                    | 153 recursos, 61,33 MiB | 154 recursos, aproximadamente 61,46 MiB          |
| Recursos de humanos 3D                                | 59, SHA-256 válido      | 59, SHA-256 válido                               |
| Inferencias para avanzar de tema en caso determinista | 2, decisión + pregunta  | 1, pregunta; mismo caso, configuración y fuentes |
| Velocidad/latencia con modelos reales                 | No ejecutada aquí       | No ejecutada aquí                                |
| Micrófono, voces reales y percepción audiovisual      | No ejecutados aquí      | No ejecutados aquí                               |
| Compilación nativa Windows                            | No disponible           | No disponible; Cargo no está instalado           |

El cambio de dos a una inferencias es una comprobación estructural con doble LLM; no demuestra una reducción porcentual equivalente de latencia ni calidad conversacional con pesos reales. Las cifras de rendimiento aportadas previamente por el usuario provienen de prompts/límites distintos y no se reutilizaron como comparación controlada de esta entrega.

Las pruebas nuevas incluyen NDJSON byte a byte, UTF-8, entrega antes de completar, error HTTP, cierre prematuro, cancelación activa/en cola, timeout tras cabeceras, recuperación del modelo, fuentes/páginas inválidas, memoria y presupuesto, privacidad del diagnóstico, los seis escenarios, filtros con 80 coincidencias distractoras, segmentación larga, caché semántica, preservación de archivo/vectores ajenos y audio obsoleto. El navegador comprueba streaming visible, una inferencia por turno rápido, exportación sin contenido privado, configuración persistente y reindexación desde el original.

Comandos de la batería:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm verify:build
pnpm test:e2e
pnpm verify:avatars
```

En este contenedor se añadieron `PW_CHROMIUM_PATH` y `PW_SOFTWARE_GL=1` al comando E2E para usar el navegador instalado y el renderizador por software. No son requisitos de ejecución en Windows.

## Benchmark que falta realizar en el equipo real

Conservar los modelos ya instalados. No se necesita borrar `qwen2.5:7b` ni instalar pesos nuevos para aplicar este parche.

```powershell
Set-Location -LiteralPath 'C:\my_drive\Portafolio\oratoria_lab'
pnpm benchmark:local --models 'qwen3.5:4b,qwen2.5:7b,qwen3.5:9b' --repeat 3 --output '.\benchmark-modernizacion.json'
```

El script usa cuatro casos ficticios idénticos por modelo y repetición, contexto 4.096, salida máxima 160, temperatura 0,2, semilla 23 y `think: false` si se declara soporte. Registra primer token, carga, procesamiento, velocidad de tokens y salida para revisión humana. No descarga, elimina ni descarga de memoria modelos. La primera ejecución puede incluir carga: comparar ese campo y revisar por caso, no mezclar arbitrariamente preguntas o estados de carga. El benchmark de Configuración es otro prompt breve, también fijo; sus cifras no se deben mezclar con las de este protocolo.

Durante una práctica real, abrir «Diagnóstico avanzado» y exportar las medidas tras varios turnos. Para evaluar rigor/naturalidad se necesitan revisar las respuestas y las fuentes con una persona; para voz, micrófono, audífonos y una grabación de referencia. No se verificó aquí superioridad frente a herramientas comerciales.

## Alcance pendiente

La fase 0 quedó ejecutada sobre la base remota. Las fases 1 y 2 tienen implementación funcional de configuración, diagnóstico, reducción de inferencias y streaming visual, pendiente validación con los pesos/hardware reales. La fase 3 incorpora recuperación, preparación extractiva y reindexación, pero no el RAG académico jerárquico exhaustivo del prompt completo. La fase 4 corrige cancelación y añade perfiles gráficos; quedan TTS previo al cierre del JSON, validación perceptual, fonemas temporizados reales y mejora de modelos/texturas humanas. La fase 5 cubre la integración web; no equivale a una validación nativa Windows.

No se incorporó reanudación de una sala activa tras recarga, contradicciones semánticas verificadas automáticamente, deduplicación neural de preguntas ni OCR. Las heurísticas de repetición y los prompts reducen repeticiones, sin garantizar ausencia de duplicados semánticos. Las mejoras subjetivas de conversación, español y realismo requieren pruebas reales.

## Soluciones externas examinadas

No se añadieron dependencias, servicios obligatorios ni recursos externos. Las siguientes son decisiones de arquitectura tras revisar fuentes primarias; no comparaciones experimentales de rendimiento.

| Solución / fuente primaria                                                                   | Decisión y compatibilidad                                                                                                                 | Licencia y coste de integración                                                                   |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [Ollama](https://docs.ollama.com/api/chat) y [NDJSON](https://docs.ollama.com/api/streaming) | Se usa su API nativa y estadísticas; conserva la ejecución local existente                                                                | No se incorpora código de Ollama; la licencia de cada modelo sigue siendo independiente           |
| [NVIDIA SMI](https://docs.nvidia.com/deploy/nvidia-smi/)                                     | Lectura fija de nombre y memoria en Tauri; no confundir memoria total de GPU con `size_vram` de un modelo en `/api/ps`                    | Utilidad del controlador existente; no se instala ni redistribuye                                 |
| [Pipecat](https://docs.pipecat.ai/overview/introduction)                                     | Framework de voz potencial para servidor futuro; no justifica sustituir el motor web/Tauri para corregir estos fallos                     | BSD-2 según su documentación; añade servicios/proceso y mantenimiento                             |
| [LiveKit Agents](https://docs.livekit.io/agents/)                                            | Transporte/agentes útil si se necesita WebRTC multiusuario; no necesario para entrenamiento local de una persona                          | No se incorporó; licencia, servidor y despliegue deben revisarse en una integración concreta      |
| [faster-whisper](https://github.com/SYSTRAN/faster-whisper)                                  | Candidato de servidor STT local; puede competir por GPU con Ollama. Se conserva el adaptador actual                                       | MIT del proyecto; CUDA/cuDNN y modelos tienen condiciones propias. No instalado ni comparado aquí |
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp)                                       | Candidato nativo multiplataforma; requiere empaquetar binarios/pesos y medir español/latencia                                             | MIT del proyecto; no se sustituyó Whisper WASM ni se descargaron pesos                            |
| [Docling](https://docling.ai/)                                                               | Candidato opcional para OCR/tablas/documentos complejos; es un componente local adicional, no una mejora gratuita de la extracción actual | No incorporado; verificar licencia de código/modelos y distribuir de forma explícita si se adopta |
| [Qdrant](https://qdrant.tech/)                                                               | Una base vectorial externa añade operación y migración; el índice IndexedDB actual permite corregir estos casos sin otro servicio         | No incorporado ni medido; revisar licencia del despliegue elegido antes de empaquetar             |
| [Three.js](https://threejs.org/docs/pages/WebGLRenderer.html)                                | Se conserva el renderer actual y su control de resolución/frecuencia                                                                      | Dependencia existente; no requiere migrar el producto                                             |
| [React Three Fiber](https://github.com/pmndrs/react-three-fiber)                             | Otro renderer React no aporta por sí solo mejores piel/ojos/rigs; no se migra                                                             | No incorporado; no se copiaron recursos ni código                                                 |
| [TalkingHead](https://github.com/met4citizen/TalkingHead)                                    | Referencia para rigs y visemas; exigiría un avatar compatible y temporización del proveedor                                               | MIT del código; avatares, audio y otros recursos tienen licencias distintas. No se importaron     |
| [MPFB](https://github.com/makehumancommunity/mpfb2) / MakeHuman                              | Candidato de producción offline de activos GLB, no sustitución automática en ejecución                                                    | Revisar licencia del programa y de cada recurso exportado; no se incorporaron assets              |

MetaHuman/Unreal no se integró: implicaría otro motor y otra cadena de distribución sin ventaja demostrada en este proyecto web/Tauri.

## Aplicación segura

El parche es un correo de `git format-patch`, compatible con `git am`, comprobado sobre la base indicada. La entrega incluye un script PowerShell que exige árbol limpio, verifica `git apply --check`, crea una rama de respaldo y aplica con `git am --3way`. No hace push, reset ni limpieza de archivos del usuario. Si la versión local contiene los parches 0.3.1 y la comprobación no pasa, hay que adaptar los cambios a ese código, no forzar este parche.

Tras aplicarlo:

```powershell
Set-Location -LiteralPath 'C:\my_drive\Portafolio\oratoria_lab'
pnpm install --frozen-lockfile
pnpm dev
```

En Configuración → Modelos de IA, conservar las asignaciones deseadas; aplicar el perfil equilibrado o elegir `qwen3.5:4b` en Conversación. Elegir «Conversación rápida» y razonamiento apagado para la primera prueba. Generar embeddings solo con el modelo dedicado seleccionado y los documentos deseados. El modo académico o un evaluador 9B siguen siendo opcionales.

## Archivos de la implementación

### Modificados

- `apps/desktop/src-tauri/src/lib.rs`
- `apps/desktop/src-tauri/src/models.rs`
- `apps/web/src/ai/desktop.ts`
- `apps/web/src/ai/hardware.ts`
- `apps/web/src/ai/llm.ts`
- `apps/web/src/ai/settings.ts`
- `apps/web/src/knowledge/MaterialPanel.tsx`
- `apps/web/src/knowledge/library.ts`
- `apps/web/src/pages/settings/Models.tsx`
- `apps/web/src/practice/HumanCommittee.tsx`
- `apps/web/src/practice/Report.tsx`
- `apps/web/src/practice/Room.tsx`
- `apps/web/src/practice/Setup.tsx`
- `apps/web/src/practice/records.ts`
- `apps/web/src/practice/store.ts`
- `apps/web/src/voice/piper.worker.ts`
- `apps/web/src/voice/tts.ts`
- `docs/ARCHITECTURE.md`
- `docs/AUDITORIA-V2.md`
- `docs/BENCHMARK.md`
- `docs/HARDWARE.md`
- `docs/STATUS.md`
- `package.json`
- `packages/conversation/src/engine.ts`
- `packages/conversation/src/index.ts`
- `packages/conversation/src/prompts.ts`
- `packages/conversation/src/rules.ts`
- `packages/conversation/src/types.ts`
- `packages/knowledge/src/index.ts`
- `packages/knowledge/src/library.ts`
- `packages/model-manager/src/catalog.ts`
- `packages/model-manager/src/index.ts`
- `packages/model-manager/src/ollama.ts`
- `packages/storage/src/index.ts`
- `scripts/benchmark-local.mjs`
- `tests/e2e/helpers.ts`
- `tests/unit/conversation.test.ts`
- `tests/unit/models.test.ts`

### Agregados

- `apps/web/src/knowledge/processing.worker.ts`
- `apps/web/src/practice/Diagnostics.tsx`
- `apps/web/src/practice/render-profile.ts`
- `docs/MODERNIZACION.md`
- `packages/conversation/src/diagnostics.ts`
- `packages/knowledge/src/preparation.ts`
- `packages/knowledge/src/query-cache.ts`
- `packages/model-manager/src/inference.ts`
- `packages/model-manager/src/ndjson.ts`
- `tests/e2e/streaming.spec.ts`
- `tests/unit/benchmark-local.test.ts`
- `tests/unit/conversation-streaming.test.ts`
- `tests/unit/knowledge-advanced.test.ts`
- `tests/unit/streaming.test.ts`
- `tests/unit/voice-cancellation.test.ts`

No se eliminaron archivos del repositorio. Los scripts de entrega y registros de ejecución se incluyen fuera del código de la aplicación.
