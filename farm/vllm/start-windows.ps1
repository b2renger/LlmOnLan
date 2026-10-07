# Start vLLM in WSL, wait until it answers, then start the Farm app: for a scheduled task "At log on", so vLLM comes
# back after a reboot (farm/README.md, "Start vLLM at logon"). The farm probes its external engine only when it
# starts, and a Farm app that starts before vLLM answers serves its built-in engine for that whole run. So turn the
# Farm app's own Launch at login off and let this script start it.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File start-windows.ps1 [-Root /home/<you>/lol-vllm] [-Port 8100]
#
# serve.sh runs from this script's folder in daemon mode (LOL_VLLM_DAEMON=1: nobody types into its hidden window), in
# the foreground of its own wsl.exe, which keeps the distro running as long as vLLM runs. Stop it with stop.sh, as
# always. Nothing restarts a vLLM that stops later: run the task again. Log: -Log, next to the Farm app's farm.log.
param(
    [string]$Distro = 'Ubuntu',
    [string]$Root = '',        # LOL_VLLM_ROOT, a Linux path without ~ ('' = serve.sh's default, ~/lol-vllm)
    [int]$Port = 8100,         # LOL_VLLM_PORT
    [int]$TimeoutSec = 900,    # a first start compiles kernels (~3 min), later starts take ~1.5 min
    [string]$FarmApp = "$env:LOCALAPPDATA\Programs\llmonlan-farm-app\LlmOnLan Farm.exe",
    [string]$Log = "$env:APPDATA\LlmOnLan Farm\vllm-start.log"
)
$ProgressPreference = 'SilentlyContinue'
New-Item -ItemType Directory -Force -Path (Split-Path $Log) | Out-Null
function Say([string]$m) { Add-Content -Path $Log -Value "$(Get-Date -Format s) $m" -Encoding UTF8 }

# serve.sh beside this script, as WSL sees it: C:\a b\farm\vllm -> /mnt/c/a b/farm/vllm
$sh = '/mnt/' + $PSScriptRoot.Substring(0, 1).ToLower() + $PSScriptRoot.Substring(2).Replace('\', '/') + '/serve.sh'
$vars = "LOL_VLLM_DAEMON=1 LOL_VLLM_PORT=$Port"
if ($Root) { $vars += " `"LOL_VLLM_ROOT=$Root`"" }
$wsl = Start-Process wsl.exe -ArgumentList "-d $Distro -e env $vars bash `"$sh`"" -WindowStyle Hidden -PassThru
$null = $wsl.Handle   # without a handle, ExitCode stays empty once it exits
Say "started vLLM (wsl.exe pid $($wsl.Id)): -d $Distro -e env $vars bash $sh"

$url = "http://127.0.0.1:$Port/v1/models"
$deadline = (Get-Date).AddSeconds($TimeoutSec)
$ready = $false
while ($true) {
    try { Invoke-WebRequest $url -UseBasicParsing -TimeoutSec 5 | Out-Null; $ready = $true }
    catch { if ($_.Exception.Response) { $ready = $true } }   # any HTTP answer is vLLM's (401: it has --api-key)
    if ($ready -or $wsl.HasExited -or (Get-Date) -gt $deadline) { break }
    Start-Sleep -Seconds 5
}
if ($ready) { Say "vLLM answers at $url" }
elseif ($wsl.HasExited) { Say "serve.sh stopped (exit code $($wsl.ExitCode)) before vLLM answered: see logs/vllm.log in its LOL_VLLM_ROOT. The farm will serve its built-in engine." }
else { Say "vLLM did not answer at $url within $TimeoutSec s. The farm will serve its built-in engine: quit and reopen the Farm app once vLLM answers." }

if (Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension($FarmApp)) -ErrorAction SilentlyContinue) {
    Say "the Farm app was already running. It serves vLLM only if vLLM answered when it started: if not, quit and reopen it. If it opened by itself at log on, turn its Launch at login off."
} elseif (Test-Path $FarmApp) {
    Start-Process $FarmApp
    Say "started the Farm app: $FarmApp"
} else {
    Say "no Farm app at ${FarmApp}: start the farm yourself, or pass -FarmApp."
}
