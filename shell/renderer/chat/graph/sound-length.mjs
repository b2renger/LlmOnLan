// @ts-check
// How long is a sound file, read from its HEADERS — without decoding it? (K6 fix round) — PURE.
//
// The Sound box refuses a sound longer than AUDIO_MAX_SEC. Finding that out by decoding the whole
// file is the expense the cap exists to avoid: Chromium's decodeAudioData decodes at the file's
// own rate before it resamples, so a 25 MB one-hour MP3 becomes ~1.2 GB of PCM in the renderer
// before "too long" can be said. The formats the Sound box takes state their length (or enough to
// compute it) in a few bytes, so this module reads those bytes:
//   WAV   the `data` chunk's size / the `fmt ` chunk's byte rate                         exact
//   MP3   a Xing/Info or VBRI header's frame count × samples per frame / rate           exact
//         else the first frame's bitrate over the bytes after it (CBR)                  estimate
//   OGG   the last page's granule position / the Vorbis rate (Opus: 48 kHz − pre-skip)  exact
//   FLAC  STREAMINFO's total samples / its rate                                          exact
//   M4A   the `moov`/`mvhd` duration / its timescale                                     exact
//   AAC   every ADTS frame header walked: frames × 1024 / rate                            exact
// Anything else (WebM, a damaged header) answers null, and the caller probes a PREFIX instead.
// Never throws; never reads past the buffer.

/** @typedef {{sec: number, exact: boolean, format: string}} SoundLength */

const MP3_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
const MP3_KBPS = {
  v1l1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  v1l2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  v1l3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2l1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  v2l23: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const ADTS_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

/** @param {Uint8Array} u8 @param {number} at @param {string} tag */
const is = (u8, at, tag) => {
  if (at < 0 || at + tag.length > u8.length) return false;
  for (let i = 0; i < tag.length; i++) if (u8[at + i] !== tag.charCodeAt(i)) return false;
  return true;
};
/** @param {Uint8Array} u8 @param {number} at */
const u32be = (u8, at) => (at + 4 <= u8.length ? ((u8[at] << 24) | (u8[at + 1] << 16) | (u8[at + 2] << 8) | u8[at + 3]) >>> 0 : 0);
/** @param {Uint8Array} u8 @param {number} at */
const u32le = (u8, at) => (at + 4 <= u8.length ? ((u8[at + 3] << 24) | (u8[at + 2] << 16) | (u8[at + 1] << 8) | u8[at]) >>> 0 : 0);
/** @param {Uint8Array} u8 @param {number} at */
const u16le = (u8, at) => (at + 2 <= u8.length ? (u8[at + 1] << 8) | u8[at] : 0);
/** @param {number} sec @param {boolean} exact @param {string} format @returns {SoundLength|null} */
const out = (sec, exact, format) => (Number.isFinite(sec) && sec > 0 ? { sec, exact, format } : null);

/** Where the audio starts after an ID3v2 tag (0 when there is none). @param {Uint8Array} u8 */
export function afterId3(u8) {
  if (!is(u8, 0, 'ID3') || u8.length < 10) return 0;
  const size = ((u8[6] & 0x7f) << 21) | ((u8[7] & 0x7f) << 14) | ((u8[8] & 0x7f) << 7) | (u8[9] & 0x7f);
  return 10 + size + ((u8[5] & 0x10) ? 10 : 0);
}

/** @param {Uint8Array} u8 @returns {SoundLength|null} */
function wav(u8) {
  if (!is(u8, 0, 'RIFF') || !is(u8, 8, 'WAVE')) return null;
  let byteRate = 0;
  for (let at = 12; at + 8 <= u8.length;) {
    const size = u32le(u8, at + 4);
    if (is(u8, at, 'fmt ')) byteRate = u32le(u8, at + 16);
    else if (is(u8, at, 'data')) {
      const avail = u8.length - (at + 8);
      // A streamed WAV says 0 or 0xFFFFFFFF; a truncated one says more than it has.
      const bytes = size && size !== 0xffffffff && size <= avail ? size : avail;
      return byteRate ? out(bytes / byteRate, true, 'wav') : null;
    }
    at += 8 + size + (size & 1);
  }
  return null;
}

/** One MPEG audio frame header at `at`, or null. @param {Uint8Array} u8 @param {number} at */
function mp3Frame(u8, at) {
  if (at + 4 > u8.length || u8[at] !== 0xff || (u8[at + 1] & 0xe0) !== 0xe0) return null;
  const ver = (u8[at + 1] >> 3) & 3;          // 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5, 1 = reserved
  const layer = (u8[at + 1] >> 1) & 3;        // 3 = I, 2 = II, 1 = III, 0 = reserved (ADTS)
  const bi = (u8[at + 2] >> 4) & 15;
  const ri = (u8[at + 2] >> 2) & 3;
  if (ver === 1 || layer === 0 || bi === 0 || bi === 15 || ri === 3) return null;
  const v1 = ver === 3;
  const table = layer === 3 ? (v1 ? MP3_KBPS.v1l1 : MP3_KBPS.v2l1)
    : layer === 2 ? (v1 ? MP3_KBPS.v1l2 : MP3_KBPS.v2l23)
      : (v1 ? MP3_KBPS.v1l3 : MP3_KBPS.v2l23);
  const kbps = table[bi];
  const rate = /** @type {any} */ (MP3_RATES)[ver][ri];
  const spf = layer === 3 ? 384 : layer === 2 ? 1152 : (v1 ? 1152 : 576);
  const pad = (u8[at + 2] >> 1) & 1;
  const len = layer === 3 ? (Math.floor((12 * kbps * 1000) / rate) + pad) * 4 : Math.floor((spf / 8) * kbps * 1000 / rate) + pad;
  const mono = ((u8[at + 3] >> 6) & 3) === 3;
  return { v1, layer, kbps, rate, spf, len, mono };
}

/** @param {Uint8Array} u8 @returns {SoundLength|null} */
function mp3(u8) {
  const start = afterId3(u8);
  // The first frame followed by two more exactly where each says the next one is: a lone 0xFFE
  // is often just data (in a WebM, say), and a wrong guess here would refuse a good file.
  const limit = Math.min(u8.length - 4, start + 64 * 1024);
  for (let at = start; at < limit; at++) {
    const f = mp3Frame(u8, at);
    if (!f || f.len < 24) continue;
    const g = at + f.len + 4 <= u8.length ? mp3Frame(u8, at + f.len) : f;
    if (!g) continue;
    if (g !== f && at + f.len + g.len + 4 <= u8.length && !mp3Frame(u8, at + f.len + g.len)) continue;
    // Xing/Info sits after the side info; VBRI 32 bytes in, whatever the mode.
    const side = f.v1 ? (f.mono ? 17 : 32) : (f.mono ? 9 : 17);
    const x = at + 4 + side;
    if ((is(u8, x, 'Xing') || is(u8, x, 'Info')) && (u32be(u8, x + 4) & 1)) {
      const frames = u32be(u8, x + 8);
      if (frames) return out((frames * f.spf) / f.rate, true, 'mp3');
    }
    if (is(u8, at + 36, 'VBRI')) {
      const frames = u32be(u8, at + 36 + 14);
      if (frames) return out((frames * f.spf) / f.rate, true, 'mp3');
    }
    const tail = is(u8, u8.length - 128, 'TAG') ? 128 : 0;
    return out(((u8.length - at - tail) * 8) / (f.kbps * 1000), false, 'mp3');
  }
  return null;
}

/** @param {Uint8Array} u8 @returns {SoundLength|null} */
function ogg(u8) {
  if (!is(u8, 0, 'OggS') || u8.length < 28) return null;
  const data = 27 + u8[26];
  let rate = 0;
  let skip = 0;
  if (u8[data] === 1 && is(u8, data + 1, 'vorbis')) rate = u32le(u8, data + 12);
  else if (is(u8, data, 'OpusHead')) { rate = 48000; skip = u16le(u8, data + 10); }
  if (!rate) return null;
  // The last page with a real granule position (a page that ends no packet says -1).
  const from = Math.max(0, u8.length - 256 * 1024);
  for (let at = u8.length - 27; at >= from; at--) {
    if (u8[at] !== 0x4f || !is(u8, at, 'OggS')) continue;
    const lo = u32le(u8, at + 6);
    const hi = u32le(u8, at + 10);
    if (lo === 0xffffffff && hi === 0xffffffff) continue;
    return out((hi * 4294967296 + lo - skip) / rate, true, 'ogg');
  }
  return null;
}

/** @param {Uint8Array} u8 @returns {SoundLength|null} */
function flac(u8) {
  const at = afterId3(u8);
  if (!is(u8, at, 'fLaC') || (u8[at + 4] & 0x7f) !== 0) return null;
  const si = at + 8;
  if (si + 18 > u8.length) return null;
  const rate = (u8[si + 10] << 12) | (u8[si + 11] << 4) | (u8[si + 12] >> 4);
  const total = (u8[si + 13] & 0x0f) * 4294967296 + u32be(u8, si + 14);
  return rate && total ? out(total / rate, true, 'flac') : null;
}

/** Walk the boxes in [from, to) and return where the `type` box's CONTENT starts and ends.
 * @param {Uint8Array} u8 @param {number} from @param {number} to @param {string} type */
function mp4Box(u8, from, to, type) {
  for (let at = from; at + 8 <= to;) {
    let size = u32be(u8, at);
    let head = 8;
    if (size === 1) { size = u32be(u8, at + 8) * 4294967296 + u32be(u8, at + 12); head = 16; }
    else if (size === 0) size = to - at;
    if (size < head) return null;
    if (is(u8, at + 4, type)) return { start: at + head, end: Math.min(to, at + size) };
    at += size;
  }
  return null;
}

/** @param {Uint8Array} u8 @returns {SoundLength|null} */
function m4a(u8) {
  if (!is(u8, 4, 'ftyp')) return null;
  const moov = mp4Box(u8, 0, u8.length, 'moov');
  const mvhd = moov ? mp4Box(u8, moov.start, moov.end, 'mvhd') : null;
  if (!mvhd) return null;
  const p = mvhd.start;
  if (u8[p] === 1) {
    const scale = u32be(u8, p + 20);
    const dur = u32be(u8, p + 24) * 4294967296 + u32be(u8, p + 28);
    return scale ? out(dur / scale, true, 'm4a') : null;
  }
  const scale = u32be(u8, p + 12);
  const dur = u32be(u8, p + 16);
  return scale && dur !== 0xffffffff ? out(dur / scale, true, 'm4a') : null;
}

/** @param {Uint8Array} u8 @returns {SoundLength|null} */
function adts(u8) {
  const start = afterId3(u8);
  let at = start;
  if (!(u8[at] === 0xff && (u8[at + 1] & 0xf6) === 0xf0)) return null;
  const rate = ADTS_RATES[(u8[at + 2] >> 2) & 15] || 0;
  if (!rate) return null;
  let samples = 0;
  while (at + 7 <= u8.length && u8[at] === 0xff && (u8[at + 1] & 0xf6) === 0xf0) {
    const len = ((u8[at + 3] & 3) << 11) | (u8[at + 4] << 3) | (u8[at + 5] >> 5);
    if (len < 7) break;
    samples += ((u8[at + 6] & 3) + 1) * 1024;
    at += len;
  }
  if (!samples) return null;
  const whole = at + 7 > u8.length;
  // A walk that lost the frames before the end scales what it counted to the whole file.
  return out((samples / rate) * (whole ? 1 : (u8.length - start) / Math.max(1, at - start)), whole, 'aac');
}

/**
 * The length of a sound file from its headers, or null when they do not say.
 * @param {ArrayBuffer|Uint8Array} buf @returns {SoundLength|null}
 */
export function soundLength(buf) {
  const u8 = buf instanceof Uint8Array ? buf : (buf && typeof buf.byteLength === 'number' ? new Uint8Array(buf) : null);
  if (!u8 || u8.length < 12) return null;
  try {
    return wav(u8) || ogg(u8) || flac(u8) || m4a(u8) || adts(u8) || mp3(u8);
  } catch { return null; }
}
