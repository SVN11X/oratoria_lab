> **GPU de 6 GiB:** el candidato de conversación equilibrada es Qwen 3.5 4B si está instalado. Se respetan las selecciones existentes. 7B/9B siguen disponibles, pero no se deduce velocidad a partir de la RAM. Véase [MODERNIZACION](MODERNIZACION.md).

# Requisitos de equipo

Oratoria Lab funciona sin ningún modelo: los interlocutores usan el motor de reglas, las respuestas pueden ser escritas o reconocidas por el navegador y el análisis de voz es DSP local. Los modelos agregan naturalidad y calidad, y cada uno tiene un costo de memoria y de disco. Las cifras de esta página son estimaciones de referencia, no mediciones en tu equipo. Para medir tu caso usa **Configuración → Modelos de IA → Probar velocidad**.

## Sin modelos

| Recurso   | Mínimo razonable                                                                     |
| --------- | ------------------------------------------------------------------------------------ |
| Navegador | Chrome, Edge o Firefox actuales. Safari con limitaciones de MediaRecorder            |
| RAM       | 4 GB                                                                                 |
| Disco     | Unos 61,3 MiB de descarga para el shell offline, más caché, grabaciones y documentos |
| Red       | Solo para abrir la web la primera vez. La app de escritorio no la necesita           |

## Perfiles de modelos

El perfil sugerido se calcula con lo que la plataforma permite saber. En el navegador la RAM es aproximada (Chrome informa como máximo 8 GB), no se conoce la VRAM y el microbenchmark de CPU no permite inferir más memoria. Tauri consulta CPU/RAM del sistema y VRAM NVIDIA mediante nvidia-smi si está disponible; la implementación nativa requiere validación en Windows. No se recomienda un modelo grande solo por tener 32/64 GB de RAM.

| Perfil               | Equipo orientativo                                                          | Conversación (Ollama) | Búsqueda en tu material | Transcripción | Disco aproximado |
| -------------------- | --------------------------------------------------------------------------- | --------------------- | ----------------------- | ------------- | ---------------- |
| Eficiente            | 8 GB de RAM, sin GPU dedicada                                               | qwen3.5:2b            | qwen3-embedding:0.6b    | Whisper Tiny  | 3,5 a 4 GB       |
| Equilibrado          | 16 GB de RAM                                                                | qwen3.5:4b            | qwen3-embedding:0.6b    | Whisper Base  | 4,5 a 5 GB       |
| Máxima calidad local | VRAM medida de al menos 10 GiB, unos 8 disponibles, y prueba real favorable | qwen3.5:9b            | bge-m3                  | Whisper Small | 8 a 9 GB         |

Las voces Piper ocupan entre 63 y 110 MB cada una y usan entre 150 y 300 MB de RAM mientras están cargadas. MediaPipe (cámara) descarga unos 10 MB.

Los tamaños de descarga de Ollama se consultaron en ollama.com el 17 de octubre de 2026 y pueden cambiar. La aplicación siempre muestra el tamaño real que informa Ollama después de instalar.

## Qué consume cada parte

| Función                     | Dónde corre                               | Consumo principal                       |
| --------------------------- | ----------------------------------------- | --------------------------------------- |
| Análisis de voz (DSP)       | Web Worker del navegador                  | CPU, pocos MB                           |
| Transcripción Whisper       | Web Worker, ONNX Runtime WASM en un hilo  | CPU y 0,5 a 3 GB de RAM según el modelo |
| Voces Piper                 | Web Worker, espeak-ng WASM y ONNX Runtime | CPU, 150 a 300 MB por voz               |
| Cámara (MediaPipe)          | Navegador, WASM con SIMD                  | CPU, 150 a 300 MB                       |
| Interlocutores y evaluación | Ollama u otro servidor local              | RAM o memoria de GPU según el modelo    |
| Búsqueda por significado    | Ollama (embeddings)                       | Poco; se calcula una vez por documento  |

Whisper y Piper usan un solo hilo para no exigir cabeceras COOP/COEP, que GitHub Pages no permite. Por eso Whisper Small puede tardar varias veces la duración del audio en equipos sin GPU. Para respuestas largas conviene Whisper Base o un servidor local de transcripción (whisper.cpp o faster-whisper) configurado en Modelos de IA.

## Navegadores

| Capacidad                           | Chrome / Edge                     | Firefox              | Safari                          |
| ----------------------------------- | --------------------------------- | -------------------- | ------------------------------- |
| Grabación y análisis                | Sí                                | Sí                   | Parcial (formatos de grabación) |
| Reconocimiento de voz del navegador | Sí, en línea (Google o Microsoft) | No                   | Parcial                         |
| Whisper, Piper y MediaPipe          | Sí                                | Sí                   | Sin verificar                   |
| Ollama desde la web publicada       | Con `OLLAMA_ORIGINS`              | Con `OLLAMA_ORIGINS` | Con `OLLAMA_ORIGINS`            |

Estas columnas resumen el soporte esperado según las APIs que usa la app. En esta entrega solo se ejecutaron pruebas automáticas en Chromium.

## Actualización 0.3.0

Los archivos del shell verificado de esta entrega suman aproximadamente 61,3 MiB, incluyendo bibliotecas WASM y recursos humanos, antes de instalar modelos. Algunos recursos ya están comprimidos con gzip: la caché puede guardar su representación descomprimida según el servidor y ocupar más espacio. Ambas representaciones se verifican por SHA-256. Los recursos humanos seleccionados suman 6,65 MB; sus geometrías y texturas consumen memoria adicional al cargarse. La vista usa un contexto WebGL y limita resolución y animación; se suspende al quedar fuera de la vista, al ocultar la pestaña o pausar. Elige ilustraciones para reducir consumo. No se ha medido un mínimo de GPU/RAM para todas las comisiones en hardware del usuario.

La configuración inicial usa respuestas escritas y cámara apagada. «Solo escribir» permite entrenar sin pedir micrófono ni cámara. Para reconocimiento local hay que seleccionar un Whisper instalado; si falta, la aplicación no cambia a reconocimiento en línea automáticamente.
