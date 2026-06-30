# One-command farm bootstrap (Windows).
#   pwsh ./install.ps1     (or right-click → Run with PowerShell)
# Installs the CLI's Node deps, then runs `lol install` (Ollama + LiteLLM + models).
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
Write-Host '== installing CLI dependencies ==' -ForegroundColor Cyan
npm install
Write-Host '== bootstrapping the farm (Ollama + LiteLLM + models) ==' -ForegroundColor Cyan
node bin/lol.js install
