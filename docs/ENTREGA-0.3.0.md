# Entrega 0.3.0 y comandos PowerShell

El parche se prepara sobre `cf8433151ea3743fb1b1e9862537eb68d4c61bae` y contiene recursos binarios. No se asume que el remoto coincida con tus cambios locales. La validación sobre esa base no garantiza aplicación sobre cualquier versión distinta.

## Aplicar el parche

La entrega es un único archivo `oratoria-lab-0.3.0.patch`, compatible con `git am`. Contiene dos commits: primero fija los atributos de los recursos para conservar sus bytes en Windows y después aplica la implementación completa. Descárgalo y aplica estos comandos en PowerShell. Ajusta la carpeta del repositorio y del parche si son diferentes.

```powershell
& {
    $ErrorActionPreference = 'Stop'
    $PSNativeCommandUseErrorActionPreference = $false
    Set-Location -LiteralPath 'C:\my_drive\Portafolio\oratoria_lab'
    $PatchPath = "$env:USERPROFILE\Downloads\oratoria-lab-0.3.0.patch"
    if (-not (Test-Path -LiteralPath $PatchPath -PathType Leaf)) { throw 'No se encuentra el parche.' }
    $Changes = git status --porcelain
    if ($LASTEXITCODE -ne 0) { throw 'No es un repositorio Git accesible.' }
    if ($Changes) { throw 'Guarda o confirma tus cambios antes de aplicar el parche.' }
    $AmPath = git rev-parse --git-path rebase-apply
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo consultar el estado de Git.' }
    if (Test-Path -LiteralPath $AmPath) { throw 'Ya hay una aplicación de parche en curso.' }
    git merge-base --is-ancestor cf8433151ea3743fb1b1e9862537eb68d4c61bae HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Tu rama no contiene la base de esta entrega. Revisa su versión antes de continuar.' }
    $NewBranch = 'mejora/oratoria-lab-0.3.0-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
    git switch -c $NewBranch
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear una rama de trabajo.' }
    git am --3way -- "$PatchPath"
    if ($LASTEXITCODE -ne 0) { throw 'Git detuvo la aplicación. Revisa git status y los conflictos; no se descartó tu rama anterior.' }
}
```

Los comandos exigen un árbol limpio, comprueban la base y crean una rama nueva desde tu HEAD. Conservan la rama anterior; no publican ni eliminan cambios automáticamente. Git necesita tu nombre y correo de autor configurados para `git am`. El parche también incorpora `scripts/aplicar-parche-0.3.0.ps1` para aplicaciones futuras desde otra copia.

Si falta la base, `git fetch origin` permite consultarla sin reemplazar tu rama. Si aun así tu rama no la contiene, revisa `git log` antes de aplicar: se necesita esa versión de código para adaptar el parche.

## Ejecutar y comprobar la web

Requisitos: Node.js 22.12 o superior; pnpm 11.25.0.

```powershell
& {
    $ErrorActionPreference = 'Stop'
    $PSNativeCommandUseErrorActionPreference = $false
    Set-Location -LiteralPath 'C:\my_drive\Portafolio\oratoria_lab'
    node --version
    if ($LASTEXITCODE -ne 0) { throw 'Node.js no está disponible.' }
    npm install --global pnpm@11.25.0
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar pnpm.' }
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Falló la instalación de dependencias.' }
    pnpm check
    if ($LASTEXITCODE -ne 0) { throw 'Falló una comprobación. Revisa su salida antes de continuar.' }
    pnpm dev
}
```

Abre `http://localhost:5173`. Para preparar GitHub Pages:

```powershell
& {
    Set-Location -LiteralPath 'C:\my_drive\Portafolio\oratoria_lab'
    $env:VITE_BASE_PATH = '/oratoria_lab/'
    try {
        pnpm build
        if ($LASTEXITCODE -ne 0) { throw 'Falló la compilación web.' }
        pnpm verify:build
        if ($LASTEXITCODE -ne 0) { throw 'Falló la verificación del build.' }
    } finally { Remove-Item Env:\VITE_BASE_PATH -ErrorAction SilentlyContinue }
}
```

El resultado está en `apps/web/dist`. El workflow Pages existente puede publicarlo cuando tú decidas actualizar el remoto; esta entrega no lo publica.

## Recorrido de uso

1. Configuración → Modelos de IA: revisar lo instalado antes de descargar. Conservar modelos que aún sirven y probar candidatos antes de cambiarlos.
2. Elegir cualquiera de las seis prácticas, tema y participantes. Dificultad y temperamento son independientes.
3. Elegir «Hablar y escribir» o «Solo escribir». Esta última modalidad no pide micrófono ni cámara y no produce calificaciones de voz/cuerpo.
4. Cargar material. Si hay PPTX, elegir toda la presentación o una diapositiva y documentos de respaldo.
5. Configurar vista 3D o ilustraciones; entrar a la sala. Para voz privada instalar/seleccionar Whisper y Piper existentes o configurar servicios locales compatibles. El reconocimiento del navegador es una opción en línea explícita.
6. Al terminar, revisar evidencias, criterios y ejercicios; repetir y consultar historial/progreso. Los comentarios del análisis libre se conservan con la sesión y se pueden exportar.

## Pruebas de navegador

```powershell
pnpm exec playwright install chromium
$env:PW_SOFTWARE_GL = '1'
try { pnpm test:e2e } finally { Remove-Item Env:\PW_SOFTWARE_GL -ErrorAction SilentlyContinue }
```

La opción activa WebGL por software solo en el navegador de pruebas. Los modelos de Ollama y Piper usados por las pruebas son dobles, no pesos ni voces reales del usuario.

## Escritorio

Instalar primero los [prerrequisitos oficiales de Tauri 2](https://v2.tauri.app/start/prerequisites/) y Rust/Cargo. En Windows incluyen herramientas de compilación C++ y WebView2.

```powershell
Set-Location -LiteralPath 'C:\my_drive\Portafolio\oratoria_lab'
pnpm desktop:dev
# Para generar el instalador:
pnpm desktop:build
# Pruebas nativas:
cargo test --manifest-path .\apps\desktop\src-tauri\Cargo.toml
```

En este entorno la compilación nativa se detuvo porque Cargo no está instalado. No se adjunta un instalador verificado.

Inventario y benchmark de modelos ya instalados: [BENCHMARK](BENCHMARK.md). Estado real de las funciones: [STATUS](STATUS.md).
