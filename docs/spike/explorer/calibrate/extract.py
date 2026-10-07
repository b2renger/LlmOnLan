# dump the vLLM follow-up + chat/agent levels into a flat rows file for calibration
import json
import os
HERE = os.path.dirname(os.path.abspath(__file__))
m = json.load(open(os.path.join(HERE, '..', 'measured.json'), encoding='utf-8'))
rows = []
for c in m['configs']:
    if c['engine'] != 'vllm': continue
    for pn, p in c['profiles'].items():
        for l in p['levels']:
            base = dict(box=c['box'], model=c['model'], prof=pn, N=l['c'], C=l.get('prompt_tok'), err=l.get('err'))
            if pn.startswith('followup'):
                for rd in ('r1', 'r2'):
                    r = l.get(rd)
                    if not r: continue
                    rows.append(dict(base, rd=rd, ttft95=r.get('ttft_p95'), d10=r.get('dec_p10'), d50=r.get('dec_p50'), n=r.get('n')))
            else:
                rows.append(dict(base, rd='all', ttft95=l.get('ttft_p95'), ttft95_r0=l.get('ttft_p95_r0'), ttft95_st=l.get('ttft_p95_steady'),
                                 d10=l.get('dec_p10'), d10st=l.get('dec_p10_steady'), d50=l.get('dec_p50'), out=l.get('out_tok')))
json.dump(rows, open(os.path.join(HERE, 'rows.json'), 'w'), indent=0)
print(len(rows))
