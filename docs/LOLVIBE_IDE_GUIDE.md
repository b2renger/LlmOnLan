# LOL Vibe's IDE — a guide

LOL Vibe can build small web projects with you: you ask in the chat, a **coding agent** writes the files, and you
see the result at once. The agent is **DeepSeek Harness** running on this computer, thinking with the **farm's
model**. Your project is a folder on this computer; nothing is kept on the farm.

*(For the people who build LlmOnLan: the design and the tests are in [IDE_PLAN.md](IDE_PLAN.md).)*

---

## 1. Start

1. Open **LOL Vibe** (the topbar: Open WebUI · **LOL Vibe** · Computer) and a chat.
2. Press **Project** (beside *System prompt*, or **Ctrl+1**). A panel opens on the right; **Chat · Split · Panel**
   at its top set how much room it takes (**Ctrl+\\** goes round them), and its left edge drags.
3. The first time, press **Install the coding agent**: about 120 MB from GitHub, once. It stays installed.
4. Type a name and press **New project**. The chat is now tied to that project folder:
   `<your data folder>/LOL Studio Projects/<name>…`.

The model: the agent works best with **qwen3.8** or **nemotron**. When the farm serves one, a project chat starts on
it. The line under the project's name says whether the chosen model is good at editing code (**gemma4** is not —
it thinks itself out of room).

## 2. Ask

Write what you want in the chat, like any message:

> Make index.html: a three.js page with a slowly rotating cube, three 0.160.0 from cdn.jsdelivr.net.

The reply says what the agent did. **Thought for …** opens on its steps (*→ write index.html ✓*), and the stats say
how many steps and seconds it took. **Stop** stops it at once. Ask for changes the same way: *"add a speed slider in
a corner; change nothing else."* Keep each request small: one change at a time works best with local models.
**Regenerate** on a reply asks the agent again. The chat's *System prompt* and *Regenerate with…* make no
difference here (the agent has its own instructions), and a stopped reply has no **Continue**: ask again.

The agent works with **files**: it reads, searches, writes and edits them — **only inside the project folder**
(anything else it is refused, and it says so). It has no shell, runs no programs and has no web.

### Keep going until done

For a bigger job, press **Keep going until done** in the panel's top bar (it turns to *…: on*). Your next messages
then start a **loop**: the agent takes the job on as a goal and keeps working on it **round after round** — each round
a whole turn of its own — until it has checked in the files that the job is done, then marks it complete. It all
lands in **one reply**: its steps show *◎ Goal set*, *◎ Round 2 of 10*…, and *◎ Goal done*. A job that fits one turn is
simply done in one turn.

- **At most 10 rounds.** Past that it stops and says so; what it did is kept — send a message to go on.
- **Stop** ends the loop at once, like any reply.
- It also stops, and says why, when one of its replies was longer than the model may write at once, when it does not
  start its next round, or when it says it is **blocked** (with its reason). The files keep what it did.
- Each round is a full reply of the model on the farm, and a loop holds your farm seat until it ends.
- The switch is per project, off by default, and **off again when LlmOnLan closes**: a loop only ever runs because you
  asked for one. Best with **qwen3.8** (it checks its own work; nemotron did not, in our tests).

### Use the Computer

**Use the Computer** (in the same bar) gives the agent the Computer's own tools as well as files: it can make a graph,
add and wire boxes, set them and run them, then read what they gave — for example *"On the Computer, build a graph
'Room monitor': a Text box with a temperature, a Code box that says 'too hot' above 26, a Preview; run it with 24 and
29"*. Its steps say what it did there (*→ Computer: add_box code ✓*), and the graph is in the Computer's library.

- **Devices stay yours:** anything that would reach a device (a Send box, a USB board) is a **dry run** until *you* arm
  the outputs; while they are armed the agent cannot change or run a graph at all. What only a person chooses — a Fetch
  address, an Open data link, an Agent's hosts, a board, Listen — the agent cannot set; it says it left it for you.
- It all stays on this computer (the Computer answers the agent on 127.0.0.1 only).
- Per project, off by default, off again when LlmOnLan closes. It combines with **Keep going until done** and
  **Schedule…** — a scheduled loop that checks something with a graph and reports.

### On a schedule

**Schedule…** in the panel's top bar opens a small form: **Every … minutes** (5 at the least) or **Every day at …**, and
the message the agent should get each time — for example *"Check the page still works and add today's date to
log.md"*. **Start**: the app then sends that message **by itself**, into **this chat** (marked ⏰), after the interval
or at the time, and again and again. Each run is an ordinary message, so the reply, **Stop**, your farm seat and **Keep
going until done** work as for one you typed.

- It runs **only while LlmOnLan is open**, and is **forgotten when LlmOnLan closes** — start it again after you reopen.
- While a reply is running, a run is **skipped** (never queued); the form counts runs sent and skipped.
- The runs go into the chat you started it from, even while you read another chat.
- **Stop the schedule** ends it.

## 3. The panel

| Tab | What it shows |
|---|---|
| **Preview** | the project's `index.html` (or the page, picture or sound you opened in the file list), live; it reloads after each reply. **Reload** redraws it. |
| **Code** | the file you picked in the list. You can edit it: **Save** (or Ctrl+S). Tab indents, Enter keeps the indent. It follows the agent: after a reply (or **Go back**, or **Pull**) it shows the new text — unless you have unsaved edits, which it keeps. |
| **Changes** | what the agent's last reply changed: the old text and the new, edit by edit. |
| **History** | every reply that changed a file, and every Save, newest first. Pick one to see what it changed. **Go back to this version** makes the files what they were then — as a new step, so you can come back again. |

Buttons on top: **Other project** (tie the chat to another one), **Open folder**, **Open in browser** (the page in
your usual browser, on this computer only), **Share on the LAN** (below).

### A map of the project (graphify)

Ask: *"Use the graphify skill to make a knowledge graph of this project."* The agent reads the files and writes
`graphify-out/graph.json` (and a short `GRAPH_REPORT.md`): the files, functions and ideas of the project, and how
they connect. Click `graphify-out/graph.json` in the file list: the **Preview** draws it — colours are groups, drag
the nodes, zoom with the wheel. (The skill is adapted from [graphify](https://github.com/Graphify-Labs/graphify);
here it needs no Python — the model does the reading. On a 5-file project qwen3.8 took about 90 seconds.) The same
file opens in the Computer's **Graph** box.

## 4. Share on the LAN

**Share on the LAN** lets anyone on your network open the project in their browser: the panel shows the address
(`http://<this computer>:<port>/`). It is **read-only** (nobody can change your files through it), for this project
only, and it **stops** when you press **Stop sharing** or close LlmOnLan. The first time, Windows may ask whether
LlmOnLan may accept connections: allow it on private networks.

## 5. GitHub (or any git server)

History → **GitHub** (folded):
1. Create an empty repository on GitHub and copy its `https://…/project.git` address. **Save address**.
2. Make a token: GitHub ▸ Settings ▸ Developer settings ▸ Personal access tokens ▸ **Fine-grained**, with
   *Contents: read and write* on that repository only. Paste it, **Save token**. LlmOnLan keeps it **encrypted by
   this computer** and never shows it again; **Forget the token** removes it. There is one token per server: every
   project that pushes to github.com uses the same one, so give it access to each of their repositories.
3. **Push** sends the project's history to GitHub. **Pull** brings newer commits from GitHub here — only when this
   copy has nothing the other lacks (your own work is kept and committed first; if both sides changed, the pull
   is refused with a sentence).

A Gitea on your LAN works the same way (an `https://` address).

## 6. What leaves this computer

- Your requests and the files the agent reads go to **the farm's model** (on your LAN), like any chat. The farm
  keeps nothing.
- **Push** sends the project to the git server you typed, only when you press it. **Share on the LAN** serves it
  on your network until you stop it.
- The agent's own telemetry and cloud features are switched off; it talks to nothing else — except, with **Use the
  Computer** on, the Computer on this same machine (127.0.0.1), whose boxes follow their own rules (a Send reaches a
  device only once you armed the outputs).
- **On a schedule** sends nothing new: each run is an ordinary message to the farm's model, like one you typed.
- Everything else stays here: the project folder, its history (`.git` inside it), and the chat.

## 7. When something goes wrong

| You see | Do |
|---|---|
| *The coding agent is not installed on this computer yet* | Press **Install the coding agent** (the panel). |
| *No farm is connected* | The pill at the top: pick a farm. |
| *The model ran out of room before it finished* | Ask for something smaller, or pick qwen3.8 / nemotron. |
| *This file changed since you opened it … so it was not saved* | The agent edited it meanwhile. Copy your changes, click the file in the list (the new version opens), paste them back, **Save**. |
| *The coding agent stopped before it answered* | Ask again: it restarts, and it gets a short recap of the chat. |
| *… refused the token* | Make a new token with *Contents: read and write* on that repository, and save it again. |
| *… both have changes the other lacks* | Your work is safe (committed). Push is refused too: bring the other side's work another way, or keep this copy. |
| *This project's folder is not there any more* | It was moved or deleted outside LlmOnLan: put it back in `LOL Studio Projects`, or press **Other project**. |
| The Preview is blank | Open **Code**: is there an `index.html`? Ask the agent to make one, or pick another page in the list. |
