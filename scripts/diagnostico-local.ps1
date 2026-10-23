[CmdletBinding()]
param(
    [string]$OutputPath = (Join-Path (Get-Location) 'oratoria-diagnostico-local.json')
)
$ErrorActionPreference = 'Stop'
# Inventario de solo lectura. No descarga, ejecuta ni elimina modelos.
function Read-LocalApi([string]$Path, $Body = $null) {
    $Parameters = @{ Uri = ('http://localhost:11434' + $Path); TimeoutSec = 15; ErrorAction = 'Stop' }
    if ($null -ne $Body) {
        $Parameters.Method = 'Post'
        $Parameters.ContentType = 'application/json'
        $Parameters.Body = ($Body | ConvertTo-Json -Depth 5 -Compress)
    }
    Invoke-RestMethod @Parameters
}
$Report = [ordered]@{
    version = 1
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    scope = 'Solo lectura. Los tamaños de archivos son lógicos; no equivalen a espacio recuperable. Las cachés de navegador se consultan dentro de Oratoria Lab.'
    hardware = $null
    ollama = $null
    huggingFace = @()
    errors = @()
}
try {
    $Computer = Get-CimInstance -ClassName Win32_ComputerSystem
    $Processors = @(Get-CimInstance -ClassName Win32_Processor)
    $Graphics = @(Get-CimInstance -ClassName Win32_VideoController)
    $Report.hardware = [ordered]@{
        ramBytes = [long]$Computer.TotalPhysicalMemory
        cpu = @($Processors | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors)
        gpu = @($Graphics | Select-Object Name, DriverVersion, AdapterRAM)
        note = 'AdapterRAM proviene de Windows y puede no reflejar toda la VRAM. No se estima una VRAM ausente.'
    }
} catch { $Report.errors += 'Windows no pudo informar el hardware mediante CIM.' }
try {
    $Version = Read-LocalApi '/api/version'
    $Tags = Read-LocalApi '/api/tags'
    $Running = Read-LocalApi '/api/ps'
    $Models = @()
    foreach ($Model in @($Tags.models)) {
        $Details = $null
        try { $Details = Read-LocalApi '/api/show' @{ model = $Model.name } } catch { }
        $Models += [ordered]@{
            name = $Model.name
            logicalBytes = $Model.size
            digest = $Model.digest
            details = $Model.details
            capabilities = $Details.capabilities
            license = $Details.license
            running = (@($Running.models | Where-Object { $_.name -eq $Model.name }).Count -gt 0)
        }
    }
    $Report.ollama = [ordered]@{ version = $Version.version; models = $Models; running = $Running.models }
} catch { $Report.errors += 'Ollama no respondió en localhost:11434. No se inició ningún proceso.' }
$CacheRoot = if ($env:HF_HUB_CACHE) { $env:HF_HUB_CACHE } elseif ($env:HF_HOME) { Join-Path $env:HF_HOME 'hub' } else { Join-Path $env:USERPROFILE '.cache\huggingface\hub' }
if (Test-Path -LiteralPath $CacheRoot -PathType Container) {
    $Report.huggingFace = @(Get-ChildItem -LiteralPath $CacheRoot -Directory -Filter 'models--*' | ForEach-Object {
        [ordered]@{ name = $_.Name; manager = 'Hugging Face Hub'; state = 'Caché detectada; no confirma que todos los pesos estén completos' }
    })
}
$Report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
Write-Host ('Informe creado: ' + (Resolve-Path -LiteralPath $OutputPath).Path)
