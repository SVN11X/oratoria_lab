# Estado real de Oratoria Lab

Fecha: 18 de octubre de 2026. Versión de interfaz 0.2.0. Punto de partida auditado: commit `6861e06` ([AUDITORIA](AUDITORIA.md)).

Categorías: **verificado** (ejecutado con éxito en una prueba automática de esta entrega), **verificado con doble de prueba** (funciona contra un servidor o archivo que imita al real), **implementado sin verificar** (el código existe y compila, pero no se pudo ejecutar con el componente real), **parcial** y **no implementado**.

## Comprobaciones ejecutadas en este entorno

| Comprobación                                    | Resultado                                                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm lint`, `pnpm typecheck`, `prettier`       | Correctos                                                                                       |
| `pnpm test` (Vitest)                            | 116 pruebas pasadas en 9 archivos                                                               |
| `pnpm build` y `pnpm verify:build`              | Correctos. 89 recursos, 54,37 MiB, SHA-256 y tamaño verificados (antes: 86 recursos, 65,43 MiB) |
| Playwright en Chromium 1194                     | 17 de 17 recorridos pasados (detalle abajo)                                                     |
| axe, WCAG 2.2 AA                                | Sin violaciones en 10 pantallas en modo claro y oscuro, en la sala y en el informe              |
| `cargo test` (escritorio)                       | 9 de 9 pruebas Rust pasadas                                                                     |
| `cargo build` del binario de escritorio (Linux) | Correcto. Con la interfaz incluida, la app abre en una pantalla virtual y muestra Inicio        |
| Descarga de modelos reales                      | **No posible aquí**: la red de este entorno bloquea Hugging Face, ollama.com y Google Storage   |

Recorridos de Playwright: grabación con micrófono sintético, importación y análisis, permiso rechazado, inicio sin solicitudes externas y navegación móvil, accesibilidad en dos temas, uso sin conexión, copia completa y copia cifrada, práctica de defensa de tesis completa, entrevista sin presentación, material PDF/DOCX/PPTX con comparación y búsqueda por significado, gestor de modelos de Ollama, conexión fallida a Ollama, práctica con modelo local simulado, voz Piper administrada y rechazo de archivos alterados de Whisper.

## Estado por función

| Función                                                                             | Estado                         | Evidencia y límites                                                                                                                                     |
| ----------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seis prácticas guiadas con motor conversacional único                               | Verificado                     | Pruebas unitarias de los seis escenarios con reglas. E2E completos de defensa de tesis y entrevista con respuestas escritas                             |
| Flujo práctica, escenario, participantes, material, simulación, evaluación, repetir | Verificado                     | E2E. Configuración rápida y avanzada                                                                                                                    |
| Comisión de tesis con seis roles, nombres ficticios y especialidad                  | Verificado                     | Pruebas unitarias y E2E                                                                                                                                 |
| Dificultad (5 niveles) y temperamento (6 estilos) independientes                    | Verificado                     | Pruebas unitarias: el temperamento cambia el tono y la repregunta, no la evaluación. Filtro de civilidad probado                                        |
| Repreguntas, interrupciones, antirepetición y exigencia progresiva                  | Verificado                     | Pruebas unitarias del motor. Interrupción durante la exposición sin E2E propio                                                                          |
| Preguntas ancladas al material con página, diapositiva o sección                    | Verificado                     | Unitarias y E2E (el informe cita el archivo). Detección de cifras que contradicen el documento                                                          |
| Material académico PDF, DOCX, PPTX, TXT, MD y LaTeX, sin límite de caracteres       | Verificado                     | Unitarias con documentos generados y E2E en el navegador. PDF escaneado: se avisa, no hay OCR                                                           |
| Búsqueda local híbrida (palabras y significado) con RRF y MMR                       | Verificado con doble de prueba | Unitarias. E2E con embeddings de un servidor que imita Ollama. Sin reranker neuronal                                                                    |
| Comparación presentación y documento                                                | Verificado                     | Unitarias y E2E                                                                                                                                         |
| Gestor de modelos: inventario, auditoría, perfiles, asignación por función          | Verificado con doble de prueba | E2E contra un servidor con la API documentada de Ollama. **No probado contra Ollama real**                                                              |
| Descarga con progreso, cancelación y reintento                                      | Verificado con doble de prueba | E2E                                                                                                                                                     |
| Desinstalación real con la API oficial y verificación posterior                     | Verificado con doble de prueba | E2E comprueba que solo se envía `DELETE /api/delete` con el modelo confirmado. Ollama real pendiente                                                    |
| Sustitución guiada (descargar, probar, reasignar, preguntar)                        | Verificado con doble de prueba | E2E                                                                                                                                                     |
| Espacio liberado exacto y capas compartidas (escritorio)                            | Verificado en Rust             | Pruebas Rust con una carpeta de Ollama de prueba. La interfaz de escritorio no se automatizó                                                            |
| Detección de equipo                                                                 | Parcial                        | Web: RAM aproximada del navegador, núcleos, WebGPU y prueba de CPU. Escritorio: `system_info` con pruebas Rust                                          |
| Prueba de velocidad de un modelo                                                    | Verificado con doble de prueba | E2E. Las cifras reales dependen de tu equipo                                                                                                            |
| Interlocutores y evaluación con modelo local                                        | Verificado con doble de prueba | E2E con preguntas y evaluación simuladas. La calidad con modelos reales no se midió                                                                     |
| Evaluación con criterios, evidencia literal y «No evaluado»                         | Verificado                     | Unitarias (citas inventadas se descartan, evaluación igual entre temperamentos) y E2E                                                                   |
| Entrenador, historial unificado y Mi progreso                                       | Verificado                     | E2E y unitarias. La migración de informes antiguos de localStorage no tiene prueba automática                                                           |
| Voces Piper locales                                                                 | Verificado con doble de prueba | E2E: instalación, verificación, fonemas espeak-ng WASM, inferencia ONNX y uso en la sala con un modelo ONNX mínimo de prueba. **Voz real no escuchada** |
| Prosodia por temperamento y corte de voz al interrumpir                             | Implementado sin verificar     | Código y vista previa; el corte requiere audífonos y micrófono real                                                                                     |
| Voces del sistema                                                                   | Implementado sin verificar     | Chromium sin interfaz no tiene voces en español                                                                                                         |
| Whisper Tiny, Base y Small por turnos                                               | Implementado sin verificar     | E2E solo comprueba que archivos alterados se rechazan. El modelo nunca se ejecutó                                                                       |
| Reconocimiento de voz del navegador                                                 | Implementado sin verificar     | En línea en Chrome y Edge. No existe en WebKitGTK (escritorio Linux)                                                                                    |
| Servidores locales compatibles con OpenAI (modelo, voz, transcripción)              | Implementado sin verificar     |                                                                                                                                                         |
| Cámara con MediaPipe (mirada, gestos, postura)                                      | Implementado sin verificar     | El motor WASM carga; los modelos reales no se pudieron descargar aquí. No infiere emociones                                                             |
| Avatares animados con sincronía labial                                              | Parcial                        | Personas vectoriales 2D con parpadeo, mirada, gestos y visemas. **No hay avatares 3D realistas** (ver Decisiones)                                       |
| Práctica libre y análisis de grabación con línea de tiempo                          | Verificado                     | E2E de grabación e importación. La línea de tiempo permite saltar al momento                                                                            |
| Rediseño, tema claro y oscuro, navegación nueva                                     | Verificado                     | E2E y axe                                                                                                                                               |
| Uso sin conexión y copias cifradas                                                  | Verificado                     | E2E                                                                                                                                                     |
| Privacidad: sin solicitudes externas por defecto                                    | Verificado                     | E2E en Inicio y Configuración                                                                                                                           |
| Escritorio Tauri                                                                    | Parcial                        | Binario Linux compilado y abierto en pantalla virtual. Windows y macOS sin compilar aquí. Micrófono y cámara en WebView sin probar                      |
| GitHub Pages                                                                        | Parcial                        | Build con base de subcarpeta verificado. Publicación remota no ejecutada desde aquí                                                                     |

## Decisiones por límites verificables

- **Avatares 3D realistas**: requieren modelos humanos 3D con licencia compatible y blendshapes faciales, que no se pueden descargar ni verificar en este entorno. Se entregó la mejor alternativa realista: avatares 2D vectoriales animados, livianos, accesibles y sin descargas. Se deja preparada la interfaz `AvatarHandle` (boca, modo, reacción, mano levantada) para conectar un renderizador 3D en el futuro.
- **Reordenamiento neuronal**: no se agregó un reranker. La fusión de rangos con diversidad funciona sin modelos adicionales.
- **Whisper multihilo**: se usa un hilo para funcionar en GitHub Pages sin cabeceras especiales. Es más lento.
- **Voz con emoción**: Piper no cambia de emoción. La variación por temperamento se logra con ritmo, altura y pausas.

## Qué falta verificar en un equipo real

1. Conectar Ollama real, instalar y desinstalar un modelo, y comparar el espacio liberado en web y escritorio.
2. Instalar Whisper y escuchar la calidad de transcripción con voces en español de Chile.
3. Instalar voces Piper reales y evaluar su naturalidad.
4. Instalar MediaPipe y probar mirada y postura con una persona frente a la cámara.
5. Compilar y probar el escritorio en Windows y macOS, incluidos micrófono y cámara.
6. Calibrar los umbrales de evaluación con evaluadores humanos.
