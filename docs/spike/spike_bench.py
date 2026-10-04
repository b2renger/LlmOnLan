#!/usr/bin/env python3
"""LlmOnLan engine x model spike harness (multiuser plan, Phase 0.6).

Talks to any OpenAI-compatible server (vLLM, llama-server, ...) over streaming chat completions.
Python 3.10+, stdlib + aiohttp only, so it runs on x86_64 and linux-arm64 (DGX Spark) alike.

Subcommands (see README.md for the full matrix):
  bench     concurrency sweep for one load profile (chat | long | agent)
  quality   the fixed quality gate in quality_set.json (code asserts, exact answers, tool round-trips)
  kvlog     read a vLLM / llama-server start-up log -> KV pool size, people at 32k / 64k / 128k
  summarize print markdown tables from results/*.json
  selftest  check every reference solution in quality_set.json passes its own tests
"""
import argparse
import asyncio
import glob
import json
import math
import os
import platform
import random
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS_DIR = os.path.join(HERE, "results")
QUALITY_FILE = os.path.join(HERE, "quality_set.json")

WORDS = (
    "time person year way day thing man world life hand part child eye woman place work week case point "
    "government company number group problem fact be have do say get make go know take see come think look "
    "want give use find tell ask work seem feel try leave call good new first last long great little own other "
    "old right big high different small large next early young important few public bad same able to of in for "
    "on with at by from up about into over after beneath under above the a an and or but if then because while "
    "studio farm model server network office window table chair lamp river mountain forest garden kitchen city "
    "village market bridge station train ticket letter report meeting budget schedule project design drawing "
    "camera screen keyboard cable signal battery engine sensor robot music sound color light shadow paper glass "
    "stone metal wood water fire wind cloud rain snow summer winter morning evening night quickly slowly quietly "
    "carefully rarely often always never perhaps maybe certainly clearly simply mostly nearly almost already "
    "student teacher artist engineer doctor writer painter builder farmer driver pilot sailor baker gardener "
    "history science language memory question answer reason result method system process theory practice "
    "decision change growth balance pattern structure surface volume weight distance speed energy pressure"
).split()
IDENTS = "a b c n x y z idx count total value item node left right acc tmp buf key val res out data size step".split()


def now_stamp():
    return datetime.now().strftime("%Y%m%d-%H%M%S")


def pct(values, p):
    """Percentile with linear interpolation (p in 0..100). None for an empty list."""
    if not values:
        return None
    v = sorted(values)
    if len(v) == 1:
        return v[0]
    k = (len(v) - 1) * p / 100.0
    lo, hi = math.floor(k), math.ceil(k)
    return v[lo] + (v[hi] - v[lo]) * (k - lo)


def rnd(x, n=3):
    return None if x is None else round(x, n)


# ----------------------------------------------------------------------------------------------
# Synthetic text: deterministic per seed, so a user's prompt is unique and reproducible.

def prose(rng, n_words):
    out, count = [], 0
    while count < n_words:
        k = rng.randint(8, 20)
        s = [rng.choice(WORDS) for _ in range(k)]
        s[0] = s[0].capitalize()
        out.append(" ".join(s) + rng.choice([".", ".", ".", "?", "!"]))
        count += k
        if rng.random() < 0.1:
            out.append("\n\n")
    return " ".join(out)


def code_lines(rng, n_lines):
    lines = []
    while len(lines) < n_lines:
        name = rng.choice(WORDS) + "_" + rng.choice(WORDS) + "_" + str(rng.randint(1, 99))
        args = ", ".join(rng.sample(IDENTS, rng.randint(1, 3)))
        lines.append("def " + name + "(" + args + "):")
        for _ in range(rng.randint(2, 6)):
            a, b = rng.choice(IDENTS), rng.choice(IDENTS)
            op = rng.choice(["+", "-", "*", "//", "%"])
            lines.append("    " + a + " = " + b + " " + op + " " + str(rng.randint(1, 999)))
        lines.append("    return " + rng.choice(IDENTS))
        lines.append("")
    return "\n".join(lines)


class TokenModel:
    """Words-per-token calibration, measured once per run with the server's own /tokenize."""

    def __init__(self):
        self.prose_tpw = 1.35  # tokens per word (fallback)
        self.code_tpl = 10.0   # tokens per code line (fallback)
        self.json_tpc = 0.3    # tokens per char of a JSON tools schema (fallback)
        self.source = "fallback"

    def words_for(self, tokens):
        return max(1, int(tokens / self.prose_tpw))

    def lines_for(self, tokens):
        return max(1, int(tokens / self.code_tpl))


# ----------------------------------------------------------------------------------------------
# HTTP helpers

def root_of(base_url):
    b = base_url.rstrip("/")
    return b[:-3] if b.endswith("/v1") else b


def make_connector(args):
    """One connection per request (llama-server drops idle keep-alives, so reuse races and fails), over TCP or,
    with --uds, a Unix domain socket (vLLM --uds; used on WSL2 where vLLM's TCP listener was unreachable)."""
    import aiohttp
    if getattr(args, "uds", None):
        return aiohttp.UnixConnector(path=args.uds, limit=0, force_close=True)
    return aiohttp.TCPConnector(limit=0, force_close=True)


def headers(args):
    return {"Authorization": "Bearer " + args.api_key, "Content-Type": "application/json"}


async def get_json(session, url, args, timeout=10):
    import aiohttp
    try:
        async with session.get(url, headers=headers(args), timeout=aiohttp.ClientTimeout(total=timeout)) as r:
            if r.status != 200:
                return None
            return await r.json(content_type=None)
    except Exception:
        return None


async def count_tokens(session, args, text):
    """vLLM: POST /tokenize {model, prompt} -> {count}; llama-server: POST /tokenize {content} -> {tokens}."""
    import aiohttp
    root = root_of(args.base_url)
    for body in ({"model": args.model, "prompt": text, "add_special_tokens": False}, {"content": text}):
        try:
            async with session.post(root + "/tokenize", json=body, headers=headers(args),
                                    timeout=aiohttp.ClientTimeout(total=60)) as r:
                if r.status != 200:
                    continue
                j = await r.json(content_type=None)
                if isinstance(j, dict):
                    if isinstance(j.get("count"), int) and j["count"] > 0:
                        return j["count"]
                    if isinstance(j.get("tokens"), list) and j["tokens"]:
                        return len(j["tokens"])
        except Exception:
            continue
    return None


async def calibrate(session, args, tm):
    rng = random.Random(7)
    sample = prose(rng, 3000)
    n = await count_tokens(session, args, sample)
    if n:
        tm.prose_tpw = n / len(sample.split())
        tm.source = "server /tokenize"
    code = code_lines(rng, 300)
    n2 = await count_tokens(session, args, code)
    if n2:
        tm.code_tpl = n2 / len(code.split("\n"))
    tools_json = json.dumps(agent_tools())
    n3 = await count_tokens(session, args, tools_json)
    if n3:
        tm.json_tpc = n3 / len(tools_json)


async def server_info(session, args):
    info = {}
    root = root_of(args.base_url)
    models = await get_json(session, args.base_url.rstrip("/") + "/models", args)
    if models and models.get("data"):
        m = models["data"][0]
        info["models"] = [{k: d.get(k) for k in ("id", "max_model_len", "owned_by", "root")} for d in models["data"]]
        if not args.model:
            args.model = m.get("id")
    v = await get_json(session, root + "/version", args)
    if v:
        info["vllm_version"] = v.get("version")
    props = await get_json(session, root + "/props", args)
    if props:
        dgs = props.get("default_generation_settings") or {}
        info["llamacpp"] = {"build_info": props.get("build_info"), "total_slots": props.get("total_slots"),
                            "n_ctx": dgs.get("n_ctx"), "model_path": props.get("model_path")}
    return info


def host_info():
    return {"hostname": platform.node(), "machine": platform.machine(), "system": platform.system(),
            "release": platform.release(), "python": platform.python_version()}


# ----------------------------------------------------------------------------------------------
# Samplers: GPU (nvidia-smi) and server /metrics while a level runs

class GpuSampler:
    def __init__(self, every=2.0):
        self.every = every
        self.mem = []
        self.util = []
        self.power = []
        self.exe = shutil.which("nvidia-smi") or ("/usr/lib/wsl/lib/nvidia-smi" if os.path.exists("/usr/lib/wsl/lib/nvidia-smi") else None)

    async def run(self, stop):
        if not self.exe:
            return
        while not stop.is_set():
            try:
                p = await asyncio.create_subprocess_exec(
                    self.exe, "--query-gpu=memory.used,memory.total,utilization.gpu,power.draw",
                    "--format=csv,noheader,nounits", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
                out, _ = await p.communicate()
                f = [x.strip() for x in out.decode(errors="ignore").splitlines()[0].split(",")]

                def num(s):
                    try:
                        return float(s)
                    except ValueError:
                        return None
                if num(f[0]) is not None:
                    self.mem.append(num(f[0]))
                if num(f[2]) is not None:
                    self.util.append(num(f[2]))
                if len(f) > 3 and num(f[3]) is not None:
                    self.power.append(num(f[3]))
            except Exception:
                pass
            try:
                await asyncio.wait_for(stop.wait(), timeout=self.every)
            except asyncio.TimeoutError:
                pass

    def summary(self):
        return {"vram_used_mib_max": max(self.mem) if self.mem else None,
                "gpu_util_mean": rnd(statistics.mean(self.util), 1) if self.util else None,
                "power_w_mean": rnd(statistics.mean(self.power), 1) if self.power else None}


METRIC_KEEP = re.compile(r"(num_requests_running|num_requests_waiting|kv_cache_usage|cache_usage_perc|preempt|"
                         r"prefix_cache_(hits|queries)|prompt_tokens_total|generation_tokens_total|"
                         r"requests_processing|requests_deferred|kv_cache_tokens|n_busy_slots|"
                         r"spec_decode_num_(accepted|draft)_tokens)")


def parse_metrics(text):
    vals = {}
    for line in text.splitlines():
        if not line or line[0] == "#":
            continue
        try:
            name_labels, value = line.rsplit(" ", 1)
            name = name_labels.split("{", 1)[0]
            if not METRIC_KEEP.search(name) or name.endswith(("_bucket", "_created", "_sum", "_count")):
                continue
            vals[name] = vals.get(name, 0.0) + float(value)
        except ValueError:
            continue
    return vals


class MetricsSampler:
    def __init__(self, session, args, every=1.0):
        self.session, self.args, self.every = session, args, every
        self.first, self.last, self.gmax = None, None, {}

    async def snap(self):
        import aiohttp
        try:
            async with self.session.get(root_of(self.args.base_url) + "/metrics", headers=headers(self.args),
                                        timeout=aiohttp.ClientTimeout(total=5)) as r:
                if r.status != 200:
                    return None
                return parse_metrics(await r.text())
        except Exception:
            return None

    async def run(self, stop):
        while not stop.is_set():
            s = await self.snap()
            if s:
                if self.first is None:
                    self.first = s
                self.last = s
                for k, v in s.items():
                    if not k.endswith("_total"):
                        self.gmax[k] = max(self.gmax.get(k, v), v)
            try:
                await asyncio.wait_for(stop.wait(), timeout=self.every)
            except asyncio.TimeoutError:
                pass
        s = await self.snap()
        if s:
            self.last = s

    def summary(self):
        if not self.first or not self.last:
            return None
        out = {"gauges_max": {k: rnd(v, 4) for k, v in self.gmax.items()}, "counters_delta": {}}
        for k, v in self.last.items():
            if k.endswith("_total"):
                out["counters_delta"][k] = rnd(v - self.first.get(k, 0.0), 1)
        d = out["counters_delta"]
        q = next((v for k, v in d.items() if "prefix_cache_queries" in k), None)
        h = next((v for k, v in d.items() if "prefix_cache_hits" in k), None)
        if q:
            out["prefix_cache_hit_rate"] = rnd((h or 0) / q, 3)
        acc = next((v for k, v in d.items() if "spec_decode_num_accepted_tokens" in k), None)
        dr = next((v for k, v in d.items() if "spec_decode_num_draft_tokens" in k), None)
        if dr:
            out["spec_acceptance"] = rnd((acc or 0) / dr, 3)
        return out


# ----------------------------------------------------------------------------------------------
# Load profiles

AGENT_RULES = (
    "You are a coding agent working inside a person's project folder. You can only act through the tools "
    "you are given. Read before you write: open the files you will change, keep their style, and never invent "
    "paths. Prefer small, targeted edits with edit_file over rewriting whole files. After every write, re-read "
    "the changed region to check it. Explain what you changed in two or three sentences once the work is done. "
    "Never touch files outside the project. Never run commands: you have no shell. If the request is unclear, "
    "ask one short question instead of guessing. Keep answers in the person's language. When a task needs "
    "several steps, do them one tool call at a time and stop when the task is complete."
)


def agent_tools():
    def fn(name, desc, props, req):
        return {"type": "function", "function": {"name": name, "description": desc,
                                                 "parameters": {"type": "object", "properties": props, "required": req}}}
    s = {"type": "string"}
    i = {"type": "integer"}
    tools = [
        fn("read_file", "Read a UTF-8 text file from the project. Returns the content with line numbers. Use offset and "
           "limit for large files; never read binary files.", {"path": s, "offset": i, "limit": i}, ["path"]),
        fn("write_file", "Create a new file or overwrite an existing one with the full content given. Parent folders are "
           "created. Prefer edit_file for small changes to existing files.", {"path": s, "content": s}, ["path", "content"]),
        fn("edit_file", "Replace an exact, unique snippet of an existing file with new text. Fails if the old text is not "
           "found exactly once; include enough surrounding lines to make it unique.",
           {"path": s, "old_text": s, "new_text": s, "replace_all": {"type": "boolean"}}, ["path", "old_text", "new_text"]),
        fn("list_dir", "List the entries of a folder in the project, with sizes and modification times.",
           {"path": s, "recursive": {"type": "boolean"}, "max_entries": i}, ["path"]),
        fn("glob", "Find files whose path matches a glob pattern such as src/**/*.ts. Results are sorted by "
           "modification time, newest first.", {"pattern": s, "path": s}, ["pattern"]),
        fn("grep", "Search file contents with a regular expression. Returns matching lines with file names and line "
           "numbers. Use file_glob to narrow the search.", {"pattern": s, "path": s, "file_glob": s,
                                                           "case_insensitive": {"type": "boolean"}, "max_results": i},
           ["pattern"]),
        fn("move_file", "Move or rename a file inside the project.", {"source": s, "destination": s}, ["source", "destination"]),
        fn("delete_file", "Delete a file inside the project. Folders cannot be deleted.", {"path": s}, ["path"]),
        fn("file_info", "Return the size, line count and modification time of a file.", {"path": s}, ["path"]),
    ]
    return tools


PROFILES = {
    # name: prompt tokens (unique part), shared prefix tokens, max output tokens, tools
    "chat": {"prompt_tokens": 4000, "prefix_tokens": 0, "max_tokens": 512, "tools": False},
    "long": {"prompt_tokens": 32000, "prefix_tokens": 0, "max_tokens": 256, "tools": False},
    # A person deep into a long chat: each user's unique context is loaded once (round 0, cold, not scored), all
    # users wait for each other, then every later round re-sends the SAME context + a new ~300-token question.
    # TTFT then measures the cached-prefix path, i.e. what each turn costs once the conversation is in the KV pool.
    "followup": {"prompt_tokens": 32000, "prefix_tokens": 0, "max_tokens": 256, "tools": False},
    "agent": {"prompt_tokens": 2000, "prefix_tokens": 8000, "max_tokens": 1024, "tools": True},
}


class PromptFactory:
    def __init__(self, args, tm):
        self.args, self.tm = args, tm
        p = dict(PROFILES[args.profile])
        if args.prompt_tokens:
            p["prompt_tokens"] = args.prompt_tokens
        if args.prefix_tokens is not None:
            p["prefix_tokens"] = args.prefix_tokens
        if args.max_tokens:
            p["max_tokens"] = args.max_tokens
        self.p = p
        self.tools = agent_tools() if p["tools"] else None
        self.shared_system = None
        if p["prefix_tokens"]:
            tools_tok = int(len(json.dumps(self.tools)) * tm.json_tpc) if self.tools else 0
            rules_tok = int(len(AGENT_RULES.split()) * tm.prose_tpw)
            filler = max(0, p["prefix_tokens"] - tools_tok - rules_tok)
            notes = prose(random.Random(1234), tm.words_for(filler))
            self.shared_system = AGENT_RULES + "\n\n# Project notes (shared by every request)\n\n" + notes

    def build(self, uid, rnd_no, run_nonce):
        a, p = self.args, self.p
        rng = random.Random(hash((run_nonce, uid, rnd_no)) & 0xFFFFFFFF)
        tag = "[session " + run_nonce + "-u" + str(uid) + "-r" + str(rnd_no) + "]"
        if a.profile == "agent":
            code = code_lines(rng, self.tm.lines_for(p["prompt_tokens"] - 60))
            user = (tag + " The function below returns wrong results for negative inputs. Find the bug and write the "
                    "corrected file with write_file, keeping every other function unchanged.\n\nFile: src/" +
                    rng.choice(WORDS) + "_" + str(uid) + ".py\n```python\n" + code + "\n```")
            msgs = [{"role": "system", "content": self.shared_system}, {"role": "user", "content": user}]
        elif a.profile == "followup":
            drng = random.Random(hash((run_nonce, uid)) & 0xFFFFFFFF)   # same context for every round of a user
            doc = prose(drng, self.tm.words_for(p["prompt_tokens"] - 400))
            question = prose(rng, self.tm.words_for(300))
            user = ("[session " + run_nonce + "-u" + str(uid) + "] Here is our working document:\n\n" + doc +
                    "\n\nNew question (turn " + str(rnd_no) + "): " + question + "\nAnswer briefly.")
            msgs = [{"role": "system", "content": "You are a helpful assistant in an office chat app."},
                    {"role": "user", "content": user}]
        else:
            doc = prose(rng, self.tm.words_for(p["prompt_tokens"] - 60))
            user = (tag + " Here is a document I pasted:\n\n" + doc + "\n\nSummarise the key points of this document "
                    "in a few bullet points, then suggest three follow-up questions.")
            msgs = [{"role": "system", "content": "You are a helpful assistant in an office chat app."},
                    {"role": "user", "content": user}]
        mt = p["max_tokens"]
        if a.jitter and not a.natural:
            mt = max(16, int(mt * rng.uniform(1 - a.jitter, 1 + a.jitter)))
        body = {"model": a.model, "messages": msgs, "max_tokens": mt, "stream": True,
                "stream_options": {"include_usage": True}, "temperature": a.temperature, "top_p": a.top_p,
                "seed": rng.randint(1, 2 ** 31 - 1)}
        if a.top_k is not None:
            body["top_k"] = a.top_k
        if not a.natural:
            body["ignore_eos"] = True
        ctk = template_kwargs(a)
        if ctk:
            body["chat_template_kwargs"] = ctk
        if self.tools:
            body["tools"] = self.tools
            body["tool_choice"] = "auto"
        return body


def template_kwargs(a):
    ctk = {}
    if a.template_kwargs:
        ctk.update(json.loads(a.template_kwargs))
    if a.thinking == "on":
        ctk["enable_thinking"] = True
    elif a.thinking == "off":
        ctk["enable_thinking"] = False
    return ctk


async def stream_request(session, args, body, t_origin):
    """One streaming chat completion. Times are seconds relative to t_origin."""
    import aiohttp
    url = args.base_url.rstrip("/") + "/chat/completions"
    res = {"ok": False, "err": None, "t_start": time.perf_counter() - t_origin, "ttft": None, "t_end": None,
           "ntok": 0, "prompt_tokens": None, "decode_tps": None, "finish": None, "n_events": 0,
           "content_chars": 0, "reasoning_chars": 0, "tool_call_chunks": 0, "max_tokens": body.get("max_tokens")}
    t0 = time.perf_counter()
    t_first = t_last = None
    usage = None
    try:
        async with session.post(url, json=body, headers=headers(args),
                                timeout=aiohttp.ClientTimeout(total=args.timeout, sock_read=args.timeout)) as r:
            if r.status != 200:
                txt = (await r.text())[:300]
                res["err"] = "HTTP " + str(r.status) + ": " + txt
                res["t_end"] = time.perf_counter() - t_origin
                return res
            async for raw in r.content:
                line = raw.strip()
                if not line.startswith(b"data:"):
                    continue
                data = line[5:].strip()
                if data == b"[DONE]":
                    break
                try:
                    obj = json.loads(data)
                except ValueError:
                    continue
                if obj.get("usage"):
                    usage = obj["usage"]
                if obj.get("error"):
                    res["err"] = "stream error: " + json.dumps(obj["error"])[:300]
                for ch in obj.get("choices") or []:
                    d = ch.get("delta") or {}
                    got = False
                    c = d.get("content")
                    rc = d.get("reasoning_content") or d.get("reasoning")
                    if c:
                        res["content_chars"] += len(c)
                        got = True
                    if rc:
                        res["reasoning_chars"] += len(rc)
                        got = True
                    if d.get("tool_calls"):
                        res["tool_call_chunks"] += 1
                        got = True
                    if ch.get("finish_reason"):
                        res["finish"] = ch["finish_reason"]
                    if got:
                        t = time.perf_counter()
                        if t_first is None:
                            t_first = t
                        t_last = t
                        res["n_events"] += 1
    except asyncio.TimeoutError:
        res["err"] = "timeout after %ss" % args.timeout
    except Exception as e:  # connection reset, server crash, ...
        res["err"] = type(e).__name__ + ": " + str(e)[:200]
    t_end = time.perf_counter()
    res["t_end"] = t_end - t_origin
    res["e2e"] = t_end - t0
    if usage:
        res["ntok"] = usage.get("completion_tokens") or 0
        res["prompt_tokens"] = usage.get("prompt_tokens")
        det = usage.get("prompt_tokens_details") or {}
        if det.get("cached_tokens") is not None:
            res["cached_tokens"] = det.get("cached_tokens")
    else:
        res["ntok"] = res["n_events"]
    if t_first is not None:
        res["ttft"] = t_first - t0
        res["t_first"] = t_first - t_origin
        if res["ntok"] > 1 and t_last > t_first:
            res["decode_tps"] = (res["ntok"] - 1) / (t_last - t_first)
    if res["err"] is None and t_first is None:
        res["err"] = "no tokens received"
    res["ok"] = res["err"] is None
    return res


def summarize_level(reqs, wall, c, args):
    ok = [r for r in reqs if r["ok"]]
    ttft = [r["ttft"] for r in ok if r["ttft"] is not None]
    dec = [r["decode_tps"] for r in ok if r["decode_tps"]]
    e2e = [r["e2e"] for r in ok]
    ntok = sum(r["ntok"] for r in ok)
    s = {"concurrency": c, "requests": len(reqs), "errors": len(reqs) - len(ok),
         "wall_s": rnd(wall, 2),
         "ttft_p50": rnd(pct(ttft, 50)), "ttft_p95": rnd(pct(ttft, 95)), "ttft_max": rnd(max(ttft) if ttft else None),
         "decode_tps_median": rnd(pct(dec, 50), 2), "decode_tps_p10": rnd(pct(dec, 10), 2),
         "decode_tps_min": rnd(min(dec) if dec else None, 2),
         "e2e_p50": rnd(pct(e2e, 50), 2), "e2e_p95": rnd(pct(e2e, 95), 2),
         "completion_tokens": ntok,
         "completion_tokens_mean": rnd(ntok / len(ok), 1) if ok else None,
         "prompt_tokens_mean": rnd(statistics.mean([r["prompt_tokens"] for r in ok if r["prompt_tokens"]]), 0)
         if any(r["prompt_tokens"] for r in ok) else None,
         "agg_tps_wall": rnd(ntok / wall, 1) if wall > 0 else None}
    # Steady window: from the moment the last user got its first token to the moment the first user finished
    # its last request. Tokens inside it are apportioned assuming a constant rate within each request.
    by_user = {}
    for r in ok:
        by_user.setdefault(r["user"], []).append(r)
    if len(by_user) == c and c > 0 and all(x.get("t_first") is not None for x in ok):
        w0 = max(min(x["t_first"] for x in rs) for rs in by_user.values())
        w1 = min(max(x["t_end"] for x in rs) for rs in by_user.values())
        if w1 - w0 > 1.0:
            tok = 0.0
            for x in ok:
                a, b = x["t_first"], x["t_end"]
                if b <= a:
                    continue
                ov = max(0.0, min(b, w1) - max(a, w0))
                tok += x["ntok"] * ov / (b - a)
            s["agg_tps_steady"] = rnd(tok / (w1 - w0), 1)
            s["steady_window_s"] = rnd(w1 - w0, 1)
    s["agg_tps"] = s.get("agg_tps_steady") or s["agg_tps_wall"]
    # Round 0 starts every user within --stagger seconds (a room hitting Enter together); later rounds are
    # desynchronised by the jittered output lengths. Report both; "steady" = rounds >= 1.
    later = [r for r in ok if r.get("round", 0) >= 1]
    if later:
        lt = [r["ttft"] for r in later if r["ttft"] is not None]
        ld = [r["decode_tps"] for r in later if r["decode_tps"]]
        s["ttft_p50_steady"], s["ttft_p95_steady"] = rnd(pct(lt, 50)), rnd(pct(lt, 95))
        s["decode_tps_p10_steady"] = rnd(pct(ld, 10), 2)
        first = [r["ttft"] for r in ok if r.get("round", 0) == 0 and r["ttft"] is not None]
        s["ttft_p95_round0"] = rnd(pct(first, 95))
        s["pass_steady"] = bool(not s["errors"] and s["ttft_p95_steady"] is not None
                                and s["ttft_p95_steady"] < args.ttft_p95_max
                                and s["decode_tps_p10_steady"] is not None and s["decode_tps_p10_steady"] >= args.min_tps)
    s["pass_p10"] = bool(ok and not s["errors"] and s["ttft_p95"] is not None and s["ttft_p95"] < args.ttft_p95_max
                         and s["decode_tps_p10"] is not None and s["decode_tps_p10"] >= args.min_tps)
    s["pass_median"] = bool(ok and not s["errors"] and s["ttft_p95"] is not None and s["ttft_p95"] < args.ttft_p95_max
                            and s["decode_tps_median"] is not None and s["decode_tps_median"] >= args.min_tps)
    errs = [r["err"] for r in reqs if not r["ok"]]
    if errs:
        s["error_samples"] = sorted(set(errs))[:5]
    return s


async def run_level(session, args, pf, c, run_nonce):
    t_origin = time.perf_counter()
    reqs = []

    followup = args.profile == "followup"
    loaded = [0]
    all_loaded = asyncio.Event()

    async def user(uid):
        rng = random.Random(uid * 7919 + c)
        await asyncio.sleep(rng.uniform(0, args.stagger) if args.stagger and c > 1 else 0)
        for r in range(args.rounds):
            body = pf.build(uid, r, run_nonce + "c" + str(c))
            if followup and r == 0:
                body["max_tokens"] = 8   # the cold load: just get the context into the KV pool
            res = await stream_request(session, args, body, t_origin)
            res["user"], res["round"] = uid, r
            if followup and r == 0:
                res["cold_load"] = True
                loaded[0] += 1
                if loaded[0] == c:
                    all_loaded.set()
                await all_loaded.wait()
                cold.append(res)
                continue
            reqs.append(res)

    cold = []

    stop = asyncio.Event()
    gpu = GpuSampler()
    met = MetricsSampler(session, args)
    samplers = [asyncio.create_task(gpu.run(stop)), asyncio.create_task(met.run(stop))]
    await asyncio.gather(*[user(u) for u in range(c)])
    wall = time.perf_counter() - t_origin
    stop.set()
    await asyncio.gather(*samplers)
    if followup:
        # Score only the warm turns; the steady window starts once every context is loaded.
        t_warm = max((x["t_end"] for x in cold), default=0.0)
        wall = max((x["t_end"] for x in reqs), default=t_warm) - t_warm
    s = summarize_level(reqs, wall, c, args)
    if followup:
        ct = [x["ttft"] for x in cold if x.get("ttft") is not None]
        s["cold_load"] = {"requests": len(cold), "errors": sum(1 for x in cold if not x["ok"]),
                          "ttft_p50": rnd(pct(ct, 50)), "ttft_max": rnd(max(ct) if ct else None),
                          "all_loaded_after_s": rnd(max((x["t_end"] for x in cold), default=None), 1)}
        cached = [x.get("cached_tokens") for x in reqs if x.get("cached_tokens") is not None]
        if cached:
            s["cached_tokens_mean"] = rnd(statistics.mean(cached), 0)
    s["gpu"] = gpu.summary()
    s["server_metrics"] = met.summary()
    return s, reqs + cold


async def cmd_bench(args):
    import aiohttp
    async with aiohttp.ClientSession(connector=make_connector(args)) as session:
        info = await server_info(session, args)
        if not args.model:
            sys.exit("server at %s did not list a model; pass --model" % args.base_url)
        tm = TokenModel()
        await calibrate(session, args, tm)
        pf = PromptFactory(args, tm)
        levels = [int(x) for x in args.levels.split(",") if x]
        extend = [int(x) for x in args.extend.split(",") if x] if args.extend else []
        os.makedirs(args.out_dir, exist_ok=True)
        fname = os.path.join(args.out_dir, "%s__bench__%s__think-%s%s__%s.json" % (
            args.label, args.profile, args.thinking, "__natural" if args.natural else "", now_stamp()))
        doc = {"kind": "bench", "label": args.label, "profile": args.profile, "profile_params": pf.p,
               "thinking": args.thinking, "natural": args.natural, "model": args.model, "base_url": args.base_url,
               "server": info, "host": host_info(), "notes": args.notes, "started": datetime.now().isoformat(),
               "tokenizer_calibration": vars(tm), "criteria": {"ttft_p95_max_s": args.ttft_p95_max,
                                                               "min_decode_tps": args.min_tps},
               "args": {k: v for k, v in vars(args).items() if k not in ("func", "api_key")}, "levels": []}
        run_nonce = "%06x" % random.randrange(16 ** 6)
        print("[bench] %s profile=%s thinking=%s model=%s calib=%.3f tok/word (%s) -> %s" % (
            args.label, args.profile, args.thinking, args.model, tm.prose_tpw, tm.source, fname), flush=True)
        if args.warmup:
            wb = pf.build(9999, 0, run_nonce + "warm")
            wb["max_tokens"] = 16
            w = await stream_request(session, args, wb, time.perf_counter())
            print("[bench] warm-up: ok=%s ttft=%s prompt_tokens=%s err=%s" % (
                w["ok"], rnd(w["ttft"]), w["prompt_tokens"], w["err"]), flush=True)
            if args.warmup_burst > 1:
                # A concurrent burst first, so the first measured level doesn't pay one-off JIT/autotune costs
                # for large batch shapes (seen on vLLM 0.30: the first c=64 level after a fresh start was ~3x slower).
                t0 = time.perf_counter()
                bodies = []
                for k in range(args.warmup_burst):
                    b = pf.build(10000 + k, 0, run_nonce + "burst")
                    b["max_tokens"] = 64
                    bodies.append(b)
                ws = await asyncio.gather(*[stream_request(session, args, b, t0) for b in bodies])
                print("[bench] warm-up burst of %d: %d ok in %.1fs" % (
                    len(ws), sum(1 for x in ws if x["ok"]), time.perf_counter() - t0), flush=True)
        queue = list(levels)
        i = 0
        while i < len(queue):
            c = queue[i]
            s, reqs = await run_level(session, args, pf, c, run_nonce)
            if args.save_requests:
                s["requests_detail"] = reqs
            doc["levels"].append(s)
            with open(fname, "w", encoding="utf-8") as f:
                json.dump(doc, f, indent=1)
            print("[bench] c=%-3d req=%-3d err=%d ttft p50/p95=%s/%s s  decode med/p10=%s/%s tok/s  agg=%s tok/s  "
                  "prompt~%s  pass(p10)=%s pass(med)=%s  vram=%s" % (
                      c, s["requests"], s["errors"], s["ttft_p50"], s["ttft_p95"], s["decode_tps_median"],
                      s["decode_tps_p10"], s["agg_tps"], s["prompt_tokens_mean"], s["pass_p10"], s["pass_median"],
                      (s["gpu"] or {}).get("vram_used_mib_max")), flush=True)
            if "ttft_p95_steady" in s:
                print("[bench]        steady (rounds>=1): ttft p50/p95=%s/%s s  decode p10=%s  pass=%s | round-0 ttft p95=%s" % (
                    s["ttft_p50_steady"], s["ttft_p95_steady"], s["decode_tps_p10_steady"], s["pass_steady"],
                    s["ttft_p95_round0"]), flush=True)
            if s["errors"] == s["requests"]:
                print("[bench] every request failed; stopping the sweep", flush=True)
                break
            if (s["ttft_p95"] or 0) > args.abort_ttft or (s["decode_tps_median"] or 1e9) < args.abort_tps:
                print("[bench] past the abort thresholds; stopping the sweep", flush=True)
                break
            if i == len(queue) - 1 and extend and s["pass_median"]:
                queue.extend(extend)
                extend = []
            i += 1
        doc["finished"] = datetime.now().isoformat()
        passing = [l["concurrency"] for l in doc["levels"] if l["pass_p10"]]
        passing_m = [l["concurrency"] for l in doc["levels"] if l["pass_median"]]
        doc["people_latency_bounded_p10"] = max(passing) if passing else 0
        doc["people_latency_bounded_median"] = max(passing_m) if passing_m else 0
        passing_s = [l["concurrency"] for l in doc["levels"] if l.get("pass_steady")]
        doc["people_latency_bounded_steady"] = max(passing_s) if passing_s else 0
        with open(fname, "w", encoding="utf-8") as f:
            json.dump(doc, f, indent=1)
        print("[bench] done: people (TTFT p95<%ss & decode p10>=%s) = %s; with the median = %s -> %s" % (
            args.ttft_p95_max, args.min_tps, doc["people_latency_bounded_p10"], doc["people_latency_bounded_median"],
            fname), flush=True)


# ----------------------------------------------------------------------------------------------
# Quality gate

FENCE = "`" * 3


def strip_think(text):
    if text and "</think>" in text:
        return text.rsplit("</think>", 1)[1]
    return text or ""


def extract_code(content, names):
    blocks = re.findall(FENCE + r"[ \t]*(?:python|py|Python)?[ \t]*\n(.*?)" + FENCE, content, re.S)
    if not blocks:
        return content
    with_name = [b for b in blocks if any(("def " + n) in b or ("class " + n) in b for n in names)]
    pool = with_name or blocks
    return max(pool, key=len) if len(pool) > 1 and not with_name else pool[-1]


def run_python(code, timeout=30):
    with tempfile.TemporaryDirectory(prefix="spikeq_") as d:
        path = os.path.join(d, "check.py")
        with open(path, "w", encoding="utf-8") as f:
            f.write(code)
        env = {"PATH": os.environ.get("PATH", ""), "PYTHONDONTWRITEBYTECODE": "1", "PYTHONIOENCODING": "utf-8"}
        if os.name == "nt":
            env["SYSTEMROOT"] = os.environ.get("SYSTEMROOT", "")
        try:
            p = subprocess.run([sys.executable, "-I", path], cwd=d, env=env, capture_output=True, text=True,
                               timeout=timeout)
            return p.returncode == 0, (p.stderr or p.stdout)[-600:]
        except subprocess.TimeoutExpired:
            return False, "timeout"


def defined_names(ref_lines):
    names = []
    for ln in ref_lines:
        m = re.match(r"(def|class)\s+([A-Za-z_][A-Za-z0-9_]*)", ln)
        if m:
            names.append(m.group(2))
    return names


NUM_RE = re.compile(r"-?\d[\d,]*(?:\.\d+)?")


def final_answer(content):
    m = re.findall(r"ANSWER\s*[:=]\s*(.+)", content)
    if m:
        ans = m[-1]
    else:
        i = content.rfind("\\boxed{")
        if i < 0:
            return None
        j, depth = i + len("\\boxed{"), 1
        k = j
        while k < len(content) and depth:
            depth += {"{": 1, "}": -1}.get(content[k], 0)
            k += 1
        ans = content[j:k - 1]
    ans = re.sub(r"\\boxed\{([^{}]*)\}", r"\1", ans)
    ans = re.sub(r"\\[a-z]?frac\{([^{}]*)\}\{([^{}]*)\}", r"\1/\2", ans)
    return ans.strip().strip("*`$ .").strip()


def score_exact(item, content):
    ans = final_answer(content)
    if ans is None:
        return False, "no ANSWER line"
    want = item["answer"]
    kind = item.get("match", "text")
    try:
        if kind == "number":
            m = NUM_RE.search(ans)
            return bool(m) and abs(float(m.group(0).replace(",", "")) - float(want)) < 1e-9, "got " + ans[:60]
        if kind == "fraction":
            from fractions import Fraction
            m = re.search(r"(-?\d+)\s*/\s*(\d+)", ans)
            got = Fraction(int(m.group(1)), int(m.group(2))) if m else Fraction(NUM_RE.search(ans).group(0))
            return got == Fraction(want), "got " + ans[:60]
    except Exception:
        return False, "unparsable: " + ans[:60]
    norm = lambda s: re.sub(r"\s+", "", s.lower())
    return norm(want) in norm(ans), "got " + ans[:60]


def arg_ok(matcher, actual):
    if actual is None:
        return False
    if "eq" in matcher:
        w = matcher["eq"]
        if isinstance(w, bool):
            return actual is w or str(actual).strip().lower() == str(w).lower()
        if isinstance(w, (int, float)):
            try:
                return abs(float(actual) - w) < 1e-6
            except (TypeError, ValueError):
                return False
        return str(actual).strip().lower() == str(w).strip().lower()
    if "contains" in matcher:
        return str(matcher["contains"]).lower() in json.dumps(actual).lower() if not isinstance(actual, str) \
            else str(matcher["contains"]).lower() in actual.lower()
    if "num" in matcher:
        try:
            return abs(float(actual) - float(matcher["num"])) < 1e-6
        except (TypeError, ValueError):
            return False
    if "set" in matcher:
        if isinstance(actual, str):
            actual = [x.strip() for x in actual.split(",")]
        if not isinstance(actual, list):
            return False
        return sorted(str(x).strip().lower() for x in actual) == sorted(str(x).lower() for x in matcher["set"])
    return False


def call_matches(exp, call):
    if call["name"] != exp["name"] or not isinstance(call["args"], dict):
        return False
    return all(arg_ok(m, call["args"].get(k)) for k, m in exp.get("args", {}).items())


def tool_result(item, name, args_obj):
    for r in item.get("results", []):
        if r["name"] != name:
            continue
        when = r.get("when") or {}
        if all(str(v).lower() in json.dumps(args_obj or {}).lower() for v in when.values()):
            return r["result"]
    return {"ok": True}


async def chat_once(session, args, messages, tools=None, max_tokens=None):
    import aiohttp
    body = {"model": args.model, "messages": messages, "max_tokens": max_tokens or args.max_tokens,
            "temperature": args.temperature, "top_p": args.top_p, "seed": args.seed, "stream": False}
    if args.top_k is not None:
        body["top_k"] = args.top_k
    ctk = template_kwargs(args)
    if ctk:
        body["chat_template_kwargs"] = ctk
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"
    t0 = time.perf_counter()
    async with session.post(args.base_url.rstrip("/") + "/chat/completions", json=body, headers=headers(args),
                            timeout=aiohttp.ClientTimeout(total=args.timeout)) as r:
        txt = await r.text()
        if r.status != 200:
            raise RuntimeError("HTTP %s: %s" % (r.status, txt[:300]))
        j = json.loads(txt)
    j["_latency"] = time.perf_counter() - t0
    return j


async def score_item(session, args, qs, item):
    kind = item["kind"]
    sysmsg = qs["system"][kind]
    prompt = item["prompt"] if isinstance(item["prompt"], str) else "\n".join(item["prompt"])
    rec = {"id": item["id"], "kind": kind, "pass": False, "reason": "", "latency_s": 0.0, "completion_tokens": 0,
           "finish": None}
    try:
        if kind in ("code", "exact"):
            j = await chat_once(session, args, [{"role": "system", "content": sysmsg}, {"role": "user", "content": prompt}])
            msg = j["choices"][0]["message"]
            content = strip_think(msg.get("content") or "")
            rec["latency_s"] = rnd(j["_latency"], 2)
            rec["completion_tokens"] = (j.get("usage") or {}).get("completion_tokens", 0)
            rec["finish"] = j["choices"][0].get("finish_reason")
            rec["reasoning_chars"] = len(msg.get("reasoning_content") or msg.get("reasoning") or "")
            rec["content_tail"] = content[-500:]
            if kind == "code":
                names = defined_names(item["reference"])
                code = extract_code(content, names)
                ok, log = await asyncio.to_thread(run_python, code + "\n\n" + "\n".join(item["tests"]) + "\n")
                rec["pass"], rec["reason"] = ok, ("tests pass" if ok else log[-300:])
            else:
                rec["pass"], rec["reason"] = score_exact(item, content)
        else:
            lib = qs["tool_library"]
            tools = [{"type": "function", "function": dict(name=n, **lib[n])} for n in item["tools"]]
            messages = [{"role": "system", "content": sysmsg}, {"role": "user", "content": prompt}]
            calls, malformed, final, steps, lat, ctoks = [], [], None, 0, 0.0, 0
            while steps < 5:
                j = await chat_once(session, args, messages, tools=tools)
                lat += j["_latency"]
                ctoks += (j.get("usage") or {}).get("completion_tokens", 0)
                ch = j["choices"][0]
                msg = ch["message"]
                rec["finish"] = ch.get("finish_reason")
                tcs = msg.get("tool_calls") or []
                if not tcs:
                    final = strip_think(msg.get("content") or "")
                    break
                steps += 1
                amsg = {"role": "assistant", "content": msg.get("content") or "", "tool_calls": []}
                tmsgs = []
                for k, tc in enumerate(tcs):
                    fn = tc.get("function") or {}
                    name, raw = fn.get("name"), fn.get("arguments")
                    try:
                        a = json.loads(raw) if isinstance(raw, str) else raw
                        if not isinstance(a, dict):
                            raise ValueError("arguments not an object")
                    except Exception as e:
                        malformed.append("%s: %s (%s)" % (name, str(raw)[:120], e))
                        a = None
                    if name not in item["tools"]:
                        malformed.append("unknown tool %r" % name)
                    calls.append({"name": name, "args": a})
                    cid = tc.get("id") or ("call_%d_%d" % (steps, k))
                    amsg["tool_calls"].append({"id": cid, "type": "function",
                                               "function": {"name": name, "arguments": raw if isinstance(raw, str) else json.dumps(raw)}})
                    tmsgs.append({"role": "tool", "tool_call_id": cid, "content": json.dumps(tool_result(item, name, a))})
                messages.append(amsg)
                messages.extend(tmsgs)
            rec["latency_s"] = rnd(lat, 2)
            rec["completion_tokens"] = ctoks
            rec["calls"] = calls
            rec["steps"] = steps
            rec["final_tail"] = (final or "")[-400:]
            unmatched = list(calls)
            missing = []
            for exp in item.get("expect", []):
                hit = next((c for c in unmatched if call_matches(exp, c)), None)
                if hit is None:
                    missing.append(exp["name"])
                else:
                    unmatched.remove(hit)
            fc = item.get("final_contains") or []
            final_ok = final is not None and (not fc or any(x.lower() in final.lower() for x in fc))
            problems = []
            if malformed:
                problems.append("malformed: " + "; ".join(malformed)[:200])
            if missing:
                problems.append("missing/wrong call: " + ",".join(missing))
            if item.get("no_call") and calls:
                problems.append("called a tool when none was needed")
            if final is None:
                problems.append("no final answer within 5 steps")
            elif not final_ok:
                problems.append("final answer lacks " + "/".join(fc))
            rec["pass"] = not problems
            rec["reason"] = "ok" if not problems else " | ".join(problems)
            rec["malformed"] = len(malformed)
    except Exception as e:
        rec["reason"] = "error: " + type(e).__name__ + ": " + str(e)[:200]
    return rec


async def cmd_quality(args):
    import aiohttp
    with open(QUALITY_FILE, encoding="utf-8") as f:
        qs = json.load(f)
    items = [i for i in qs["items"] if (not args.only or i["kind"] in args.only.split(",") or i["id"] in args.only.split(","))]
    async with aiohttp.ClientSession(connector=make_connector(args)) as session:
        info = await server_info(session, args)
        sem = asyncio.Semaphore(args.concurrency)
        done = []

        async def one(item):
            async with sem:
                r = await score_item(session, args, qs, item)
                done.append(r)
                print("[quality] %-24s %-5s %6.1fs %6s tok  %s" % (
                    r["id"], "PASS" if r["pass"] else "fail", r["latency_s"] or 0, r["completion_tokens"],
                    r["reason"][:110].replace("\n", " ")), flush=True)
                return r

        t0 = time.perf_counter()
        recs = await asyncio.gather(*[one(i) for i in items])
    by = {}
    for r in recs:
        b = by.setdefault(r["kind"], [0, 0])
        b[0] += r["pass"]
        b[1] += 1
    summary = {k: "%d/%d" % tuple(v) for k, v in by.items()}
    summary["total"] = "%d/%d" % (sum(r["pass"] for r in recs), len(recs))
    doc = {"kind": "quality", "label": args.label, "model": args.model, "thinking": args.thinking,
           "sampling": {"temperature": args.temperature, "top_p": args.top_p, "top_k": args.top_k, "seed": args.seed,
                        "max_tokens": args.max_tokens, "template_kwargs": template_kwargs(args)},
           "concurrency": args.concurrency, "server": info, "host": host_info(), "notes": args.notes,
           "wall_s": rnd(time.perf_counter() - t0, 1), "summary": summary,
           "completion_tokens_total": sum(r["completion_tokens"] or 0 for r in recs),
           "set_version": qs.get("version"), "items": recs, "finished": datetime.now().isoformat()}
    os.makedirs(args.out_dir, exist_ok=True)
    fname = os.path.join(args.out_dir, "%s__quality__think-%s__%s.json" % (args.label, args.thinking, now_stamp()))
    with open(fname, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=1)
    print("[quality] %s  (%.0fs, %d completion tokens) -> %s" % (
        json.dumps(summary), doc["wall_s"], doc["completion_tokens_total"], fname), flush=True)


def cmd_selftest(args):
    with open(QUALITY_FILE, encoding="utf-8") as f:
        qs = json.load(f)
    bad = 0
    for it in qs["items"]:
        if it["kind"] == "code":
            reply = "Here you go:\n" + FENCE + "python\n" + "\n".join(it["reference"]) + "\n" + FENCE + "\n"
            code = extract_code(reply, defined_names(it["reference"]))
            ok, log = run_python(code + "\n\n" + "\n".join(it["tests"]) + "\n")
        elif it["kind"] == "exact":
            ok, log = score_exact(it, "Some working.\n\nANSWER: **" + it["answer"] + "**")
        else:
            lib = qs["tool_library"]
            ok = all(n in lib for n in it["tools"])
            log = "tools exist" if ok else "unknown tool in item"
        bad += not ok
        print("%-24s %s %s" % (it["id"], "ok " if ok else "BAD", "" if ok else log))
    print("selftest:", "all good" if not bad else "%d bad" % bad)
    sys.exit(1 if bad else 0)


# ----------------------------------------------------------------------------------------------
# Start-up logs -> KV capacity

def cmd_kvlog(args):
    txt = open(args.log, encoding="utf-8", errors="ignore").read()
    out = {"log": args.log}
    m = re.findall(r"GPU KV cache size:\s*([\d,]+)\s*tokens", txt)
    if m:
        out["engine"] = "vllm"
        out["kv_tokens"] = int(m[-1].replace(",", ""))
    conc = re.findall(r"Maximum concurrency for\s*([\d,]+)\s*tokens per request:\s*([\d.]+)x", txt)
    if conc:
        out["max_concurrency"] = {int(a.replace(",", "")): float(b) for a, b in conc}
    mem = re.findall(r"Available KV cache memory:\s*([\d.]+)\s*GiB", txt)
    if mem:
        out["kv_cache_gib"] = float(mem[-1])
    w = re.findall(r"Model loading took\s*([\d.]+)\s*GiB", txt)
    if w:
        out["weights_gib"] = float(w[-1])
    g = re.findall(r"Graph capturing finished in\s*([\d.]+)\s*secs?, took\s*([\d.\-]+)\s*GiB", txt)
    if g:
        out["cuda_graphs_gib"] = float(g[-1][1])
    # llama-server
    nctx = re.findall(r"n_ctx\s*=\s*(\d+)", txt)
    if nctx and "kv_tokens" not in out:
        out["engine"] = "llama.cpp"
        out["kv_tokens"] = int(nctx[-1])
    kvb = re.findall(r"KV buffer size\s*=\s*([\d.]+)\s*MiB", txt)
    if kvb:
        out["kv_buffer_mib"] = sum(float(x) for x in kvb)
    rsb = re.findall(r"RS buffer size\s*=\s*([\d.]+)\s*MiB", txt)
    if rsb:
        out["recurrent_state_mib"] = sum(float(x) for x in rsb)
    slots = re.findall(r"n_slots\s*=\s*(\d+)", txt)
    if slots:
        out["slots"] = int(slots[-1])
    if out.get("kv_tokens"):
        k = out["kv_tokens"]
        out["people_by_kv"] = {str(L // 1024) + "k": round(k / L, 2) for L in (32768, 65536, 131072)}
        if out.get("max_concurrency"):
            L0, c0 = max(out["max_concurrency"].items())
            out["people_by_kv_from_concurrency_line"] = {
                str(L // 1024) + "k": round(c0 * L0 / L, 2) for L in (32768, 65536, 131072)}
    print(json.dumps(out, indent=1))
    if args.save:
        with open(args.save, "w", encoding="utf-8") as f:
            json.dump(out, f, indent=1)


# ----------------------------------------------------------------------------------------------
# Summaries

def cmd_summarize(args):
    files = []
    for p in args.files or [os.path.join(RESULTS_DIR, "*.json")]:
        files.extend(sorted(glob.glob(p)))
    bench, qual = [], []
    for fn in files:
        try:
            d = json.load(open(fn, encoding="utf-8"))
        except Exception:
            continue
        (bench if d.get("kind") == "bench" else qual if d.get("kind") == "quality" else []).append((fn, d))
    if bench:
        print("| label | profile | thinking | prompt tok | c | err | TTFT p50 / p95 (s) | steady TTFT p95 (s) | "
              "decode med / p10 (tok/s) | agg tok/s | VRAM max (MiB) | pass p10 / med / steady |")
        print("|---|---|---|---|---|---|---|---|---|---|---|---|")
        for fn, d in bench:
            for l in d["levels"]:
                print("| %s | %s | %s%s | %s | %s | %s | %s / %s | %s | %s / %s | %s | %s | %s / %s / %s |" % (
                    d["label"], d["profile"], d["thinking"], " nat" if d.get("natural") else "",
                    l["prompt_tokens_mean"], l["concurrency"],
                    l["errors"], l["ttft_p50"], l["ttft_p95"], l.get("ttft_p95_steady", "n/a"), l["decode_tps_median"],
                    l["decode_tps_p10"], l["agg_tps"], (l.get("gpu") or {}).get("vram_used_mib_max"),
                    "Y" if l["pass_p10"] else "-", "Y" if l["pass_median"] else "-",
                    {True: "Y", False: "-"}.get(l.get("pass_steady"), "n/a")))
        print()
        print("| label | profile | thinking | prompt tok | people (p10 rule) | people (median rule) | people (steady) |")
        print("|---|---|---|---|---|---|---|")
        for fn, d in bench:
            print("| %s | %s | %s%s | %s | %s | %s | %s |" % (
                d["label"], d["profile"], d["thinking"], " nat" if d.get("natural") else "",
                (d["levels"][0]["prompt_tokens_mean"] if d["levels"] else None),
                d.get("people_latency_bounded_p10"), d.get("people_latency_bounded_median"),
                d.get("people_latency_bounded_steady", "n/a")))
        print()
    if qual:
        print("| label | thinking | code | exact | tool | total | completion tokens | wall (s) |")
        print("|---|---|---|---|---|---|---|---|")
        for fn, d in qual:
            s = d["summary"]
            print("| %s | %s | %s | %s | %s | %s | %s | %s |" % (d["label"], d["thinking"], s.get("code"), s.get("exact"),
                                                               s.get("tool"), s.get("total"),
                                                               d.get("completion_tokens_total"), d.get("wall_s")))


# ----------------------------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p):
        p.add_argument("--base-url", default="http://127.0.0.1:8100/v1", help="OpenAI-compatible base URL (ends in /v1)")
        p.add_argument("--model", default=None, help="model id (default: the first id the server lists)")
        p.add_argument("--api-key", default=os.environ.get("SPIKE_API_KEY", "sk-spike"))
        p.add_argument("--uds", default=os.environ.get("SPIKE_UDS"),
                       help="talk HTTP over this Unix socket (vLLM --uds); --base-url then only supplies the path")
        p.add_argument("--label", required=True, help="row label, e.g. pro6000-vllm-qwen3.6-nvfp4")
        p.add_argument("--thinking", choices=["on", "off", "default"], default="default",
                       help="send chat_template_kwargs.enable_thinking (default: leave the template's default)")
        p.add_argument("--template-kwargs", default=None, help='extra chat_template_kwargs as JSON, e.g. \'{"force_nonempty_content": true}\'')
        p.add_argument("--temperature", type=float, default=0.6)
        p.add_argument("--top-p", type=float, default=0.95)
        p.add_argument("--top-k", type=int, default=None)
        p.add_argument("--timeout", type=float, default=1200.0, help="per request, seconds")
        p.add_argument("--out-dir", default=RESULTS_DIR)
        p.add_argument("--notes", default="", help="free text stored in the result (exact server command, etc.)")

    b = sub.add_parser("bench", help="concurrency sweep")
    common(b)
    b.add_argument("--profile", choices=sorted(PROFILES), required=True)
    b.add_argument("--levels", default="1,4,8,16,32")
    b.add_argument("--extend", default="48,64", help="levels added when the last base level still passes ('' = none)")
    b.add_argument("--rounds", type=int, default=2, help="requests per user per level (closed loop)")
    b.add_argument("--stagger", type=float, default=3.0, help="users start uniformly within this many seconds")
    b.add_argument("--jitter", type=float, default=0.2, help="+/- fraction applied to max_tokens per request (desyncs users)")
    b.add_argument("--natural", action="store_true", help="let the model stop by itself (no ignore_eos, no jitter)")
    b.add_argument("--prompt-tokens", type=int, default=None, help="override the profile's unique prompt size")
    b.add_argument("--prefix-tokens", type=int, default=None, help="override the profile's shared prefix size")
    b.add_argument("--max-tokens", type=int, default=None, help="override the profile's output size")
    b.add_argument("--ttft-p95-max", type=float, default=5.0)
    b.add_argument("--min-tps", type=float, default=15.0)
    b.add_argument("--abort-ttft", type=float, default=90.0, help="stop the sweep once TTFT p95 exceeds this")
    b.add_argument("--abort-tps", type=float, default=3.0, help="stop the sweep once median decode falls below this")
    b.add_argument("--no-warmup", dest="warmup", action="store_false")
    b.add_argument("--warmup-burst", type=int, default=32, help="concurrent short requests before the sweep (0 = none)")
    b.add_argument("--no-save-requests", dest="save_requests", action="store_false",
                   help="drop the per-request timings from the JSON (kept by default)")
    b.set_defaults(func=lambda a: asyncio.run(cmd_bench(a)))

    q = sub.add_parser("quality", help="the quality gate")
    common(q)
    q.add_argument("--max-tokens", type=int, default=16384)
    q.add_argument("--seed", type=int, default=1234)
    q.add_argument("--concurrency", type=int, default=4, help="items in flight (items are independent)")
    q.add_argument("--only", default=None, help="comma list of kinds (code,exact,tool) or item ids")
    q.set_defaults(func=lambda a: asyncio.run(cmd_quality(a)))

    k = sub.add_parser("kvlog", help="KV capacity from a server start-up log")
    k.add_argument("log")
    k.add_argument("--save", default=None)
    k.set_defaults(func=cmd_kvlog)

    s = sub.add_parser("summarize", help="markdown tables from result files")
    s.add_argument("files", nargs="*")
    s.set_defaults(func=cmd_summarize)

    t = sub.add_parser("selftest", help="check quality_set.json references")
    t.set_defaults(func=cmd_selftest)

    args = ap.parse_args()
    if getattr(args, "func", None) is None:
        ap.print_help()
        return
    if hasattr(args, "base_url"):
        try:
            import aiohttp  # noqa: F401
        except ImportError:
            sys.exit("spike_bench needs aiohttp: pip install aiohttp (the vLLM venv already has it)")
    args.func(args)


if __name__ == "__main__":
    main()
