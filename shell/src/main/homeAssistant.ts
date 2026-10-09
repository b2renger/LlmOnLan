// Home Assistant, main-process side (owner, 2026-09-30; docs/HOME_ASSISTANT.md). A person links their Home Assistant
// in Preferences (its address and a long-lived token they paste); assistants then read the home and, only once a person
// allows commands, switch its devices. The tools are served by the Computer's MCP server (mcp.ts), so Open WebUI's chat
// (typed or spoken) and the IDE's agent ("Use the Computer") reach the home through the door they already have.
// Every rule lives HERE, in main, where no page and no model can skip it:
//   - reading is free; a command is a DRY RUN until a person allows commands, which asks in a native dialog listing
//     the devices a model may then switch — exactly those: a device that appears later is refused until they allow
//     again. Forgotten when LlmOnLan closes and whenever the link changes (an allow that raced a relink is refused);
//   - one device per command, and only an action on ACTIONS' list for its domain — an allowlist, because Home
//     Assistant registers a service per script (`script.unlock_front_door` beside `script.turn_on`) and its domains
//     carry actions that reach past the one device (`scene.apply`, `remote.send_command`, `media_player.play_media`
//     fetching a URL the model picks). Targeting keys a model adds (area_id, device_id…) are dropped;
//   - never by a model, whatever was allowed: unlock or open a lock, disarm or trigger an alarm, sound a siren, open a
//     valve (water or gas), open a cover that does not say it is a blind, curtain, shade, shutter, awning or window (it
//     could be a door, a gate or a garage) — a person does those in Home Assistant;
//   - never a coordinate: where people and the home are (latitude, longitude…) is not handed to a model, because what a
//     model reads can leave with its other tools in the same chat (Open WebUI's web search brings `fetch_url`);
//   - at most one command a second per device (a light is not a strobe) and 30 a minute in all;
//   - the token stays in main (safeStorage, like the IDE's git tokens), is never handed to the page, and never follows a
//     redirect.
// What this cannot know: what a switch, a button, a helper, a number, a select, a scene or a script is wired to. The
// dialog says so.
// The Computer's Home boxes (2026-10-09) come through here too: `read` (the devices a person picked, free) and
// `command` with `outputsArmed` — a box's command is a dry run unless the Computer's outputs are armed AND home commands
// are allowed, and every rule above applies to it unchanged.
// ponytail: REST only (states, services, one call per command). Home Assistant's WebSocket API would push changes as
// they happen (and give its own per-device "expose" list) — the upgrade path.

import type { McpTool } from './mcp';

export interface HomeLink { url: string; token: string }
/** Where the link is kept (index.ts: `<userData>/home-assistant.json`, the token encrypted by the OS). */
export interface HomeStore { load(): HomeLink | null; save(link: HomeLink | null): boolean }
export interface HomeDevice { id: string; name: string }
type Out = { text: string; isError?: boolean };
type State = { entity_id: string; state: string; attributes?: Record<string, any>; last_changed?: string };
/** A command's outcome: `text` for a model (MCP), `code` + `what` for a Home command box, which says it in its own words. */
export type CommandOut = Out & { code: string; what?: string; now?: string };

const ONOFF = ['turn_on', 'turn_off', 'toggle'];
const PICK = ['select_option', 'select_first', 'select_last', 'select_next', 'select_previous'];
/** Per domain, the ONLY actions a model may use. A domain not here is read-only for a model. */
export const ACTIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
    light: ONOFF, switch: ONOFF, input_boolean: ONOFF, remote: ONOFF, script: ONOFF,
    fan: [...ONOFF, 'set_percentage', 'increase_speed', 'decrease_speed', 'oscillate', 'set_direction', 'set_preset_mode'],
    cover: ['open_cover', 'close_cover', 'set_cover_position', 'stop_cover', 'toggle',
        'open_cover_tilt', 'close_cover_tilt', 'set_cover_tilt_position', 'stop_cover_tilt', 'toggle_cover_tilt'],
    climate: [...ONOFF, 'set_temperature', 'set_hvac_mode', 'set_fan_mode', 'set_preset_mode', 'set_humidity', 'set_swing_mode', 'set_swing_horizontal_mode'],
    media_player: [...ONOFF, 'volume_up', 'volume_down', 'volume_set', 'volume_mute', 'media_play', 'media_pause', 'media_play_pause',
        'media_stop', 'media_next_track', 'media_previous_track', 'media_seek', 'select_source', 'select_sound_mode', 'shuffle_set', 'repeat_set'],
    humidifier: [...ONOFF, 'set_humidity', 'set_mode'],
    water_heater: ['turn_on', 'turn_off', 'set_temperature', 'set_operation_mode', 'set_away_mode'],
    vacuum: ['start', 'pause', 'stop', 'return_to_base', 'locate', 'clean_spot', 'set_fan_speed'],
    lawn_mower: ['start_mowing', 'pause', 'dock'],
    valve: ['close_valve'],
    lock: ['lock'],
    alarm_control_panel: ['alarm_arm_home', 'alarm_arm_away', 'alarm_arm_night', 'alarm_arm_vacation', 'alarm_arm_custom_bypass'],
    siren: ['turn_off'],
    scene: ['turn_on'],
    button: ['press'], input_button: ['press'],
    number: ['set_value'], input_number: ['set_value', 'increment', 'decrement'],
    select: PICK, input_select: PICK,
});
/** The domains a model may command: devices. Everything else (sensors, updates, notify, the system) is read-only. */
export const COMMANDABLE: ReadonlySet<string> = new Set(Object.keys(ACTIONS));
/** A cover a model may open says what it is — and it is one of these. */
const OPENABLE_COVERS = ['awning', 'blind', 'curtain', 'shade', 'shutter', 'window'];
export const MIN_GAP_MS = 1000;
export const PER_MINUTE = 30;
const TIMEOUT_MS = 8000;
/** Home Assistant keeps running a command whose caller gave up (its REST handler shields the call): wait longer, and
 * past this say "sent, not confirmed" — a retried toggle would flip the device back. */
const COMMAND_TIMEOUT_MS = 20_000;
const MAX_LINES = 150;
const MAX_NAMES = 30;
const TARGET_KEYS = ['entity_id', 'device_id', 'area_id', 'floor_id', 'label_id'];
/** Attributes a model never gets, compared without case: noise, a camera's or a speaker's short-lived token and picture
 * URL, and every coordinate or place (the phone apps' geocoded `Location` is [lat, lon]). */
const HIDDEN_ATTRS = ['friendly_name', 'supported_features', 'entity_picture', 'entity_picture_local', 'icon', 'access_token',
    'latitude', 'longitude', 'gps_accuracy', 'altitude', 'location', 'coordinates'];
const WHERE = 'LlmOnLan ▸ Preferences ▸ Home Assistant';
const ENTITY = /^[a-z0-9_]+\.[a-z0-9_]+$/;
/** A Home box reads at most this many devices, this many hours back, this many past values per device. History is
 * capped at DEVICE_HOURS in one read (4 devices × 168 h, 30 × 24 h), one history read every HISTORY_GAP_MS and
 * HISTORY_BYTES of answer: Home Assistant's history query has no limit of its own, and a Green has 4 GB. */
export const MAX_READ = 30;
export const MAX_HOURS = 168;
export const MAX_POINTS = 240;
export const DEVICE_HOURS = 720;
const HISTORY_GAP_MS = 5000;
const HISTORY_BYTES = 8 * 1024 * 1024;
const HISTORY_TIMEOUT_MS = 20_000;
/** Where people are: their past is not read (their state now is, like a model's `home_state`). */
const NO_HISTORY = ['person', 'device_tracker', 'zone'];

/** PURE: a Home Assistant address as `scheme://host[:port]`, or null. Home Assistant lives at the root; `/api` is forgiven. */
export function normaliseUrl(s: string): string | null {
    let u: URL;
    try { u = new URL(String(s || '').trim()); } catch { return null; }
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || u.username || u.password) return null;
    if (u.pathname.replace(/\/+$/, '').replace(/\/api$/, '')) return null;
    return `${u.protocol}//${u.host}`;
}

/** PURE: why a model may never do this, or null. */
export function neverByModel(s: State, action: string): string | null {
    const domain = s.entity_id.split('.')[0];
    if (domain === 'lock' && (action === 'unlock' || action === 'open')) return 'unlock or open a lock';
    if (domain === 'alarm_control_panel' && (action === 'alarm_disarm' || action === 'alarm_trigger')) return 'disarm or trigger an alarm';
    if (domain === 'siren' && (action === 'turn_on' || action === 'toggle')) return 'sound a siren';
    if (domain === 'valve' && ['open_valve', 'toggle', 'set_valve_position', 'stop_valve'].includes(action)) return 'open a valve (water or gas)';
    const cls = String(s.attributes?.device_class || '');
    if (domain === 'cover' && !OPENABLE_COVERS.includes(cls) && ['open_cover', 'toggle', 'set_cover_position', 'stop_cover'].includes(action)) {
        return ['door', 'gate', 'garage'].includes(cls) ? 'open a door, a gate or a garage'
            : 'open a cover that does not say it is a blind, a curtain, a shade, a shutter, an awning or a window (it could be a door, a gate or a garage)';
    }
    return null;
}

/** PURE: may a model use this action on this entity? Never-by-a-model first, then the allowlist. */
export function allowedAction(s: State, action: string): boolean {
    const list = ACTIONS[s.entity_id.split('.')[0]];
    return !!list && list.includes(action) && !neverByModel(s, action);
}

const nameOf = (s: State) => String(s.attributes?.friendly_name || s.entity_id);
/** PURE: the attributes a model or a box may read — never a coordinate, a camera's token or the noise; long lists cut. */
export function cleanAttrs(s: State): Record<string, unknown> {
    const attrs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.attributes || {})) {
        if (HIDDEN_ATTRS.includes(k.toLowerCase())) continue;
        attrs[k] = Array.isArray(v) && v.length > 20 ? [...v.slice(0, 20), `… ${v.length - 20} more`] : v;
    }
    return attrs;
}
/** PURE: at most `max` items of `list`, evenly spread, the first and the last kept. */
export function thin<T>(list: T[], max = MAX_POINTS): T[] {
    if (list.length <= max) return list;
    const out: T[] = [];
    for (let i = 0; i < max; i++) out.push(list[Math.round((i * (list.length - 1)) / (max - 1))]);
    return out;
}
const numberOf = (state: unknown) => (/^-?\d+(\.\d+)?$/.test(String(state ?? '').trim()) ? Number(state) : null);
const shown = (s: State) => {
    const unit = s.attributes?.unit_of_measurement;
    return unit && s.state !== 'unavailable' && s.state !== 'unknown' ? `${s.state} ${unit}` : s.state;
};

/** Field names of one action, a collapsed section's own fields included. */
function fieldsOf(service: any): string[] {
    const out: string[] = [];
    for (const [k, v] of Object.entries(service?.fields || {})) {
        if (v && typeof v === 'object' && (v as any).fields) out.push(...Object.keys((v as any).fields));
        else out.push(k);
    }
    return out.slice(0, 12);
}

/** PURE: the arming dialog's list — one line per domain; past MAX_NAMES names a line says how many more. */
export function armingText(devices: HomeDevice[]): string {
    const by = new Map<string, string[]>();
    for (const d of devices) {
        const dom = d.id.split('.')[0];
        by.set(dom, [...(by.get(dom) || []), d.name]);
    }
    return [...by].map(([dom, names]) => {
        const more = names.length > MAX_NAMES ? ` and ${names.length - MAX_NAMES} more` : '';
        return `${dom} (${names.length}): ${names.slice(0, MAX_NAMES).join(', ')}${more}`;
    }).join('\n');
}

export const HOME_TOOLS: McpTool[] = [
    { name: 'home_devices', description: 'List the devices and sensors of the home (Home Assistant), one per line: entity id · name · state. Filter by domain (light, switch, sensor, climate, cover…) or by words in the name. Also says whether home commands are allowed.', inputSchema: { type: 'object', properties: { domain: { type: 'string' }, search: { type: 'string' } } } },
    { name: 'home_state', description: 'One device or sensor of the home in detail, by entity id: its state, its attributes, and the actions a model may use on it, with their fields.', inputSchema: { type: 'object', properties: { entity_id: { type: 'string' } }, required: ['entity_id'] } },
    { name: 'home_command', description: 'Tell ONE device of the home to do something: entity_id, action (one of home_state\'s actions, e.g. turn_on) and optional data (e.g. {"brightness_pct": 40}). A dry run unless a person has allowed home commands; unlocking, disarming an alarm, sounding a siren and opening a valve, a door or a garage are never done by a model.', inputSchema: { type: 'object', properties: { entity_id: { type: 'string' }, action: { type: 'string' }, data: { type: 'object' } }, required: ['entity_id', 'action'] } },
];
export const HOME_TOOL_NAMES: ReadonlySet<string> = new Set(HOME_TOOLS.map((t) => t.name));

type HomeApi = ReturnType<typeof createHome>;
/** The MCP server's tools and calls with the home in them: its tools listed only while a home is linked, and answered
 * HERE, in main — never carried to the page. */
export function withHome(home: HomeApi, pageTools: () => McpTool[], pageCall: (name: string, args: Record<string, unknown>) => Promise<Out>) {
    return {
        tools: () => (home.linked() ? [...pageTools(), ...HOME_TOOLS] : pageTools()),
        call: (name: string, args: Record<string, unknown>) => (HOME_TOOL_NAMES.has(name) ? home.call(name, args) : pageCall(name, args)),
    };
}

/** A failed request, in words: a timeout (`timeout`), a certificate this computer does not trust, a redirect the token
 * will not follow, or no answer. */
function failed(e: any, url: string, ms: number): Error & { timeout?: boolean } {
    const code = String(e?.cause?.code || e?.code || '');
    const text = `${e?.message || ''} ${e?.cause?.message || ''}`;
    // `code` tells a Home box whether it may hand on its saved copy: `offline` (no answer) may, `refused` may not.
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError') {
        return Object.assign(new Error(`Home Assistant at ${url} did not answer within ${Math.round(ms / 1000)} s.`), { timeout: true, code: 'offline' });
    }
    if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY/i.test(code)) return Object.assign(new Error(`This computer does not trust the certificate of Home Assistant at ${url} (${code}).`), { code: 'refused' });
    if (/redirect/i.test(text)) return Object.assign(new Error(`Home Assistant at ${url} answered with a redirect; LlmOnLan never sends the token on to another address. Link the address it redirects to.`), { code: 'refused' });
    return Object.assign(new Error(`Home Assistant did not answer at ${url}${code ? ` (${code})` : ''}.`), { code: 'offline' });
}

export function createHome(deps: { store: HomeStore; fetch?: typeof fetch; now?: () => number; commandTimeoutMs?: number }) {
    const f = deps.fetch || fetch;
    const now = deps.now || Date.now;
    const commandMs = deps.commandTimeoutMs || COMMAND_TIMEOUT_MS;
    let link: HomeLink | null | undefined;          // undefined = not read from the store yet (safeStorage needs app ready)
    let info: { name: string; version: string } | null = null;
    let armed: Map<string, string> | null = null;   // entity id → name, exactly what the person saw
    let generation = 0;                              // bumped by every link change: an allow from an older one is refused
    const lastAt = new Map<string, number>();
    let recent: number[] = [];
    let services: { at: number; url: string; byDomain: Map<string, Record<string, any>> } | null = null;
    let historyAt = -Infinity;

    const current = () => { if (link === undefined) link = deps.store.load(); return link; };

    async function api(path: string, init: RequestInit = {}, l = current(), ms = TIMEOUT_MS, maxBytes = 0): Promise<any> {
        if (!l) throw new Error(`No Home Assistant is linked: a person links one in ${WHERE}.`);
        let r: Response;
        try {
            r = await f(l.url + path, {
                ...init,
                redirect: 'error',
                signal: AbortSignal.timeout(ms),
                headers: { authorization: `Bearer ${l.token}`, 'content-type': 'application/json' },
            });
        } catch (e) { throw failed(e, l.url, ms); }
        if (r.status === 401) throw Object.assign(new Error(`Home Assistant at ${l.url} refused the token: a person pastes a new long-lived token in ${WHERE}.`), { code: 'refused' });
        if (r.status === 404) return null;
        if (!r.ok) {
            const body = (await r.text().catch(() => '')).slice(0, 300);
            throw Object.assign(new Error(`Home Assistant refused it (${r.status})${body ? `: ${body}` : '.'}`), { code: 'refused' });
        }
        if (!maxBytes || !r.body) return r.json();
        // A capped read: stop (and cancel the answer) past maxBytes instead of holding all of it in main.
        const chunks: Uint8Array[] = [];
        let n = 0;
        const reader = r.body.getReader();
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            n += value.byteLength;
            if (n > maxBytes) {
                void reader.cancel().catch(() => undefined);
                throw Object.assign(new Error(`Home Assistant's answer is larger than ${Math.round(maxBytes / 1048576)} MB: read fewer hours or devices.`), { code: 'toomuch' });
            }
            chunks.push(value);
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }

    async function servicesOf(domain: string): Promise<Record<string, any>> {
        const l = current();
        if (!services || services.url !== l?.url || now() - services.at > 60_000) {
            const list = (await api('/api/services')) || [];
            services = { at: now(), url: l!.url, byDomain: new Map(list.map((d: any) => [String(d.domain), d.services || {}])) };
        }
        return services.byDomain.get(domain) || {};
    }

    const commandsLine = () => armed
        ? `Commands: allowed for the ${armed.size} devices a person listed, until LlmOnLan closes.`
        : `Commands: a dry run — a person has not allowed them (${WHERE} ▸ Allow commands).`;

    function status() {
        const l = current();
        return { linked: !!l, url: l ? l.url : '', name: info?.name || '', version: info?.version || '', armed: armed ? armed.size : 0 };
    }

    /** Ask Home Assistant who it is and how many things it has. Never throws. */
    async function check(l = current()): Promise<{ ok: boolean; message?: string; name?: string; version?: string; entities?: number; devices?: number }> {
        try {
            const cfg = await api('/api/config', {}, l);
            const states: State[] = (await api('/api/states', {}, l)) || [];
            if (!cfg || !Array.isArray(states)) return { ok: false, message: `${l?.url} does not look like Home Assistant.` };
            const devices = states.filter((s) => COMMANDABLE.has(s.entity_id.split('.')[0])).length;
            const who = { name: String(cfg.location_name || 'Home'), version: String(cfg.version || '') };
            if (l === current()) info = who;
            return { ok: true, ...who, entities: states.length, devices };
        } catch (e) { return { ok: false, message: (e as Error).message }; }
    }

    /** Link (test first, then keep) — or forget with an empty address and token. A NEW link forgets the allowed list; an
     * attempt that fails (a bad address, no token, no answer) changes nothing, while an allow the person made during its
     * test is refused (the generation moved) and the list is dropped again once the new link lands. */
    async function setLink(url: string, token: string): Promise<{ ok: boolean; message?: string }> {
        if (!url && !token) {
            generation++; armed = null; services = null; link = null; info = null;
            return deps.store.save(null) ? { ok: true } : { ok: false, message: 'Forgotten for this session, but the kept link could not be deleted: it comes back at the next start.' };
        }
        const u = normaliseUrl(url);
        if (!u) return { ok: false, message: 'That is not a Home Assistant address: http(s)://host:port, e.g. http://homeassistant.local:8123.' };
        const t = String(token || '').trim();
        if (!t || /\s/.test(t) || t.length > 4096) return { ok: false, message: 'Paste a long-lived access token (Home Assistant ▸ your profile ▸ Security).' };
        const mine = ++generation;
        const c = await check({ url: u, token: t });
        if (mine !== generation) return { ok: false, message: 'Another link was made meanwhile.' };
        if (!c.ok) return { ok: false, message: c.message };
        if (!deps.store.save({ url: u, token: t })) return { ok: false, message: 'The token could not be kept: this computer cannot encrypt it, or cannot write the settings folder.' };
        link = { url: u, token: t };
        info = { name: c.name || '', version: c.version || '' };
        armed = null; services = null; generation++;
        return { ok: true };
    }

    /** The devices a person would allow, for the dialog, with the link generation they belong to. */
    async function armable(): Promise<{ ok: true; home: string; url: string; devices: HomeDevice[]; generation: number } | { ok: false; message: string }> {
        const g = generation;
        try {
            const states: State[] = (await api('/api/states')) || [];
            const devices = states.filter((s) => COMMANDABLE.has(s.entity_id.split('.')[0]))
                .map((s) => ({ id: s.entity_id, name: nameOf(s) }))
                .sort((a, b) => a.id.localeCompare(b.id));
            return { ok: true, home: info?.name || 'Home Assistant', url: current()!.url, devices, generation: g };
        } catch (e) { return { ok: false, message: (e as Error).message }; }
    }

    /** Allow exactly `devices` (null stops). A list from an older link generation is refused: returns -1. */
    function arm(devices: HomeDevice[] | null, g?: number): number {
        if (devices && g !== generation) return -1;
        armed = devices && devices.length ? new Map(devices.map((d) => [d.id, d.name])) : null;
        return armed ? armed.size : 0;
    }

    async function devicesTool(a: any): Promise<Out> {
        const states: State[] = (await api('/api/states')) || [];
        const domain = String(a.domain || '').trim().toLowerCase();
        const words = String(a.search || '').toLowerCase().split(/\s+/).filter(Boolean);
        const hits = states
            .filter((s) => !domain || s.entity_id.startsWith(`${domain}.`))
            .filter((s) => { const hay = `${s.entity_id} ${nameOf(s)}`.toLowerCase(); return words.every((w) => hay.includes(w)); })
            .sort((x, y) => x.entity_id.localeCompare(y.entity_id));
        const head = `${info?.name || 'The home'}: ${hits.length} of ${states.length} entities${domain || words.length ? ' match' : ''}.\n${commandsLine()}`;
        const lines = hits.slice(0, MAX_LINES).map((s) => `${s.entity_id} · ${nameOf(s)} · ${shown(s)}`);
        const more = hits.length > MAX_LINES ? `\n(and ${hits.length - MAX_LINES} more: filter by domain or search)` : '';
        return { text: `${head}\n${lines.join('\n')}${more}` };
    }

    /** The actions a model may use on `s` that its Home Assistant offers, and the ones it never may. */
    async function actionsFor(s: State) {
        const all = await servicesOf(s.entity_id.split('.')[0]);
        const may = Object.keys(all).filter((n) => allowedAction(s, n));
        const never = Object.keys(all).filter((n) => neverByModel(s, n));
        return { all, may, never };
    }

    async function stateTool(a: any): Promise<Out> {
        const id = String(a.entity_id || '').trim();
        const s: State | null = ENTITY.test(id) ? await api(`/api/states/${id}`) : null;
        if (!s) return { text: `No entity ${id || '(none)'} in the home: home_devices lists them.`, isError: true };
        const domain = id.split('.')[0];
        const out: Record<string, unknown> = { entity_id: id, name: nameOf(s), state: shown(s), attributes: cleanAttrs(s), last_changed: s.last_changed };
        if (COMMANDABLE.has(domain)) {
            const { all, may, never } = await actionsFor(s);
            out.actions = Object.fromEntries(may.map((n) => [n, fieldsOf(all[n])]));
            if (never.length) out.never_by_a_model = never;
            out.commands = !armed ? 'a dry run: a person has not allowed home commands' : armed.has(id) ? 'allowed' : 'not in the list the person allowed';
        } else out.commands = `none: ${domain} is read-only for a model`;
        return { text: JSON.stringify(out, null, 1) };
    }

    /** One command on one device, for a model (MCP) or a Computer box. `outputsArmed` is given for a box only: its
     * command is then a dry run unless the Computer's outputs are armed too (main reads that itself, outputs.ts).
     * Never throws: a refusal comes back with its `code`. */
    async function command(a: any, from: { outputsArmed?: boolean } = {}): Promise<CommandOut> {
        const box = from.outputsArmed !== undefined;
        try {
            if (!current()) return { code: 'nolink', text: `No Home Assistant is linked: a person links one in ${WHERE}.`, isError: true };
            const id = String(a?.entity_id || '').trim();
            const action = String(a?.action || a?.service || '').trim().replace(/^[a-z0-9_]+\./, '');
            const s: State | null = ENTITY.test(id) ? await api(`/api/states/${id}`) : null;
            if (!s) return { code: 'missing', text: `No entity ${id || '(none)'} in the home: home_devices lists them.`, isError: true };
            const domain = id.split('.')[0];
            if (!COMMANDABLE.has(domain)) return { code: 'readonly', text: `${nameOf(s)} (${id}) is a ${domain}: read-only for a model.`, isError: true };
            const why = neverByModel(s, action);
            if (why) return { code: 'never', what: why, text: `Never ${box ? 'from LlmOnLan' : 'by a model'}: ${why}. A person does that in Home Assistant.`, isError: true };
            const { all, may } = await actionsFor(s);
            if (!Object.hasOwn(all, action) || !allowedAction(s, action)) {
                return { code: 'action', what: may.join(', ') || 'none', text: `"${action}" is not an action a model may use on ${nameOf(s)} (${id}). It may use: ${may.join(', ') || 'none'}.`, isError: true };
            }
            const data: Record<string, unknown> = {};
            if (a.data && typeof a.data === 'object' && !Array.isArray(a.data)) {
                for (const [k, v] of Object.entries(a.data)) if (!TARGET_KEYS.includes(k)) data[k] = v;
            }
            if (JSON.stringify(data).length > 4096) return { code: 'too-big', text: 'The data is too large for one command.', isError: true };
            const what = `${domain}.${action} on ${nameOf(s)} (${id})${Object.keys(data).length ? ` with ${JSON.stringify(data)}` : ''}`;
            if (box && !from.outputsArmed) return { code: 'dry-outputs', what, text: `DRY RUN — nothing was switched. It would be ${what}. The Computer's outputs are not armed.` };
            if (!armed) return { code: 'dry-home', what, text: `DRY RUN — nothing was switched. It would be ${what}. Home commands are not allowed right now: tell the person they can allow them in ${WHERE} ▸ Allow commands.` };
            if (!armed.has(id)) return { code: 'not-listed', what, text: `${nameOf(s)} (${id}) was not in the list the person allowed: they allow commands again to include it.`, isError: true };
            const t = now();
            const gap = t - (lastAt.get(id) || 0);
            if (gap < MIN_GAP_MS) return { code: 'rate', what, text: `Too fast: one command a second per device. Wait ${MIN_GAP_MS - gap} ms.`, isError: true };
            recent = recent.filter((x) => t - x < 60_000);
            if (recent.length >= PER_MINUTE) return { code: 'rate', what, text: `Too many commands: at most ${PER_MINUTE} a minute. Wait a little.`, isError: true };
            lastAt.set(id, t);
            recent.push(t);
            try {
                await api(`/api/services/${domain}/${action}`, { method: 'POST', body: JSON.stringify({ entity_id: id, ...data }) }, current(), commandMs);
            } catch (e) {
                if (!(e as { timeout?: boolean }).timeout) throw e;
                return { code: 'unconfirmed', what, text: `Sent, not confirmed: ${what} was sent, but Home Assistant did not answer within ${Math.round(commandMs / 1000)} s. It may still be doing it: read the device with home_state before trying again.`, isError: true };
            }
            const after: State | null = await api(`/api/states/${id}`);
            const state = after ? shown(after) : 'unknown';
            return { code: 'done', what, now: state, text: `Done: ${what}. ${nameOf(s)} is now ${state}.` };
        } catch (e) { return { code: 'error', text: (e as Error).message, isError: true }; }
    }

    /** A weather entity's next days (Home Assistant's read-only `weather.get_forecasts`, for the entity the person
     * picked — the one action this module calls that is not a command), or null. */
    async function forecastOf(id: string): Promise<unknown[] | null> {
        for (const type of ['daily', 'hourly']) {
            try {
                const r = await api('/api/services/weather/get_forecasts?return_response', { method: 'POST', body: JSON.stringify({ entity_id: id, type }) });
                const list = r?.service_response?.[id]?.forecast;
                if (!Array.isArray(list) || !list.length) continue;
                return list.slice(0, type === 'daily' ? 3 : 12).map((f: any) => {
                    const out: Record<string, unknown> = {};
                    for (const k of ['datetime', 'condition', 'temperature', 'templow', 'precipitation', 'precipitation_probability', 'wind_speed', 'humidity']) if (f && f[k] != null) out[k] = f[k];
                    return out;
                });
            } catch { /* this kind of forecast is not offered: try the next */ }
        }
        return null;
    }

    /** A calendar's events of the next 24 hours, or null. */
    async function eventsOf(id: string, t: number): Promise<unknown[] | null> {
        try {
            const q = `start=${encodeURIComponent(new Date(t).toISOString())}&end=${encodeURIComponent(new Date(t + 86_400_000).toISOString())}`;
            const list = await api(`/api/calendars/${id}?${q}`);
            if (!Array.isArray(list)) return null;
            return list.slice(0, 20).map((e: any) => ({
                summary: String(e?.summary || ''),
                start: e?.start?.dateTime || e?.start?.date || '',
                end: e?.end?.dateTime || e?.end?.date || '',
                ...(e?.description ? { description: String(e.description).slice(0, 300) } : {}),
            }));
        } catch { return null; }
    }

    /** What a Computer Home box reads: the devices a PERSON picked, now and over their past `hours`. Free, like a
     * model's reading, and the same attributes (never a coordinate or a place; no past for people). Never throws:
     * {ok:false, code} is nolink, offline, refused, empty, toomuch or busy. */
    async function read(ids: unknown, hours: unknown): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; code: string; message: string }> {
        const list = [...new Set((Array.isArray(ids) ? ids : []).map((x) => String(x).trim()))].filter((x) => ENTITY.test(x));
        if (!list.length) return { ok: false, code: 'empty', message: 'Choose the devices to read.' };
        if (list.length > MAX_READ) return { ok: false, code: 'empty', message: `At most ${MAX_READ} devices in one box.` };
        const h = Math.max(0, Math.min(MAX_HOURS, Math.floor(Number(hours) || 0)));
        const histIds = h > 0 ? list.filter((x) => !NO_HISTORY.includes(x.split('.')[0])) : [];
        if (histIds.length * h > DEVICE_HOURS) {
            return { ok: false, code: 'toomuch', message: `History of ${histIds.length} devices over ${h} hours is too much at once: at most ${DEVICE_HOURS} device-hours (4 devices over 168 hours, 30 over 24).` };
        }
        if (histIds.length && now() - historyAt < HISTORY_GAP_MS) return { ok: false, code: 'busy', message: `One history read every ${HISTORY_GAP_MS / 1000} seconds: run again in a moment.` };
        if (!current()) return { ok: false, code: 'nolink', message: `No Home Assistant is linked: a person links one in ${WHERE}.` };
        try {
            if (!info) {
                const cfg = await api('/api/config');
                if (cfg) info = { name: String(cfg.location_name || 'Home'), version: String(cfg.version || '') };
            }
            const states: State[] = (await api('/api/states')) || [];
            const by = new Map(states.map((x) => [x.entity_id, x]));
            const t = now();
            const devices: Record<string, any>[] = [];
            const missing: string[] = [];
            for (const id of list) {
                const s = by.get(id);
                if (!s) { missing.push(id); continue; }
                const d: Record<string, any> = { id, name: nameOf(s), state: s.state };
                const v = numberOf(s.state);
                if (v !== null) d.value = v;
                if (s.attributes?.unit_of_measurement) d.unit = String(s.attributes.unit_of_measurement);
                d.attributes = cleanAttrs(s);
                delete d.attributes.unit_of_measurement;
                if (s.last_changed) d.last_changed = s.last_changed;
                const domain = id.split('.')[0];
                if (domain === 'weather') { const f = await forecastOf(id); if (f) d.forecast = f; }
                if (domain === 'calendar') { const e = await eventsOf(id, t); if (e) d.events = e; }
                devices.push(d);
            }
            const past = devices.filter((d) => histIds.includes(d.id));
            if (past.length) {
                historyAt = now();
                const start = encodeURIComponent(new Date(t - h * 3_600_000).toISOString());
                const q = `filter_entity_id=${past.map((d) => d.id).join(',')}&end_time=${encodeURIComponent(new Date(t).toISOString())}&minimal_response&no_attributes`;
                const rows = await api(`/api/history/period/${start}?${q}`, {}, current(), HISTORY_TIMEOUT_MS, HISTORY_BYTES);
                for (const row of Array.isArray(rows) ? rows : []) {
                    const d = Array.isArray(row) && row.length ? past.find((x) => x.id === row[0]?.entity_id) : null;
                    if (!d) continue;
                    d.history = thin(row.filter((p: any) => p && p.last_changed).map((p: any) => {
                        const v = numberOf(p.state);
                        return v !== null ? { at: p.last_changed, value: v } : { at: p.last_changed, state: String(p.state ?? '') };
                    }));
                }
            }
            return { ok: true, value: { home: info?.name || 'Home', at: new Date(t).toISOString(), devices, missing } };
        } catch (e) {
            return { ok: false, code: String((e as any)?.code || 'offline'), message: (e as Error).message };
        }
    }

    /** Every entity of the home, for a person's Choose…: id, name, state, and whether a command may name it. */
    async function entities(): Promise<{ ok: true; home: string; list: { id: string; name: string; state: string; commandable: boolean }[] } | { ok: false; code: string; message: string }> {
        if (!current()) return { ok: false, code: 'nolink', message: `No Home Assistant is linked: a person links one in ${WHERE}.` };
        try {
            const states: State[] = (await api('/api/states')) || [];
            const list = states.map((s) => ({ id: s.entity_id, name: nameOf(s), state: shown(s), commandable: COMMANDABLE.has(s.entity_id.split('.')[0]) }))
                .sort((x, y) => x.id.localeCompare(y.id)).slice(0, 3000);
            return { ok: true, home: info?.name || 'Home', list };
        } catch (e) { return { ok: false, code: String((e as any)?.code || 'offline'), message: (e as Error).message }; }
    }

    /** The actions a Home command box may offer for one device: those its home offers that the rules allow. */
    async function actionsOf(id: unknown): Promise<{ ok: true; name: string; actions: string[] } | { ok: false; code: string; message: string }> {
        const e = String(id || '').trim();
        if (!current()) return { ok: false, code: 'nolink', message: `No Home Assistant is linked: a person links one in ${WHERE}.` };
        try {
            const s: State | null = ENTITY.test(e) ? await api(`/api/states/${e}`) : null;
            if (!s) return { ok: false, code: 'missing', message: `No device ${e || '(none)'} in the home.` };
            if (!COMMANDABLE.has(e.split('.')[0])) return { ok: true, name: nameOf(s), actions: [] };
            const { may } = await actionsFor(s);
            return { ok: true, name: nameOf(s), actions: may.sort() };
        } catch (err) { return { ok: false, code: String((err as any)?.code || 'offline'), message: (err as Error).message }; }
    }

    /** One MCP tool call. Never throws: a refusal is an `isError` answer the model reads. */
    async function call(name: string, args: Record<string, unknown>): Promise<Out> {
        const a = args && typeof args === 'object' ? args : {};
        try {
            if (!current()) return { text: `No Home Assistant is linked: a person links one in ${WHERE}.`, isError: true };
            if (name === 'home_devices') return await devicesTool(a);
            if (name === 'home_state') return await stateTool(a);
            if (name === 'home_command') { const r = await command(a); return r.isError ? { text: r.text, isError: true } : { text: r.text }; }
            return { text: `No tool named ${name}.`, isError: true };
        } catch (e) { return { text: (e as Error).message, isError: true }; }
    }

    return { status, check, setLink, armable, arm, call, read, entities, actionsOf, command, linked: () => !!current() };
}
