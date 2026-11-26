# Laya on the headline set, exactly as the farm's classify_server.py calls it (Router().predict, one item at a time,
# torch on 4 threads, criteria {option: option}). Usage: python -I classify_laya.py <headlines.json> <out.json>
import json, sys, time
import torch
torch.set_num_threads(4)
from laya import Router
import laya

QUESTION = 'Which section of a newspaper published this headline?'
data = json.load(open(sys.argv[1], encoding='utf-8'))
criteria = {l: l for l in data['labels']}
q = {'q': {'type': 'choice', 'instructions': QUESTION, 'criteria': criteria}}

t0 = time.time()
router = Router()
router.predict({'text': 'warm up'}, {'q': {'type': 'choice', 'instructions': 'Warm up.', 'criteria': {'a': 'first', 'b': 'second'}}})
load_s = time.time() - t0

out = []
for it in data['items']:
    t = time.time()
    r = router.predict({'text': it['text']}, q)
    a = (r or {}).get('answers', {}).get('q', {}) if isinstance(r, dict) else {}
    out.append({**it, 'choice': a.get('choice'), 'confidence': float(a.get('answer_confidence', 0.0) or 0.0),
                'probabilities': {k: float(v) for k, v in (a.get('probabilities') or {}).items()},
                'ms': round((time.time() - t) * 1000, 1)})
json.dump({'system': f'laya {getattr(laya, "__version__", "?")}', 'load_s': round(load_s, 1), 'question': QUESTION,
           'items': out}, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
ok = sum(o['choice'] == o['label'] for o in out)
print(f'laya {getattr(laya, "__version__", "?")}: {ok}/{len(out)} right, load {load_s:.1f}s, '
      f'median {sorted(o["ms"] for o in out)[len(out)//2]} ms/item')
