# Embedding models for the client: is a Gemma model worth it? (2026-10-08)

The owner asked (2026-10-07): "I wonder if [Gemma] embeddings could be interesting for us." A workflow answered it on
2026-10-08:
- **Research:** the models as of October 2026, from primary sources.
- **Code reading:** how Open WebUI 0.11.4 and LlmOnLan use embeddings, read in the bundled source.
- **Measurement:** on AN-A6000PRO's CPU limited to 4 threads, with the bundled sidecar's libraries: load time, memory,
  speed, and French retrieval on MIRACL-fr and Alloprof, plus an English check.
- **Review:** a recommendation, then a critic who re-measured what did not add up.

The scripts and raw numbers stayed in the session's scratchpad. This page is the corrected recommendation.

**Decision: none yet; the owner decides.** Until then the client keeps Open WebUI's default all-MiniLM-L6-v2,
computed on each laptop, never on the farm.

**Short answer: do nothing for now.** On the studio farm (64k per person), Open WebUI reads attached files whole, so the search model hardly matters there. A Gemma model would cost every laptop a 1.27 GB download and uploads about 9 times slower.

If French knowledge bases, or small farms with French users, become real use, switch everyone once. Try granite-97m first; keep EmbeddingGemma 300M in reserve.

**Separately, worth fixing before v0.2.9:** a first model download that gets interrupted now leaves uploads broken for good (see "Fix first").

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
- **Never compute embeddings on the farm.** Ollama, vLLM and llama.cpp could all run these models, but that sends documents off the laptop and breaks the prime directive.
- **One trap:** turning on Open WebUI's "openai" embedding setting without giving it an address points it at the farm.
  - The seat gate answers 404, but the text has already crossed the LAN by then.
  - The guard is never setting that engine, not the gate.

### Fixed before v0.2.9 (2026-10-08): a first download cut off half-way
A first download cut off half-way left every upload broken for good. That is fixed in the shell (`configBridge.ts`,
`sidecar.ts`; DEVLOG 2026-10-08):
- **"Cached" is judged the way huggingface_hub judges it.** It follows `refs/main` to the one snapshot folder, checks
  every file the loader needs, and treats a dangling link as damage.
- **A half or damaged MiniLM is removed before Open WebUI starts.** The snapshots and the file list go; the
  downloaded bytes stay. Open WebUI's loader then fetches the 11 files it needs: about 92 MB, healthy at 22.6 s,
  and offline-proof afterwards.
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
1. **The download fixes above:** check the weights file of the new model, and handle a half folder.
2. **Allow for the first download:** while the weights are missing, wait longer than 3 min and don't offer a Retry that kills the download. The connection screen should say what is downloading and its size.
3. **Licence:** add the Gemma notice to About and NOTICE.
4. **Docs:** CLAUDE.md (the embeddings section and the data flow), INTEGRATION_BRIEF, the tutorial, a release note telling people to click Reindex (for granite, old answers are silently wrong until then), and the DEVLOG.

What to test:
- **Startups:** first start with an empty Hugging Face folder and no token (this PC has a token, which would hide a login failure), an interrupted first start, and an offline second start.
- **Unit tests** for `hfModelsCached`, including a half folder counting as not downloaded.
- **French PDF:** on a mock farm under 24,576 tokens per person and on a 64k farm.
- **An old MiniLM knowledge base**, before and after Reindex, and memories.
- **Network:** no embedding request reaches the farm.
- **Real laptops:** Windows, an Apple Silicon Mac (MPS), an Intel Mac (torch 2.2.2) and Linux. Measure first start, memory and the time to upload 50 pages.
