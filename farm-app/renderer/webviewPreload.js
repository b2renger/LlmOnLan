// Webview preload for the embedded farm admin panel (/lol/admin).
//
// The host passes the admin token in the URL hash (#tok=…). This runs BEFORE the
// admin page's own script (which reads localStorage.lolAdminToken at load), so we
// seed the token into localStorage first → the panel unlocks with no prompt. The
// hash is stripped immediately so the token isn't left visible in the address.
//
// Plain JS (loaded via a file:// URL as the <webview preload>), not compiled by tsc.

try {
    const m = /(?:^|[#&])tok=([^&]+)/.exec(window.location.hash || '');
    if (m && m[1]) {
        window.localStorage.setItem('lolAdminToken', decodeURIComponent(m[1]));
        // Drop the token from the visible URL (keep path + query).
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
} catch (e) {
    // Non-fatal: if seeding fails the admin page simply prompts for the token.
    console.warn('[webviewPreload] token seed failed:', e && e.message);
}
