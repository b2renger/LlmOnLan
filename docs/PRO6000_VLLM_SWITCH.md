# Switching the studio's RTX PRO 6000 farm to vLLM

Two parts. **Part 1** (done on 2026-10-07, DEVLOG 17:48) made vLLM the farm's `external` engine: vLLM started by a
log-on task, the farm routing to it. **Part 2** lets the farm run that same vLLM itself, so the model, the people
and the context are set in the panel, and switching to Ollama or llama.cpp and back is a button
([farm/README.md, "vLLM, run by the farm"](../farm/README.md#vllm-run-by-the-farm)).

## Part 1: vLLM as the external engine (done 2026-10-07)

**For the owner, on `AN-A6000PRO`, at a quiet moment you pick.** Before it, the production farm served
`qwen3.8:latest` on Ollama: 2 people at once, shown to clients as **"Qwen3.8-latest"**. After the switch it
serves Qwen3.6-35B-A3B on vLLM, the farm's `external` engine: **48 people at 64k each** (measured). The recipe
behind it is farm/README.md, "External: a vLLM you run yourself". About 15 minutes, with about 5 minutes when
the farm does not answer.

What is already in place on this box:
- vLLM 0.30 and the Qwen3.6 NVFP4 weights in WSL, `~/lol-spike` (the spike's install).
- The Farm app's "Launch at login" is off.
- ComfyQ has moved off the box.

### Before you start

1. Pick a moment when nobody is generating: the panel's **Clients** card shows 0 seats in use.
2. Install **Farm app farm-v0.0.42**: from the GitHub release `farm-v0.0.42`, the Windows installer, over the
   old one. Open it once. The panel's footer shows 0.0.42, and `%APPDATA%\LlmOnLan Farm\farm\vllm\` exists.
   - farm-v0.0.41 cannot do this switch: it refuses the `presencePenalty` key and has no `vllm\` folder.

### The switch

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

### Check it

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

### If something goes wrong (rollback)

```powershell
# Quit the Farm app first, then:
wsl -d Ubuntu -- env LOL_VLLM_ROOT=/home/ateliernum/lol-spike bash "/mnt/c/Users/ateliernum/AppData/Roaming/LlmOnLan Farm/farm/vllm/stop.sh"
Copy-Item "$env:APPDATA\LlmOnLan Farm\farm\lol.config.json.before-vllm" "$env:APPDATA\LlmOnLan Farm\farm\lol.config.json" -Force
Unregister-ScheduledTask -TaskName 'LlmOnLan vLLM' -Confirm:$false
# Reopen the Farm app: it serves qwen3.8 on Ollama again, as before.
```

If vLLM is down when the farm starts, the farm serves its built-in engine (Ollama) for that run and says why on
the panel. It does not fail. When vLLM answers again, a farm that started on vLLM picks it back up by itself.

## Part 2: let the farm run it

**For the owner, at a quiet moment you pick, once a Farm app newer than farm-v0.0.42 (the first with vLLM run by
the farm) is released.** vLLM itself is not restarted: the same process (process group 401) keeps serving through
the click. The farm is down only while the Farm app is reinstalled (step 1 to 2, a few minutes): clients go to
another farm meanwhile, or wait.

1. **Quit the Farm app** (farm-v0.0.42). Its code does not touch vLLM, which keeps running.
2. **Install the new Farm app** over the old one, and open it. At its first start it copies its farm code into
   `%APPDATA%\LlmOnLan Farm\farm`, `farm\vllm` included, while the log-on task's `serve.sh` runs from there.
3. **Check that the copy landed:** the panel's Backend card shows a **vLLM** button. If it does not, `farm.log`
   (Settings ▸ Open data & logs folder) says why the code refresh failed: quit and reopen the app.
4. **Click "Let the farm run vLLM"** on the card "vLLM on this computer" (it shows a few seconds after the farm is
   up). Then check:
   - the panel says "The farm now runs vLLM. Nothing was restarted.", the engine is vLLM, kept running, with 48
     people at once and 64k each;
   - vLLM is the same process: `wsl -d Ubuntu -- cat /home/ateliernum/lol-spike/run/vllm.pgid` still says 401;
   - the copy of the old settings is there: `%APPDATA%\LlmOnLan Farm\farm\lol.config.json.before-managed-vllm`;
   - the marker is there: `wsl -d Ubuntu -- ls /home/ateliernum/lol-spike/run/managed-by-farm`;
   - a client: nothing changed (the farm, the name Qwen3.6, a reply).
5. **At the next log on**, the "LlmOnLan vLLM" task still runs: its `serve.sh` now says "The LlmOnLan farm runs
   this vLLM now" and does nothing, and `start-windows.ps1` opens the Farm app, whose farm starts vLLM (about
   1.5 min; clients see "Starting vLLM" and keep the farm). The task can stay (it opens the Farm app), or be
   replaced by the Farm app's own Launch at login (Settings) and removed:
   `Unregister-ScheduledTask 'LlmOnLan vLLM' -Confirm:$false`. Both on is harmless: the Farm app runs once.

From then on, the Farm app's Quit and Stop stop vLLM too (it frees the GPU), and a farm start starts it again.
Document reading switches to `gemma4:12b` (installed, 7.6 GB, fits the 9 GB kept for it) at the next farm start,
instead of `qwen3.8:latest` (17.7 GB, which does not).

### Going back

- **Undo**, on the same card, until a setting changes or the farm restarts: the old settings and the old log-on
  start come back, and vLLM keeps running.
- **Later, by hand** (PowerShell):
  ```powershell
  # 1. Quit the Farm app: this stops vLLM. Then:
  $cfg = "$env:APPDATA\LlmOnLan Farm\farm\lol.config.json"
  Copy-Item "$cfg.before-managed-vllm" $cfg -Force                          # 2. the settings from before
  wsl -d Ubuntu -- rm -f /home/ateliernum/lol-spike/run/managed-by-farm    # 3. serve.sh starts vLLM again
  Start-ScheduledTask 'LlmOnLan vLLM'                                      # 4. vLLM, then the Farm app
  ```
  The task is still registered (Part 2 changes no task), unless you removed it in step 5: then register it again
  with Part 1, step 2.
- **Before installing an older Farm app** (farm-v0.0.42 or older): put the old settings back first (step 2
  above). An older farm refuses a settings file that holds a `vllm` block ("lol.config.json failed validation"),
  and does not start.
