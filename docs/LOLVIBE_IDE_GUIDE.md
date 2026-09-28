# LOL Vibe's IDE — a guide

LOL Vibe can build small web projects with you: you ask in the chat, a **coding agent** writes the files, and you
see the result at once. The agent is **DeepSeek Harness** running on this computer, thinking with the **farm's
model**. Your project is a folder on this computer; nothing is kept on the farm.

*(For the people who build LlmOnLan: the design and the tests are in [IDE_PLAN.md](IDE_PLAN.md).)*

---

## 1. Start

1. Open **LOL Vibe** (the topbar: Open WebUI · **LOL Vibe** · Computer) and a chat.
2. Press **Project** (beside *System prompt*). A panel opens on the right.
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

The agent works with **files**: it reads, searches, writes and edits them, and it **changes files only inside the
project folder**. It has no shell, runs no programs and has no web.

## 3. The panel

| Tab | What it shows |
|---|---|
| **Preview** | the project's `index.html` (or the page you opened in the file list), live; it reloads after each reply. **Reload** redraws it. |
| **Code** | the file you picked in the list. You can edit it: **Save** (or Ctrl+S). Tab indents, Enter keeps the indent. |
| **Changes** | what the agent's last reply changed: the old text and the new, edit by edit. |
| **History** | every reply that changed a file, and every Save, newest first. Pick one to see what it changed. **Go back to this version** makes the files what they were then — as a new step, so you can come back again. |

Buttons on top: **Other project** (tie the chat to another one), **Open folder**, **Open in browser** (the page in
your usual browser, on this computer only), **Share on the LAN** (below).

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
   this computer** and never shows it again; **Forget the token** removes it.
3. **Push** sends the project's history to GitHub. **Pull** brings newer commits from GitHub here — only when this
   copy has nothing the other lacks (your own work is kept and committed first; if both sides changed, the pull
   is refused with a sentence).

A Gitea on your LAN works the same way (an `https://` address).

## 6. What leaves this computer

- Your requests and the files the agent reads go to **the farm's model** (on your LAN), like any chat. The farm
  keeps nothing.
- **Push** sends the project to the git server you typed, only when you press it. **Share on the LAN** serves it
  on your network until you stop it.
- The agent's own telemetry and cloud features are switched off; it talks to nothing else.
- Everything else stays here: the project folder, its history (`.git` inside it), and the chat.

## 7. When something goes wrong

| You see | Do |
|---|---|
| *The coding agent is not installed on this computer yet* | Press **Install the coding agent** (the panel). |
| *No farm is connected* | The pill at the top: pick a farm. |
| *The model ran out of room before it finished* | Ask for something smaller, or pick qwen3.8 / nemotron. |
| *The coding agent stopped before it answered* | Ask again: it restarts, and it gets a short recap of the chat. |
| *… refused the token* | Make a new token with *Contents: read and write* on that repository, and save it again. |
| *… both have changes the other lacks* | Your work is safe (committed). Push is refused too: bring the other side's work another way, or keep this copy. |
| The Preview is blank | Open **Code**: is there an `index.html`? Ask the agent to make one, or pick another page in the list. |
