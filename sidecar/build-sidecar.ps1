# Build the bundled Open WebUI sidecar (Windows). Thin wrapper over the
# cross-platform Node script. Needs Node and tar (built into Windows 10+).
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
node build-sidecar.mjs @args
