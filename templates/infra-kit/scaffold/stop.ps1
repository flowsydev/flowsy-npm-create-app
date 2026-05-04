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
Write-Info "Stopping infrastructure services..."
Invoke-CommandChecked -Command $composeCommand -CmdArgs @("-f", $ComposeFile, "down")
Write-Success "Services stopped."
