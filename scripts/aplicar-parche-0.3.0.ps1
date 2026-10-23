[CmdletBinding()]
param(
    [string]$Repository = 'C:\my_drive\Portafolio\oratoria_lab',
    [string]$PatchPath = (Join-Path $PSScriptRoot 'oratoria-lab-0.3.0.patch')
)
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$Base = 'cf8433151ea3743fb1b1e9862537eb68d4c61bae'
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git no está disponible en esta sesión.' }
if (-not (Test-Path -LiteralPath $PatchPath -PathType Leaf)) { throw ('No se encuentra el parche: ' + $PatchPath) }
$PatchPath = (Resolve-Path -LiteralPath $PatchPath).Path
Set-Location -LiteralPath $Repository
& git rev-parse --is-inside-work-tree
if ($LASTEXITCODE -ne 0) { throw 'La carpeta no es un repositorio Git.' }
$Status = @(& git status --porcelain=v1 --untracked-files=all)
if ($LASTEXITCODE -ne 0) { throw 'Git no pudo consultar el estado.' }
if ($Status.Count -gt 0) { throw 'Conserva los cambios locales antes de continuar. Este script no los sobrescribe.' }
$AmState = & git rev-parse --git-path rebase-apply
if ($LASTEXITCODE -ne 0) { throw 'Git no pudo consultar su estado interno.' }
if (Test-Path -LiteralPath $AmState) { throw 'Hay una aplicación de parches o rebase pendiente. Revísala antes de continuar.' }
& git cat-file -e ($Base + '^{commit}')
if ($LASTEXITCODE -ne 0) { throw 'La base del parche no está disponible. Ejecuta git fetch origin y revisa la rama; no se cambió ningún archivo.' }
& git merge-base --is-ancestor $Base HEAD
if ($LASTEXITCODE -ne 0) { throw 'La rama actual no contiene la base cf84331. Este parche no fue validado sobre esa versión. No se cambió la rama.' }
$Branch = 'mejora/oratoria-lab-0.3.0-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
& git switch -c $Branch
if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear la rama de trabajo.' }
& git am --3way -- $PatchPath
if ($LASTEXITCODE -ne 0) { throw 'El parche se detuvo. La rama anterior se conserva. Revisa git status; git am --abort cancela solo este intento. No ejecutes reset --hard.' }
& git status --short
if ($LASTEXITCODE -ne 0) { throw 'No se pudo consultar el resultado.' }
Write-Host ('Parche aplicado en: ' + $Branch)
Write-Host 'Siguiente paso: pnpm install --frozen-lockfile; pnpm check; pnpm dev'
