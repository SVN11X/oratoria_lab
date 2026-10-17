# Privacidad y tratamiento de datos

## Datos locales

El estudio y las prácticas escritas usan solamente micrófono. El simulador de defensa puede pedir además la cámara, si el usuario la activa. La imagen se analiza en el navegador con MediaPipe y no se envía ni se guarda, salvo la grabación que el usuario decide descargar. Grabaciones originales, texto, métricas, objetivo y valoración se conservan en el dispositivo. Web: IndexedDB para sesiones/audio/chunks/rúbricas, CacheStorage para modelos y shell, localStorage para preferencias. Tauri: sesiones y audio en SQLite del directorio de datos de la aplicación; los demás datos en el WebView.

Al grabar se escriben chunks comprimidos temporales. Al terminar se ensamblan y retiran; descartar o desmontar limpia el draft. Un cierre abrupto del proceso puede dejar chunks huérfanos: no hay recuperación automática ni garbage collection entre pestañas en esta versión, para evitar borrar grabaciones activas de otra pestaña.

No se implementan cuentas, sincronización, analytics, publicidad, reconocimiento de identidad ni inferencia de emociones. Solo las dos opciones del simulador indicadas en la tabla envían datos de práctica a terceros, y únicamente cuando el usuario las activa. Los informes del simulador se guardan en localStorage del navegador (máximo 10). Bibliotecas JS, CSS y runtime WASM se incluyen en el build y se sirven desde el mismo origen.

## Conexiones

| Acción                                                        | Destino                                                                                          | Contenido enviado                                                                                                   |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Abrir/cargar web o preparar/actualizar offline explícitamente | Alojamiento elegido                                                                              | Solicitudes de recursos estáticos e información normal de conexión; sin audio/texto                                 |
| Descargar Whisper explícitamente                              | `huggingface.co` y hosts HTTPS de Hugging Face (`*.hf.co`, `*.huggingface.co`, `*.xethub.hf.co`) | GET de archivos de una revisión fijada; IP/metadatos de conexión; sin credenciales, referrer, audio o transcripción |
| Abrir un enlace de procedencia                                | Sitio indicado en el enlace                                                                      | Navegación elegida por el usuario                                                                                   |
| Grabar, DSP, editar, valorar, practicar, exportar             | Sin servicio externo                                                                             | Datos procesados localmente                                                                                         |
| Descargar modelos de cámara explícitamente                    | `storage.googleapis.com`                                                                         | GET de dos archivos de MediaPipe e información normal de conexión. Sin imagen, audio ni texto                       |
| Transcripción en vivo del simulador (opcional)                | Servicio de reconocimiento del navegador (Google en Chrome, Microsoft en Edge)                   | Audio del micrófono mientras el usuario expone o responde                                                           |
| Comisión con IA del simulador (opcional)                      | Dirección configurada por el usuario (local con Ollama/LM Studio, o Gemini/OpenAI)               | Título, resumen, texto transcrito de la exposición y de las respuestas. La clave de API se guarda en localStorage   |
| Desarrollo                                                    | Vite en localhost, incluyendo WebSocket HMR                                                      | Recursos locales de desarrollo                                                                                      |

No hay actualizador Tauri remoto configurado. En PWA, preparar/actualizar el shell requiere una acción explícita y SHA-256 por recurso. Las comprobaciones del script pequeño del Service Worker pueden seguir el ciclo del navegador; la versión preparada del shell se conserva hasta terminar otra preparación. La CSP de producción permite origen propio, medios blob, workers propios y las familias de hosts de descarga. El worker de inferencia añade un bloqueo de fetch fuera del runtime propio. Este bloqueo no equivale a aislamiento total del equipo o protección frente a una extensión maliciosa.

## Conservación y eliminación

El usuario puede exportar TXT, CSV, JSON y original de audio como archivos ordinarios sin cifrado. El informe JSON registra métodos y diccionario; no incluye bytes de audio. La función Copia completa genera un archivo restaurable por sesión, con audio original y datos guardados, y permite cifrar todo su contenido con una contraseña. La opción cifrada utiliza AES-256-GCM, salt/IV aleatorios y PBKDF2-SHA256 con 600.000 iteraciones. La contraseña se usa en un worker local, no se persiste ni se envía; al cerrar se retira del estado del formulario y el worker termina. No se promete borrado físico de todas las copias temporales de memoria de JavaScript.

El archivo cifrado se descarga con nombre genérico; no expone título, texto ni fecha de práctica en su envoltura, aunque su tamaño sigue siendo visible. La contraseña no es recuperable por la app. El cifrado del archivo no cambia la protección de las sesiones que ya están almacenadas en IndexedDB/SQLite. Se puede eliminar cada sesión con confirmación y el modelo separadamente. Una nueva versión del shell no elimina sesiones/modelos.

No hay cifrado en reposo implementado. La base Rust limita el directorio propio a modo 0700 en Unix; Windows utiliza el directorio de datos del usuario con sus permisos del sistema. La protección del dispositivo/perfil depende del sistema y del navegador. Eliminación en DB es lógica; no se promete borrado forense del soporte. En web, otros scripts del mismo origen pueden acceder a sus almacenes, por lo que el origen de publicación forma parte de la confianza.

Los navegadores pueden desalojar datos, negar persistencia o restringir almacenamiento. Las cuotas y retención no son ilimitadas. Al borrar datos del sitio se pierden sesiones web, preferencias y modelos. Mantén copias de lo que desees conservar. Restaurar una copia requiere selección explícita, descifrado si corresponde, validación y confirmación de la vista previa; solo entonces guarda una nueva sesión mediante el almacén local. La validación no certifica quién generó sus resultados. No se importan preferencias, modelos ni rúbricas ajenas a la valoración guardada, y no existe sincronización automática entre web y escritorio. Consulta [BACKUPS](BACKUPS.md).

## Interpretación de resultados

Actividad es estimación energética, no detección certificada de voz; ritmo depende de la exactitud de la transcripción. Candidatos léxicos y frecuencia fundamental no determinan personalidad, confianza, emoción u honestidad. Las valoraciones son manuales, con evidencia y cobertura, y se diferencian de las mediciones. Whisper no se usa para identificar a nadie; texto y tiempos requieren revisión.

Los tests emplean únicamente datos sintéticos y respuestas ficticias claramente de prueba. La aplicación abre vacía y no los inserta en el historial del usuario.
