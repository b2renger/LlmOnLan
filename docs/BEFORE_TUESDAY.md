# Tests before Tuesday

**How to give feedback:** tick `[x]` when it works. When something goes wrong, write what you saw after `Notes:`, in
your own words (a screenshot path is fine). Save the file. The night session reads it. Or just tell me in the chat.

---

## 1. Update the farm — before Saturday 01:00 (15 min)

On the PRO 6000.

1. Open the Farm app. Take a photo of the panel (engine, model, people at once).
2. Check for updates ▸ install it.
3. Look at the panel again: same engine and model as in the photo?
4. **For the class:** in the panel, set the engine to **vLLM** with its default model, **Qwen3.6 35B-A3B · NVFP4**. The panel must then say about **32 people at once** or more, not 1.
5. Leave the farm running for the night (the night session updates vLLM and tests 30 people on it).

- [X] OK
- Farm app version after the update:
- Notes:

## 2. Your Wi-Fi — by Saturday evening (15 min)

One laptop on the Wi-Fi the students will use.

1. Download this file and time it:
   [owui-sidecar-win32-x64.tar.gz](https://github.com/b2renger/LlmOnLan/releases/latest/download/owui-sidecar-win32-x64.tar.gz)
   (740 MB, what each student downloads). Delete it after.
2. Open LlmOnLan. Does the top bar find the farm by itself?
   If not: click the connection pill ▸ add the farm by its address.

- Download time:
- [X] Farm found by itself
- [ ] Had to add it by address
- Is your Wi-Fi's internet a 4G/5G box?  no
- Notes:

## 3. The usage report (5 min)

**Waits for client v0.2.18**, not out yet: 0.2.17 and farm 0.0.53 have no usage report. Any laptop.

1. Open Open WebUI, LOL Vibe and the Computer once. Ask one question in LOL Vibe; run one template in the Computer.
2. Preferences ▸ Usage report ▸ **Save a usage report…** ▸ save. Open the file in a text editor.

OK if: the file has counts, and **none** of your words.

- [] OK
- Notes: 

## 4. PDFs on the farm (10 min)

Any laptop, chat in Open WebUI. Needs: a scanned PDF of 30+ pages, a PDF of more than 200 pages (a manual), a file
over 100 MB.

1. Attach the scanned PDF; while it is still working, close the chat.
2. Attach the 200+ page PDF; when done, click the file and scroll to the end of its text.
3. Attach the file over 100 MB.

OK if: 2 ends with *"Pages 201 to … were not read"*; 3 is refused.

- [ ] OK
- Notes:

## 5. A student's 20 minutes — Monday afternoon (25 min per laptop)

Do it three times: a **Windows laptop**, a **Mac**, and **the slowest laptop** you have. Each must never have had
LlmOnLan. Use the client release that is out on Monday.

1. Install from [the latest release](https://github.com/b2renger/LlmOnLan/releases/latest).
   - Windows: *More info* ▸ *Run anyway*.
   - Mac: right-click ▸ *Open*. If that is not offered: open it once, then System Settings ▸ Privacy & Security ▸
     *Open Anyway*.
2. Open it and time how long until you can chat.
3. **Open WebUI:** ask a question; attach a short PDF and ask about it.
4. **LOL Vibe:** ask something; press **Stop** during a long answer.
5. **LOL Vibe ▸ Project ▸ Install the coding agent ▸ New project.** Ask: *"Make index.html: a page with a bouncing
   ball."* Look at **Preview**.
6. **The Computer:** the Tour, then lesson 1, then run a template.
7. Write down anything a student would get stuck on.

| | Windows | Mac | Slowest laptop |
|---|---|---|---|
| Worked | [ ] | [ ] | [ ] |
| Time until chat | | | |
| macOS version, and what it asked | — | | |

- Notes:

## 6. Three laptops at once — Monday (10 min)

1. On three laptops, at the same moment, in Open WebUI: *"Write a 500-word story about a lighthouse."*
2. Same in LOL Vibe. One laptop runs a Computer template meanwhile.

OK if: every answer comes; nobody sees *farm full* or *not responding*.

- [ ] OK
- Notes:

## 7. Tuesday morning (5 min)

1. On the PRO 6000: the Farm app shows the farm running.
2. On your laptop: the pill is green; one chat answers in Open WebUI and in LOL Vibe.
3. Read the top of `docs/sessions/2026-11-17.md` (the night's check).

If anything is wrong, don't restart anything: read the summary first.

- [ ] OK
- Notes:
