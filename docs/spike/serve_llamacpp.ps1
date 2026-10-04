# Start llama-server (Windows, native CUDA) for the spike, in the FOREGROUND of this PowerShell, logging to a file.
# It mirrors the farm's own argv (farm/src/llamacpp.js argsFor) so the baseline is what `lol up` would run.
# Stop it with:  Stop-Process -Id (Get-Content $env:TEMP\lol-spike-llama.pid)
#
#   powershell -File serve_llamacpp.ps1 -Model <gguf> -Parallel 8 -Ctx 262144 -KvType q8_0 -Log <file>
param(
  [Parameter(Mandatory = $true)][string]$Model,
  [int]$Parallel = 8,
  [int]$Ctx = 262144,
  [string]$KvType = 'q8_0',
  [int]$Port = 8190,
  [string]$Alias = 'assistant',
  [string]$Log = "$env:TEMP\lol-spike-llama.log",
  [string]$Bin = "$env:APPDATA\LlmOnLan Farm\farm\.llamacpp\bin\llama-server.exe",
  [int]$CacheRamMiB = 24576,
  [string[]]$Extra = @()
)
$a = @('--model', $Model, '--alias', $Alias, '--host', '127.0.0.1', '--port', "$Port",
       '--ctx-size', "$Ctx", '--n-gpu-layers', '999', '--parallel', "$Parallel",
       '--jinja', '--no-webui', '--metrics', '-fa', '1',
       '--cache-type-k', $KvType, '--cache-type-v', $KvType,
       '--cache-reuse', '256', '--cache-ram', "$CacheRamMiB", '--kv-unified',
       '--slot-prompt-similarity', '0.4') + $Extra
New-Item -ItemType Directory -Force (Split-Path -Parent $Log) | Out-Null
"[serve_llamacpp] $(Get-Date -Format s) $Bin $($a -join ' ')" | Out-File -FilePath "$Log.cmd" -Encoding utf8
$p = Start-Process -FilePath $Bin -ArgumentList $a -RedirectStandardOutput "$Log.out" -RedirectStandardError $Log `
      -NoNewWindow -PassThru
$p.Id | Out-File -FilePath "$env:TEMP\lol-spike-llama.pid" -Encoding ascii
"[serve_llamacpp] pid $($p.Id)"
$p.WaitForExit()
"[serve_llamacpp] exited with $($p.ExitCode)"
