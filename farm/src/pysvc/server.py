"""
lol-extract — an Open WebUI "External Document Loader" for the LlmOnLan farm.

One shared document-extraction service on the farm box. Each client's OWUI is
configured (by the shell's config-bridge, from the beacon) with:

    CONTENT_EXTRACTION_ENGINE = external
    EXTERNAL_DOCUMENT_LOADER_URL = http://<farm>:<port>
    EXTERNAL_DOCUMENT_LOADER_API_KEY = <key>

so on every uploaded file OWUI does (verified against open-webui v0.10.2,
backend/open_webui/retrieval/loaders/external_document.py):

    PUT  {URL}/process        body = raw file bytes
    headers: Content-Type: <mime>, Authorization: Bearer <key>, X-Filename: <urlquoted name>

and expects back a JSON list of {"page_content": str, "metadata": {...}} (one per
page). This is the ONLY way an external service ever receives an uploaded file in
OWUI 0.10.2 — external OpenAPI *tool servers* never get the bytes — so both the
"searchable scanned docs (RAG)" and the "vision-model OCR transcript" goals funnel
through this single engine, which routes internally:

  • images + scanned / image-only PDF pages  -> Ollama-OCR (a vision model on the
    farm's LOCAL Ollama /api/generate) -> structured markdown.
  • born-digital PDFs / docx / plaintext / html -> fast local text extraction.
  • (optional, OCR_DOCLING=1) Docling in-process for richer office/table fidelity.

Env (set by farm/src/extract.js spawnExtract):
  EXTRACT_API_KEY  bearer token OWUI must send (matches the beacon-advertised key)
  EXTRACT_PORT     bind port (informational; uvicorn is launched with --port)
  OCR_MODEL        vision model tag for Ollama-OCR (e.g. gemma4:12b)
  OCR_OLLAMA_URL   the local Ollama NATIVE generate endpoint (…:11434/api/generate)
  OCR_FORMAT       markdown|text|json|structured|key_value|table (default markdown)
  OCR_PDF_ENGINE   auto|vision|text (default auto: per page, text layer if present
                   else vision OCR)
  OCR_PREPROCESS   "1" to enable Ollama-OCR's cv2 binarization (default off — a raw
                   image usually reads better on a vision LLM)
  OCR_DOCLING      "1" to route non-image docs through Docling (must be installed)
"""

import os
import re
import hmac
import shutil
import tempfile
import urllib.parse

import pymupdf
from fastapi import FastAPI, Request, HTTPException
from starlette.concurrency import run_in_threadpool

from ocr_processor import OCRProcessor

# ---- config from env (set once by extract.js spawnExtract) ------------------
KEY = os.environ.get("EXTRACT_API_KEY", "")
OCR_MODEL = os.environ.get("OCR_MODEL", "llama3.2-vision:11b")
OCR_OLLAMA_URL = os.environ.get("OCR_OLLAMA_URL", "http://127.0.0.1:11434/api/generate")
OCR_FORMAT = os.environ.get("OCR_FORMAT", "markdown")
OCR_PDF_ENGINE = os.environ.get("OCR_PDF_ENGINE", "auto")   # auto | vision | text
OCR_PREPROCESS = os.environ.get("OCR_PREPROCESS", "0") == "1"
OCR_DOCLING = os.environ.get("OCR_DOCLING", "0") == "1"
# Read timeout (seconds) for the Ollama call — a non-stream vision generate sends
# nothing until done, so this bounds total per-page generation before we give up and
# free the worker (a stalled Ollama would otherwise hold a threadpool token forever).
OCR_HTTP_TIMEOUT = int(os.environ.get("OCR_HTTP_TIMEOUT", "600"))

OCR = OCRProcessor(model_name=OCR_MODEL, base_url=OCR_OLLAMA_URL, request_timeout=(10, OCR_HTTP_TIMEOUT))

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp", ".gif"}
TEXT_EXTS = {".txt", ".md", ".markdown", ".csv", ".tsv", ".log", ".rst"}
HTML_EXTS = {".html", ".htm"}
# Content-Type → extension fallback when X-Filename carries no usable suffix.
CT_EXT = {
    "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp",
    "image/tiff": ".tiff", "image/bmp": ".bmp", "image/gif": ".gif",
    "application/pdf": ".pdf",
    "text/plain": ".txt", "text/markdown": ".md", "text/csv": ".csv",
    "text/html": ".html",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
}

app = FastAPI(title="lol-extract", docs_url=None, redoc_url=None)

_docling_conv = None


def _docling_converter():
    """Lazily build (and cache) a Docling converter — importing docling pulls a
    heavy tree, so we only touch it when OCR_DOCLING is on and a doc arrives."""
    global _docling_conv
    if _docling_conv is None:
        from docling.document_converter import DocumentConverter
        _docling_conv = DocumentConverter()
    return _docling_conv


def _page(content, page, source, engine):
    return {"page_content": content or "", "metadata": {"page": page, "source": source, "engine": engine}}


def _ext(filename, content_type):
    ext = os.path.splitext(filename or "")[1].lower()
    if ext:
        return ext
    return CT_EXT.get((content_type or "").split(";")[0].strip().lower(), "")


def _read_text(path):
    with open(path, "rb") as f:
        return f.read().decode("utf-8", errors="replace")


def _strip_html(s):
    s = re.sub(r"(?is)<(script|style).*?</\1>", " ", s)
    s = re.sub(r"(?s)<[^>]+>", " ", s)
    s = re.sub(r"[ \t]{2,}", " ", s)
    return s.strip()


def _extract_docx(path):
    import docx  # python-docx
    d = docx.Document(path)
    parts = [p.text for p in d.paragraphs if p.text.strip()]
    for table in d.tables:
        for row in table.rows:
            cells = [c.text.strip() for c in row.cells]
            if any(cells):
                parts.append(" | ".join(cells))
    return "\n".join(parts)


def _extract_pptx(path):
    from pptx import Presentation  # python-pptx
    prs = Presentation(path)
    slides = []
    for i, slide in enumerate(prs.slides, 1):
        lines = [f"# Slide {i}"]
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    t = "".join(run.text for run in para.runs).strip()
                    if t:
                        lines.append(t)
            if shape.has_table:
                for row in shape.table.rows:
                    cells = [c.text.strip() for c in row.cells]
                    if any(cells):
                        lines.append(" | ".join(cells))
        slides.append("\n".join(lines))
    return "\n\n".join(slides)


def _extract_xlsx(path):
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    parts = []
    for ws in wb.worksheets:
        parts.append(f"# {ws.title}")
        for row in ws.iter_rows(values_only=True):
            cells = ["" if v is None else str(v) for v in row]
            if any(c.strip() for c in cells):
                parts.append(" | ".join(cells))
    wb.close()
    return "\n".join(parts)


def _ocr_image(path):
    """Run a vision-model OCR pass. Ollama-OCR never raises — it returns an
    'Error processing image: …' string — so surface that as a 502 (Ollama down /
    model missing) rather than silently ingesting the error text."""
    res = OCR.process_image(path, format_type=OCR_FORMAT, preprocess=OCR_PREPROCESS)
    if isinstance(res, str) and res.startswith("Error processing image:"):
        raise HTTPException(status_code=502, detail=res)
    return res


def _extract_pdf(src, filename, workdir):
    """Per page: use the embedded text layer when present (born-digital), else
    rasterize at ~144 DPI and vision-OCR (scanned). OCR_PDF_ENGINE forces the choice."""
    doc = pymupdf.open(src)
    out = []
    try:
        for i in range(doc.page_count):
            page = doc[i]
            text = page.get_text("text").strip()
            if OCR_PDF_ENGINE == "text":
                use_vision = False
            elif OCR_PDF_ENGINE == "vision":
                use_vision = True
            else:  # auto
                use_vision = not text
            if use_vision:
                pix = page.get_pixmap(matrix=pymupdf.Matrix(2, 2))
                png = os.path.join(workdir, f"page{i}.png")
                pix.save(png)
                out.append(_page(_ocr_image(png), i + 1, filename, "vision"))
            else:
                out.append(_page(text, i + 1, filename, "text"))
    finally:
        doc.close()
    return out or [_page("", 1, filename, "text")]


def _extract(body, filename, content_type):
    ext = _ext(filename, content_type)
    workdir = tempfile.mkdtemp(prefix="lolocr_")
    src = os.path.join(workdir, "input" + (ext or ".bin"))
    with open(src, "wb") as f:
        f.write(body)
    try:
        # Images always go to the vision model — that's the point of OCR here.
        if ext in IMAGE_EXTS:
            return [_page(_ocr_image(src), 1, filename, "vision")]
        # Everything else: Docling (if enabled) for the best office/table fidelity,
        # else our light extractors. Docling failure falls through to the light path.
        if OCR_DOCLING:
            try:
                conv = _docling_converter()
                md = conv.convert(src).document.export_to_markdown()
                return [_page(md, 1, filename, "docling")]
            except HTTPException:
                raise
            except Exception as e:  # noqa: BLE001 — degrade gracefully to light path
                print(f"[extract] docling failed ({e}); falling back to light extraction", flush=True)
        if ext == ".pdf":
            return _extract_pdf(src, filename, workdir)
        if ext == ".docx":
            return [_page(_extract_docx(src), 1, filename, "text")]
        if ext == ".pptx":
            return [_page(_extract_pptx(src), 1, filename, "text")]
        if ext == ".xlsx":
            return [_page(_extract_xlsx(src), 1, filename, "text")]
        if ext in TEXT_EXTS:
            return [_page(_read_text(src), 1, filename, "text")]
        if ext in HTML_EXTS:
            return [_page(_strip_html(_read_text(src)), 1, filename, "text")]
        # Legacy binary office (.doc/.ppt/.xls) + odt/epub/rtf aren't in the light
        # path; enabling ocr.docling routes them through Docling above instead of 415.
        raise HTTPException(
            status_code=415,
            detail=f'Unsupported file type "{ext or content_type}". Images + PDFs are OCR\'d; '
                   f"docx/pptx/xlsx/text extract natively; enable ocr.docling for other office formats.",
        )
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def _check_auth(authorization):
    if not KEY:
        raise HTTPException(status_code=500, detail="OCR service misconfigured: no API key set.")
    if not hmac.compare_digest(authorization or "", f"Bearer {KEY}"):
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/health")
async def health():
    return {"status": "ok", "model": OCR_MODEL, "docling": OCR_DOCLING}


@app.put("/process")
async def process(request: Request):
    _check_auth(request.headers.get("authorization", ""))
    body = await request.body()
    if not body:
        raise HTTPException(status_code=400, detail="Empty request body.")
    filename = urllib.parse.unquote(request.headers.get("x-filename", "") or "upload")
    content_type = request.headers.get("content-type", "")
    # OCR / extraction is blocking (HTTP to Ollama, cv2, pymupdf) — run it off the
    # event loop so concurrent uploads don't serialize on the single async worker.
    return await run_in_threadpool(_extract, body, filename, content_type)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("EXTRACT_PORT", "8890")))
