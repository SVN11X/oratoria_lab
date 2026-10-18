# Próximos pasos

Prioridades ordenadas según lo que falta verificar o construir después de la versión 0.2.0. El estado actual está en [STATUS](STATUS.md).

## 1. Validar con componentes reales

- Conectar Ollama real: inventario, descarga, sustitución y desinstalación, comparando el espacio liberado en web y escritorio.
- Instalar Whisper Base y Small y medir errores de transcripción con voces de distintas regiones, ruido y respuestas largas, sobre grabaciones consentidas.
- Escuchar las cinco voces Piper y elegir las más naturales para cada temperamento.
- Probar MediaPipe con distintas cámaras, luz y distancias para ajustar los umbrales de mirada y postura.
- Compilar y probar el escritorio en Windows y macOS, incluido micrófono y cámara del WebView.

## 2. Calidad de la evaluación

- Calibrar los umbrales de los criterios con evaluadores humanos y documentar la concordancia.
- Medir la calidad de las preguntas de cada modelo local con un conjunto fijo de tesis ficticias.
- Agregar un reranker local opcional si mejora la precisión de las citas de forma medible.

## 3. Experiencia

- Avatares 3D con licencia compatible y blendshapes faciales, conectados a la interfaz `AvatarHandle` existente.
- Voces con más expresividad cuando exista un motor local verificable.
- Informe exportable a PDF.
- Práctica diapositiva por diapositiva con la presentación cargada.

## 4. Distribución

- Firmar binarios de escritorio y publicar versiones.
- Interfaz móvil optimizada para practicar respuestas cortas.

No se afirma superioridad frente a otros productos hasta tener comparaciones con pruebas equivalentes ([BENCHMARK](BENCHMARK.md)).
