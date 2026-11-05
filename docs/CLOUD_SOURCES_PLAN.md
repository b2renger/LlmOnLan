# Documents from Microsoft 365 and Google — brainstorm and plan

*2026-11-05 (11:23). Status: brainstorm. Nothing is built. The facts in §2 and §3 were checked today, against Open WebUI
0.11.4's source and the two providers' documentation; everything else is a proposal for the owner to decide.*

The office keeps its documents in **Office 365** (Word, Excel and PowerPoint files in **OneDrive** and in **SharePoint**
sites) and in **Google Docs** (Drive). The question: how could a person ask the farm's model about those documents from
the LlmOnLan client, signing in with their own account, with the right authorizations, and without breaking what
LlmOnLan promises?

---

## 1. The rule this touches, first

The owner's rule is **local only, never cloud**: no cloud API, no hosted model, no online fallback. Microsoft 365 and
Google Drive are cloud APIs. So, before anything else, this plan needs one decision from the owner (Q0 in §8):

> **Proposed reading.** LlmOnLan never sends anything *to* a cloud service to be processed: inference, OCR, document
> search, speech all stay on the farm. It may **read from** the cloud services where the organization *already* keeps its
> documents, on a person's click, with that person's own account and rights, and keep what it read on that person's
> computer, as for any upload.

If the owner says no, this plan stops at **way A** (§4): the sync apps Microsoft and Google already install put the
files on the disk, and LlmOnLan reads local files only, as it does today.

---

## 2. What already exists (checked 2026-11-05)

**Open WebUI ships both pickers, switched on by environment variables** (`backend/open_webui/config.py` at v0.11.4,
unchanged since 0.10):

| Variable | What it does |
|---|---|
| `ENABLE_ONEDRIVE_INTEGRATION` | Shows "Microsoft OneDrive" in the chat's **+** menu |
| `ONEDRIVE_CLIENT_ID_PERSONAL` / `ONEDRIVE_CLIENT_ID_BUSINESS` (or one `ONEDRIVE_CLIENT_ID`) | The Microsoft app registration that signs in |
| `ONEDRIVE_SHAREPOINT_URL` + `ONEDRIVE_SHAREPOINT_TENANT_ID` | The work/school side: `https://<org>.sharepoint.com` and the tenant |
| `ENABLE_GOOGLE_DRIVE_INTEGRATION` | Shows "Google Drive" in the same menu |
| `GOOGLE_DRIVE_CLIENT_ID` + `GOOGLE_DRIVE_API_KEY` | Google's OAuth client and a Picker API key |

How they work (`src/lib/utils/onedrive-file-picker.ts`, `google-drive-picker.ts`):
- **Microsoft**: MSAL.js in Open WebUI's page signs in through a **popup** (`loginPopup`). The redirect address is the
  page's own origin, `http://127.0.0.1:<port>`; for us that is 8080, or the next free port when 8080 is taken
  (`sidecar.ts` `findFreePort(8080)`). The work/school side asks for the SharePoint resource's `/.default` scope. The
  picker itself is Microsoft's File Picker v8, opened in a **second popup** and driven by `postMessage`.
- **Google**: the page loads Google's scripts at run time (`apis.google.com/js/api.js`,
  `accounts.google.com/gsi/client`). Sign-in goes through Google Identity Services' **popup**, with the scopes
  `drive.readonly` **and** `drive.file`. Google Docs, Sheets and Slides are exported as text, CSV and text; other files
  are downloaded as they are.
- **Where**: only the chat's **+** menu (`MessageInput.svelte`, `InputMenu.svelte`). Not Knowledge, not a sync. A
  picked file then becomes a normal upload: it is stored in `DATA_DIR`, its text is read by the farm's OCR and indexed by
  the farm's document search.

**The shell already has the pieces a connector of our own would reuse:**
- **Sign-in to a service, done the Home Assistant way** (`homeAssistant.ts`, `index.ts`): the token is encrypted by the
  OS (`safeStorage`) in `<userData>/home-assistant.json`. It is never handed to a page, and it is forgotten by
  **Forget**. The IDE's git tokens use the same pattern (`git-tokens.json`).
- **One door for outgoing GETs** (`io.ts`): http(s) only, never loopback or the farm's ports, with size and time limits.
- **The Computer's MCP server** (`mcp.ts`, 127.0.0.1:41995), which already answers Open WebUI with the home tools,
  listed only while a home is linked. It is the template for "search my documents" tools.
- **The webview may open popups** (`<webview ... allowpopups>`). The window's own `setWindowOpenHandler` sends links
  to the system browser, but it covers the main window only, not the Open WebUI guest. A popup from Open WebUI therefore
  opens as a plain Electron window.

**The farm's extractor already reads Office files**: python-docx, python-pptx and openpyxl are in the OCR service's
dependencies (`farm/src/extract.js`). So a `.docx`/`.pptx`/`.xlsx` from SharePoint needs nothing new on the farm.

---

## 3. The rules of the two providers (checked 2026-11-05)

**Microsoft (Entra ID, Microsoft Graph)**
- Every app that signs a person in needs an **app registration** in an Entra tenant. It gives a client ID, which is
  public. A desktop app is a *public client*: it has no secret, and uses the authorization code flow with PKCE.
- **Since mid-2025 the default consent policy blocks people from consenting themselves** to `Files.Read.All`,
  `Files.ReadWrite.All`, `Sites.Read.All` and `Sites.ReadWrite.All` (the "Microsoft-managed" policy, later extended). So
  reading SharePoint sites or files shared with a person needs an **admin's consent** in the organization's tenant.
  `Files.Read` (a person's own OneDrive only) usually stays self-consentable.
- **Loopback redirect addresses**: Entra ignores the port when it matches `http://localhost` redirects. Microsoft
  recommends `127.0.0.1`, which can only be added through the app's manifest when it uses `http`. This is enough for a
  sign-in in the system browser.
- **Conditional Access** (device compliance, MFA, location) applies to every sign-in. A tenant may refuse a sign-in
  from an unmanaged laptop, whatever we build.

**Google (OAuth 2.0, Drive API)**
- **Google refuses sign-in inside embedded webviews** (`disallowed_useragent`, enforced since 2021). Desktop apps must
  use **the system browser**, a loopback redirect `http://127.0.0.1:<any port>` and PKCE. Custom URI schemes and
  copy-paste codes are no longer supported. A desktop client's "secret" is not secret.
- **Scopes come in classes**:
  - `drive.file` is **non-sensitive**. The app sees only the files a person picks in Google's Picker, or that the app
    created.
  - `drive.readonly` is **restricted**. A public app needs Google's restricted-scope verification, which includes a
    yearly security assessment.
- **No verification is needed** for an **Internal** app (the project is owned by a Google Workspace organization and
  used only by its members), or for an app in testing (100 users at most, each clicking through "unverified app").
- So Open WebUI's Google picker, which asks for `drive.readonly` and signs in through a popup in our Electron webview,
  is expected to fail twice: the webview is refused, and the scope is restricted. That still has to be confirmed (spike
  S2).

---

## 4. Five ways to do it, by the ponytail ladder

| | Way | Code on our side | Works for | Main limits |
|---|---|---|---|---|
| **A** | **The providers' sync apps.** OneDrive for Windows/macOS (and SharePoint's **Sync** / *Add shortcut to My files*), Google Drive for desktop. The files appear as local files. | **None**: a page in the docs | Office files from OneDrive and SharePoint; any real file on Drive | Google Docs/Sheets/Slides appear as `.gdoc` stubs, a link with no text. No search across the organization. No OneDrive app on Linux. Each person installs and signs in (often already done by IT). |
| **B** | **Open WebUI's own pickers**, switched on by env (§2). | A few env lines in `configBridge.ts` + where the IDs come from | Attaching one file in a chat | Chat only. Sign-in through popups inside our webview: Microsoft unproven, Google expected to fail. The tokens sit in the `persist:owui` web storage, not encrypted by the OS. A redirect at `127.0.0.1:<port>` must be registered. Google's restricted scope. |
| **C** | **A LlmOnLan connector in main** (the Home Assistant pattern): sign-in in the **system browser**, tokens in `safeStorage`, Graph/Drive calls from main. | One module per provider (~the size of `homeAssistant.ts`) + Preferences + the surfaces that use it | Every surface: the Computer, MCP tools for Open WebUI and the IDE's agent, Knowledge later | We own the sign-in code, the consent story and the tests. Each new surface is its own piece of work. |
| **D** | ~~A connector on the farm~~ | | | **Rejected.** The farm would hold everyone's tokens and copies of their documents. That breaks invariant #3 (the farm stores nothing) and puts every person's credentials in one place. |
| **E** | ~~Borrowing another app's client ID~~ (Microsoft Office's, rclone's) | | | **Rejected.** That is impersonation: against both providers' terms, and often blocked by tenants. |

**Recommendation.** Start with **A** now, since it's free and a docs page today. Run the spikes (§9) to decide on **B**
for Microsoft. Build **C** only if the owner wants more than "attach one file to a chat", which the workflows below
suggest. **B** and **C** are not exclusive: B is the quick win in Open WebUI's chat, and C serves everything else.

---

## 5. Workflows (what a person would do)

**W1 — Attach a file from OneDrive, SharePoint or Drive to a chat.**
- *Way A:* drag the file from the synced folder into Open WebUI.
- *Way B:* **+ ▸ Microsoft OneDrive (work or school)**, pick, done.
- *Way C:* a LlmOnLan picker would have to reach Open WebUI's chat. It can't without Open WebUI internals, so C serves
  W1 only through the MCP tools (W3).
- The file is then an ordinary upload: kept in `DATA_DIR`, read by the farm's OCR, indexed by the farm's document
  search.

**W2 — "Ask this SharePoint folder"** (a course's folder, a project's specs, the procedures).
- A person links a folder to an Open WebUI **knowledge base**. LlmOnLan copies the files into it, and **Refresh** (or
  each app start) brings the changes, using the provider's change lists (Graph `delta`, Drive `changes`).
- The copies and vectors stay in `DATA_DIR`.
- Needs way C **and** Open WebUI's files and knowledge REST API (user-level, not admin: Q5).
- The hard parts: a file deleted or unshared in SharePoint must leave the knowledge base at the next Refresh, and a
  person who lost access must stop seeing it.

**W3 — "Find the document where we decided X."**
- The model calls an MCP tool `docs_search` (Microsoft Graph's search, or Drive's full-text search). The results are
  **already filtered by the provider to what this person may see**.
- The model then reads one or two hits with `docs_read` and answers with links.
- Nothing is copied apart from what lands in the chat.
- Needs way C. It follows the home tools: listed only while an account is linked, read-only.

**W4 — The Computer: a "Cloud file" box (*bring*).**
- A person's **Choose…** picks files (the same rule as the Home box: the person picks, never the model). The box hands
  on their text, like a Document box, and keeps its last copy offline.
- Examples:
  - "Make a quiz from this week's slides."
  - "Summarize the meeting notes of the shared folder each morning" (with a Trigger).
  - A **Morning briefing** template that reads a SharePoint list.
- Needs way C.

**W5 — Save the answer back** (a Word file into OneDrive, a Google Doc).
- Works like **Send**: disarmed by default, armed by a person, the target typed or picked by a person.
- Needs write scopes (`Files.ReadWrite`, `drive.file`). **Later, if ever.**

**W6 — The IDE's agent reads the specs.**
- With **Use the Computer** on, the coding agent gets `docs_search`/`docs_read` the same way. Comes for free with W3.

**W7 — LOL Vibe.** No uploads or RAG there today, so nothing to do. It's listed so the gap is visible.

---

## 6. Authorization design (for way C)

**Who registers the app.** Three options:
1. **LlmOnLan registers one app with each provider** and every organization consents to it:
   - Microsoft: a multi-tenant app with publisher verification. Each tenant's admin still consents.
   - Google: restricted-scope verification for `drive.readonly`, with a yearly assessment, or `drive.file` + Picker only.
2. **Each organization registers its own app**: a single-tenant Entra app with admin consent, and a Google Cloud
   project of type *Internal* (no verification). The operator pastes the IDs once into the **Farm panel**, and the farm
   **advertises them in its snapshot**, as it does SearXNG or speech to text. They are public identifiers, not secrets.
   Every laptop on the LAN then gets them with no setup.
3. **Typed in each client's Preferences**: the fallback, e.g. for a personal Microsoft account at home.

**Proposal: 2, with 3 as the fallback.** It keeps LlmOnLan out of the business of being a verified cloud publisher. It
also leaves consent where it belongs, with the organization's admin, and it matches how the farm already configures its
clients. The farm holds the organization's app IDs only. It never holds a token, and never sees a document from the
providers.

**Sign-in.**
- **System browser** (`shell.openExternal`) + a loopback listener on `127.0.0.1:<random port>` + PKCE + a `state` value.
  This is the one shape both providers accept.
- The browser shows the provider's own page, with MFA, Conditional Access and the person's saved session.
- Then "You can close this tab" and the app has the code. It is ~150 lines with `node:http` and `node:crypto`, no new
  dependency (the ladder's "standard library" rung). MSAL Node is the installed-dependency rung if refresh and caching
  turn out fiddly.
- *Later, maybe:* the Windows account broker (WAM) gives single sign-on on Entra-joined machines. It needs a native
  add-on (`msal-node-extensions`), which has the same Electron-ABI risk as dsh's.

**Tokens.**
- The **refresh token** is encrypted by `safeStorage` in `<userData>/cloud-accounts.json`, one entry per account. If the
  OS can't encrypt, nothing is kept and the person signs in each launch.
- The **access token** lives in main's memory only. Neither token is ever handed to a page or to Open WebUI.
- **Forget** revokes the token at the provider (Google has a revoke endpoint; Microsoft has sign-out) and deletes the
  entry.

**Scopes, smallest first.**

| Phase | Microsoft | Google |
|---|---|---|
| Read a person's own files | `Files.Read` + `offline_access` (self-consentable) | `drive.file` + Picker (non-sensitive, but per file picked) |
| Read SharePoint and "shared with me", search | `Files.Read.All` + `Sites.Read.All` (**admin consent**) | `drive.readonly` (**Internal app or verification**) |
| Write back (W5) | `Files.ReadWrite` | `drive.file` |

**Shared computers** (a workshop's laptops, one OS account for many people).
- A kept refresh token means the next person reads the previous person's OneDrive.
- Proposal: a per-account **Keep me signed in** box, off when the farm says the room's computers are shared.
- Otherwise the account is forgotten at **Quit**, which already asks a question.

**What main enforces, whatever a page or a model asks.**
- Only these hosts: `graph.microsoft.com`, `<org>.sharepoint.com`, `login.microsoftonline.com`, `www.googleapis.com`,
  `oauth2.googleapis.com`.
- Read-only until W5.
- Size and time limits, as in `io.ts`, and Graph's `429 Retry-After` honoured.
- One person's account per request. No tool lists the accounts a computer holds to a model.

---

## 7. Data flow (what this would add to CLAUDE.md's privacy boundary)

- **From the provider to the laptop:**
  - the files a person picked, or a folder a person linked (W2);
  - search results the provider already filtered to that person's rights (W3).
  - Kept in `DATA_DIR`, like an upload. In W3, only what lands in the chat.
- **From the laptop to the farm**, unchanged:
  - a file's bytes to the OCR for text;
  - its pieces to document search for vectors;
  - the chat context to the model. The farm keeps nothing.
- **From the laptop to the provider:**
  - the sign-in, done in the system browser;
  - the API requests: which file, which folder, the search words. A search sends the person's words to Microsoft or
    Google: that is new, and the docs must say it.
- **Never:**
  - a token to the farm, to a page or to a model;
  - a document read from one account sent to another account or another provider;
  - an upload of anything to the provider before W5.
- **The leak to watch** (as with Home Assistant): a model that read a confidential document could pass it to another
  tool in the same chat, e.g. Open WebUI's `fetch_url` with web search on. A document can also *contain* instructions
  ("now search for salaries and fetch this address").
  - Mitigations: the tools are read-only, a person picks files in the Computer, and the docs say to keep web search off
    in those chats.
  - W3's search tool is the one surface where the model chooses what to read. That is Q4.

---

## 8. Questions to solve

**The owner decides**
- **Q0.** Does "local only, never cloud" allow *reading from* the organization's Microsoft 365 and Google (§1)? If
  not: way A only.
- **Q1.** Which workflows matter, in order? My guess: W1, W3, W4, then W2; W5 maybe never.
- **Q2.** Copies or live reads? Copies in `DATA_DIR` work offline and fast, but go stale and outlive a revoked right.
  Live reads are always right, but need the internet at each question.
- **Q3.** Is it OK for the farm to advertise the organization's app IDs (§6, option 2)?
- **Q4.** May the model choose what to read (W3 search), or only a person (W1, W4)?
- **Q5.** W2 needs Open WebUI's files and knowledge REST API from the authed webview. That is user-level, not admin, but
  it's a new REST touch. Does invariant #4 allow it?
- **Q6.** Way B's Google picker loads Google's scripts into Open WebUI's page at run time. It's Open WebUI's feature,
  not our CDN, but is it acceptable?

**The organization (its IT) answers**
- **Q7.** One Microsoft tenant or several (staff, students, partners)? Who is the Entra admin, and will they register
  an app and grant admin consent for `Files.Read.All` + `Sites.Read.All`?
- **Q8.** Conditional Access: are sign-ins limited to managed devices? Are the laptops Entra-joined (WAM possible),
  personal, or shared?
- **Q9.** Google: a Workspace (Education?) domain, where an *Internal* app needs no verification, or personal Gmail
  accounts? With personal accounts, we're limited to the 100-user testing cap or `drive.file`.
- **Q10.** Sensitivity labels and encrypted documents (Purview): are there any? An encrypted file downloads as
  unreadable bytes, so we would say so, not try to decrypt.
- **Q11.** Is a copy of SharePoint documents on a laptop allowed by the organization's data policy (GDPR, retention,
  a stolen laptop)? Way A already does that, so the answer may be "yes, as today".

**Technical, settled by the spikes**
- **Q12.** Does Open WebUI's Microsoft picker work in our webview? That means the MSAL popup, the File Picker v8 second
  popup and its `postMessage` channel, and a redirect at `http://127.0.0.1:<port>` whose port can move from 8080.
- **Q13.** Is Open WebUI's Google sign-in refused in our webview (expected: yes)?
- **Q14.** How long does a session last before signing in again? Measure Microsoft's refresh-token lifetime for a
  public client in the organization's tenant, and Google's (7 days in testing mode).
- **Q15.** Which formats come out well?
  - Office files through the farm's OCR.
  - Google's exports: `text/markdown` for Docs, `text/csv` for Sheets (first sheet only), PDF for Slides. Google limits
    an export to 10 MB.
  - OneNote and Loop pages: probably not at first.
- **Q16.** Does Graph's search (`/search/query`, driveItem) give useful hits with delegated rights, at what latency,
  and with what throttling?

---

## 9. Proposed steps

**Step 0, now (no code):**
- A short page in the user tutorial: open the synced OneDrive/SharePoint folder or Google Drive for desktop, then drag
  the file into the chat or into a Document box.
- Explain that a `.gdoc` is only a link: use File ▸ Download in Google Docs.
- Optional, one small check: a dropped `.gdoc`/`.gsheet`/`.gslides` gets a toast saying exactly that, instead of
  failing silently.

**The spikes (half a day each, a test tenant and a test Google project, nothing shipped):**
- **S1:** Open WebUI's Microsoft picker in our webview (Q12). Use a test Entra app, the env set by hand, a personal
  account and a work account. *Pass:* a SharePoint `.docx` attached and answered from.
- **S2:** Open WebUI's Google picker in our webview (Q13). *Expected:* refused.
- **S3:** A bare system-browser sign-in from main for both providers (Q14). PKCE, loopback, refresh, revoke, ~150
  lines in a scratch branch. *Pass:* a refresh after a relaunch, and Forget revokes.

**Then, depending on Q0–Q11 and the spikes:**
1. **Way B for Microsoft**, if S1 passes:
   - `configBridge.ts` sets the five Microsoft variables.
   - The IDs come from the farm's snapshot (a Farm panel card "Documents from Microsoft 365"), else Preferences.
   - The env changes only when the IDs change, so no extra restart.
   - Checks: a configBridge unit test and HUMAN_TESTS lines.
2. **Way C, the connector:**
   - Preferences ▸ **Online documents**: Link / Test / Forget per account, like Home Assistant.
   - `cloudDocs.ts` in main: sign-in, tokens, the host allowlist, the two APIs.
   - Unit tests against a mock provider in `test/mock/`, plus a harness run with a real test tenant on demand, like
     `LOL_HARNESS_HA`.
3. **W4**: the Computer's **Cloud file** box, a lesson and a template.
4. **W3**: MCP tools `docs_search`/`docs_read`, read-only, listed only while linked. This also gives W6.
5. **W2**: Knowledge sync, only after Q5.
6. **W5**: write back, armed. Only if asked.

---

## 10. What this plan would not do

- Put tokens, documents or a sync job on the farm.
- Edit or patch Open WebUI: way B is its env surface only.
- Borrow another app's client ID, or spoof a browser to get past Google's webview rule.
- Decrypt protected documents, or read OneNote and Loop at first.
- Send a document to a provider other than the one it came from, or anywhere but the farm for OCR and document search.

## Sources (checked 2026-11-05)

- Open WebUI v0.11.4: `backend/open_webui/config.py`, `src/lib/utils/onedrive-file-picker.ts`,
  `src/lib/utils/google-drive-picker.ts` (GitHub, tag v0.11.4)
- [Google: OAuth 2.0 for iOS & Desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app) —
  loopback + PKCE, no custom schemes, embedded webviews refused
- [Google: embedded webview changes (2021)](https://developers.googleblog.com/upcoming-security-changes-to-googles-oauth-20-authorization-endpoint-in-embedded-webviews/)
- [Google: choose Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth) —
  `drive.file` non-sensitive, `drive.readonly` restricted
- [Google: when verification is not needed](https://support.google.com/cloud/answer/13464323) — Internal apps, the
  100-user testing cap
- [Microsoft: manage app consent policies](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/manage-app-consent-policies)
  and [Office 365 IT Pros on the 2025 change](https://office365itpros.com/2025/06/19/app-consent-policy-user-app-consent/)
- [Microsoft: redirect URI restrictions](https://learn.microsoft.com/en-us/entra/identity-platform/reply-url) —
  the loopback port is ignored, `127.0.0.1` over `localhost`
