> La sala incorpora una ruta conversacional directa con streaming NDJSON, planificación local, evaluación separada, diagnóstico y preparación documental reutilizable. Detalle y límites: [MODERNIZACION](MODERNIZACION.md). La ruta estructurada anterior se conserva por compatibilidad.

# Arquitectura

## Visión general

```text
apps/web            React 19 + Vite 7. Interfaz, workers y adaptadores del navegador
apps/desktop        Tauri 2 (Rust). Reutiliza apps/web/dist y agrega SQLite y comandos de solo lectura
packages/
  core              Esquemas Zod y contratos de sesión
  audio             DSP: actividad, pausas, RMS, F0 y remuestreo
  evaluation        Conteo de palabras, muletillas, evidencias y rúbricas manuales
  conversation      Motor conversacional universal, escenarios, personas, criterios, evaluación y entrenador
  knowledge         Extracción PDF/DOCX/PPTX/texto, segmentación, índice híbrido y comparación de presentación
  model-manager     Cliente de la API de Ollama, catálogo, auditoría, perfiles y modelos administrados
  defense           Señales de cámara, informe de voz y cuerpo, términos clave (reutilizado por la sala)
  storage           IndexedDB (web) y adaptador SQLite (escritorio)
  export            Informes, copias completas y cifrado
  transcription     Contrato y validación de transcripciones
  simulation        Prácticas escritas de la versión anterior (solo pruebas de compatibilidad)
```

Ningún paquete depende de la interfaz. La interfaz depende de los paquetes y aporta lo que solo existe en el navegador: micrófono, cámara, workers, CacheStorage y audio.

## Motor conversacional (`packages/conversation`)

Una sola máquina de estados sirve a las seis prácticas guiadas. Los escenarios son datos (`scenarios.ts`): roles, áreas de preguntas, criterios, saludo, cierre y apertura (exposición, presentación o ninguna).

- **Estados del motor**: `idle → opening → exposition → questions → closing → finished`. La sala tiene además fases de interfaz (agente hablando, respuesta, pensando).
- **Etapas de exigencia**: introducción, fundamentos, inconsistencias, objeciones, síntesis e integración. La dificultad fija la etapa máxima y la cantidad de repreguntas; con exigencia progresiva la etapa avanza con la sesión.
- **Dificultad y temperamento son independientes**. La dificultad (básica a defensa extrema) define la profundidad de las preguntas. El temperamento (amable a desafiante) define tono, paciencia, probabilidad de repreguntar, interrupciones y prosodia de la voz. Un filtro de civilidad rechaza insultos o descalificaciones, también en las salidas del modelo.
- **Memoria**: áreas cubiertas, preguntas hechas (para no repetir), respuestas débiles y afirmaciones de la persona para detectar contradicciones.
- **Análisis de cada respuesta** (`analysis.ts`): tipo (correcta, parcial, no comprende, contradice el documento, sin sustento, reconoce una limitación, pide reformular, evade, sin respuesta), coincidencia con la pregunta, justificación, evidencia, estructura STAR y cifras que no coinciden con el material.
- **Generadores**: reglas (`rules.ts`) siempre disponibles y modelo de lenguaje opcional (`LlmPort`). Las salidas del modelo se validan con Zod, pasan por el filtro de civilidad y por el control de repetición. Tras tres fallos el motor sigue con reglas e informa el cambio.
- **Contratos tipados**: `SessionConfig`, `Participant`, `Move`, `TurnRecord`, `EngineSnapshot`.

## Evaluación y entrenador

`evaluation.ts` evalúa criterios inteligentes (`criteria.ts`): cada uno tiene dimensión, indicador, por qué importa, cuatro niveles y métodos permitidos (medición, regla o IA). Si faltan datos el criterio queda **No evaluado** y no pesa en el índice. Cuando se usa un modelo, su nivel solo se acepta si cada evidencia citada aparece literalmente en la transcripción; el prompt del evaluador no incluye el temperamento de los interlocutores. `coach.ts` elige ejercicios para los criterios más débiles, compara con la sesión anterior del mismo escenario y calcula habilidades prioritarias.

## Material académico (`packages/knowledge`)

1. Extracción: PDF con pdf.js (reconstrucción de líneas y títulos por tamaño de fuente, aviso si parece escaneado), DOCX y PPTX descomprimidos con fflate (estilos de título, tablas, notas del orador y orden real de diapositivas), Markdown, LaTeX y texto.
2. Segmentación por estructura (secciones, páginas, diapositivas) en fragmentos de unos 1.000 caracteres sin truncar el documento.
3. Índice híbrido: BM25 con raíces en español y, si hay modelo de embeddings, similitud de coseno. Los resultados se combinan con fusión de rangos recíprocos y se diversifican con MMR.
4. Cada fragmento conserva su ubicación (página, diapositiva o sección) para citarla en las preguntas.
5. `comparePresentation` señala cobertura, cifras ausentes o distintas, conceptos ausentes y secuencia entre la presentación y el documento.

Los documentos, fragmentos y vectores se guardan en IndexedDB. Los vectores se indexan por par fragmento y modelo, así que cambiar de modelo de embeddings no mezcla espacios.

## Gestor de modelos (`packages/model-manager` y `apps/web/src/ai`)

- `OllamaClient` usa solo endpoints documentados: `/api/version`, `/api/tags`, `/api/ps`, `/api/show`, `/api/pull` (NDJSON con progreso y cancelación), `DELETE /api/delete`, `/api/generate` con `keep_alive: 0`, `/api/chat` con esquema JSON y `/api/embed`.
- `auditModels` revisa lo instalado antes de recomendar descargas: conservar, actualizar, complementar, sustituir o desinstalación opcional. Nunca recomienda borrar solo por antigüedad.
- `planProfile` asigna funciones (conversación, evaluación, embeddings) priorizando lo instalado y lista lo que falta para cada perfil.
- Los modelos administrados por Oratoria Lab (Whisper Tiny, Base y Small; cinco voces Piper; MediaPipe) se guardan cada uno en un caché exclusivo. Whisper Tiny y MediaPipe tienen huellas SHA-256 fijadas en el código; los demás registran su huella al instalar y se comprueban en cada uso.
- Desinstalar: liberar memoria si está cargado, llamar a la API oficial, verificar que ya no aparece, reasignar funciones y medir el espacio (exacto en escritorio, estimado en web).

## Voz, transcripción y sala

- **Captura**: un AudioWorklet entrega cuadros PCM para la transcripción local y un AnalyserNode mide el nivel. `MediaSensors` resume voz, cámara y tono cada segundo, separado por fase.
- **Transcripción**: Whisper en un worker persistente con ONNX Runtime WASM, por fragmentos cortados en pausas; servidor local compatible con OpenAI; o reconocimiento del navegador, declarado como en línea.
- **Voz**: Piper en un worker (fonemas con espeak-ng WASM e inferencia ONNX), voces del sistema filtradas a locales, servidor local compatible con OpenAI o solo texto. La prosodia cambia con el temperamento. Si la persona habla con audífonos mientras un interlocutor habla, la voz se corta.
- **Avatares**: `HumanCommittee` renderiza personas 3D con HumanForge/MakeHuman/MPFB, un contexto WebGL y vistas por participante. Límite de resolución/30 fps; suspensión fuera de vista, al ocultar y en pausa; liberación de recursos al salir. `AvatarHandle` une boca, modo, reacción y mano con TTS y motor. Las ilustraciones SVG se conservan como opción ligera. Ambas respetan reducción de movimiento; la sincronía labial es aproximada.
- **Modo escrito**: `TextSensors` proporciona un reloj sin permisos, pistas, ticks acústicos ni datos de cámara. El motor, las preguntas y los criterios textuales son los mismos.
- **Grabaciones**: `evaluateSpeech` revisa la transcripción completa por partes y recupera referencias del índice existente. Descarta citas inventadas y guarda los comentarios en `Session.speechFeedback`, opcional para compatibilidad. Editar o reemplazar la transcripción invalida ese comentario.
- **Foco documental**: la configuración puede fijar una diapositiva. El recuperador conserva sus fragmentos y excluye las otras diapositivas, usando documentos sin diapositivas como respaldo.

## Escritorio

Comandos Rust: cinco de sesiones (UUID validado, SQL con parámetros, metadatos y audio en una operación) y dos de solo lectura. `system_info` usa `sysinfo` para memoria, CPU y sistema. `ollama_storage` busca la carpeta de modelos (`OLLAMA_MODELS`, `~/.ollama/models` y rutas del servicio de Linux), lee manifiestos con límites de tamaño y cantidad, ignora enlaces simbólicos y huellas inválidas, calcula capas compartidas y suma el tamaño real de los blobs. La CSP permite Ollama local y los hosts de descarga de modelos.

## Métodos de medición de audio

`oratoria-dsp-1.0.0`: RMS de ventanas de 20 ms y umbral entre -60 y -15 dBFS. Rellena huecos internos menores a 100 ms y retira actividad menor a 80 ms. Las pausas son silencios internos de 250 ms o más. dBFS = 20 log10(RMS), con suelo de -120. La frecuencia fundamental usa autocorrelación normalizada en ventanas de 50 ms cada 200 ms, entre 70 y 400 Hz, con un máximo de correlación de 0,8 o más. No es dB SPL ni detecta emociones.

`spanish-token-count-1.0.0`: tokens Unicode y diccionario de expresiones completas. Ritmo = palabras × 60 / duración total del audio.

## PWA y distribución

El build genera un Service Worker con tamaño y SHA-256 de cada recurso. La preparación sin conexión es explícita desde Gestión de datos y conserva la versión anterior hasta verificar la nueva. ONNX Runtime usa un hilo WASM, por lo que no se necesitan cabeceras COOP/COEP y la app funciona en GitHub Pages. Whisper y Piper comparten una sola copia del runtime (`public/ort`), y el build elimina la copia duplicada que Vite emitiría.
