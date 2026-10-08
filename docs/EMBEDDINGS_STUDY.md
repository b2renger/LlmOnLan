# Embedding models for the client: is a Gemma model worth it? (2026-10-08)

The owner asked (2026-10-07): "I wonder if [Gemma] embeddings could be interesting for us." A workflow answered it on
2026-10-08:
- **Research:** the models as of October 2026, from primary sources.
- **Code reading:** how Open WebUI 0.11.4 and LlmOnLan use embeddings, read in the bundled source.
- **Measurement:** on AN-A6000PRO's CPU limited to 4 threads, with the bundled sidecar's libraries: load time, memory,
  speed, and French retrieval on MIRACL-fr and Alloprof, plus an English check.
- **Review:** a recommendation, then a critic who re-measured what did not add up.

The scripts and raw numbers stayed in the session's scratchpad. This page is the corrected recommendation.

**Decision (2026-10-08): the farm, with EmbeddingGemma 2** — see "The decision" at the end. Round 1 below
recommended doing nothing; round 2 measured the farm option, and the owner chose it.

**Short answer: do nothing for now.** On the studio farm (64k per person), Open WebUI reads attached files whole, so the search model hardly matters there. A Gemma model would cost every laptop a 1.27 GB download and uploads about 9 times slower.

If French knowledge bases, or small farms with French users, become real use, switch everyone once. Try granite-97m first; keep EmbeddingGemma 300M in reserve.

**Separately, fixed before v0.2.9:** a first model download that got interrupted used to leave uploads broken for good (see "Fixed before v0.2.9").

### What "gemma2 embeddings" is
- Almost certainly **EmbeddingGemma 2**, which Google released on 6 October 2026. It is Apache 2.0 and needs no login. It is one 1.5 GB file; text uses 270M of its 740M parameters, and the rest is for images, audio and video.
- **We can't run it today.**
  - It needs transformers 5.19, sentence-transformers 6.1 and torchvision.
  - Open WebUI 0.11.4, still the newest release, pins transformers 5.5.4 and sentence-transformers 5.5.1 exactly.
  - Overriding those pins changes no Open WebUI source. But Open WebUI would run on libraries it was never tested with, which goes against invariant 5 (an upgrade is only a version bump). Wait for an Open WebUI release that raises them.
- **On French it is no better than the first version** (300M, 2025): 0.75 against 0.79 on Wikipedia questions, and 0.60 against 0.75 on homework questions.
- **"bge-multilingual-gemma2"** (2024) is 9B parameters and about 37 GB, so it is out of reach for laptops.

### Where embeddings matter for us
- **Every upload is embedded, whatever the mode.** That costs CPU time on the laptop.
- **On the 64k farm, files attached to a chat and Legacy web-search pages are read whole.** Their vectors are never read.
- **Vectors are read in three cases:**
  - on farms with less than 24,576 tokens per person (top-k mode), for everything;
  - on any farm, by Open WebUI's two knowledge "query" tools. The model also gets grep and whole-file tools that read the text without vectors.
  - by memories, for people who use them.
- **Web search v2** ranks with plain word matching in our main process, so it uses no vectors.

### French quality (measured, ±0.03)
- **Wikipedia** = MIRACL-fr: the share of the right passages (2.1 per question) found in the top 5.
- **Homework** = Alloprof, Quebec secondary-school questions: the share of questions whose one right article is in the top 5.

| Model | Wikipedia | Homework | Download | 50 pages* |
|---|---|---|---|---|
| MiniLM (today) | 0.44 | 0.36 | 92 MB | 1x |
| granite-97m-r2 | 0.73 | 0.57 | 211 MB | ~2x |
| multilingual-e5-small | 0.75 | 0.34 | 488 MB | ~2x |
| EmbeddingGemma 300M | 0.79 | 0.75 | 1.27 GB | ~9x |
| EmbeddingGemma 2 | 0.75 | 0.60 | 1.5 GB | ~12x |

\* Time to embed a 50-page French document compared with MiniLM, CPU limited to 4 threads.

- **MiniLM** is English-only, which is most of its gap. It also stops at 256 tokens: 7 to 8 of Open WebUI's French chunks in 10 lose their end, about a sixth to a fifth of the text.
- **EmbeddingGemma 300M's homework lead may partly come from training overlap** (not verified). On Wikipedia questions, all the multilingual models are within 0.06 of each other.

### Laptop cost
Measured on a 16-core desktop limited to 4 threads. Laptops are probably 2 to 3 times slower; that is not measured.
- **EmbeddingGemma 300M, compared with today:**
  - **Download:** 1.27 GB per laptop, inside Open WebUI's startup before it answers. It took 2.5 min in one try and 6 min in another; the app waits 3 min.
  - **Startup:** +0.9 to 1.4 s on every start.
  - **Memory:** +0.6 GB at rest, +1.3 GB at the peak while embedding.
  - **A 50-page document:** 32 s instead of 3.5 s.
- **granite-97m:**
  - **Download:** 211 MB.
  - **Startup:** +1.2 s.
  - **Memory:** +0.6 GB at the peak.
  - **A 50-page document:** 10 s instead of 4.6 s in fp32, the same session's MiniLM time.
  - **Format:** it loads in bf16 by default, which was as fast as MiniLM on this CPU. That is untested on laptops without native bf16.
- **EmbeddingGemma 2 is heavier still.** Open WebUI would load all of it, because it has no text-only setting: +3.1 GB of memory, or +4.3 GB at the peak.

### Licence and download blockers
- **Google's EmbeddingGemma 300M needs a Hugging Face login.** Without one, the download is refused, Open WebUI starts with no search model, and every upload fails. We never ship a token.
- **`unsloth/embeddinggemma-300m` is a byte-identical copy that needs no login.**
  - The Gemma terms still apply, so the Gemma notice goes in About and NOTICE.
  - Turn off `RAG_EMBEDDING_MODEL_TRUST_REMOTE_CODE`. Open WebUI's default runs code from the download.
  - The copy can't be pinned to a version through settings.
- **granite-97m** is labelled Apache 2.0, but its tokenizer descends from Gemma 3's. Treat it as needing the Gemma notice too, unless IBM says otherwise.
- **EmbeddingGemma 2** has no licence or login problem; only the library versions block it.

### Existing knowledge bases
- **Open WebUI does not rebuild old vectors when the model changes.**
- **Gemma (384 → 768 sizes):**
  - In top-k mode and in the two query tools, old knowledge bases and files return nothing.
  - Adding a file to an old knowledge base fails.
  - Files attached on the 64k farm keep working, because they are read whole.
- **granite (384, the same size as MiniLM):** nothing errors. Old vectors silently give wrong matches.
- **Memories** repair themselves only when a new memory is saved, and only if the size changed.
- **The fix is one click per person:** Admin ▸ Settings ▸ Documents ▸ **Reindex Embedding Data**.
  - It re-embeds every knowledge-base file at the new model's speed.
  - Old files attached straight to a chat are never rebuilt.
  - The app can't press it for people: that would be our first use of Open WebUI's admin API, which our rules exclude.

### Staying within the rules
- **Open WebUI needs only settings**, and the bundled Open WebUI stays unchanged for the 300M model and granite. Our shell needs the small changes listed below. Models sit in each laptop's Hugging Face folder.
- **Never compute embeddings on the farm** (round 1's rule, replaced by the owner's decision of 2026-10-08 below). Ollama, vLLM and llama.cpp could all run these models, but that sends documents off the laptop.
- **One trap:** turning on Open WebUI's "openai" embedding setting without giving it an address points it at the farm.
  - The seat gate answers 404, but the text has already crossed the LAN by then.
  - The guard is never setting that engine, not the gate.

### Fixed before v0.2.9 (2026-10-08): a first download cut off half-way
A first download cut off half-way left every upload broken for good. That is fixed in the shell (`configBridge.ts`,
`sidecar.ts`; DEVLOG 2026-10-08):
- **"Cached" is judged the way huggingface_hub judges it.** It follows `refs/main` to the one snapshot folder, checks
  every file the loader needs, and treats a dangling link as damage.
- **A half or damaged MiniLM is repaired before Open WebUI starts, gently.** First the hub's file list and any
  dangling link go: a whole model damaged only by a dangling link then loads from disk, offline too (healthy at
  11.3–11.6 s). Only a model still half-downloaded loses its snapshots too. The downloaded bytes always stay. Open
  WebUI's loader then fetches the 11 files it needs: about 92 MB, healthy at 22.6 s, and offline-proof afterwards.
- **A closed LAN no longer holds the start.** While MiniLM is not on disk, the app asks huggingface.co once (a 3 s
  question). With no answer, that launch alone starts offline: the chat opens in about 12 s instead of after the
  hub's 2 to 8 minutes of retries, and a message says document uploads need one start with internet access. The
  next start online downloads the model.
- **The question follows the system proxy, as the hub does.** It goes through Electron's network stack. When a
  proxy is set in the environment, the app does not ask and the launch stays online. Node's own fetch ignores
  proxies, so on a proxy-only network every launch would have started offline and MiniLM would never have
  downloaded.
- **The first idea did not work.** Turning Open WebUI's own update back on fetched the whole repository (0.94 GB,
  once 196 s, past the 180 s start wait). It also left a dangling link that made the next offline start fail.
  End-to-end tests with the real sidecar rejected it.

### Recommendation: do nothing now
**Reason:** on the 64k farm the vectors are rarely read, and the knowledge tools can read the text anyway. The cost of a switch would reach everyone: a download, slower uploads, and a Reindex click per person.
- **Not as a Preferences option either.** Each time a person flipped it, their knowledge bases would break.
- **When to revisit:** French knowledge bases are in real use, or a farm with less than 24,576 tokens per person serves French users.
  - Then switch everyone once to **granite-97m**. It recovers most of the gain for a sixth of the download and about a quarter of EmbeddingGemma's CPU time.
  - Use **EmbeddingGemma 300M** only if granite falls short on real school documents.
- **Re-check EmbeddingGemma 2** when Open WebUI raises its library pins.

### If you switch
Settings, in `configBridge.ts`. `RAG_EMBEDDING_ENGINE` stays unset.
- **granite-97m:**
  - `RAG_EMBEDDING_MODEL=ibm-granite/granite-embedding-97m-multilingual-r2`
  - `RAG_EMBEDDING_MODEL_TRUST_REMOTE_CODE=false`
  - no prefixes;
  - optionally `SENTENCE_TRANSFORMERS_MODEL_KWARGS={"dtype":"float32"}` if laptops are slow in bf16 (untested in Open WebUI).
- **or EmbeddingGemma 300M:**
  - `RAG_EMBEDDING_MODEL=unsloth/embeddinggemma-300m`
  - `RAG_EMBEDDING_QUERY_PREFIX="task: search result | query: "`
  - `RAG_EMBEDDING_CONTENT_PREFIX="title: none | text: "`
  - `TRUST_REMOTE_CODE=false`
  - never float16.

Steps:
1. **Point the download fixes at the new model:** `configBridge.ts` checks and repairs MiniLM by name (`MINILM`: its
   folder and the files its loader reads; `miniLmState`, `repairMiniLm`), and the start-up question asks huggingface.co
   about MiniLM (`hubAnswers`). Give them the new model's folder and file list, measured file by file as for MiniLM,
   and change the size in the offline-start message ("about 92 MB") in `sidecar.ts`.
2. **Allow for the first download:** while the weights are missing, wait longer than 3 min and don't offer a Retry that kills the download. The connection screen should say what is downloading and its size.
3. **Licence:** add the Gemma notice to About and NOTICE.
4. **Docs:** CLAUDE.md (the embeddings section and the data flow), INTEGRATION_BRIEF, the tutorial, a release note telling people to click Reindex (for granite, old answers are silently wrong until then), and the DEVLOG.

What to test:
- **Startups:** first start with an empty Hugging Face folder and no token (this PC has a token, which would hide a login failure), an interrupted first start, and an offline second start.
- **Unit tests:** extend the existing `hfModelState` / repair / `hubAnswers` tests in `test/chat/unit/shell-main.test.mjs`
  to the new model's file list (a half folder counts as partial; leave out each needed file in turn).
- **French PDF:** on a mock farm under 24,576 tokens per person and on a 64k farm.
- **An old MiniLM knowledge base**, before and after Reindex, and memories.
- **Network:** no embedding request reaches the farm.
- **Real laptops:** Windows, an Apple Silicon Mac (MPS), an Intel Mac (torch 2.2.2) and Linux. Measure first start, memory and the time to upload 50 pages.

---

## Round 2 (2026-10-08 afternoon): multilingual, laptop or farm

The owner: "we would need multi language embedding support … server or laptop, help me decide; gemma2 embeddings is new
and performant, my only worry is that it will be too big for some laptops." Two agents measured it, one per side. The
scripts and raw results stayed in the session scratchpad (`embeddings/laptop/`, `embeddings/server/`).

### Quality across languages (nDCG@10, 200 questions per cell, ±0.03–0.04)

**Same-language questions** (MIRACL Wikipedia slices):

| model | fr | en | es | de | ar | zh | ja | average |
|---|---|---|---|---|---|---|---|---|
| MiniLM (today) | 0.41 | 0.69 | 0.45 | 0.39 | 0.00 | 0.05 | 0.05 | 0.29 |
| granite-97m-r2 | 0.70 | 0.75 | 0.78 | 0.73 | 0.83 | 0.71 | 0.79 | 0.75 |
| multilingual-e5-small | 0.69 | 0.75 | 0.81 | 0.74 | 0.87 | 0.68 | 0.81 | 0.76 |
| **EmbeddingGemma 300M** | 0.76 | 0.80 | 0.82 | 0.80 | 0.86 | 0.78 | 0.82 | **0.81** |
| EmbeddingGemma 2 | 0.73 | 0.78 | 0.82 | 0.78 | 0.88 | 0.76 | 0.83 | 0.80 |
| Qwen3-Embedding-0.6B | 0.76 | 0.78 | 0.80 | 0.76 | 0.88 | 0.75 | 0.78 | 0.79 |

**A question in another language, answers in French documents** (Belebele; the international student's case):

| model | en→fr | es→fr | de→fr | ar→fr | zh→fr | ja→fr | average |
|---|---|---|---|---|---|---|---|
| MiniLM | 0.55 | 0.24 | 0.28 | 0.02 | 0.03 | 0.02 | 0.19 |
| granite | 0.82 | 0.81 | 0.78 | 0.61 | 0.70 | 0.67 | 0.73 |
| e5-small | 0.80 | 0.79 | 0.79 | 0.44 | 0.25 | 0.59 | 0.61 |
| **EmbeddingGemma 300M** | 0.92 | 0.92 | 0.88 | 0.84 | 0.90 | 0.88 | **0.89** |
| EmbeddingGemma 2 | 0.87 | 0.87 | 0.84 | 0.80 | 0.83 | 0.84 | 0.84 |
| Qwen3-0.6B | 0.91 | 0.86 | 0.86 | 0.73 | 0.84 | 0.81 | 0.83 |

French homework (Alloprof): MiniLM 0.29, granite 0.48, e5-small 0.27, **EmbeddingGemma 300M 0.60**, EmbeddingGemma 2 0.47.

**What it says:**
- MiniLM does not work beyond English.
- EmbeddingGemma 300M is the best model for us wherever it runs: best on average, and clearly best across
  languages.
- EmbeddingGemma 2 is no better on text. It ties in the same language and loses 0.04–0.07 across languages. Its
  strengths, images and audio in the same space, are not used by Open WebUI.

### On a laptop (4 cores capped to AVX2; real laptops ~1.5–3× slower, an estimate)

Measured in the real bundled Open WebUI 0.11.4, uploading a 50-page French document:

| setting | download | upload time | Open WebUI's memory, peak |
|---|---|---|---|
| MiniLM (today) | 91 MB | 3.4 s | 0.80 GB |
| granite, forced to fp32 | 220 MB | 8.6 s | 1.21 GB |
| **EmbeddingGemma 300M** | 1.27 GB | **31.8 s** | 1.49 GB |
| EmbeddingGemma 2 | — | fails: Open WebUI 0.11.4 cannot load it (it pins transformers 5.5.4); no newer release exists | — |

- **Memory is not the problem: time is.** Every upload is embedded, even on a 64k farm that then reads the file
  whole. So on a weak laptop each 50-page attachment would wait about 1–2.5 minutes, against seconds today.
- **Intel Macs** (found on the way, to confirm on a real one): their sidecar's torch 2.2.2 is too old for transformers
  5.5.4. Document uploads probably fail there today, with MiniLM. No in-process model can work there.
- **Apple Silicon:** Open WebUI uses the Mac's GPU. Not measured.

### On the farm (llama-server with `--embeddings`, the farm's own llama.cpp)

| measure | result |
|---|---|
| GPU memory | about 1.1 GB |
| one 50-page upload | 1.4 s |
| ten 50-page uploads at once | 6.7 s |
| a search query | 3 ms |

- **Runs with the farm's llama.cpp of the time (b10670), DGX Spark included:** EmbeddingGemma 300M and Qwen3-0.6B.
  EmbeddingGemma 2 needs b11454 or later; the farm moved to b11512 the same day (DEVLOG 2026-10-08 21:40).
- **No seat taken:** it runs on its own plugin port, so it doesn't count against chat seats.
- **Same vectors whatever the server:** the same model gives the same vectors from the farm's llama.cpp and from the
  laptop's sentence-transformers (cosine ≥ 0.999, measured for EmbeddingGemma 2). A knowledge base built on one
  can therefore be searched from the other.
- **What changes:**
  - Document text chunks and queries go to the farm. Today's OCR already sends the file itself there for
    extraction. Nothing is stored there, and the vectors stay on the laptop.
  - Every farm must serve the same model, and the laptop checks it before use.
  - Indexing needs the farm.
  - CLAUDE.md's rule "never send documents to the farm for embedding" would change: the owner's decision.

### The decision (2026-10-08)

**The owner chose the farm, and EmbeddingGemma 2.** Documents are turned into vectors on the farm, the vectors come
back to the laptop and are kept there as before, and the farm keeps nothing. Built on branch `embed-farm`
(DEVLOG 2026-10-08):
- **The rule changed.** A document's text may now be sent to the farm to be turned into vectors: nothing is kept
  there and nothing is logged (the farm's log holds token counts only). CLAUDE.md says so.
- **On the farm:** a plugin, *Document search* (`farm/src/embed.js`): llama-server in embedding mode with one pinned
  model per LOL release, ggml-org's BF16 conversion of google/embeddinggemma-2 (pinned by revision and sha256). Its
  vectors equal sentence-transformers' float32 ones (cosine 1.0000, measured above). 768 numbers, Google's search
  prefixes, named by the contract `embeddinggemma-2/768/v1`. On by default when the farm has an NVIDIA GPU; about
  1.2 GB of its memory (1.05 GB loaded, 1.16 GB at the peak, 8 texts of up to 2048 tokens at once). It needs
  llama.cpp b11454 or later: the farm's pin moves to an official build in its own branch.
- **On the laptop:** a data folder adopts the farm's model the first time it meets a farm offering it
  (`DATA_DIR/lol-embedding.json`), and keeps it for good: on a farm without it, an upload fails with a message
  rather than being indexed with MiniLM, which would leave the old documents unsearchable. A folder MiniLM had
  indexed is told once to press **Reindex** (Admin Panel ▸ Settings ▸ Documents); the app never presses it.
- **No laptop fallback with it** until Open WebUI raises its library pins: 0.11.4 pins transformers 5.5.4, which
  cannot load EmbeddingGemma 2. When a release can, a laptop could compute the same vectors under the same contract.
- **What the measurements said, for the record:** EmbeddingGemma 300M scored a little higher on text (0.81 against
  0.80 in the same language, 0.89 against 0.84 across languages); the owner chose EmbeddingGemma 2.
- **Checked end to end** (the built Open WebUI 0.11.4 with the shell's env, the plugin alone on scratch ports):
  a French text's vectors are 768 numbers in the data folder's vector store; a French search and an English one both
  find the right passage; 200,000 characters (356 pieces) are indexed in 1.4 s; Open WebUI no longer loads MiniLM
  (healthy at 7–8 s, nothing downloaded from huggingface.co); a made-up word from the document is in no farm file,
  folder or log afterwards; a MiniLM knowledge base finds nothing after the switch and everything after Reindex.
