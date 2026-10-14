# Copias completas por sesión

En una sesión guardada, pulsa **Copia completa**. Si hay cambios de transcripción sin guardar, primero guárdalos. La copia incluye grabación original, texto y preguntas de contexto, métricas almacenadas, objetivo y valoración con revisión de texto y snapshot de rúbrica. No incluye pesos de modelos, preferencias ni el catálogo completo de rúbricas. Los conteos léxicos son cálculos del texto y utilizan el diccionario del dispositivo de destino.

La protección por contraseña está seleccionada inicialmente. Usa una frase larga de al menos 12 caracteres y confirma el mismo valor; no se recortan espacios ni se modifica su Unicode. La app no puede recuperar una contraseña perdida. Para una copia legible sin contraseña, elige la opción correspondiente. El informe JSON ordinario sigue siendo una exportación de resultados sin audio; no se acepta como copia restaurable.

En **Historial → Restaurar copia**, selecciona el archivo, introduce su contraseña si corresponde y revisa la vista previa. **Guardar como sesión nueva** es el paso que escribe en el dispositivo. Conserva la fecha original y genera otro UUID, para mantener las sesiones existentes incluso si restauras el mismo archivo varias veces. Si falla almacenamiento, se informa el error y no se declara guardado. Los datos descifrados permanecen en la vista previa solo mientras el diálogo está abierto; cerrar descarta esa vista previa.

## Formato 1

| Archivo                   | Envoltura                               | Contenido                                                                                             |
| ------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `nombre.oratoria.json`    | `oratoria-session-backup`, versión 1    | Fecha de exportación, sesión validada y audio opcional en Base64 con MIME, bytes y SHA-256            |
| `sesion-cifrada.oratoria` | `oratoria-session-encrypted`, versión 1 | Parámetros fijos de cifrado, salt, IV y ciphertext en Base64; la copia completa anterior está cifrada |

El nombre genérico del archivo cifrado evita incluir el título en el nombre sugerido. La envoltura no contiene título, texto, fecha de práctica ni hash del audio en claro. Su tamaño y parámetros de cifrado son visibles.

## Cifrado

Web Crypto: AES-GCM con clave de 256 bits, IV aleatorio de 12 bytes y etiqueta de autenticación de 128 bits. La clave no es exportable y se deriva mediante PBKDF2-HMAC-SHA256, salt aleatorio de 16 bytes y 600.000 iteraciones. Cada exportación genera nuevo salt/IV con `crypto.getRandomValues`. Los datos autenticados adicionales fijan formato/versión y algoritmos. El importador solo admite esos parámetros; no ejecuta cantidades arbitrarias de iteraciones solicitadas por un archivo.

La derivación, serialización, comprobaciones y cifrado ocurren en un worker sin peticiones de red. Cancelar termina el worker. Se necesita HTTPS/localhost y soporte Web Crypto. Los valores se basan en las [interfaces de Web Crypto](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey), [parámetros de AES-GCM](https://developer.mozilla.org/en-US/docs/Web/API/AesGcmParams) y [PBKDF2](https://developer.mozilla.org/en-US/docs/Web/API/Pbkdf2Params). El coste PBKDF2 sigue la [referencia OWASP para HMAC-SHA256](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html); esto no constituye certificación criptográfica ni cumplimiento FIPS de la aplicación.

El cifrado protege el archivo exportado. No cifra IndexedDB, SQLite, preferencias ni el audio dentro de la aplicación. JavaScript puede mantener copias temporales de cadenas/buffers en memoria; no se garantiza su borrado físico. No hay recuperación de contraseña ni cuenta remota.

## Validación y límites

Se limita el archivo antes de leerlo: máximo 60 MiB, contenido sin cifrar máximo 44 MiB, metadatos de sesión máximo 8 MiB y audio original máximo 25 MiB/10 minutos. Se valida formato/versión, Base64 canónico, tamaños y SHA-256 del audio; además, esquema de sesión, tiempos y secuencia de frames/pausas, ids únicos, revisión de transcripción, pertenencia de criterios y citas exactas de cada nivel puntuado. La cabecera debe corresponder a un contenedor de audio admitido.

SHA-256 detecta un audio cambiado respecto del hash declarado; un archivo legible se puede editar y recalcular. AES-GCM rechaza ciphertext alterado o contraseña equivocada, con el mismo mensaje para ambos casos. Estas comprobaciones no autentican la identidad del autor ni prueban que las métricas provienen de una grabación auténtica. La restauración conserva resultados disponibles y no vuelve a ejecutar DSP/Whisper; escucha el audio y usa Reanalizar cuando necesites comprobarlos. La compatibilidad de codec sigue dependiendo del navegador/WebView.

Aunque la UI permanece en otro hilo, el archivo se serializa y procesa completo, con varias copias de Base64/buffers. Puede requerir bastante más RAM que su tamaño en disco; no es backup streaming ni almacenamiento ilimitado. No existe aún una copia global del dispositivo o sincronización. Las tres pruebas de almacenamiento nativo y los recorridos de navegador necesitan ejecutarse en sus entornos respectivos.

## Verificación

Vitest utiliza Web Crypto real en Node y un WAV sintético conocido. Comprueba ida/vuelta de texto/evidencias y audio exacto, cifrado/descifrado completo, salt/IV distintos, contraseña equivocada, corrupción, límites, parámetros KDF no admitidos, citas/revisiones inválidas e importación/persistencia con IndexedDB emulado. Se añaden dos recorridos Playwright para exportar/restaurar desde la interfaz, incluido el error de contraseña; están preparados y listados, sin ejecución de navegador en esta entrega. Consulta [STATUS](STATUS.md) para los resultados finales.
