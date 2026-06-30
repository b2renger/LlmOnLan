# One-command farm run (Windows). Starts the farm in the foreground (Ctrl-C stops).
#   pwsh ./run.ps1
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
node bin/lol.js up
