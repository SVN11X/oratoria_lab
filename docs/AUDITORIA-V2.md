> Esta auditoría histórica se amplía en [MODERNIZACION](MODERNIZACION.md), con problemas comprobados, funciones afectadas, decisiones, pruebas y pendientes.

# Auditoría e implementación V2

Fecha: 23 de octubre de 2026. Base real: `cf8433151ea3743fb1b1e9862537eb68d4c61bae`, rama pública `main`. Entrega: 0.3.0. No se inspeccionó el disco del computador Windows del usuario ni se modificó el remoto.

## Diagnóstico de partida

El repositorio recibido ya contenía React 19, Vite 7, Tauri 2, once paquetes, seis escenarios con motor compartido, comisiones y temperamentos, extracción documental, índice híbrido, Piper, Whisper, cámara, historial y progreso. La [auditoría histórica](AUDITORIA.md) corresponde a `6861e06`, una versión anterior.

Se revisaron rutas, configuración web/escritorio, contratos y estados del motor, preguntas y repreguntas, evaluación, recuperación documental, importación, gestión de modelos y sus operaciones destructivas, grabación, almacenamiento, migración, voces, avatares, pruebas y workflows. Se preservó la arquitectura y la compatibilidad con datos anteriores.

La comprobación inicial pasó lint, TypeScript, 116 pruebas unitarias y build web. En Chromium 138 pasaron 16 de los 17 recorridos existentes: importar PDF falló con `toHex is not a function`. Los resultados de esta entrega están en [STATUS](STATUS.md).

## Fallos corregidos

| Hallazgo comprobado                                                       | Cambio aplicado                                                                                      | Evidencia                                        |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Reconocimiento en línea por defecto y al faltar Whisper                   | Respuestas escritas por defecto; ninguna sustitución automática hacia reconocimiento en línea        | Prueba de la cadena local                        |
| No había una sesión sin captura de medios                                 | Modalidad solo escrita con reloj propio, sin `getUserMedia`, pistas ni métricas acústicas inventadas | Reloj y recorridos con captura prohibida         |
| Personajes SVG como única representación                                  | Personas humanas 3D, rig corporal, piel, ropa, ojos y expresiones; un renderizador para la comisión  | Renderizado real y pruebas de geometría/recursos |
| Sustitución activaba el modelo nuevo aunque fallara la prueba             | Conservar asignaciones y mostrar error; probar también alternativas de embeddings                    | E2E con doble de Ollama                          |
| Desinstalación con inventario/conexión potencialmente antiguos            | Comprobar servidor y digest; detener si sigue cargado; reasignar sobre configuración actual          | E2E de gestión y revisión del flujo              |
| Respuestas de un inventario anterior sobrescribían una conexión nueva     | Secuencia de solicitudes y descarte de respuestas antiguas                                           | Revisión del flujo                               |
| NDJSON exigía salto de línea final                                        | Procesar último registro y cerrar lector                                                             | Pruebas de éxito y error final                   |
| Embeddings recortados a 4.000 caracteres y truncamiento implícito         | Fragmento completo y `truncate: false`                                                               | Adaptador; proveedor real pendiente              |
| Vectores incompatibles podían producir NaN                                | Descartar dimensiones distintas y valores no finitos                                                 | Prueba unitaria                                  |
| Citas aceptaban cualquier identificador con números                       | Solo `S1…` y `T1…` válidos, sin duplicados                                                           | Pruebas de evidencias                            |
| Turnos penalizaba interrupciones dependientes del temperamento            | Informarlas sin bajar por ello la calificación                                                       | Prueba de imparcialidad                          |
| Desactivar todos los criterios restauraba la rúbrica por defecto          | Respetar selección vacía, sin puntuación                                                             | Prueba unitaria                                  |
| Resumen libre del evaluador podía sobrevivir al rechazo de sus citas      | Derivarlo de criterios aceptados                                                                     | Prueba con texto inventado                       |
| Análisis libre enviaba solo el comienzo del material y de la intervención | Revisar toda la transcripción por partes, recuperar material pertinente y comprobar citas            | Texto extenso y citas inventadas                 |
| Comentarios del análisis libre se perdían al guardar                      | Campo opcional compatible, exportación e informe en historial; invalidación al editar transcripción  | Esquema y E2E de persistencia e invalidación     |
| No existía foco por diapositiva                                           | Selector, anterior/siguiente y recuperación de esa diapositiva con respaldo documental               | Prueba de exclusión de otras diapositivas        |
| PDF.js moderno incompatible con el navegador de prueba                    | Lector y worker `legacy` del mismo paquete                                                           | Recorrido PDF/DOCX/PPTX                          |
| JSON antiguo dañado bloqueaba historial actual                            | Aislar lectura fallida y conservar original; completar migración antes de marcarla                   | Revisión del flujo                               |
| Recursos gzip descomprimidos por el host fallaban la verificación offline | Fijar huellas para ambas representaciones; rechazar cualquier alteración                             | Prueba de integridad y recorrido offline         |
| Git con conversión CRLF alteraba el manifiesto de recursos verificado     | Marcar los recursos humanos como `-text` para conservar sus bytes                                    | Aplicación del parche en checkouts LF y CRLF     |
| Dos avisos de seguridad en Vitest 4.1.11                                  | Actualización a 4.1.12                                                                               | Auditoría final: cero avisos reportados          |

## Arquitectura resultante

Las seis prácticas mantienen `ConversationEngine`, escenarios y rúbricas diferenciadas. Los avatares usan `AvatarHandle`: boca, turno, reacción y mano levantada. No toman decisiones académicas ni alteran puntuaciones. Las señales labiales llegan del motor TTS; la sincronía es aproximada y no equivale a captura facial.

`HumanCommittee` carga recursos del propio sitio, mantiene un contexto WebGL, limita resolución y animación a 30 imágenes por segundo y libera texturas/esqueletos. Suspende fuera de la vista y al ocultar la pestaña, detiene la animación en pausa y respeta movimiento reducido. Ofrece ilustraciones si WebGL falla. El módulo 3D no se carga en Inicio.

Los recursos seleccionados suman 6.650.419 bytes. Proceden de HumanForge/MakeHuman/MPFB, con código MIT y recursos CC0. Origen y transformaciones: `apps/web/src/vendor/humanforge/UPSTREAM.md`; tamaños y SHA-256: `apps/web/public/avatars/PROVENANCE.json`. No se incluyen recursos con restricción de uso comercial de TalkingHead.

`evaluateSpeech` analiza partes consecutivas de la transcripción, usa la recuperación existente, solicita salidas estructuradas y comprueba las citas. El comentario sigue siendo una apreciación automática: una cita verdadera no garantiza una interpretación acertada. El evaluador conversacional usa extractos marcados y reglas sobre el texto completo; no equivale a leer toda la tesis con un LLM en cada turno.

## Modelos existentes y candidatos

No hay acceso al inventario del computador del usuario. Se preservan configuraciones y modelos; no se descarga ni elimina ningún peso allí. La aplicación consulta Ollama y sus cachés propias. `scripts/diagnostico-local.ps1` genera un informe de solo lectura de Windows, Ollama y nombres de cachés Hugging Face; no es un inventario universal de todas las aplicaciones.

| Tecnología              | Evidencia primaria y decisión                                                                                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LLM instalado en Ollama | Conservar hasta medirlo con material propio. No se impone reemplazar Qwen 2.5 por antigüedad. Dos modelos instalados no obligan a mantener ambos cargados.                                                                  |
| Whisper WASM            | Se mantiene instalación por huellas y adaptador. Inferencia con pesos y español reales pendiente aquí.                                                                                                                      |
| Faster-Whisper          | [Proyecto oficial](https://github.com/SYSTRAN/faster-whisper): CTranslate2, CPU/GPU e INT8. Candidato para servicio local; no puede ejecutarse como backend dentro de GitHub Pages. No se incorpora un servicio automático. |
| Piper                   | [Proyecto oficial](https://github.com/OHF-Voice/piper1-gpl): TTS local y eSpeak NG. Revisar GPL y licencia de cada voz. Se mantiene la integración existente, sin afirmar naturalidad medida.                               |
| Kokoro                  | [Model card](https://huggingface.co/hexgrad/Kokoro-82M): 82 millones de parámetros y pesos Apache-2.0. Candidato de servidor local; verificar español y las voces concretas.                                                |
| Qwen3-TTS               | [Proyecto oficial](https://github.com/QwenLM/Qwen3-TTS): variantes 0.6B/1.7B, español y control de estilo en algunas variantes. Requiere recursos propios; no se presenta como instalado ni integrado en el navegador.      |
| MediaPipe               | Se conserva el adaptador de observaciones corporales. No se infieren ansiedad, mentira o personalidad. Cámara con personas reales pendiente.                                                                                |

Cambiar ritmo/altura de Piper no es síntesis emocional. El adaptador de voz en servidor requiere una API compatible configurada explícitamente; no garantiza conexión directa con cualquier servidor de estos proyectos.

## Límites y trabajo pendiente

- Ollama real, STT/TTS, cámara y hardware del usuario requieren validación en ese computador. Los dobles comprueban integración y operaciones, no calidad de IA.
- No hay OCR para PDF escaneado, reranker neuronal, captura de emociones ni clonación de voz integrada. No se muestran controles que los prometan.
- La vista 3D tiene apariencias parametrizadas. No admite GLB personalizados, no es animación cinematográfica ni fotorrealismo. Voz y aspecto no están calibrados contra personas reales.
- Del video importado se analiza el audio. La cámara en vivo es otra función; no se promete análisis corporal del video importado.
- Material: límite explícito de 60 MiB por archivo. Grabaciones: 25 MiB y diez minutos. Se eliminó el límite arbitrario de 20.000 caracteres, no los límites de memoria del navegador.
- La evaluación es orientativa; no hay validación psicométrica ni experimento de superioridad frente a competidores.
- Las copias de sesión no son una copia única de todos los materiales, modelos y datos de la aplicación.
- El build nativo no pudo ejecutarse por ausencia de Rust/Cargo. No se entrega un instalador Windows probado; sí el código y el workflow de compilación existente.

Comparación y protocolo: [BENCHMARK](BENCHMARK.md). Comandos de aplicación y ejecución: [ENTREGA-0.3.0](ENTREGA-0.3.0.md).
