// @ts-check
// A LOL Vibe reply written by the IDE's coding agent (docs/IDE_PLAN.md). The agent — DeepSeek Harness, run by the
// main process in the thread's project folder on the thread's model — answers in records, not tokens; this file
// turns them into the SAME shape net/run.mjs's startGeneration hands the controller ({done, abort}, onTail /
// onCheckpoint with {content, reasoning}), so the reply keeps the message tree, the stream view, Stop and the seat.
//   content   = what the agent said (its text blocks)
//   reasoning = its steps, one line each ("→ edit index.html ✓ (1 change)") — the reply's collapsible block
//   changes   = every edit it made ({path, oldText, newText}) and created: the files it made — the Changes tab
import { studioDoor } from './bridge.mjs';
import { t } from '../core/i18n.mjs';
import '../strings/agent.en.mjs';

const RECAP_MAX = 6000;   // characters of earlier turns a fresh agent session starts with

/**
 * The recap a fresh agent session starts with: the thread before this prompt, newest kept, each turn clipped.
 * @param {Array<{role: string, content?: string}>} path the thread's messages BEFORE the new prompt
 * @returns {string} '' when there is nothing earlier
 */
export function buildRecap(path) {
  const lines = [];
  let room = RECAP_MAX;
  for (let i = path.length - 1; i >= 0 && room > 0; i--) {
    const m = path[i];
    const text = String((m && m.content) || '').trim();
    if (!text || (m.role !== 'user' && m.role !== 'assistant')) continue;
    const clipped = text.length > 1200 ? `${text.slice(0, 1200)}…` : text;
    const line = m.role === 'user' ? t('agent.recapPerson', { text: clipped }) : t('agent.recapYou', { text: clipped });
    if (line.length > room && lines.length) break;
    lines.unshift(line);
    room -= line.length;
  }
  return lines.length ? [t('agent.recapHead'), ...lines, '', t('agent.recapNow')].join('\n') : '';
}

/** A fresh turn's state. */
export function emptyTurn() {
  return {
    // sawToolCalls stays false: to the controller it means a farm tool call it cannot run, which is not this.
    content: '', reasoning: '', contentDeltas: 0, sawToolCalls: false,
    /** @type {Array<{path: string, oldText: string, newText: string}>} */ changes: [],
    /** @type {string[]} */ created: [],
    /** @type {Record<string, {name: string, target: string}>} */ calls: {},
    outTokens: 0, stopReason: /** @type {string|null} */ (null), end: /** @type {string|null} */ (null),
    // "Keep going until done": the goal's phase, its round cap, the rounds dsh started, why it is blocked.
    goal: /** @type {string|null} */ (null), goalMax: 0, rounds: 0, blocked: '',
  };
}

/**
 * Fold one record from main into the turn (pure: returns the same object, changed).
 * @param {ReturnType<typeof emptyTurn>} s @param {any} rec
 */
export function applyRecord(s, rec) {
  if (!rec || typeof rec !== 'object') return s;
  const line = (/** @type {string} */ l) => { s.reasoning = s.reasoning ? `${s.reasoning}\n${l}` : l; };
  if (rec.kind === 'step') {
    const thought = String(rec.reasoning || '').trim();
    if (thought) line(thought);
    const text = String(rec.text || '').trim();
    if (text) { s.content = s.content ? `${s.content}\n\n${text}` : text; s.contentDeltas += 1; }
    if (Number.isFinite(rec.outTokens)) s.outTokens += rec.outTokens;
    s.stopReason = rec.stopReason || s.stopReason;
  } else if (rec.kind === 'call') {
    s.calls[String(rec.callId)] = { name: String(rec.name || ''), target: String(rec.target || '') };
  } else if (rec.kind === 'result') {
    const c = s.calls[String(rec.callId)] || { name: 'tool', target: '' };
    const diffs = Array.isArray(rec.diffs) ? rec.diffs : [];
    if (rec.ok) {
      const n = diffs.length;
      line(t('agent.stepOk', { name: c.name, target: c.target }).trim() + (n === 1 ? ' ' + t('agent.stepChanges', { n }) : n > 1 ? ' ' + t('agent.stepChangesMany', { n }) : ''));
      for (const d of diffs) s.changes.push({ path: String(d.path || ''), oldText: String(d.oldText || ''), newText: String(d.newText || '') });
      if (rec.created && c.target && !s.created.includes(c.target)) s.created.push(c.target);
    } else {
      line(t('agent.stepFailed', { name: c.name, target: c.target, error: String(rec.error || '').split('\n')[0] }));
    }
  } else if (rec.kind === 'end') {
    s.end = String(rec.reason || '');
  } else if (rec.kind === 'goal') {
    // "Keep going until done": dsh's goal as the model set it, then how it ended.
    const was = s.goal;
    s.goal = String(rec.phase || '');
    if (Number.isFinite(rec.max)) s.goalMax = Math.min(Number(rec.max), GOAL_ROUNDS);
    if (s.goal === 'active' && !was) line(t('agent.goalSet'));
    else if (s.goal === 'complete') line(t('agent.goalDone'));
    else if (s.goal === 'blocked') { s.blocked = String(rec.blocked || ''); line(t('agent.goalBlocked', { why: s.blocked || '—' })); }
  } else if (rec.kind === 'round') {
    s.rounds = Number(rec.n) || s.rounds;
    line(t('agent.round', { n: s.rounds, max: s.goalMax || GOAL_ROUNDS }));
  }
  return s;
}

/** Main's cap on a loop's rounds (studio.ts GOAL_ROUNDS): the step log says "Round n of 10" even if the model asked for more. */
export const GOAL_ROUNDS = 10;

/** "Keep going until done", per project: a person's switch, off by default and forgotten at restart (like Share on the
 *  LAN) — a loop only ever runs because someone asked for it. */
const keep = new Set();
/** @param {string} projectId @param {boolean} on */
export function setKeepGoing(projectId, on) { if (on) keep.add(String(projectId)); else keep.delete(String(projectId)); }
/** @param {string} projectId */
export function keepGoing(projectId) { return keep.has(String(projectId)); }

/** "Use the Computer", per project: the same kind of switch — the agent gets the Computer's MCP tools (build and run
 *  graphs; devices only once a person arms the outputs). */
const computer = new Set();
/** @param {string} projectId @param {boolean} on */
export function setUseComputer(projectId, on) { if (on) computer.add(String(projectId)); else computer.delete(String(projectId)); }
/** @param {string} projectId */
export function useComputer(projectId) { return computer.has(String(projectId)); }

/** How a finished turn reads as a result, from its state and main's end. @param {ReturnType<typeof emptyTurn>} s @param {{reason: string, error?: string}} done */
export function resultOf(s, done) {
  const local = (/** @type {string} */ message, kind = 'local') => ({ kind, status: null, code: null, message, farmMessage: message, retryAfter: null });
  if (done.reason === 'stopped') return { status: 'aborted', abortedBy: 'user', error: null };
  if (done.reason === 'refused') return { status: 'error', error: local(done.error || t('agent.noApp')) };
  if (done.reason === 'error') return { status: 'error', error: local(done.error || t('agent.endedEarly', { reason: 'error' }), 'stream_error') };
  // A loop that ended before its goal: what was done is kept (in the reply and the files), and the note says why.
  const LOOP_END = { 'max-tokens': 'agent.loopMaxTokens', stalled: 'agent.loopStalled', 'round-limit': 'agent.loopRoundLimit', blocked: 'agent.loopBlocked' };
  if (s.goal && done.reason in LOOP_END) {
    const why = t(/** @type {any} */ (LOOP_END)[done.reason], { max: s.goalMax || GOAL_ROUNDS, why: s.blocked || '—' });
    return { status: 'error', error: local(why, 'stream_error') };
  }
  if (!s.content && /length|max/i.test(String(s.stopReason || ''))) return { status: 'error', error: local(t('agent.outOfRoom'), 'stream_error') };
  if (done.reason !== 'completed') return { status: 'error', error: local(t('agent.endedEarly', { reason: done.reason }), 'stream_error') };
  if (!s.content) s.content = t('agent.noAnswer');
  return { status: 'done', abortedBy: null, error: null };
}

/** @type {Map<string, (msg: any) => void>} */
const turns = new Map();
/** @type {Set<(p: any) => void>} */
const installers = new Set();
/** @type {ReturnType<typeof studioDoor>|false|null} */
let door = null;

/** The ONE subscription to main's studio events (the preload's has no unsubscribe): turns and install progress. */
export function getDoor() {
  if (door === null) {
    door = studioDoor() || false;
    if (door) door.onEvent((m) => {
      if (m && m.install) { for (const f of installers) f(m.install); return; }
      const h = m && turns.get(m.turnId);
      if (h) h(m);
    });
  }
  return door || null;
}

/** Hear the runtime download's progress ({phase, percent}). @param {(p: any) => void} fn @returns {() => void} off */
export function onInstall(fn) {
  getDoor();
  installers.add(fn);
  return () => { installers.delete(fn); };
}

/**
 * One agent turn, shaped like a generation.
 * @param {{projectId: string, threadId: string, model: string, text: string, recap?: string, maxTokens?: number, goal?: boolean, computer?: boolean,
 *   onTail?: (state: any) => void, onCheckpoint?: (state: any) => void, now?: () => number, door?: any}} o
 * @returns {{done: Promise<any>, abort: (reason?: string) => void, state: ReturnType<typeof emptyTurn>}}
 */
export function startAgentTurn(o) {
  const d = o.door || getDoor();
  const now = o.now || (() => Date.now());
  const started = now();
  const s = emptyTurn();
  const turnId = `t${started.toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  /** @type {(r: any) => void} */ let settle = () => {};
  const done = new Promise((r) => { settle = r; });
  let finished = false;

  const finish = (/** @type {{reason: string, error?: string}} */ end) => {
    if (finished) return;
    finished = true;
    turns.delete(turnId);
    const r = resultOf(s, end);
    if (o.onCheckpoint) o.onCheckpoint(s);
    const durationMs = now() - started;
    settle({
      status: r.status, abortedBy: r.abortedBy || null, content: s.content, reasoning: s.reasoning || null,
      reasoningMs: durationMs, usage: null, agentSteps: Object.keys(s.calls).length,
      finishReason: s.stopReason, ttftMs: null, durationMs, tokPerSec: null, error: r.error, sawToolCalls: false,
    });
  };

  if (!d) {
    finish({ reason: 'refused', error: t('agent.noApp') });
    return { done, abort: () => {}, state: s };
  }
  turns.set(turnId, (m) => {
    if (m.rec) {
      applyRecord(s, m.rec);
      if (o.onTail) o.onTail(s);
      if (o.onCheckpoint) o.onCheckpoint(s);
    }
    if (m.done) finish(m.done);
  });
  const ask = { turnId, projectId: o.projectId, threadId: o.threadId, model: o.model, text: o.text, ...(o.recap ? { recap: o.recap } : {}), ...(o.maxTokens ? { maxTokens: o.maxTokens } : {}), ...(o.goal ? { goal: true } : {}), ...(o.computer ? { computer: true } : {}) };
  Promise.resolve(d.prompt(ask)).then((r) => { if (!r || r.ok !== true) finish({ reason: 'refused', error: (r && r.message) || t('agent.endedEarly', { reason: 'error' }) }); });
  return {
    done,
    abort: () => { void Promise.resolve(d.stop()); finish({ reason: 'stopped' }); },
    state: s,
  };
}
