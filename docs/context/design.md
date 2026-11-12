# Visual design of the shell surfaces

> Moved verbatim from CLAUDE.md on 2026-11-12 (the split into context modules). It describes `main` unless a line
> names a release or says *not released yet*. Keep it true: a change to the code it describes changes this file in the same commit.

## Visual design (match ComfyQ) — shell surfaces only

Applies to LOL's **own** chrome (topbar, settings, connection screen, toasts, cards). The embedded
Open WebUI keeps its native look — we do **not** inject CSS into OWUI (that would couple us to its DOM
and break invariants #1/#5). If chat‑surface theming is ever wanted, OWUI's supported theming is the
only route, and it reintroduces version coupling — avoid for the prototype.

Ship `shell/renderer/tokens.css` mirroring ComfyQ exactly:
```css
:root, :root.dark {
  --bg:#09090b; --surface:#18181b; --surface-2:#1f1f23; --border:#27272a;
  --text:#e4e4e7; --muted:#a1a1aa; --grey:#71717a;
  --accent:#71717a; --accent-hover:#a1a1aa; --on-accent:#fafafa;
  --green:#10b981; --blue:#71717a; --amber:#f59e0b; --danger:#ef4444;
  color-scheme: dark;
}
:root.light {
  --bg:#fafafa; --surface:#ffffff; --surface-2:#f4f4f5; --border:#e4e4e7;
  --text:#18181b; --muted:#71717a; --grey:#a1a1aa;
  --accent:#52525b; --accent-hover:#3f3f46; --on-accent:#fafafa;
  --green:#16a34a; --blue:#52525b; --amber:#ca8a04; --danger:#dc2626;
  color-scheme: light;
}
```
Conventions: **Inter** (system‑ui fallback), 14px base, antialiased. Radii: cards 12px, panels 10px,
buttons/inputs 8px, chips 7px, pills 999px. 1px `--border` everywhere. Accent buttons use
`filter: brightness(1.08)` on hover; secondary = ghost buttons on `--surface-2`. Status dots use
`color-mix` glow (green = ready, amber = waiting — connecting, seats full, a queue at the engine, not responding,
password needed — red = error, grey = idle). The theme toggle shows the **current** mode's icon (moon in dark, sun
in light), as ComfyQ does. Icons: inline Lucide‑style SVG (moon/sun, gear), no icon font.
