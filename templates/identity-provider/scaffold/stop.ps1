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
Usage: ./stop.sh [docker|podman]

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
Write-Info "Stopping identity provider services..."
Invoke-CommandChecked -Command $composeCommand -CmdArgs @("-f", $ComposeFile, "down")
Write-Success "Services stopped."
