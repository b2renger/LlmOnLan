"""A French classroom probe and a tool-call smoke test for a model on trial (2026-11-23, Inkling 2 Mini).

Not the 28-item gate (spike_bench.py quality), so the gate stays comparable between models: five prompts a teacher in
a French school might type, each answer checked for its language (French, no other script, few English words) and
kept whole for a person to read; then one tool call through the server's tool parser.

    python fr_probe.py --uds <vllm.sock> --model <served name> --label <label> [--kwargs '{"reasoning_effort":"none"}']

Writes docs/spike/results/<label>__fr_probe.json. Standard library only.
"""
import argparse, http.client, json, os, re, socket, time

PROMPTS = [
    "Explique simplement à des élèves de quatrième ce qu'est la photosynthèse, en cinq phrases.",
    "Rédige un court message aux parents pour annoncer une sortie au musée le jeudi 3 décembre, avec la liste de ce qu'il faut apporter.",
    "Quelle est la différence entre « a » et « à » ? Donne trois exemples de phrases.",
    "Corrige les fautes de cette phrase et explique chaque correction : « Les élèves sont allé au cinéma et ils ont regarder un film qui les a beaucoup plus. »",
    "Propose le plan d'une séance de 55 minutes sur les fractions pour une classe de CM2.",
]
# Common English words that should not appear in a French answer (a few may, inside quotes or names).
ENGLISH = set("the and is are with which this that from have will would should there their what when where".split())
FRENCH = set("le la les des une est et que qui pour dans avec sur pas ce cette sont aux du en".split())


class UDSConnection(http.client.HTTPConnection):
    def __init__(self, path, timeout=900):
        super().__init__("localhost", timeout=timeout)
        self.path = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.path)


def post(uds, body):
    c = UDSConnection(uds)
    c.request("POST", "/v1/chat/completions", json.dumps(body), {"content-type": "application/json"})
    r = c.getresponse()
    data = json.loads(r.read() or b"{}")
    if r.status != 200:
        raise RuntimeError(f"HTTP {r.status}: {json.dumps(data)[:400]}")
    return data


def language(text):
    words = re.findall(r"[a-zàâäçéèêëîïôöùûüÿœæ']+", text.lower())
    n = max(1, len(words))
    return {
        "words": len(words),
        "french_share": round(sum(w in FRENCH for w in words) / n, 3),
        "english_share": round(sum(w in ENGLISH for w in words) / n, 3),
        "other_script": bool(re.search(r"[Ѐ-ӿ؀-ۿ぀-ヿ㐀-鿿가-힯]", text)),
    }


def main():
    a = argparse.ArgumentParser()
    a.add_argument("--uds", required=True)
    a.add_argument("--model", required=True)
    a.add_argument("--label", required=True)
    a.add_argument("--kwargs", default=None, help="chat_template_kwargs as JSON")
    a.add_argument("--max-tokens", type=int, default=4096)
    o = a.parse_args()
    kw = json.loads(o.kwargs) if o.kwargs else None
    out = {"label": o.label, "model": o.model, "chat_template_kwargs": kw, "at": time.strftime("%Y-%m-%d %H:%M"), "answers": []}
    for p in PROMPTS:
        body = {"model": o.model, "messages": [{"role": "user", "content": p}], "max_tokens": o.max_tokens}
        if kw:
            body["chat_template_kwargs"] = kw
        t0 = time.time()
        d = post(o.uds, body)
        m = d["choices"][0]["message"]
        text = m.get("content") or ""
        rec = {"prompt": p, "seconds": round(time.time() - t0, 1), "usage": d.get("usage"),
               "finish": d["choices"][0].get("finish_reason"), "reasoning_chars": len(m.get("reasoning_content") or m.get("reasoning") or ""),
               "language": language(text), "answer": text}
        out["answers"].append(rec)
        print(f"[fr] {rec['seconds']}s fr={rec['language']['french_share']} en={rec['language']['english_share']} "
              f"other={rec['language']['other_script']} words={rec['language']['words']} think={rec['reasoning_chars']} :: {p[:50]}")
    tool = {"type": "function", "function": {"name": "menu_cantine", "description": "Donne le menu de la cantine pour une date.",
            "parameters": {"type": "object", "properties": {"date": {"type": "string", "description": "AAAA-MM-JJ"}}, "required": ["date"]}}}
    body = {"model": o.model, "messages": [{"role": "user", "content": "Quel est le menu de la cantine le 2026-11-26 ?"}],
            "tools": [tool], "tool_choice": "auto", "max_tokens": 2048}
    if kw:
        body["chat_template_kwargs"] = kw
    t0 = time.time()
    d = post(o.uds, body)
    m = d["choices"][0]["message"]
    calls = m.get("tool_calls") or []
    out["tool_call"] = {"seconds": round(time.time() - t0, 1), "finish": d["choices"][0].get("finish_reason"),
                        "calls": [{"name": c["function"]["name"], "arguments": c["function"]["arguments"]} for c in calls],
                        "content": m.get("content")}
    print(f"[tool] {out['tool_call']}")
    path = os.path.join(os.path.dirname(__file__), "..", "results", f"{o.label}__fr_probe.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("[fr] wrote", os.path.normpath(path))


if __name__ == "__main__":
    main()
