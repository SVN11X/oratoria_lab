# Arquitectura

## Flujo de audio

Micrófono → MediaStream → MediaRecorder → chunks de IndexedDB → Blob comprimido. AudioWorklet calcula niveles RMS actuales; AnalyserNode es el fallback. El reloj descuenta pausas. Detener, error o desmontaje libera tracks, nodos, contexto y temporizadores.

Importación → límite y firma de archivo → lectura de duración mediante audio local → decodificación Web Audio limitada a 10 minutos → copia de canales al worker → mezcla mono y FIR antes de resampling a 16 kHz → DSP → sesión y grabación original en almacenes separados. El worker es cancelable; la decodificación Web Audio ya iniciada no puede interrumpirse y termina antes de liberar sus buffers.

Solo la grabación producida por la app puede analizarse sin duración finita en la metadata del contenedor: su reloj y límite de captura ya acotan el contenido. Las importaciones con duración desconocida se rechazan antes de decodificar. Un archivo válido aún puede fallar por codec o memoria insuficiente.

## Métodos

`oratoria-dsp-1.0.0`: RMS de ventanas de 20 ms y umbral entre -60 y -15 dBFS. Rellena huecos internos menores a 100 ms y retira actividad menor a 80 ms. Suma duración real de ventanas finales. Las pausas son silencios internos ≥250 ms; los extremos se excluyen del número de pausas, pero se incluyen en silencio total.

RMS digital = raíz de media de cuadrados; dBFS = 20 log10(RMS), con suelo de -120 para evitar infinitos. Variación = desviación estándar/media del RMS en intervalos clasificados activos. No es una medida directa de prosodia ni dB SPL. El percentil 10 de energías se registra como referencia inferior; no determina automáticamente el umbral.

La frecuencia fundamental utiliza autocorrelación normalizada en ventanas de 50 ms cada 200 ms, con reducción a aproximadamente 8 kHz. Se exige un primer máximo local ≥0,8 en 70–400 Hz y al menos tres estimaciones para mostrar mediana. Tonos y música también pueden ser periódicos. Saturación se refiere a las muestras procesadas; resampling/mezcla pueden modificar el pico respecto del original.

`spanish-token-count-1.0.0`: tokens Unicode, diccionario de expresiones completas, sin inferencia semántica. Prioriza expresiones de varias palabras y evita contar el mismo token dos veces. Ritmo = palabras del texto guardado ×60/duración total del audio. No estima articulación por palabra ni precisa cuándo se pronunció un candidato dentro del segmento.

`manual-evidence-1.0.0`: cada nivel 0–3 necesita cita literal, segmento existente y justificación escrita. No evaluable se excluye del peso evaluado. Puntuación = Σ(peso×nivel/3)/peso evaluado; cobertura = peso evaluado/peso total. Se guarda snapshot de rúbrica, versión del texto y fecha. La transcripción corregida invalida la valoración previa, sin fabricar una nueva.

## Separación de capacidades

`core` define Zod/contratos sin UI; `audio` contiene DSP verificable y validación compartida de cabeceras/tamaños. `storage` presenta SessionStore: web IndexedDB, escritorio IPC/SQLite. `evaluation` contiene conteos, validación de evidencias y recomendaciones por reglas. `simulation` es un reducer independiente de IA. `transcription` define el adaptador y valida salida; la implementación browser vive junto al worker de Vite.

Whisper recibe exclusivamente PCM local en un worker. Primero valida los ocho archivos de un caché con nombre ligado a la revisión. Transformers permite archivos locales y desactiva repositorios remotos. El worker bloquea fetch salvo runtime WASM del mismo origen. CacheStorage devuelve los pesos previamente verificados; no hay petición que contenga audio o texto a Hugging Face.

Sin modelo: grabar, importar, analizar, escuchar, guardar, exportar, redactar transcripción y usar rúbricas siguen disponibles. Si falta un archivo, hay corrupción, falta memoria o la implementación WASM falla, se informa el error y no se genera texto ficticio.

SQLite guarda audio y metadata en una operación. La actualización de metadata conserva audio con COALESCE; eliminación borra una sola fila. UUID y límites se validan en Rust; SQL utiliza parámetros. Los esquemas completos del frontend se validan con Zod antes de persistir y al recuperar. Las rúbricas/preferencias/modelos del escritorio usan almacenamiento del WebView en esta etapa.

## Simulador de defensa

`packages/defense` no depende de la interfaz: extrae términos, genera preguntas y repreguntas por reglas, clasifica señales de rostro y postura, simula la atención del público, construye el informe y prepara y valida con Zod las respuestas JSON del modelo de lenguaje. Tiene pruebas con datos sintéticos.

En la web, `DefenseEngine` toma micrófono y cámara, mide cada 100 ms (RMS, umbral de Preferencias, tono con la misma autocorrelación del DSP) y analiza la imagen cada 125 ms con MediaPipe. Cada segundo resume todo en un `Tick` con su fase: exposición, pregunta de la comisión o respuesta. El informe usa solo los ticks del estudiante. La grabación se mantiene en memoria y no se guarda en IndexedDB. La transcripción en vivo se pausa mientras habla la comisión para no transcribir su voz.

## PWA y distribución

Build Vite produce assets y un Service Worker con manifiesto de tamaño/SHA-256 por recurso y caché versionado por hash del contenido. Preferencias ofrece preparación/actualización explícita. Instalación del worker no descarga el shell: solo una petición prepare verifica/reutiliza/descarga los recursos y cambia el marcador de la versión preparada al completar todos. Se conserva una versión estática anterior para chunks abiertos; no se tocan caches de modelos ni IndexedDB. Las rutas hash evitan necesidad de rewrite del servidor. ONNX usa un hilo WASM: no se exige COOP/COEP en Pages.

La primera preparación offline, solicitada por el usuario, copia los recursos estáticos completos, incluyendo runtime WASM y chunks opcionales de la UI; consume cuota y tráfico de descarga. Los pesos son una preparación separada y explícita. No hay backend, login, analítica ni CDN de ejecución. El desarrollo no registra Service Worker y usa un tratamiento CSP separado para el HMR local.

## Copias y restauración

`export/backup.ts` serializa una sesión y su grabación en un formato versionado, valida evidencias y límites, y utiliza Web Crypto para SHA-256/AES-GCM/PBKDF2. El worker `backup.ts` ejecuta serialización, Base64, comprobaciones y cifrado; la cancelación lo termina. Devuelve un Blob de descarga o una sesión validada con audio. El protocolo solo comunica fases reales de trabajo, sin porcentajes de progreso fabricados ni solicitudes de red.

La restauración muestra vista previa antes de escribir. Genera un UUID de sesión nuevo, conserva la fecha de práctica y guarda audio/metadatos en la operación atómica de SessionStore. La rúbrica de la valoración es un snapshot: en esa sesión prevalece sobre otra rúbrica local con el mismo id/versión y contenido distinto. No se cambia el catálogo global. La aplicación continúa almacenando sesiones sin cifrado en reposo. Formato, parámetros y límites: [BACKUPS](BACKUPS.md).

## Extensión

Para P2, añadir evaluador local con esquema Zod de hallazgos y verificación literal contra segmentos. La evidencia y timestamps deben salir del texto/segmentos reales, nunca de una predicción libre. Añadir sidecars nativos mediante comandos/capacidades específicos; no exponer shell arbitraria. Un modo de conversación dinámica debe declarar el modelo que realmente se ejecuta y mantener la máquina de estados como autoridad de turnos.
