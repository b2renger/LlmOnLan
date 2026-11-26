# Score classify runs against the section labels. Usage: python -I classify_score.py <run.json>...
import json, sys

def row(items):
    n = len(items); ok = sum(i['choice'] == i['label'] for i in items)
    def bucket(th):
        s = [i for i in items if i['confidence'] >= th]
        return f"{sum(i['choice'] == i['label'] for i in s)}/{len(s)}" + (f" = {100*sum(i['choice']==i['label'] for i in s)/len(s):.0f}%" if s else '') + f" (covers {100*len(s)/n:.0f}%)"
    return f"{ok}/{n} = {100*ok/n:.0f}% | >=0.6: {bucket(0.6)} | >=0.8: {bucket(0.8)}"

for f in sys.argv[1:]:
    d = json.load(open(f, encoding='utf-8'))
    its = d['items']
    ms = sorted(i['ms'] for i in its)
    print(f"== {d['system']}  (median {ms[len(ms)//2]} ms/item{', wall %.1fs' % d['wall_s'] if 'wall_s' in d else ''})")
    for lang in ('en', 'fr'):
        print(f"  {lang}: {row([i for i in its if i['lang'] == lang])}")
    print(f"  all: {row(its)}")
    wrong = {}
    for i in its:
        if i['choice'] != i['label']:
            wrong[(i['label'], i['choice'])] = wrong.get((i['label'], i['choice']), 0) + 1
    print('  most common errors (label -> choice):', sorted(wrong.items(), key=lambda kv: -kv[1])[:5])
