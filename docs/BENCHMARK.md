# Comparación y benchmark reproducible

Revisión: 23 de octubre de 2026. Las columnas comerciales reflejan documentación pública de los proveedores. No se probaron sus cuentas, modelos ni tratamientos internos de datos. «No verificado» no significa que una función no exista.

| Aspecto                 | Yoodli                                                                   | Orai                                      | VirtualSpeech                                                      | Oratoria Lab 0.3.0                                                                                               |
| ----------------------- | ------------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Conversación adaptativa | Roleplays y varias personas [1][2]                                       | Práctica y comentarios de oratoria [4]    | Roleplays, objeciones y personalización [6]                        | Seis escenarios por reglas o LLM local; calidad con pesos reales pendiente                                       |
| Comisión y documentos   | Tesis completa con citas: no verificado                                  | No verificado                             | Escenarios personalizables; citas a tesis: no verificado           | Roles y temperamentos, PDF/DOCX/PPTX, recuperación con ubicaciones                                               |
| Voz y personajes        | Interlocutores virtuales [1]                                             | No es el foco del producto [4]            | Avatares y entornos web/VR [6]                                     | Humanos 3D y voces locales; sin comparación perceptual                                                           |
| Métricas y progreso     | Comentarios y seguimiento [1]                                            | Ritmo, muletillas, claridad y energía [4] | Evaluación por escenario [6]                                       | DSP, criterios, citas, historial y ejercicios; umbrales sin calibración humana                                   |
| Español                 | No verificado aquí                                                       | No verificado aquí                        | Más de veinte idiomas anunciados; verificar escenario concreto [6] | Interfaz y reglas en español; STT/TTS dependen del modelo                                                        |
| Precio                  | Acceso gratuito limitado y planes de pago según condiciones vigentes [3] | Planes personales y de equipos [5]        | Planes y complementos de pago [6]                                  | Código abierto, sin API comercial obligatoria                                                                    |
| Local y sin conexión    | No verificado                                                            | No verificado                             | No verificado                                                      | Datos y métricas locales; preparación offline. Reconocimiento del navegador en línea solo por elección explícita |

## Protocolo de comparación

1. Usar una investigación **ficticia** y las mismas respuestas grabadas en cada producto. Registrar fecha, versiones, idioma, hardware, configuración y plan. No subir tesis reales a servicios externos sin decisión expresa de su propietario.
2. Ejecutar cuatro condiciones: amable/experta, desafiante/intermedia, escéptica/avanzada y seria/experta. Repetir cada una tres veces y alternar el orden.
3. Dos evaluadores sin conocer el producto valoran pertinencia, rigor, dependencia de la respuesta anterior, consistencia del rol, dificultad y utilidad, con escala 0–3 y ejemplos. Registrar desacuerdos.
4. Contar citas válidas, afirmaciones sin respaldo, repeticiones, fallos y tareas no disponibles. Un identificador válido no demuestra que la fuente respalde la pregunta.
5. Medir latencia inicial y por turno, con mediana y percentil 95. Para voz, usar mismo micrófono, audífonos, frase y terminología; comparar transcripción con referencia manual.
6. Evaluar naturalidad y comprensión con oyentes. Medir desfase audiovisual con grabación de pantalla. Un test JSON no mide naturalidad.
7. Registrar RAM/VRAM medidas cuando existan, recursos transferidos, trabajo sin red y eliminación. Distinguir tamaño lógico y espacio realmente recuperado.

## Herramientas incluidas

```powershell
Set-Location -LiteralPath 'C:\my_drive\Portafolio\oratoria_lab'
ollama list
# Cambia los nombres por los que realmente aparezcan instalados.
node .\scripts\benchmark-local.mjs --models 'qwen2.5:7b,qwen3:4b' --output '.\benchmark-local.json'
```

El script solo habla con Ollama en loopback y no descarga ni elimina modelos. Guarda cuatro casos ficticios por modelo, respuesta, digest, latencia, carga y tokens/s cuando Ollama los informa. Comprueba formato JSON e identificadores; deja calidad para revisión humana. No se ejecutó contra modelos del usuario.

Inventario Windows de solo lectura:

```powershell
& .\scripts\diagnostico-local.ps1 -OutputPath '.\oratoria-diagnostico-local.json'
```

No invoca `powershell.exe` ni instala o elimina modelos. El informe contiene hardware y nombres de cachés para revisión local.

`pnpm test` verifica reglas y contratos. `pnpm test:e2e` recorre la interfaz. `pnpm benchmark` mide un tono sintético en el DSP, no habla humana ni calidad pedagógica. Estas pruebas no son una comparación experimental con los productos comerciales.

## Resultados de calidad

No existe un experimento comparativo realizado. Control local, comisión académica configurable y evidencia visible son capacidades; no demuestran por sí solas mejores aprendizajes ni mayor naturalidad.

## Fuentes primarias

1. [Yoodli: plataforma](https://yoodli.ai/)
2. [Yoodli: varias personas](https://yoodli.ai/feature-announcements/talk-the-talk-with-multi-persona-roleplays)
3. [Yoodli: planes](https://yoodli.ai/pricing)
4. [Orai: producto](https://orai.com/product/)
5. [Orai: planes](https://orai.com/pricing/)
6. [VirtualSpeech: roleplays, idiomas y modalidades](https://virtualspeech.com/platform/roleplays)
