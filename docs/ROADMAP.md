# Roadmap verificable

## P0: cerrar validación de la base implementada

La grabación/importación/DSP/persistencia/historial/exportación y la configuración Tauri están implementadas. Antes de considerar soportado un dispositivo, ejecutar los ocho E2E, comprobar micrófono real, desconexión, permisos, pausa, codecs, almacenamiento lleno y recarga offline. Compilar/probar SQLite e IPC en Windows/macOS/Linux y conservar Cargo.lock.

Validar móvil y accesibilidad con lector de pantalla, zoom y teclado; axe no sustituye esa revisión. Medir RAM de captura/decodificación además del benchmark DSP. Considerar recuperación de drafts huérfanos con ownership/heartbeat por pestaña antes de introducir limpieza automática.

## P1: comprobar transcripción y mejorar trazabilidad

El editor, conteos, rúbricas/manual-evidence, catálogo e integración Whisper están implementados. Verificar una instalación real, errores y cancelación en los navegadores, preparación offline, fallos de CORS/red y CacheStorage del WebView. Evaluar español de distintas regiones, nombres/números, silencio, ruido y duración larga; documentar WER/CER sobre corpus consentido y condiciones.

Las copias por sesión ya incluyen audio y datos, restauración validada con vista previa y cifrado opcional. Comprobar sus dos nuevos recorridos E2E y su interoperabilidad entre navegador/WebView, errores de cuota y cancelación con archivos grandes. La prueba de cifrado/descifrado y audio exacto en Node no acredita esa compatibilidad de interfaz.

Mejorar registro de revisiones y procedencia de texto editado, comparación de rúbricas con idéntica versión/cobertura/tarea y perfil de audio/canal. Incorporar copias globales de sesiones/rúbricas/preferencias y PDF cuando exista un motor real verificable. Preferir streaming/WebCodecs antes de ampliar los límites de archivo y memoria.

## P2: evaluación y conversación con modelos locales

El simulador de defensa ya incluye una primera versión: preguntas, repreguntas, interrupciones y comentario de contenido con un servicio compatible con OpenAI configurado por el usuario, con respaldo por reglas. Falta un modelo instalable dentro de la app y validar la calidad de las preguntas con evaluadores humanos.

Introducir LLM compatible/licenciado con instalación explícita, catálogo verificable, estimación de memoria y fallback claro. Iniciar con un backend realmente ejecutable y probado; después WebLLM o llama.cpp según plataforma. No añadir Ollama como requisito.

Validar hallazgos con Zod y citas/timestamps contra el texto. Rechazar evidencias inexistentes. Separar hallazgo interpretativo de cálculo; registrar modelo, cuantización, prompt/evaluador y rúbrica. Añadir ejercicios basados en hallazgos revisables y metas del usuario.

Extender la máquina de estados a conversación dinámica: turnos, límites, cancelación, capturas por respuesta y repreguntas que citen contenido real. Mantener preguntas fijas como modo guiado explícito. No presentar reglas predefinidas como IA.

## P3: complementos y comparación

La primera versión del análisis visual con MediaPipe está en el simulador de defensa (mirada, gestos, manos en la cara y postura). Falta validar sus umbrales con grabaciones reales consentidas y con distintas cámaras e iluminación.

Análisis visual local opcional con MediaPipe y permisos de cámara separados, indicadores de movimiento sin inferencias psicológicas ni reconocimiento de identidad. Síntesis local opcional, sidecars whisper.cpp/llama.cpp con capacidades acotadas, optimización por plataforma y distribución nativa firmada.

Solo después de pruebas comparables, estudiar ventajas frente a otros productos: precisión regional, utilidad de feedback con evaluadores humanos, privacidad, accesibilidad, latencia/RAM y reproducibilidad. No hay resultados comparativos en esta entrega y no se afirma superioridad.
