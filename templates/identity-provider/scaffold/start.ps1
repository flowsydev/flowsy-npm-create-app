#!/usr/bin/env pwsh
param(
  [string]$Engine = "docker"
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

function Show-Usage {
  @"
Usage: ./start.sh [docker|podman]

Arguments:
  docker  Use Docker as the container engine (default)
  podman  Use Podman as the container engine
"@ | Write-Host
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

if ($Engine -in @("-h", "--help", "help")) {
  Show-Usage
  exit 0
}

if ($Engine -notin @("docker", "podman")) {
  Write-Failure "Invalid engine: '$Engine'. Only 'podman' or 'docker' are allowed."
  Show-Usage
  exit 1
}

$composeCommand = @()

if ($Engine -eq "docker") {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "docker not found on system."
  }

  & docker compose version *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "docker is installed but 'docker compose' is not available."
  }

  $composeCommand = @("docker", "compose")
}
else {
  if (-not (Get-Command podman -ErrorAction SilentlyContinue)) {
    throw "podman not found on system."
  }

  & podman compose version *> $null
  if ($LASTEXITCODE -eq 0) {
    $composeCommand = @("podman", "compose")
  }
  elseif (Get-Command podman-compose -ErrorAction SilentlyContinue) {
    $composeCommand = @("podman-compose")
  }
  else {
    throw "neither 'podman compose' nor 'podman-compose' could be found."
  }
}

Write-Info "Selected engine: $Engine"
Write-Progress -Activity "Identity Provider" -Status "Bringing up services" -PercentComplete 25
Invoke-CommandChecked -Command $composeCommand -CmdArgs @("-f", $ComposeFile, "up", "-d")

Write-Progress -Activity "Identity Provider" -Status "Checking health status" -PercentComplete 55
$timeoutSeconds = 240
$elapsed = 0

while ($elapsed -lt $timeoutSeconds) {
  $statusOutput = Get-CommandOutput -Command $composeCommand -CmdArgs @("-f", $ComposeFile, "ps")
  $healthyCount = ([regex]::Matches($statusOutput, "healthy", "IgnoreCase")).Count

  if ($statusOutput -match "postgres" -and $statusOutput -match "keycloak" -and $healthyCount -ge 2) {
    break
  }

  $percent = 55 + [math]::Min(40, [math]::Floor(($elapsed / $timeoutSeconds) * 40))
  Write-Progress -Activity "Identity Provider" -Status "Waiting for healthy services..." -PercentComplete $percent
  Start-Sleep -Seconds 3
  $elapsed += 3
}

if ($elapsed -ge $timeoutSeconds) {
  Write-Failure "Maximum wait time for health checks reached."
  Write-Info "Check logs with: $($composeCommand -join ' ') -f `"$ComposeFile`" logs -f"
  exit 1
}

Write-Progress -Activity "Identity Provider" -Status "Completed" -PercentComplete 100

# ensure placeholders have been replaced before we try to parse the file
if (Get-Content $ComposeFile -Raw | Select-String '__KEYCLOAK_PORT__') {
    Write-Failure "compose.yml still contains placeholder values. Please run the project generator/configure step or edit the file to set a real port."
    exit 1
}

$composeContent = Get-Content $ComposeFile -Raw
$kcPort = if ($composeContent -match "- ['\"]?(\d+):8080['\"]?") { $Matches[1].Trim('"') } else { "8080" }
$kcAdminUser = if ($composeContent -match 'KC_ADMIN_USERNAME:\s*(\S+)') { $Matches[1].Trim('"') } else { "admin" }
$kcAdminPassword = if ($composeContent -match 'KC_ADMIN_PASSWORD:\s*(\S+)') { $Matches[1].Trim('"') } else { "admin" }

Write-Success "Services ready 🚀"
Write-Info "Keycloak: http://localhost:$kcPort"
# note: fallback to 8080 above only happens on failure to parse the file
Write-Info "Admin user: $kcAdminUser"
Write-Info "Admin password: $kcAdminPassword"
Write-Info "To stop: .\stop.ps1 -Engine $Engine"
