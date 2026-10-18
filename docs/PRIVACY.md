# Privacidad y tratamiento de datos

## Principios

- Sin cuentas, publicidad, analítica ni telemetría oculta.
- Con la configuración inicial la app no hace ninguna solicitud de red fuera de su propio origen. Una prueba automática lo comprueba en Inicio y en Configuración.
- Ningún proveedor comercial es obligatorio. Los modelos de lenguaje, de voz y de transcripción se ejecutan en tu equipo o en un servidor que tú configuras.
- La página **Configuración → Privacidad** muestra, con tu configuración actual, qué sale del equipo y ofrece volver a procesamiento solo local.

## Datos locales

| Dato                                                | Web                                 | Escritorio (Tauri)                                |
| --------------------------------------------------- | ----------------------------------- | ------------------------------------------------- |
| Grabaciones analizadas, transcripciones, métricas   | IndexedDB                           | SQLite en el directorio de datos de la aplicación |
| Prácticas guiadas, informes y video opcional        | IndexedDB                           | Almacenamiento del WebView                        |
| Material académico, fragmentos y vectores           | IndexedDB                           | Almacenamiento del WebView                        |
| Modelos de Oratoria Lab (Whisper, Piper, MediaPipe) | CacheStorage, un espacio por modelo | Almacenamiento del WebView                        |
| Preferencias y asignación de modelos                | localStorage                        | localStorage del WebView                          |
| Modelos de Ollama                                   | Los administra Ollama               | Los administra Ollama                             |

La cámara se analiza en el equipo con MediaPipe. No se identifica a nadie ni se infieren emociones o personalidad. El video de una práctica solo se guarda si activas «Grabación» al configurarla.

Los datos no se cifran en reposo. La copia completa de una grabación puede cifrarse con contraseña (AES-256-GCM con PBKDF2-SHA256 de 600.000 iteraciones); ver [BACKUPS](BACKUPS.md).

## Conexiones

| Acción                                                    | Destino                                                         | Qué se envía                                                                                     |
| --------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Abrir la web o preparar el uso sin conexión               | Alojamiento de la página                                        | Solicitudes de archivos estáticos                                                                |
| Instalar Whisper o voces Piper (botón «Instalar»)         | `huggingface.co` y sus hosts de archivos                        | Descarga de archivos de una revisión fijada. Sin audio ni texto                                  |
| Instalar MediaPipe                                        | `storage.googleapis.com`                                        | Descarga de dos archivos. Sin imagen                                                             |
| Usar un modelo de lenguaje con Ollama                     | La dirección configurada (por defecto `http://localhost:11434`) | Contexto de la práctica, fragmentos de tu material, tu exposición y tus respuestas transcritas   |
| Descargar o desinstalar modelos de Ollama                 | Ollama local, que descarga de su propio registro                | Nombre del modelo                                                                                |
| Servidor compatible con OpenAI, de voz o de transcripción | La dirección que configures                                     | Texto de las preguntas (voz), audio de tus respuestas (transcripción) o la conversación (modelo) |
| Reconocimiento de voz del navegador (opcional)            | Google en Chrome, Microsoft en Edge                             | Audio del micrófono durante tus turnos                                                           |
| Voces en línea del navegador (desactivadas por defecto)   | Microsoft o Google                                              | Texto de las preguntas                                                                           |

La política de seguridad de contenido (CSP) de producción solo permite conectar con el propio origen, `localhost` y `127.0.0.1` en cualquier puerto, y los hosts de descarga de modelos. Si configuras una dirección que no es de tu equipo, la app lo advierte y la CSP del navegador bloqueará la conexión salvo que se trate de esos hosts.

## Gestión de modelos y archivos

- Los modelos de Ollama se instalan y desinstalan solo con su API oficial (`POST /api/pull`, `DELETE /api/delete`, `POST /api/generate` con `keep_alive: 0` para liberar memoria). Oratoria Lab no borra archivos de Ollama por su cuenta.
- En escritorio, el comando `ollama_storage` lee los manifiestos de Ollama **en modo solo lectura** para informar capas compartidas y el espacio liberado medido. No escribe, mueve ni borra nada, no sigue enlaces simbólicos y valida cada huella antes de usarla.
- Desinstalar un modelo de Oratoria Lab borra solo su espacio exclusivo en CacheStorage. La app comprueba después que ese espacio ya no existe.
- La app no ejecuta comandos del sistema. El escritorio expone siete comandos acotados: cinco de sesiones y dos de solo lectura (`system_info`, `ollama_storage`).

## Eliminación

Cada sesión se elimina desde el historial con confirmación. **Configuración → Gestión de datos** permite eliminar todos los datos de este equipo (con la opción de desinstalar también los modelos de Oratoria Lab) o restablecer la configuración. Ninguna de estas acciones toca los modelos de Ollama. La eliminación en bases de datos es lógica; no se promete borrado forense del soporte.

## Interpretación de resultados

Las mediciones (ritmo, pausas, volumen, mirada) son estimaciones técnicas, no juicios sobre la persona. Los criterios sin datos suficientes aparecen como «No evaluado». El evaluador con IA no recibe el temperamento de los interlocutores y sus valoraciones se descartan si citan frases que no aparecen literalmente en la transcripción. Los tests usan solo datos ficticios y la app nunca los inserta en tu historial.
