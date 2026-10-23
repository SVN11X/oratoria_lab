# Estado real de Oratoria Lab 0.3.0

Fecha: 23 de octubre de 2026. Base `cf8433151ea3743fb1b1e9862537eb68d4c61bae`. Auditoría histórica: [AUDITORIA](AUDITORIA.md); revisión y cambios actuales: [AUDITORIA-V2](AUDITORIA-V2.md).

**Verificado** significa ejecutado aquí; **con doble** significa API/pesos de prueba; **sin verificar** significa código existente sin ejecución con el componente real; **parcial** conserva límites explícitos. «Simulado» se reserva a comportamientos ilustrativos o datos de prueba, no a capacidades de IA que no se tienen.

## Comprobaciones de esta entrega

| Comprobación               | Resultado                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Lint y TypeScript estricto | Correctos                                                                                                            |
| Vitest 4.1.12              | 129 pruebas pasadas en doce archivos                                                                                 |
| Integridad de avatares     | 59 recursos, 6.650.419 bytes, SHA-256 correcto                                                                       |
| Build web e integridad     | 153 recursos y 61,33 MiB; bases `./` y `/oratoria_lab/`, SHA-256 correcto                                            |
| Navegador                  | 24 recorridos únicos aprobados en Chromium 138; WebGL por software y axe WCAG 2.2 AA                                 |
| Dependencias               | `pnpm audit --json`: cero avisos reportados al revisar 360 dependencias                                              |
| Benchmark DSP              | Tono sintético de diez minutos procesado; no mide calidad de habla ni aprendizaje                                    |
| Benchmark de conversación  | Cuatro casos ejecutados contra API de prueba; proveedor y modelos del usuario pendientes                             |
| Escritorio                 | Intentado; falla `cargo metadata` porque Cargo no está instalado. No compilado ni probado en Windows en esta entrega |

La pasada general aprobó 19 de 23 recorridos. Tras corregir la integridad de gzip en caché, actualizar la expectativa del resumen con evidencias y ajustar las pruebas gráficas a la rasterización por software, se repitieron seis recorridos afectados o nuevos: seis aprobados, incluidos los cuatro que habían fallado y la persistencia de comentarios del análisis libre. El total corresponde a 24 casos distintos. Antes se había corregido la incompatibilidad PDF con PDF.js legacy y el renderizado fuera de la vista.

Además se compiló con `VITE_BASE_PATH=/oratoria_lab/` y se comprobó en navegador el shell y los humanos 3D tras recargar sin red en esa subruta: sin errores de página ni respuestas HTTP fallidas. `pnpm format:check` y `git diff --check` pasaron. El build avisa sobre algunos módulos mayores de 500 kB; no impide compilar. La vista 3D se carga por demanda.

## Estado por función

| Función                                                        | Estado                                                   | Alcance y límites                                                                                                                              |
| -------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Seis prácticas y motor único                                   | Verificado                                               | Reglas de las seis; recorridos completos escritos de cada escenario                                                                            |
| Roles, cinco dificultades y seis temperamentos                 | Verificado                                               | Contratos y decisiones; la personalidad cambia interacción, no los criterios                                                                   |
| Preguntas/repreguntas, memoria, reformulación e interrupciones | Verificado por reglas / con doble para LLM               | Calidad de conversación libre con pesos reales pendiente                                                                                       |
| Comisión con IA local                                          | Con doble                                                | Ollama/OpenAI compatible; los pesos de un LLM no están incluidos en el parche                                                                  |
| Material PDF, DOCX, PPTX, TXT, MD y TeX                        | Verificado                                               | Multiarquivo y ubicaciones. 60 MiB por archivo; PDF escaneado sin OCR                                                                          |
| Recuperación léxica/semántica persistente                      | Verificado / con doble para embeddings                   | BM25, vectores, fusión y diversidad. Sin reranker neuronal; no se envía el documento entero por turno                                          |
| Comparar presentación con tesis                                | Verificado                                               | Reglas orientativas de cobertura/cifras; no certifica exactitud científica                                                                     |
| Foco de ensayo por diapositiva                                 | Verificado en integración de almacenamiento/recuperación | Selección y navegación en configuración; respaldo de otros documentos, exclusión de otras diapositivas                                         |
| Inventario de modelos y asignación por tarea                   | Con doble                                                | Ollama y cachés propias; no descubre todas las aplicaciones del sistema                                                                        |
| Instalar, cancelar, reintentar y desinstalar                   | Con doble                                                | API oficial de Ollama y cachés gestionadas; confirmación, verificación y protección de compartidos                                             |
| Sustitución segura                                             | Con doble                                                | Una prueba fallida conserva el modelo anterior; anterior se elimina solo con otra confirmación                                                 |
| Espacio recuperado                                             | Parcial                                                  | Web no mide bytes físicos de Ollama. Comando nativo de lectura existe; no compilado en esta entrega                                            |
| Hardware y rendimiento                                         | Parcial                                                  | Navegador aproximado; CIM/servicio nativo requieren el equipo Windows real                                                                     |
| Personas humanas 3D                                            | Verificado con recursos reales                           | Rig, geometría, piel y expresiones; render y movimiento en Chromium con WebGL por software. No fotorrealismo ni modelos GLB personalizados     |
| Sincronía de voz y avatar                                      | Parcial                                                  | Señales del TTS y visemas aproximados; sin medición perceptual de desfase con voces reales                                                     |
| Piper y voces del sistema                                      | Con doble / sin verificar con voces reales               | ONNX de prueba y WASM; naturalidad en español no escuchada/medida aquí                                                                         |
| Whisper local y servicios de STT                               | Sin verificar con pesos reales                           | Descarga e integridad probadas; reconocimiento de habla real pendiente                                                                         |
| Privacidad inicial                                             | Verificado                                               | Sin solicitudes a proveedores externos por defecto; Whisper ausente no activa reconocimiento en línea                                          |
| Solo escribir                                                  | Verificado                                               | No solicita micrófono/cámara; no fabrica datos acústicos o corporales                                                                          |
| Cámara MediaPipe                                               | Sin verificar con personas/modelos reales                | Observaciones de orientación y postura; no inferencia de estados internos                                                                      |
| Evaluación y rúbricas                                          | Verificado / con doble para apreciaciones LLM            | Citas comprobadas, criterios vacíos respetados, «No evaluado» sin datos; escala orientativa                                                    |
| Grabación libre e importación                                  | Verificado                                               | Audio de WAV/MP3/OGG/WebM/MP4/M4A/FLAC compatibles; máximo 25 MiB/diez minutos. Del video se analiza audio                                     |
| Comentarios de contenido de grabaciones                        | Verificado por contratos / E2E con doble                 | Transcripción completa por partes, recuperación y citas. Persistencia en sesión/exportación; interpretación de IA pendiente de revisión humana |
| Historial y progreso                                           | Verificado                                               | Datos anteriores se conservan; migración de informes personales antiguos no ejecutada aquí                                                     |
| Uso sin conexión y copias                                      | Verificado                                               | Preparación del shell y copias de sesión; modelos requieren instalación previa. No hay copia única de todo el entorno                          |
| Navegación, dos temas y accesibilidad                          | Verificado en los recorridos indicados                   | axe WCAG 2.2 AA; no equivale a una certificación exhaustiva ni prueba con todos los apoyos técnicos                                            |
| GitHub Pages                                                   | Build y subruta verificados                              | No hay backend en Pages; publicación remota no realizada                                                                                       |
| Atención del público ilustrado                                 | Simulado y declarado                                     | No mide la atención de personas reales                                                                                                         |
| OCR, reranker neuronal, clonación de voz, GLB personalizados   | No implementado                                          | No se anuncian como funciones disponibles                                                                                                      |

## Validación que requiere el equipo real

1. Ejecutar el inventario de solo lectura y verificar sus modelos instalados antes de decidir cambios.
2. Evaluar preguntas y repreguntas con el LLM real, incluidas referencias, temperamento y calidad académica.
3. Escuchar voces reales, medir transcripción y sincronía audiovisual en español con micrófono/audífonos.
4. Revisar cámara, accesibilidad y rendimiento sin inferir ansiedad, mentira o personalidad.
5. Compilar y probar el escritorio Windows y sus lecturas de espacio, micrófono/cámara y almacenamiento.
6. Comparar resultados con evaluadores humanos mediante el [protocolo reproducible](BENCHMARK.md).
