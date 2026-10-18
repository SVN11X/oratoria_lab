# Comparación con Yoodli, Orai y VirtualSpeech

Fecha: 18 de octubre de 2026. Esta comparación se basa en la documentación pública indicada en Fuentes y en lo que Oratoria Lab hace en esta entrega según [STATUS](STATUS.md). No se usaron cuentas de pago ni se probaron los productos comerciales, así que sus columnas resumen lo que ellos declaran. Los precios cambian con frecuencia y no se copian aquí: consúltalos en sus páginas.

## Resumen

| Aspecto                                     | Yoodli                                  | Orai                     | VirtualSpeech                       | Oratoria Lab (esta entrega)                                                                                    |
| ------------------------------------------- | --------------------------------------- | ------------------------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Modelo de negocio                           | Plan gratuito limitado y planes de pago | Suscripción en app móvil | Suscripción y planes para empresas  | Gratuito y de código abierto (MIT)                                                                             |
| Dónde se procesan tus datos                 | En la nube del proveedor                | En la nube del proveedor | En la nube del proveedor            | En tu equipo. Sin cuentas ni telemetría                                                                        |
| Funciona sin conexión                       | No                                      | No                       | No                                  | Sí, tras preparar el uso sin conexión e instalar los modelos                                                   |
| Simulación conversacional (roleplay)        | Sí, con IA en la nube                   | No es su foco            | Sí, con IA y escenarios en VR o web | Sí: seis prácticas con interlocutores por reglas o con un modelo local de Ollama                               |
| Defensa de tesis con comisión               | No es un escenario específico           | No                       | No es un escenario específico       | Sí: seis roles de comisión, temperamento y dificultad independientes, preguntas que citan página o diapositiva |
| Preguntas basadas en tus documentos         | No verificado                           | No                       | Escenarios configurables            | Sí: PDF, DOCX, PPTX y texto sin límite de caracteres, búsqueda local y citas verificables                      |
| Métricas de voz (ritmo, pausas, muletillas) | Sí                                      | Sí                       | Sí                                  | Sí, con DSP local y método explicado en cada criterio                                                          |
| Lenguaje corporal                           | Sí, con video                           | No verificado            | Sí, en VR y con cámara              | Sí, con MediaPipe local: mirada, gestos, manos en la cara y postura. Sin inferir emociones                     |
| Avatares                                    | Interlocutores virtuales                | No                       | Avatares 3D y entornos VR           | Avatares 2D vectoriales animados con sincronía labial aproximada. **Sin avatares 3D realistas**                |
| Voces                                       | Voces neuronales en la nube             | No aplica                | Voces neuronales en la nube         | Voces Piper locales, voces del sistema o servidor local. Menos expresivas que las comerciales                  |
| Evaluación                                  | Automática con IA                       | Puntajes automáticos     | Automática con IA                   | Criterios con nivel, evidencia literal y método. «No evaluado» cuando faltan datos. Evaluador sin temperamento |
| Seguimiento del progreso                    | Sí                                      | Sí                       | Sí                                  | Sí: historial unificado, tendencias por criterio y ejercicios recomendados                                     |
| Español                                     | No verificado                           | No verificado            | No verificado                       | Español como idioma principal de interfaz, preguntas y reglas                                                  |
| Plataformas                                 | Web e integraciones                     | iOS y Android            | Web, móvil y visores VR             | Web (GitHub Pages) y escritorio con Tauri. Sin app móvil nativa                                                |
| Funciones de equipos y administración       | Sí                                      | No                       | Sí                                  | No                                                                                                             |

## Dónde Oratoria Lab es más fuerte

1. Privacidad: tus grabaciones, documentos y respuestas no salen del equipo si usas modelos locales.
2. Defensa de tesis: comisión con roles académicos, preguntas ancladas a tu documento con página o diapositiva y detección de cifras que contradicen tu propio material.
3. Transparencia: cada criterio muestra cómo se midió, la evidencia literal y si no hubo datos suficientes.
4. Costo: gratuito, sin límites de uso impuestos por un servicio.

## Dónde todavía está por detrás

1. Realismo visual: no hay avatares 3D ni entornos VR.
2. Naturalidad de la voz: las voces Piper y del sistema son menos expresivas que las voces neuronales en la nube.
3. Calidad de las preguntas libres: depende del modelo local que el equipo pueda ejecutar. Con el motor de reglas son correctas pero más predecibles.
4. Validación: los umbrales de evaluación son referencias razonables, no valores validados con evaluadores humanos.
5. Plataformas: sin app móvil ni funciones para equipos.

## Fuentes

- [Yoodli Review: Features, Pricing, and How It Compares in 2026 (Outdoo)](https://www.outdoo.ai/blog/yoodli-review-and-pricing)
- [Best Yoodli Alternatives Compared (Outdoo)](https://www.outdoo.ai/blog/yoodli-alternatives)
- [Yoodli en Capterra](https://www.capterra.com/p/10019324/Yoodli/)
- [Orai en App Store](https://apps.apple.com/us/app/-/id1203178170)
- [VirtualSpeech: planes](https://virtualspeech.com/pricing)
- [VirtualSpeech: planes de suscripción (soporte)](https://support.virtualspeech.com/Subscription%20Plans-a4f49dcd-282b-4f21-9238-d0f044389ed7)

Las celdas de los productos comerciales se deben revisar contra estas fuentes antes de citarlas en otro documento: las páginas cambian y en esta sesión no fue posible abrir su contenido completo.
