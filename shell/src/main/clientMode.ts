// Which client surface this build ships.
//
// ---------------------------------------------------------------------------
// This branch ships WITHOUT Open WebUI. That is a deliberate product experiment,
// not a cleanup, and it costs real features — everything below is provided by
// OWUI and simply does not exist in this build:
//
//   • whole-document chat / RAG (RAG_FULL_CONTEXT) and knowledge bases
//   • document upload, and therefore the farm's OCR extraction path
//   • the farm's SearXNG web search wiring
//   • Kokoro TTS and local Whisper STT
//   • the Blender/mcpo tool-server integration (registered via OWUI's API)
//   • chat history, folders, prompts, and the model picker
//
// LOL Chat replaces only the chat surface itself. Data locality (invariant #3)
// still holds — conversations live in localStorage on the user's machine — but
// DATA_DIR, the data-folder move, and the whole sidecar lifecycle become inert.
//
// Keep this as ONE constant so the diff against the OWUI build stays small and
// this is revertible by flipping a boolean rather than unpicking a fork.
// ---------------------------------------------------------------------------

export const OWUI_ENABLED = false;

// Human-readable label used in overlay copy so the connection screen does not
// promise a sidecar that will never start.
export const CLIENT_SURFACE = OWUI_ENABLED ? 'Open WebUI' : 'LOL Chat';
