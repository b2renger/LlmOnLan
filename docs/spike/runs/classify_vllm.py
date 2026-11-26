# vLLM's /v1/systemone on the headline set: the same question and options as the Laya run.
# Usage: python -I classify_vllm.py <base http://host:port> <model> <headlines.json> <out.json> <concurrency> <thinking: off|default>
import json, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

QUESTION = 'Which section of a newspaper published this headline?'
base, model, src, dst, conc, thinking = sys.argv[1:7]
data = json.load(open(src, encoding='utf-8'))
criteria = {l: None for l in data['labels']}

def ask(it):
    body = {'model': model, 'state': it['text'],
            'questions': {'q': {'type': 'choice', 'instructions': QUESTION, 'criteria': criteria}}}
    if thinking == 'off':
        body['chat_template_kwargs'] = {'enable_thinking': False}
    req = urllib.request.Request(base + '/v1/systemone', data=json.dumps(body).encode(), method='POST',
                                 headers={'content-type': 'application/json'})
    t = time.time()
    with urllib.request.urlopen(req, timeout=120) as r:
        res = json.loads(r.read())
    a = res['answers']['q']
    return {**it, 'choice': a['choice'], 'confidence': float(a['confidence']),
            'probabilities': a.get('probabilities', {}), 'label_mass': res['diagnostics']['q']['label_mass'],
            'input_tokens': res['usage']['input_tokens'], 'ms': round((time.time() - t) * 1000, 1)}

ask(data['items'][0])  # warm: the first read compiles nothing new, but keep the timing honest
t0 = time.time()
with ThreadPoolExecutor(int(conc)) as ex:
    out = list(ex.map(ask, data['items']))
wall = time.time() - t0
json.dump({'system': f'vllm systemone {model} thinking={thinking} c={conc}', 'wall_s': round(wall, 2),
           'question': QUESTION, 'items': out}, open(dst, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
ok = sum(o['choice'] == o['label'] for o in out)
ms = sorted(o['ms'] for o in out)
print(f'{model} thinking={thinking} c={conc}: {ok}/{len(out)} right, wall {wall:.1f}s, '
      f'median {ms[len(ms)//2]} ms/item, p95 {ms[int(len(ms)*0.95)]} ms, mean label_mass '
      f'{sum(o["label_mass"] for o in out)/len(out):.3f}')
