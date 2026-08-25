// Which client surface this build ships.
//
// ---------------------------------------------------------------------------
// v0.1.29 shipped WITHOUT Open WebUI as a product experiment (LOL Chat only).
// The verdict (owner, 2026-08-25): the OWUI features are wanted back — RAG /
// knowledge bases, document upload + farm OCR, web search, voice, chat history,
// folders, prompts — so OWUI is the primary surface again. LOL Chat remains as
// the topbar-toggle alternative view (see renderer/chat.js), unchanged from the
// studio test build.
//
// Keep this as ONE constant so the no-OWUI build stays a boolean flip away.
// NOTE the renderer has a matching `NO_OWUI` const at the top of
// renderer/app.js — the two must be flipped TOGETHER (main gates the sidecar
// lifecycle; the renderer gates which surface drives the overlay).
// ---------------------------------------------------------------------------

export const OWUI_ENABLED = true;

// Human-readable label used in overlay copy so the connection screen matches
// what this build actually starts.
export const CLIENT_SURFACE = OWUI_ENABLED ? 'Open WebUI' : 'LOL Chat';
