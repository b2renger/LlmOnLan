# Build the labelled headline set for the decision-endpoint measurement (plans > Next 22), night n17 2026-11-26.
# Labels come from each headline's own news section (the feed it was published in), not from a judge.
# Usage: python -I classify_headlines.py <out.json>
import json, sys, urllib.request, xml.etree.ElementTree as ET

PER = 15
FEEDS = {
    'en': {
        'politics': 'https://feeds.bbci.co.uk/news/politics/rss.xml',
        'business': 'https://feeds.bbci.co.uk/news/business/rss.xml',
        'technology': 'https://feeds.bbci.co.uk/news/technology/rss.xml',
        'science': 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml',
        'health': 'https://feeds.bbci.co.uk/news/health/rss.xml',
        'culture': 'https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml',
        'world': 'https://feeds.bbci.co.uk/news/world/rss.xml',
    },
    'fr': {
        'politics': 'https://www.lemonde.fr/politique/rss_full.xml',
        'business': 'https://www.lemonde.fr/economie/rss_full.xml',
        'technology': 'https://www.lemonde.fr/pixels/rss_full.xml',
        'science': 'https://www.lemonde.fr/sciences/rss_full.xml',
        'health': 'https://www.lemonde.fr/sante/rss_full.xml',
        'culture': 'https://www.lemonde.fr/culture/rss_full.xml',
        'world': 'https://www.lemonde.fr/international/rss_full.xml',
    },
}

def titles(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'feed-reader/1.0'})
    with urllib.request.urlopen(req, timeout=30) as r:
        root = ET.fromstring(r.read(5_000_000))
    out = []
    for item in root.iter('item'):
        t = (item.findtext('title') or '').strip()
        if t and t not in out:
            out.append(t)
    return out

items, report = [], {}
for lang, feeds in FEEDS.items():
    got = {}
    for label, url in feeds.items():
        try:
            got[label] = titles(url)
        except Exception as e:
            got[label] = []
            print(f'{lang} {label}: FAILED {e}', file=sys.stderr)
    seen = {}
    for label, ts in got.items():
        for t in ts:
            seen.setdefault(t, set()).add(label)
    for label, ts in got.items():
        kept = [t for t in ts if len(seen[t]) == 1][:PER]
        report[f'{lang}/{label}'] = f'{len(kept)} of {len(ts)}'
        items += [{'lang': lang, 'label': label, 'text': t, 'source': feeds[label]} for t in kept]

json.dump({'labels': ['politics', 'business', 'technology', 'science', 'health', 'culture', 'world'],
           'how': 'each headline labelled by the news section it was published in; a title in two sections dropped',
           'items': items}, open(sys.argv[1], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(json.dumps(report, indent=0))
print(len(items), 'items')
