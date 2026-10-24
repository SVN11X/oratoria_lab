# Voz, transcripción y evaluación por bloques

Incremento sobre `df74b2ab9061fb02e75471925049e28534c6d94e`, sin nuevas dependencias ni migraciones de datos. Conserva la conversación rápida, los seis escenarios, los modelos elegidos, los documentos y las grabaciones existentes.

## Cambios

- **Revisión de transcripción:** un detector conservador señala bucles consecutivos largos de palabras. La sala pausa el reconocimiento y permite editar el texto, confirmar una repetición intencional o volver a responder. Antes de esa decisión no se envía la respuesta al motor ni al evaluador. `transcriptReviews` conserva original y resultado en los datos de la práctica; `transcriptReviewed` identifica la confirmación explícita. El diagnóstico sin contenido excluye ambos textos.
- **Sesiones anteriores:** los informes muestran un aviso cuando encuentran bucles pendientes de revisión. Al evaluar un snapshot antiguo, las reglas y las citas de IA excluyen esas respuestas, sin modificar el snapshot. No se recalcula ni sobrescribe automáticamente la puntuación ya guardada.
- **Tiempo oral:** la duración termina al cerrar la captura, antes de esperar a Whisper. La fase de escucha termina en ese instante. La revisión humana se mide aparte; después de confirmarla, la espera hasta el audio vuelve a medirse desde la confirmación.
- **Captura local:** cortes en pausas desde cuatro segundos y un máximo de dieciséis segundos por fragmento, en lugar de doce/veintiocho. Cada trabajo conserva su frecuencia de muestreo; los resultados que llegan después de detener el reconocimiento se descartan.
- **Evaluación:** hasta tres criterios por llamada, esquema y textos de salida acotados, temperatura cero y un reintento de una salida inválida. Los bloques correctos sobreviven al fallo de otro. Se conservan las citas literales verificadas y las alternativas por reglas o «No evaluado». El contexto declara recortes; sesiones mayores de veinticuatro turnos usan una muestra distribuida para IA y conservan todos los turnos fiables para las reglas.
- **Premisas:** los prompts distinguen lo dicho por la persona de las hipótesis anteriores del interlocutor y piden conservar el alcance de cada cifra. Un guardia parcial rechaza siglas nuevas presentadas como hechos sin respaldo en las fuentes visibles o las respuestas. Las alternativas explícitamente hipotéticas siguen permitidas. Algunas citas atribuidas también se comprueban literalmente. Esto no verifica la verdad de toda una pregunta ni la relación semántica de todas sus cifras.
- **Piper:** primer fragmento de hasta noventa y seis caracteres y siguientes de hasta ciento sesenta, con cortes por palabras y preferencia por puntuación. Se conserva todo el texto. Continúa la preparación del siguiente fragmento durante la reproducción. El trabajador serializa carga, fonemas e inferencia, omite trabajos cancelados en cola y libera tensores. Una inferencia WASM ya iniciada puede terminar aunque se cancele; su audio obsoleto no se reproduce.
- **Medidas de voz:** cola, carga de voz, fonemas, inferencia y duración del audio generado, además de la síntesis total. La duración generada considera la velocidad de reproducción. Preparación y reproducción pueden solaparse: no se suman esas cifras para estimar la espera del usuario.

## Límites

El detector de bucles es una señal de revisión, no una estimación de exactitud. Una transcripción con términos técnicos deformados puede no contener repeticiones y seguir necesitando revisión. Confirmar el texto conserva la responsabilidad de comprobarlo; no lo convierte en una medición de calidad del modelo.

Los nuevos cortes de audio y de Piper necesitan validación con voz humana, los pesos reales y el equipo de destino. Las pruebas con señales sintéticas y respuestas controladas comprueban contratos y flujo. No demuestran una mejora de exactitud de Whisper ni permiten anunciar segundos de ahorro o naturalidad de la voz.

La voz sigue empezando después de validar el JSON completo de la intervención. Piper y Whisper mantienen su backend WASM y un hilo; no se incorpora un servidor, un modelo ni un uso de GPU nuevo. El build nativo Windows permanece pendiente.

## Verificación

```powershell
pnpm install --frozen-lockfile
pnpm format:check
pnpm check
pnpm test:e2e
```

La batería cubre bloqueo de bucles, confirmación intencional, exclusión de transcripciones antiguas, recuperación de JSON cortado, conservación de bloques válidos, premisas con siglas sin respaldo, integridad del texto de Piper, cancelación tardía de reconocimiento y serialización del trabajador de voz.

Los recorridos de navegador comprueban corregir, confirmar y volver a responder, con captura sintética y servidor STT de prueba. Verifican conservación del original en el JSON, privacidad del diagnóstico y que una demora artificial de transcripción no aumente la duración oral.

## Prueba en el equipo de destino

1. Mantener inicialmente el modelo conversacional y evaluador ya seleccionados; la corrección no cambia asignaciones.
2. Responder en voz alta tres preguntas y revisar que el texto reconocido corresponda con la grabación. Si aparece la revisión de bucles, corregir o volver a responder antes de continuar.
3. Confirmar en el informe qué criterios provienen de IA, reglas o mediciones. Las notas indican cualquier bloque que no pudo completar la IA.
4. Exportar diagnóstico e informe. Comparar captura, transcripción final, generación y primer audio por separado. Examinar también carga/fonemas/inferencia de Piper.
5. Revisar con una persona las preguntas y sus fuentes completas; no asumir rigor solamente por mostrar una cita o una puntuación.

Referencias de las API existentes: [salidas estructuradas de Ollama](https://docs.ollama.com/capabilities/structured-outputs), [pipeline ASR de Transformers.js](https://huggingface.co/docs/transformers.js/api/pipelines) y [configuración WASM de ONNX Runtime](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html).
