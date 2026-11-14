# Class sheets: Tuesday 17 November

Two sheets: one to hand to the students, one for the person running the class. Fill the `<…>` before printing. Written
from the night measurements of 2026-11-14 (RESULTS ▸ *30 people for the class*) and the real app driven that night.

---

## For the students: try LlmOnLan (20 minutes)

**LlmOnLan** runs an AI chat on a computer in this room, not on the internet. What you type stays between your laptop
and that computer, and your chats are kept only on your laptop.

### 1. Install it (start this first: it downloads about 1 GB the first time)

Download from **github.com/b2renger/LlmOnLan/releases/latest**:
- **Windows:** `LlmOnLan-Setup-…-windows-x64.exe`. If Windows warns you: **More info ▸ Run anyway**.
- **Mac with Apple chip (M1 to M4):** `…-mac-arm64.dmg`. **Intel Mac:** `…-mac-x64.dmg` (needs macOS 14 or later).
  Drag LlmOnLan to Applications, then open it. If the Mac refuses: **right-click ▸ Open ▸ Open**. On recent macOS that
  may not be offered: try to open it once, then **System Settings ▸ Privacy & Security ▸ Open Anyway** (your password).
- A Chromebook cannot run it.

The first start downloads the chat engine. Leave it running while you listen.

### 2. Connect to the class farm (one click)

Click the **farm button at the top** (it says `… Farm · N/M free`). In the list, click **`<the farm's name>`**: it is
then pinned, and the button shows its name. If it is not in the list: type **`<the farm's address>`** in *Add by
address*, then **Add**.

### 3. Try it

- **Open WebUI** (the chat): if the top says **Select a model**, click it and choose **assistant**. Ask a question. Attach a short PDF to your message and ask about it (up to about 30 pages).
- **LOL Vibe:** ask something. Ask for something long, then press **Stop**.
- **LOL Vibe ▸ Project:** the first time, press **Install the coding agent** (about 120 MB). Then **New project**, give it
  a name, and ask *"Make index.html: a page with a bouncing ball."* After
  about a minute the page appears in **Preview**. Ask for changes.
- **Computer:** open **Learn ▸ The tour**, then **1. hello, farm**. Then a template such as **Creative coding** and
  **Run all**: the model writes a sketch and the Computer draws it. **It can take a few minutes** while the whole class
  is using the farm: the model thinks before it writes.

### 4. Tell us what you think

`<how the students give feedback: a form, a sheet, a talk at the end>`. What worked, what confused you, what you would
use it for. Do not paste your chats or personal information.

---

## For the person running the class

**The farm:** the PRO 6000, on vLLM with Qwen3.8 27B, 32k of context per person, **36 people at once** (measured for 30:
first word within 3 s for 95 % of them, 18 to 45 tokens a second each, faster than anyone reads). Before the class: BEFORE_TUESDAY test 7.

| If you see | What it means | What to do |
|---|---|---|
| *The farm is full* | All 36 seats taken. A seat frees 15 min after its holder's last question; a laptop that slept and came back with a new address keeps its old seat until then. | Wait, or in the Farm app panel ▸ Access ▸ *Free an idle seat after* 1 min ▸ Apply (put 15 back after the class). |
| Students on a farm with **2 seats** (a Spark) | "Automatic" picked another farm on the network: it picks at random between farms that look equally free. | Step 2 of their sheet: one click on the class farm pins it. Or switch the Sparks off for the day. |
| `<farm> · not responding…` on the button | The laptop has not heard the farm for 12 s: Wi-Fi, or the farm restarting. | Check the Farm app shows the farm running; otherwise wait a minute. Do not restart the farm during the class unless nothing answers. |
| *The sandbox could not start* (Computer) | The Computer's drawing sandbox did not start in time on that laptop. | Close and reopen the Computer; if it stays, restart the app. (The real app passed this the night of 14 November; the test harness has its own failure.) |
| Open WebUI says *Select a model* | The laptop first landed on another farm, then moved to the class farm: Open WebUI kept that farm's model, which the class farm does not have. | Click it, choose **assistant** (once). |
| A PDF fails, or the answer ignores its end | One chat holds about 32k tokens: roughly 30 to 40 pages of text. | Split the PDF, or ask about one part. |
| Creative coding or a Computer template takes minutes | The model thinks a lot before writing (about 12,000 tokens for one sketch). | Say so up front; start it, then explore something else. |
| The first start is slow on many laptops | Each laptop downloads about 1 GB (the chat engine) from the internet at the same time. | Start the install first, while you present. |
| Voice: *one recording at a time from this computer* | Speech allows one recording at a time per network address. Only matters if your Wi-Fi hides the laptops behind one address. | One student speaks at a time. |

**Web search** stays off for the class (untested with 30 people at once).
