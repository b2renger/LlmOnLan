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
//     cover that does not say it is a blind, curtain, shade, shutter, awning or window (it could be a door, a gate or
//     a garage) — a person does those in Home Assistant;
//   - at most one command a second per device (a light is not a strobe) and 30 a minute in all;
//   - the token stays in main (safeStorage, like the IDE's git tokens) and is never handed to the page.
// What this cannot know: what a switch, a button, a scene or a script is wired to. The dialog says so.
// ponytail: REST only (states, services, one call per command). Home Assistant's WebSocket API would push changes as
// they happen (and give its own per-device "expose" list) — the upgrade path.

import type { McpTool } from './mcp';

export interface HomeLink { url: string; token: string }
/** Where the link is kept (index.ts: `<userData>/home-assistant.json`, the token encrypted by the OS). */
export interface HomeStore { load(): HomeLink | null; save(link: HomeLink | null): boolean }
export interface HomeDevice { id: string; name: string }
type Out = { text: string; isError?: boolean };
type State = { entity_id: string; state: string; attributes?: Record<string, any>; last_changed?: string };

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
    valve: ['open_valve', 'close_valve', 'set_valve_position', 'stop_valve', 'toggle'],
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
const MAX_LINES = 150;
const MAX_NAMES = 30;
const TARGET_KEYS = ['entity_id', 'device_id', 'area_id', 'floor_id', 'label_id'];
const WHERE = 'LlmOnLan ▸ Preferences ▸ Home Assistant';

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
    { name: 'home_command', description: 'Tell ONE device of the home to do something: entity_id, action (one of home_state\'s actions, e.g. turn_on) and optional data (e.g. {"brightness_pct": 40}). A dry run unless a person has allowed home commands; unlocking, disarming an alarm, sounding a siren and opening a door or garage are never done by a model.', inputSchema: { type: 'object', properties: { entity_id: { type: 'string' }, action: { type: 'string' }, data: { type: 'object' } }, required: ['entity_id', 'action'] } },
];
export const HOME_TOOL_NAMES: ReadonlySet<string> = new Set(HOME_TOOLS.map((t) => t.name));

export function createHome(deps: { store: HomeStore; fetch?: typeof fetch; now?: () => number }) {
    const f = deps.fetch || fetch;
    const now = deps.now || Date.now;
    let link: HomeLink | null | undefined;          // undefined = not read from the store yet (safeStorage needs app ready)
    let info: { name: string; version: string } | null = null;
    let armed: Map<string, string> | null = null;   // entity id → name, exactly what the person saw
    let generation = 0;                              // bumped by every link change: an allow from an older one is refused
    const lastAt = new Map<string, number>();
    let recent: number[] = [];
    let services: { at: number; url: string; byDomain: Map<string, Record<string, any>> } | null = null;

    const current = () => { if (link === undefined) link = deps.store.load(); return link; };

    async function api(path: string, init: RequestInit = {}, l = current()): Promise<any> {
        if (!l) throw new Error(`No Home Assistant is linked: a person links one in ${WHERE}.`);
        let r: Response;
        try {
            r = await f(l.url + path, {
                ...init,
                redirect: 'error',
                signal: AbortSignal.timeout(TIMEOUT_MS),
                headers: { authorization: `Bearer ${l.token}`, 'content-type': 'application/json' },
            });
        } catch { throw new Error(`Home Assistant did not answer at ${l.url}.`); }
        if (r.status === 401) throw new Error(`Home Assistant at ${l.url} refused the token: a person pastes a new long-lived token in ${WHERE}.`);
        if (r.status === 404) return null;
        if (!r.ok) {
            const body = (await r.text().catch(() => '')).slice(0, 300);
            throw new Error(`Home Assistant refused it (${r.status})${body ? `: ${body}` : '.'}`);
        }
        return r.json();
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

    /** Link (test first, then keep) — or forget with an empty address. Any change of link forgets the allowed list,
     * before its test AND after it, so an allow the person made while the test ran never carries over. */
    async function setLink(url: string, token: string): Promise<{ ok: boolean; message?: string }> {
        const mine = ++generation;
        armed = null; services = null;
        if (!url && !token) { deps.store.save(null); link = null; info = null; return { ok: true }; }
        const u = normaliseUrl(url);
        if (!u) return { ok: false, message: 'That is not a Home Assistant address: http(s)://host:port, e.g. http://homeassistant.local:8123.' };
        const t = String(token || '').trim();
        if (!t || /\s/.test(t) || t.length > 4096) return { ok: false, message: 'Paste a long-lived access token (Home Assistant ▸ your profile ▸ Security).' };
        const c = await check({ url: u, token: t });
        if (mine !== generation) return { ok: false, message: 'Another link was made meanwhile.' };
        if (!c.ok) return { ok: false, message: c.message };
        if (!deps.store.save({ url: u, token: t })) return { ok: false, message: 'This computer cannot encrypt the token, so it is not kept.' };
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
        const s: State | null = /^[a-z0-9_]+\.[a-z0-9_]+$/.test(id) ? await api(`/api/states/${id}`) : null;
        if (!s) return { text: `No entity ${id || '(none)'} in the home: home_devices lists them.`, isError: true };
        const domain = id.split('.')[0];
        const attrs: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(s.attributes || {})) {
            if (['friendly_name', 'supported_features', 'entity_picture', 'icon', 'access_token'].includes(k)) continue;
            attrs[k] = Array.isArray(v) && v.length > 20 ? [...v.slice(0, 20), `… ${v.length - 20} more`] : v;
        }
        const out: Record<string, unknown> = { entity_id: id, name: nameOf(s), state: shown(s), attributes: attrs, last_changed: s.last_changed };
        if (COMMANDABLE.has(domain)) {
            const { all, may, never } = await actionsFor(s);
            out.actions = Object.fromEntries(may.map((n) => [n, fieldsOf(all[n])]));
            if (never.length) out.never_by_a_model = never;
            out.commands = !armed ? 'a dry run: a person has not allowed home commands' : armed.has(id) ? 'allowed' : 'not in the list the person allowed';
        } else out.commands = `none: ${domain} is read-only for a model`;
        return { text: JSON.stringify(out, null, 1) };
    }

    async function commandTool(a: any): Promise<Out> {
        const id = String(a.entity_id || '').trim();
        const action = String(a.action || a.service || '').trim().replace(/^[a-z0-9_]+\./, '');
        const s: State | null = /^[a-z0-9_]+\.[a-z0-9_]+$/.test(id) ? await api(`/api/states/${id}`) : null;
        if (!s) return { text: `No entity ${id || '(none)'} in the home: home_devices lists them.`, isError: true };
        const domain = id.split('.')[0];
        if (!COMMANDABLE.has(domain)) return { text: `${nameOf(s)} (${id}) is a ${domain}: read-only for a model.`, isError: true };
        const why = neverByModel(s, action);
        if (why) return { text: `Never by a model: ${why}. A person does that in Home Assistant.`, isError: true };
        const { all, may } = await actionsFor(s);
        if (!Object.hasOwn(all, action) || !allowedAction(s, action)) {
            return { text: `"${action}" is not an action a model may use on ${nameOf(s)} (${id}). It may use: ${may.join(', ') || 'none'}.`, isError: true };
        }
        const data: Record<string, unknown> = {};
        if (a.data && typeof a.data === 'object' && !Array.isArray(a.data)) {
            for (const [k, v] of Object.entries(a.data)) if (!TARGET_KEYS.includes(k)) data[k] = v;
        }
        if (JSON.stringify(data).length > 4096) return { text: 'The data is too large for one command.', isError: true };
        const what = `${domain}.${action} on ${nameOf(s)} (${id})${Object.keys(data).length ? ` with ${JSON.stringify(data)}` : ''}`;
        if (!armed) return { text: `DRY RUN — nothing was switched. It would be ${what}. Home commands are not allowed right now: tell the person they can allow them in ${WHERE} ▸ Allow commands.` };
        if (!armed.has(id)) return { text: `${nameOf(s)} (${id}) was not in the list the person allowed: they allow commands again to include it.`, isError: true };
        const t = now();
        const gap = t - (lastAt.get(id) || 0);
        if (gap < MIN_GAP_MS) return { text: `Too fast: one command a second per device. Wait ${MIN_GAP_MS - gap} ms.`, isError: true };
        recent = recent.filter((x) => t - x < 60_000);
        if (recent.length >= PER_MINUTE) return { text: `Too many commands: at most ${PER_MINUTE} a minute. Wait a little.`, isError: true };
        lastAt.set(id, t);
        recent.push(t);
        await api(`/api/services/${domain}/${action}`, { method: 'POST', body: JSON.stringify({ entity_id: id, ...data }) });
        const after: State | null = await api(`/api/states/${id}`);
        return { text: `Done: ${what}. ${nameOf(s)} is now ${after ? shown(after) : 'unknown'}.` };
    }

    /** One MCP tool call. Never throws: a refusal is an `isError` answer the model reads. */
    async function call(name: string, args: Record<string, unknown>): Promise<Out> {
        const a = args && typeof args === 'object' ? args : {};
        try {
            if (!current()) return { text: `No Home Assistant is linked: a person links one in ${WHERE}.`, isError: true };
            if (name === 'home_devices') return await devicesTool(a);
            if (name === 'home_state') return await stateTool(a);
            if (name === 'home_command') return await commandTool(a);
            return { text: `No tool named ${name}.`, isError: true };
        } catch (e) { return { text: (e as Error).message, isError: true }; }
    }

    return { status, check, setLink, armable, arm, call, linked: () => !!current(), armedList: () => (armed ? [...armed.keys()] : []) };
}
