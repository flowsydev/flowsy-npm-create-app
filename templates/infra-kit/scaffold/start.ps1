#!/usr/bin/env pwsh
param(
  [ValidateSet("podman", "docker")]
  [string]$Engine = "podman"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ComposeFile = Join-Path $ScriptDir "compose.yml"

function Write-Info {
  param([string]$Message)
  Write-Host "ℹ️  $Message"
}

function Write-Success {
  param([string]$Message)
  Write-Host "✅ $Message"
}

function Write-Failure {
  param([string]$Message)
  Write-Host "❌ $Message"
}

function Invoke-CommandChecked {
  param(
    [string[]]$Command,
    [string[]]$CmdArgs
  )

  $exe = $Command[0]
  $prefix = @()
  if ($Command.Count -gt 1) {
    $prefix = $Command[1..($Command.Count - 1)]
  }

  & $exe @prefix @CmdArgs
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $exe $($prefix -join ' ') $($CmdArgs -join ' ')"
  }
}

function Get-CommandOutput {
  param(
    [string[]]$Command,
    [string[]]$CmdArgs
  )

  $exe = $Command[0]
  $prefix = @()
  if ($Command.Count -gt 1) {
    $prefix = $Command[1..($Command.Count - 1)]
  }

  try {
    return (& $exe @prefix @CmdArgs 2>$null | Out-String)
  }
  catch {
    return ""
  }
}

$composeCommand = @()

if ($Engine -eq "docker") {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "docker was not found on this system."
  }

  & docker compose version *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "docker is installed, but 'docker compose' is not available."
  }

  $composeCommand = @("docker", "compose")
}
else {
  if (-not (Get-Command podman -ErrorAction SilentlyContinue)) {
    throw "podman was not found on this system."
  }

  & podman compose version *> $null
  if ($LASTEXITCODE -eq 0) {
    $composeCommand = @("podman", "compose")
  }
  elseif (Get-Command podman-compose -ErrorAction SilentlyContinue) {
    $composeCommand = @("podman-compose")
  }
  else {
    throw "'podman compose' and 'podman-compose' were not found."
  }
}

Write-Info "Selected engine: $Engine"
Write-Progress -Activity "Infrastructure" -Status "Starting services" -PercentComplete 25
Invoke-CommandChecked -Command $composeCommand -CmdArgs @("-f", $ComposeFile, "up", "-d")

Write-Progress -Activity "Infrastructure" -Status "Validating health checks" -PercentComplete 55
$timeoutSeconds = 240
$elapsed = 0

# determine expected service count
$services = & $composeCommand -f $ComposeFile config --services 2>$null
$svcCount = if ($services) { ($services | Measure-Object -Line).Lines } else { 0 }

while ($elapsed -lt $timeoutSeconds) {
  $statusOutput = Get-CommandOutput -Command $composeCommand -CmdArgs @("-f", $ComposeFile, "ps")
  $healthyCount = ([regex]::Matches($statusOutput, "healthy", "IgnoreCase")).Count

  if ($svcCount -gt 0 -and $healthyCount -ge $svcCount) {
    break
  }

  $percent = 55 + [math]::Min(40, [math]::Floor(($elapsed / $timeoutSeconds) * 40))
  Write-Progress -Activity "Infrastructure" -Status "Waiting for healthy services..." -PercentComplete $percent
  Start-Sleep -Seconds 3
  $elapsed += 3
}

if ($elapsed -ge $timeoutSeconds) {
  Write-Failure "Timed out waiting for health checks."
  Write-Info "Check logs with: $($composeCommand -join ' ') -f `"$ComposeFile`" logs -f"
  exit 1
}

Write-Progress -Activity "Infrastructure" -Status "Completed" -PercentComplete 100
$composeContent = Get-Content $ComposeFile -Raw
Write-Success "Services ready 🚀"

# show ports per service by parsing compose.yml
Write-Info "Exposed ports by service:"
$inServices = $false
$inPorts = $false
$currentSvc = ""
foreach ($line in Get-Content $ComposeFile) {
    if ($line -eq "services:") { $inServices = $true; continue }
    if (-not $inServices) { continue }
    if ($line -match '^  ([a-zA-Z][^: ]+):') { $currentSvc = $Matches[1]; $inPorts = $false }
    elseif ($line -match '^    ports:\s*$') { $inPorts = $true }
    elseif ($inPorts -and $line -match '^      - ') {
        $port = ($line -replace '^      - ', '') -replace '"', ''
        Write-Host ("ℹ️    {0,-25} {1}" -f "${currentSvc}:", $port)
    }
    elseif ($inPorts -and $line -match '^    \S') { $inPorts = $false }
}

Write-Info "To stop: .\stop.ps1 -Engine $Engine"
