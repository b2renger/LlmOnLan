// Minimal GGUF metadata reader — just enough to answer two questions the farm
// keeps guessing at:
//
//   1. What is this model's NATIVE context window? (the owner wants every box at
//      the maximum context its hardware holds — but past `n_ctx_train` quality
//      degrades silently, so "maximum" must mean min(native, what fits))
//   2. How big is its KV cache per token? The VRAM budget used a constant
//      measured on Qwen3.8-27B (~1.2 GB per 16k, q4_0) — right for the fleet's
//      shipped model, wrong for anything else an operator adds by URL. The real
//      figure is 2 × layers × kv_heads × head_dim × bytes/element, and every term
//      is in the GGUF header.
//
// Format (v2/v3): magic 'GGUF', u32 version, u64 tensor_count, u64 kv_count, then
// kv pairs of (string key, u32 type, value). We stream the file with a small
// buffered reader and stop as soon as the keys we need are found — the tokenizer
// vocab (an array of ~150k strings) also lives here, so "read the header" can
// mean tens of MB; a full-file read never happens. Any doubt → nulls, and the
// caller falls back to its measured constants.

const fs = require('fs');

const T = { U8: 0, I8: 1, U16: 2, I16: 3, U32: 4, I32: 5, F32: 6, BOOL: 7, STRING: 8, ARRAY: 9, U64: 10, I64: 11, F64: 12 };
const SCALAR_SIZE = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
const MAX_SCAN_BYTES = 512 * 1024 * 1024;   // sanity: a hostile/corrupt header must not read forever

class Reader {
    constructor(fd) { this.fd = fd; this.pos = 0; this.buf = Buffer.alloc(0); this.off = 0; }
    // Ensure n bytes are buffered; throws on EOF (caught by the top-level try).
    need(n) {
        if (this.pos + n > MAX_SCAN_BYTES) throw new Error('header scan cap');
        while (this.buf.length - this.off < n) {
            const chunk = Buffer.alloc(Math.max(n, 1 << 20));
            const got = fs.readSync(this.fd, chunk, 0, chunk.length, this.pos + (this.buf.length - this.off));
            if (got <= 0) throw new Error('eof');
            this.buf = Buffer.concat([this.buf.subarray(this.off), chunk.subarray(0, got)]);
            this.off = 0;
        }
    }
    take(n) { this.need(n); const b = this.buf.subarray(this.off, this.off + n); this.off += n; this.pos += n; return b; }
    skip(n) {
        // Skip without buffering — arrays of strings (the vocab) are huge.
        const avail = this.buf.length - this.off;
        if (n <= avail) { this.off += n; this.pos += n; return; }
        this.buf = Buffer.alloc(0); this.off = 0; this.pos += n;
        if (this.pos > MAX_SCAN_BYTES) throw new Error('header scan cap');
    }
    u32() { return this.take(4).readUInt32LE(0); }
    u64() { const b = this.take(8); const v = b.readBigUInt64LE(0); if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('u64 too big'); return Number(v); }
    str() { const len = this.u64(); return this.take(len).toString('utf8'); }
    skipStr() { const len = this.u64(); this.skip(len); }
    scalar(type) {
        const b = this.take(SCALAR_SIZE[type]);
        switch (type) {
            case T.U8: return b.readUInt8(0);
            case T.I8: return b.readInt8(0);
            case T.U16: return b.readUInt16LE(0);
            case T.I16: return b.readInt16LE(0);
            case T.U32: return b.readUInt32LE(0);
            case T.I32: return b.readInt32LE(0);
            case T.F32: return b.readFloatLE(0);
            case T.BOOL: return b.readUInt8(0) !== 0;
            case T.U64: case T.I64: return Number(b.readBigUInt64LE(0));
            case T.F64: return b.readDoubleLE(0);
            default: throw new Error('scalar type ' + type);
        }
    }
    skipValue(type) {
        if (type === T.STRING) return this.skipStr();
        if (type === T.ARRAY) {
            const elType = this.u32();
            const count = this.u64();
            if (elType === T.STRING) { for (let i = 0; i < count; i++) this.skipStr(); return; }
            if (elType === T.ARRAY) throw new Error('nested array');
            const sz = SCALAR_SIZE[elType];
            if (!sz) throw new Error('array el type ' + elType);
            return this.skip(count * sz);
        }
        const sz = SCALAR_SIZE[type];
        if (!sz) throw new Error('type ' + type);
        this.skip(sz);
    }
}

// The architecture-suffixed keys we want, e.g. "qwen3moe.context_length".
const WANT = ['context_length', 'block_count', 'attention.head_count', 'attention.head_count_kv', 'attention.key_length', 'embedding_length'];

// Read { contextLength, blockCount, headCount, kvHeadCount, keyLength, embeddingLength,
// architecture } from a .gguf, or null when the file is missing/unreadable/not GGUF.
// Individual fields may be null when a model does not carry them.
function readGgufMeta(filePath) {
    let fd = null;
    try {
        fd = fs.openSync(filePath, 'r');
        const r = new Reader(fd);
        if (r.take(4).toString('latin1') !== 'GGUF') return null;
        const version = r.u32();
        if (version < 2 || version > 3) return null;   // v1 used u32 counts; nothing ships it any more
        r.u64();                                       // tensor_count — not needed
        const kvCount = r.u64();
        const out = { architecture: null, contextLength: null, blockCount: null, headCount: null, kvHeadCount: null, keyLength: null, embeddingLength: null };
        let found = 0;
        for (let i = 0; i < kvCount && found < WANT.length + 1; i++) {
            const key = r.str();
            const type = r.u32();
            if (key === 'general.architecture' && type === T.STRING) { out.architecture = r.str(); found++; continue; }
            const suffix = WANT.find((w) => key.endsWith('.' + w) && !key.includes('rope'));
            if (suffix && type !== T.ARRAY && type !== T.STRING) {
                const v = r.scalar(type);
                if (suffix === 'context_length') out.contextLength = v;
                else if (suffix === 'block_count') out.blockCount = v;
                else if (suffix === 'attention.head_count_kv') out.kvHeadCount = v;
                else if (suffix === 'attention.head_count') out.headCount = v;
                else if (suffix === 'attention.key_length') out.keyLength = v;
                else if (suffix === 'embedding_length') out.embeddingLength = v;
                found++;
                continue;
            }
            r.skipValue(type);
        }
        return out;
    } catch { return null; }
    finally { if (fd != null) { try { fs.closeSync(fd); } catch { /* already closed */ } } }
}

// Bytes per KV-cache element for llama.cpp's cache types (bits / 8, with the
// q-formats' scale overhead — q4_0 is 4.5 bits/el, q8_0 is 8.5).
const KV_BYTES_PER_EL = { q4_0: 4.5 / 8, q8_0: 8.5 / 8, f16: 2 };

// GB of KV cache per 16384 tokens of context for THIS model, from its header:
// 2 (K and V) × layers × kv_heads × head_dim × bytes/element. Verified against the
// fleet's measurement: Qwen3.8-27B (64 layers × 8 kv heads × 128 dim, q4_0)
// → 1.2 GB per 16k, exactly what was measured on the 4070 Ti. Returns null when
// the header lacks the geometry — callers keep their measured constant.
function kvGbPer16k(meta, kvCacheType = 'q4_0') {
    if (!meta || !meta.blockCount) return null;
    const headDim = meta.keyLength
        || (meta.embeddingLength && meta.headCount ? meta.embeddingLength / meta.headCount : null);
    const kvHeads = meta.kvHeadCount || meta.headCount;
    if (!headDim || !kvHeads) return null;
    const bytesPerEl = KV_BYTES_PER_EL[kvCacheType] || KV_BYTES_PER_EL.f16;
    const bytesPerToken = 2 * meta.blockCount * kvHeads * headDim * bytesPerEl;
    return (bytesPerToken * 16384) / 1e9;
}

module.exports = { readGgufMeta, kvGbPer16k };
