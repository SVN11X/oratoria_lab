# Publicar Oratoria Lab y comprobar la primera sesión

El repositorio está en [SVN11X/oratoria_lab](https://github.com/SVN11X/oratoria_lab), rama `main`. El nombre del paquete sigue siendo `oratoria-lab`; no necesita coincidir con el del repositorio. El workflow calcula automáticamente la ruta base `/oratoria_lab/` a partir del nombre del repositorio.

## Corrección previa y comprobación

La ejecución [Calidad web del 13 de octubre de 2026](https://github.com/SVN11X/oratoria_lab/actions/runs/38492791788) pasó instalación, formato, `pnpm check`, auditoría y preparación de Chromium. Su reporte registra siete E2E pasados y uno fallido: `pantalla vacía, tema, responsive y accesibilidad`, por contraste de textos. El texto secundario tenía ratio 4,41:1 sobre el panel suave; el pie del sidebar desbordaba el área de fondo en la ventana de 720 px de altura. Esta corrección oscurece el texto secundario y permite scroll vertical del menú. No elimina ni relaja la prueba de accesibilidad.

Después de incorporar el parche, sube el commit a `main` y revisa la nueva ejecución de **Calidad web**. La corrección debe volver a verificarse allí: los resultados del run anterior corresponden al código anterior. Esas pruebas usan audio sintético y no acreditan micrófonos físicos, Whisper ni todos los sistemas.

## Activar GitHub Pages

1. Abre [Settings → Pages](https://github.com/SVN11X/oratoria_lab/settings/pages).
2. En **Build and deployment → Source**, elige **GitHub Actions**. El workflow `pages.yml` ya está en el repositorio; usa ese archivo existente.
3. Abre [Actions → Publicar web en GitHub Pages](https://github.com/SVN11X/oratoria_lab/actions/workflows/pages.yml).
4. Pulsa **Run workflow**, selecciona `main` y confirma la ejecución.
5. Espera que los jobs `build` y `deploy` terminen correctamente. La ejecución muestra la URL publicada en el entorno `github-pages`.
6. Abre [https://svn11x.github.io/oratoria_lab/](https://svn11x.github.io/oratoria_lab/).

El workflow es manual: subir código por sí solo no ejecuta la publicación. Para publicar otra actualización, vuelve a ejecutarlo después de subir los cambios. El job compila y sube `apps/web/dist`; los visitantes reciben archivos ya compilados y no necesitan instalar Node.js.

La URL anterior es la esperada para este repositorio; no se debe considerar disponible hasta que `deploy` termine correctamente. Antes de activar Pages, la comprobación del 13 de octubre devolvía 404. Si un job falla, abre su paso rojo y revisa el error; no atribuyas éxito a la publicación por ver el código subido.

## Primera prueba de uso

En un navegador compatible, abre Estudio de grabación, concede permiso de micrófono, graba 20–30 segundos, detén y escucha el audio. Analiza, guarda, abre la sesión desde el historial, añade una transcripción manual y crea/restaura una copia. Prueba una recarga para comprobar persistencia. En Preferencias puedes preparar explícitamente la interfaz para uso offline y luego comprobar otra recarga sin conexión.

Solo después instala Whisper desde Modelos locales si deseas probar transcripción automática; su descarga es una acción separada. Para escritorio, el workflow manual `Verificar escritorio` prepara builds de Tauri, que necesitan validación por sistema. Publicar en Pages no genera un instalador de escritorio.
