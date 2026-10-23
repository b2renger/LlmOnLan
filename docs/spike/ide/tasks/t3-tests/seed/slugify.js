// Turn a title into a URL slug: "Crème Brûlée & Co." → "creme-brulee-co".
function slugify(text, options = {}) {
    const sep = options.separator ?? '-';
    const maxLength = options.maxLength ?? 80;
    let s = String(text ?? '')
        .normalize('NFKD')
        .replace(/\p{Diacritic}/gu, '')   // strip accents
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, sep);     // anything else becomes one separator
    while (s.startsWith(sep)) s = s.slice(sep.length);
    while (s.endsWith(sep)) s = s.slice(0, -sep.length);
    if (s.length > maxLength) {
        s = s.slice(0, maxLength);
        while (s.endsWith(sep)) s = s.slice(0, -sep.length);
    }
    return s;
}

module.exports = { slugify };
