# Switching the studio's RTX PRO 6000 farm to vLLM

**For the owner, on `AN-A6000PRO`, at a quiet moment you pick.** Today the production farm serves
`qwen3.8:latest` on Ollama: 2 people at once, shown to clients as **"Qwen3.8-latest"**. After the switch it
serves Qwen3.6-35B-A3B on vLLM, the farm's `external` engine: **48 people at 64k each** (measured). The recipe
behind it is farm/README.md, "Serving with vLLM on Windows (WSL2)". About 15 minutes, with about 5 minutes when
the farm does not answer.

What is already in place on this box:
- vLLM 0.30 and the Qwen3.6 NVFP4 weights in WSL, `~/lol-spike` (the spike's install).
- The Farm app's "Launch at login" is off.
- ComfyQ has moved off the box.

## Before you start

1. Pick a moment when nobody is generating: the panel's **Clients** card shows 0 seats in use.
2. Install **Farm app farm-v0.0.42**: from the GitHub release `farm-v0.0.42`, the Windows installer, over the
   old one. Open it once. The panel's footer shows 0.0.42, and `%APPDATA%\LlmOnLan Farm\farm\vllm\` exists.
   - farm-v0.0.41 cannot do this switch: it refuses the `presencePenalty` key and has no `vllm\` folder.

## The switch

Run these in PowerShell, in order.

1. **Free the GPU.** The Ollama app keeps `qwen3.8` loaded for good, about 35 GB, and vLLM needs about 75 GB:
   ```powershell
   ollama stop qwen3.8:latest
   ```
2. **Register the log-on task.** It starts vLLM, waits until it answers, then opens the Farm app, so after every
   reboot the farm finds vLLM:
   ```powershell
   Register-ScheduledTask -TaskName 'LlmOnLan vLLM' -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME) -Settings (New-ScheduledTaskSettingsSet -Priority 4 -ExecutionTimeLimit 0 -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries) -Action (New-ScheduledTaskAction -Execute powershell.exe -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$env:APPDATA\LlmOnLan Farm\farm\vllm\start-windows.ps1`" -Root /home/ateliernum/lol-spike")
   ```
3. **Point the farm at vLLM,** keeping a copy of the current config:
   ```powershell
   $cfg = "$env:APPDATA\LlmOnLan Farm\farm\lol.config.json"
   Copy-Item $cfg "$cfg.before-vllm"
   node -e "const f=process.argv[1],fs=require('fs');const c=JSON.parse(fs.readFileSync(f,'utf8'));c.external={enabled:true,alias:'Qwen3.6',baseUrl:'http://127.0.0.1:8100/v1',model:'qwen3.6-35b-a3b',contextLength:65536,parallel:48,vision:true,label:'Qwen3.6-35B-A3B (vLLM)',presencePenalty:1.5};fs.writeFileSync(f,JSON.stringify(c,null,2))" $cfg
   ```
   `Qwen3.6` is the name people will see. Change it in the command if you prefer another.
4. **Quit the Farm app** (it must not be running), then start the task:
   ```powershell
   Start-ScheduledTask 'LlmOnLan vLLM'
   ```
   vLLM takes about 1.5–3 minutes, then the Farm app opens by itself. The launcher writes its progress to
   `%APPDATA%\LlmOnLan Farm\vllm-start.log`.

## Check it

- **The panel:**
  - The engine is the external server, labelled "Qwen3.6-35B-A3B (vLLM)".
  - The Performance card shows vLLM's figures.
  - Capacity shows 48 seats.
- `curl http://127.0.0.1:4000/v1/models` lists `Qwen3.6`.
- `nvidia-smi` shows about 75–85 GB used. The OCR model loads on top of that when someone sends a document.
- **From a client:** a new chat answers on Qwen3.6.
  - **Old chats bound to "Qwen3.8-latest"** need the model picked once in that chat; new chats use the new
    default.
  - Each client's Open WebUI restarts once when it sees the new farm. The farm-v0.0.42 upgrade itself keeps an
    open farm's plugin keys, so that adds no restart.

## If something goes wrong (rollback)

```powershell
# Quit the Farm app first, then:
wsl -d Ubuntu -- env LOL_VLLM_ROOT=/home/ateliernum/lol-spike bash "/mnt/c/Users/ateliernum/AppData/Roaming/LlmOnLan Farm/farm/vllm/stop.sh"
Copy-Item "$env:APPDATA\LlmOnLan Farm\farm\lol.config.json.before-vllm" "$env:APPDATA\LlmOnLan Farm\farm\lol.config.json" -Force
Unregister-ScheduledTask -TaskName 'LlmOnLan vLLM' -Confirm:$false
# Reopen the Farm app: it serves qwen3.8 on Ollama again, as before.
```

If vLLM is down when the farm starts, the farm serves its built-in engine (Ollama) for that run and says why on
the panel. It does not fail. When vLLM answers again, a farm that started on vLLM picks it back up by itself.
