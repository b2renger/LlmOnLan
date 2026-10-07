# Builds farm/src/capacity/catalog.json (the copy the farm serves at /lol/capacity) from curated facts (below) + the Hugging Face API dumps in hf/ (fetched 2026-10-07).
# Every number below carries a source id (see SOURCES) or is marked derived/estimated.
import json, math, os

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "..", "farm", "src", "capacity", "catalog.json")
GiB = 1024 ** 3

def hf(rid):
    p = os.path.join(HERE, "hf", rid.replace("/", "__") + ".json")
    return json.load(open(p, encoding="utf-8")) if os.path.exists(p) else None

def st_gb(rid, folder_only_root=False, halve=False):
    r = hf(rid)
    if not r: return None
    b = r.get("st_bytes") or 0
    if halve: b /= 2   # repo ships the same weights twice (consolidated.* + model-*.safetensors)
    return round(b / 1e9, 2)

def gguf_gb(rid, name_part):
    r = hf(rid)
    if not r: return None
    for k, v in r["gguf"].items():
        if name_part in k: return round(v / 1e9, 2)
    return None

# ---------------------------------------------------------------- sources
SOURCES = {
 "repo-estimates": {"title": "LlmOnLan docs/spike/ESTIMATES_2026-10-05.md (specs, FR prices, per-card estimates)", "url": "docs/spike/ESTIMATES_2026-10-05.md", "date": "2026-10-05/06", "type": "repo"},
 "repo-results": {"title": "LlmOnLan docs/spike/RESULTS.md (PRO 6000 2026-10-04, DGX Spark 2026-10-05/06, measured)", "url": "docs/spike/RESULTS.md", "date": "2026-10-04..06", "type": "repo-measured"},
 "repo-plan-s9": {"title": "LlmOnLan multiuser_implementation_plan.md section 9 (model + Spark seed data, community numbers) and section 4.3 (Bonsai)", "url": "multiuser_implementation_plan.md", "date": "2026-10-06", "type": "repo"},
 "nv-spark-page": {"title": "NVIDIA DGX Spark product page (specs; 1x/2x/4x model-size table)", "url": "https://www.nvidia.com/en-us/products/workstations/dgx-spark/", "date": "fetched 2026-10-07", "type": "vendor"},
 "nv-spark-stacking": {"title": "NVIDIA DGX Spark User Guide: Spark Stacking (CX-7 ports, 2x PCIe Gen5 x4 per port, up to 3 direct / 4 via switch)", "url": "https://docs.nvidia.com/dgx/dgx-spark/spark-clustering.html", "date": "fetched 2026-10-07", "type": "vendor"},
 "nv-playbook-vllm-multinode": {"title": "build.nvidia.com Spark playbook: vLLM multi-node (TP=2, vllm/vllm-openai:v0.28.0, example nvidia/Qwen3.8-27B-NVFP4)", "url": "https://build.nvidia.com/spark/vllm/multi-node.md", "date": "fetched 2026-10-07", "type": "vendor"},
 "nv-playbook-connect-two": {"title": "build.nvidia.com Spark playbook: Connect two Sparks (one QSFP cable, 200GbE direct)", "url": "https://build.nvidia.com/spark/connect-two-sparks.md", "date": "fetched 2026-10-07", "type": "vendor"},
 "nv-playbook-trtllm": {"title": "build.nvidia.com Spark playbook: TensorRT-LLM (Qwen3-235B-A22B NVFP4 'two Sparks only', image 1.3.0rc13)", "url": "https://build.nvidia.com/spark/trt-llm.md", "date": "fetched 2026-10-07", "type": "vendor"},
 "nv-blog-spark-perf": {"title": "NVIDIA developer blog: How NVIDIA DGX Spark's performance enables intensive AI tasks (incl. Qwen3 235B on dual Spark)", "url": "https://developer.nvidia.com/blog/how-nvidia-dgx-sparks-performance-enables-intensive-ai-tasks", "date": "2025-10-24", "type": "vendor-measured"},
 "vllm-blog-spark": {"title": "vLLM blog: vLLM on DGX Spark (Nemotron-3-Super-120B-A12B-NVFP4, single node; TP=2 only with CX-7 link)", "url": "https://vllm.ai/blog/2026-06-01-vllm-dgx-spark", "date": "2026-06-01", "type": "engine-vendor"},
 "nvf-two-sparks-engines": {"title": "NVIDIA forum: Setting up vLLM, SGLang or TensorRT on two DGX Sparks (gpt-oss-120b, c=32)", "url": "https://forums.developer.nvidia.com/t/setting-up-vllm-sglang-or-tensorrt-on-two-dgx-sparks/353338", "date": "2025-12-02..07", "type": "community-measured"},
 "nvf-qwen3-235b-rpc": {"title": "NVIDIA forum: DGX Spark multi-node LLM inference report for Qwen3-235B (llama.cpp RPC; nccl-tests 39.34 GB/s)", "url": "https://forums.developer.nvidia.com/t/dgx-spark-multi-node-llm-inference-report-for-qwen3-235b-model/355126", "date": "2025-12-17", "type": "community-measured"},
 "nvf-link-throughput": {"title": "NVIDIA forum: Two DGX Sparks over the ConnectX-7 direct link (ib_write_bw 98.02+98.02 Gb/s; iperf3 ~16 Gb/s)", "url": "https://forums.developer.nvidia.com/t/two-dgx-sparks-over-the-connectx-7-direct-link-setup-notes-throughput-numbers-and-two-questions-federated-vs-cluster-telemetry/376298", "date": "2026-07-10", "type": "community-measured"},
 "muninn-flashnext-tp2": {"title": "ai-muninn: Qwen3.8-Flash-Next TP=2 on two DGX Sparks (51.9 vs 41.7 tok/s; link 185.14 Gb/s; 0.3% link use in decode)", "url": "https://ai-muninn.com/en/blog/qwen38-flash-next-tp2-two-dgx-sparks", "date": "2026-09-12", "type": "community-measured"},
 "muninn-index": {"title": "ai-muninn blog index (gpt-oss-120b 60 tok/s on one Spark 2026-03-19; DeepSeek-V4-Flash-0731 on one Spark 17.5-17.9 tok/s 2026-08-02; Flash-Next two Sparks 51.9-72.0 tok/s 2026-09-28)", "url": "https://ai-muninn.com/en/blog", "date": "fetched 2026-10-07", "type": "community-measured"},
 "muninn-glm53flash-1spark": {"title": "ai-muninn: GLM-5.3-Flash on one DGX Spark (UD-Q2_K_XL 108.72 GB, llama.cpp, 15.4-23.6 tok/s)", "url": "https://ai-muninn.com/en/blog/glm53-flash-one-dgx-spark", "date": "2026-08-30", "type": "community-measured"},
 "nvf-q35-397b-dual-a": {"title": "NVIDIA forum: Qwen3.5-397B-A17B run in dual Spark (int4-AutoRound, TP=2, 26-30 tok/s, 42-46 agg at 2-3 users)", "url": "https://forums.developer.nvidia.com/t/qwen3-5-397b-a17b-run-in-dual-spark-but-i-have-a-concern/361967", "date": "2026-02-28..03-05", "type": "community-measured"},
 "nvf-q35-397b-dual-b": {"title": "NVIDIA forum: Serving Qwen3.5-397B-A17B at 1M tokens on 2x DGX Spark; MiniMax M3 is next (vLLM 0.24, 30.82 tok/s tg32, pp2048 1114.85; M3 22-25 tok/s)", "url": "https://forums.developer.nvidia.com/t/serving-qwen3-5-397b-a17b-at-1m-tokens-on-2x-dgx-spark-minimax-m3-is-next/375421", "date": "2026-07-03", "type": "community-measured"},
 "l1t-minimax-dual": {"title": "Level1Techs forum: MiniMax (M2.7 AWQ-4bit) on dual Sparks (TP=2; NCCL_NET_GDR_LEVEL=0 needed; lockups otherwise)", "url": "https://forum.level1techs.com/t/minimax-on-dual-sparks/252038", "date": "2026-06-30", "type": "community"},
 "nvf-minimax-two": {"title": "NVIDIA forum: MiniMax on two DGX Sparks (search snippet: M2.7 AWQ-4bit ~40 tok/s on two ASUS GX10)", "url": "https://forums.developer.nvidia.com/t/minimax-on-two-dgx-sparks/375022", "date": "not read (search snippet 2026-10-07)", "type": "community-measured"},
 "gh-elsung-dsv4": {"title": "GitHub elsung/dgx-spark-deepseek-v4-flash (official checkpoint, vLLM TP=2 ~41 tok/s single, ~350 tok/s at c=32; KV pool 1,105,096 tokens)", "url": "https://github.com/elsung/dgx-spark-deepseek-v4-flash", "date": "2026-06 (README refers to a 2026-06-16 fix)", "type": "community-measured"},
 "classmethod-dsv4-2node": {"title": "Classmethod: DeepSeek-V4-Flash-DSpark on 2 DGX Spark units (vLLM TP=2; 55.17 / 41.90 tok/s)", "url": "https://dev.classmethod.jp/en/articles/dgx-spark-2node-deepseek-v4-flash-dspark/", "date": "2026-06-30", "type": "community-measured"},
 "nvf-glm53flash-sglang": {"title": "NVIDIA forum: GLM-5.3-Flash + DFlash2 on SGLang, 2x DGX Spark (TP=2; 14.7 tok/s plain, 29.4 with DFlash2; concurrency curve)", "url": "https://forums.developer.nvidia.com/t/glm-5-3-flash-dflash2-on-sglang-2x-dgx-spark-first-sglang-path-recipe-4-gb10-fixes-honest-numbers-concurrency-curve/381703", "date": "2026-08-28", "type": "community-measured"},
 "nvf-glm53flash-mtp": {"title": "NVIDIA forum: GLM-5.3-Flash running on 2x DGX Spark day-0, 24.7-30.3 tok/s with MTP-5 (search snippet)", "url": "https://forums.developer.nvidia.com/t/glm-5-3-flash-running-on-2x-dgx-spark-sm-121-day-0-24-7-30-3-tok-s-with-mtp-5-two-silent-gb10-gotchas-worth-knowing/381433", "date": "~2026-08-26 (not opened)", "type": "community-measured"},
 "nvf-q35-122b-1spark": {"title": "NVIDIA forum: Qwen3.5-122B-A10B on single Spark: up to 51 tok/s (patches + MTP); search snippets also quote 30 -> 51 tok/s", "url": "https://forums.developer.nvidia.com/t/qwen3-5-122b-a10b-on-single-spark-up-to-51-tok-s-v2-1-patches-quick-start-benchmark/365639/228", "date": "2026 (spring; not opened)", "type": "community-measured"},
 "spark-fp4-sparse": {"title": "Igor's Lab / NVIDIA forum '1PFLOP - how?': the 1 PFLOP FP4 is with 2:4 sparsity (500 dense FP4, 250 FP8, 125 BF16)", "url": "https://forums.developer.nvidia.com/t/1pflop-how/365583/4", "date": "2026 (search 2026-10-07)", "type": "community"},
 "nv-rtx5090": {"title": "NVIDIA GeForce RTX 5090 page (3352 AI TOPS, 21760 CUDA cores, 32 GB GDDR7, 512-bit, 575 W)", "url": "https://www.nvidia.com/en-us/geforce/graphics-cards/50-series/rtx-5090/", "date": "fetched 2026-10-07", "type": "vendor"},
 "nv-rtx4080": {"title": "NVIDIA GeForce RTX 4080 family page (780 / 836 AI TOPS, 16 GB GDDR6X, 256-bit, 320 W)", "url": "https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/rtx-4080-family/", "date": "fetched 2026-10-07", "type": "vendor"},
 "nv-rtx4070": {"title": "NVIDIA GeForce RTX 4070 family page (466 AI TOPS, 12 GB, 192-bit, 200 W)", "url": "https://www.nvidia.com/en-us/geforce/graphics-cards/40-series/rtx-4070-family/", "date": "fetched 2026-10-07", "type": "vendor"},
 "ldlc-5090": {"title": "LDLC.com search 'rtx 5090' (cheapest in stock EUR 6,999.95 Gainward Phantom GS; range 6,599.95-8,499.95, mostly out of stock)", "url": "https://www.ldlc.com/recherche/rtx%205090/", "date": "2026-10-07", "type": "retailer"},
 "cable-prices": {"title": "QSFP 200G cable for two Sparks: Amphenol NJAAKR-0006 $159 (petronellatech); generic 200G QSFP56 DAC $66 (naddod); dual-Spark bundles $10,599-14,828 (balticnetworks)", "url": "https://petronellatech.com/blog/what-cable-do-i-need-to-connect-two-dgx-sparks/ ; https://www.naddod.com/products/102765.html ; https://www.balticnetworks.com/products/nvidia-dgx-spark-dual-system-bundle", "date": "search 2026-10-07", "type": "retailer"},
 "hf-api": {"title": "Hugging Face Hub API (config.json, safetensors parameter counts, file sizes, licenses) for every repo listed per model", "url": "https://huggingface.co/api/models/<repo>?blobs=true", "date": "2026-10-07", "type": "primary"},
 "openai-gptoss-card": {"title": "OpenAI gpt-oss-120b & gpt-oss-20b model card (arXiv 2508.10925)", "url": "https://arxiv.org/pdf/2508.10925", "date": "2025-08", "type": "vendor"},
 "meta-llama4-card": {"title": "Meta Llama 4 model card (copy in unsloth/Llama-4-Scout-17B-16E-Instruct README)", "url": "https://huggingface.co/unsloth/Llama-4-Scout-17B-16E-Instruct", "date": "2025-04", "type": "vendor"},
 "glm53flash-chart": {"title": "Z.ai GLM-5.3-Flash benchmark chart (bench_53.png, linked from the model card)", "url": "https://raw.githubusercontent.com/zai-org/GLM-5/refs/heads/main/resources/bench_53.png", "date": "2026-08-25", "type": "vendor"},
 "mistral-small4-charts": {"title": "Mistral Small 4 model-card charts (livecode.png, aime.png)", "url": "https://huggingface.co/mistralai/Mistral-Small-4-119B-2603", "date": "2026-03", "type": "vendor"},
 "mistral-medium35-card": {"title": "Mistral Medium 3.5 128B model card text + chart image1.png", "url": "https://huggingface.co/mistralai/Mistral-Medium-3.5-128B", "date": "2026-03-31", "type": "vendor"},
 "benchlm-open": {"title": "BenchLM open-source leaderboard (aggregate 'BenchAlign v5.8' score; methodology opaque)", "url": "https://benchlm.ai/best/open-source", "date": "updated 2026-10-06, fetched 2026-10-07", "type": "aggregator"},
 "benchlm-m3": {"title": "BenchLM MiniMax M3 page (vendor SWE-V/SWE-Pro/TB2.1; Artificial Analysis GPQA/HLE; Vals LCB)", "url": "https://benchlm.ai/models/minimax-m3", "date": "fetched 2026-10-07", "type": "aggregator"},
 "medium-tp-trap": {"title": "Medium (M. Hannecke): 'The race car in the parking garage' - claims TP across two Sparks stalls on the link (403 when fetched; search snippet only)", "url": "https://medium.com/@michael.hannecke/the-race-car-in-the-parking-garage-which-inference-engine-wins-on-the-dgx-spark-a7e5fad7ce98", "date": "unknown", "type": "community (low reliability)"},
}

def card(rid):
    return "https://huggingface.co/%s" % rid

# ---------------------------------------------------------------- hardware
# Memory budgets follow ESTIMATES_2026-10-05 Method step 1 for cards (0.92 x visible - desktop 1.66 - runtime 3.7 [- OCR 9.0] GiB),
# and the spike/handoff practice for the Spark (keep 25-30 GB spare for a farm; a single user can go to ~13 GB free).
def card_budgets(visible_gib, windows=True):
    base = 0.92 * visible_gib - (1.66 if windows else 0) - 3.7
    return {"farm_with_ocr_gib": round(base - 9.0, 1), "farm_no_ocr_gib": round(base, 1),
            "single_user_max_gib": round(0.95 * visible_gib - (1.66 if windows else 0) - 3.7, 1)}

HARDWARE = [
 {"id": "rtx-pro-6000-ws", "name": "RTX PRO 6000 Blackwell Workstation", "kind": "pcie-card", "arch": "Blackwell GB202, sm_120",
  "memory_gb_nominal": 96, "memory_gib_visible": 95.59, "memory_visible_note": "97,887 MiB measured on AN-A6000PRO (repo-results)",
  "memory_type": "GDDR7 ECC, 512-bit", "bandwidth_gbs": 1792,
  "fp4_tflops_sparse": 4000, "fp4_tflops_dense": 2000, "fp8_tflops_dense": 1000, "fp8_tflops_sparse": 2000, "fp32_tflops": 125,
  "tensor_note": "NVIDIA lists 4,000 'AI TOPS' = FP4 with 2:4 sparsity; dense = 1/2; FP8 = FP4/2 (derived, not on NVIDIA's page).",
  "power_w": 600, "power_measured_w": "528-592 under the spike's load (repo-estimates Method 4)",
  "price_eur_ttc": 17679.95, "price_source": "LDLC.com OEM, 7-15 days, 2026-10-05 (repo-estimates)", "price_reliability": "high",
  "needs_host_pc": True, "host_note": "studio already owns the host (AN-A6000PRO, Windows 11 + WSL2)", "owned": 1,
  "status": "shipping", "measured_in_spike": True,
  "budget": card_budgets(95.59), "budget_note": "spike ran weights + 58 GiB KV with the GPU exclusive; the farm runs a 50 GiB pool to leave 9 GiB for OCR",
  "sources": ["repo-estimates", "repo-results"]},
 {"id": "rtx-pro-6000-maxq", "name": "RTX PRO 6000 Blackwell Max-Q", "kind": "pcie-card", "arch": "Blackwell GB202, sm_120",
  "memory_gb_nominal": 96, "memory_gib_visible": 95.59, "memory_visible_note": "assumed equal to the WS edition",
  "memory_type": "GDDR7 ECC, 512-bit", "bandwidth_gbs": 1792,
  "fp4_tflops_sparse": 3511, "fp4_tflops_dense": 1755.5, "fp8_tflops_dense": 877.8, "fp8_tflops_sparse": 1755.5, "fp32_tflops": 110,
  "tensor_note": "3,511 AI TOPS (FP4 sparse) per search results citing NVIDIA (medium reliability); dense and FP8 derived.",
  "power_w": 300, "price_eur_ttc": 17709.95, "price_source": "LDLC.com in stock, 2026-10-05 (repo-estimates)", "price_reliability": "high",
  "needs_host_pc": True, "owned": 0, "status": "shipping", "measured_in_spike": False,
  "budget": card_budgets(95.59), "sources": ["repo-estimates"]},
 {"id": "rtx-pro-5500", "name": "RTX PRO 5500 Blackwell", "kind": "pcie-card", "arch": "Blackwell GB202 (170 SMs), sm_120",
  "memory_gb_nominal": 84, "memory_gib_visible": round(84 * 0.99576, 2), "memory_visible_note": "assumed nominal x 0.99576 (the PRO 6000's visible/raw ratio)",
  "memory_type": "GDDR7 ECC, 448-bit inferred (28 x 3 GB); flopper.io prints 416-bit", "bandwidth_gbs": 1398,
  "fp4_tflops_sparse": None, "fp4_tflops_sparse_est": [3350, 3600], "fp4_tflops_dense": None, "fp8_tflops_dense": None,
  "tensor_note": "NVIDIA publishes no TOPS; estimated 3,350-3,600 FP4 sparse from the same 170 SMs as an RTX 5090 (repo-estimates).",
  "power_w": 600, "price_eur_ttc": 16469.95, "price_source": "LDLC.com retail 2026-10-05 (OEM 16,439.95) (repo-estimates)", "price_reliability": "medium (NVIDIA: 'coming soon')",
  "needs_host_pc": True, "owned": 0, "status": "NVIDIA: coming soon (listed ~2026-09-15)", "measured_in_spike": False,
  "budget": card_budgets(84 * 0.99576), "extra": "MIG 1x84 / 2x42 GB", "sources": ["repo-estimates"]},
 {"id": "rtx-pro-5000-72", "name": "RTX PRO 5000 Blackwell 72 GB", "kind": "pcie-card", "arch": "Blackwell GB202 (110 SMs), sm_120",
  "memory_gb_nominal": 72, "memory_gib_visible": round(72 * 0.99576, 2), "memory_visible_note": "assumed",
  "memory_type": "GDDR7 ECC, 384-bit (Scan; flopper.io says 512)", "bandwidth_gbs": 1344,
  "fp4_tflops_sparse": 2064, "fp4_tflops_dense": 1032, "fp8_tflops_dense": 516, "fp8_tflops_sparse": 1032, "fp32_tflops": 65,
  "tensor_note": "2,064 AI TOPS FP4 sparse / 1,032 dense (NVIDIA + flopper.io); FP8 derived.",
  "power_w": 300, "price_eur_ttc": 11193.70, "price_source": "PCComponentes.fr marketplace seller Leasi-fr, in stock, 2026-10-05 (repo-estimates)", "price_reliability": "medium",
  "needs_host_pc": True, "owned": 0, "status": "shipping (thin EU stock)", "measured_in_spike": False,
  "budget": card_budgets(72 * 0.99576), "sources": ["repo-estimates"]},
 {"id": "rtx-pro-5000-48", "name": "RTX PRO 5000 Blackwell 48 GB", "kind": "pcie-card", "arch": "Blackwell GB202 (110 SMs), sm_120",
  "memory_gb_nominal": 48, "memory_gib_visible": round(48 * 0.99576, 2), "memory_visible_note": "assumed",
  "memory_type": "GDDR7 ECC, 384-bit", "bandwidth_gbs": 1344,
  "fp4_tflops_sparse": 2064, "fp4_tflops_dense": 1032, "fp8_tflops_dense": 516, "fp8_tflops_sparse": 1032, "fp32_tflops": 65,
  "power_w": 300, "price_eur_ttc": 9939.95, "price_source": "LDLC.com / Materiel.net 2026-10-05 (repo-estimates)", "price_reliability": "high",
  "needs_host_pc": True, "owned": 0, "status": "shipping", "measured_in_spike": False,
  "budget": card_budgets(48 * 0.99576), "sources": ["repo-estimates"]},
 {"id": "dgx-spark", "name": "DGX Spark (GB10), 1 unit", "kind": "system", "arch": "GB10 Grace Blackwell, sm_121, 20 Arm cores, unified LPDDR5x",
  "memory_gb_nominal": 128, "memory_gib_visible": 121, "memory_visible_note": "121 GiB visible, shared by OS + engine (repo-results)",
  "memory_type": "LPDDR5x unified (coherent), 256-bit", "bandwidth_gbs": 273,
  "fp4_tflops_sparse": 1000, "fp4_tflops_dense": 500, "fp8_tflops_dense": 250, "fp8_tflops_sparse": 500, "bf16_tflops_dense": 125,
  "tensor_note": "NVIDIA: 'up to 1 PFLOP FP4' (the page does not say sparse); community + Igor's Lab: it is 2:4 sparse, so 500 dense FP4 / 250 FP8 / 125 BF16. Measured prefill vs PRO 6000: 0.19-0.22x (repo-results).",
  "power_w": 240, "power_note": "240 W PSU, GB10 TDP 140 W; measured 71 W at 2,464 MHz under the spike's load (repo-results)",
  "price_eur_ttc": 6599.95, "price_source": "LDLC.com PNY Founders, '+15 days', 2026-10-05; OEM GB10 boxes from EUR 5,038 HT (~6,046 TTC, pi3g 2026-09-24); Founders USD 4,699 since 2026-02-23 (repo-estimates)", "price_reliability": "high",
  "needs_host_pc": False, "owned": 2, "owned_note": "the owner received a second Spark (2026-10); a 64 GB OEM-only version exists - make sure units are 128 GB",
  "networking": "ConnectX-7, 200 Gb/s per QSFP port (nv-spark-page)",
  "status": "shipping", "measured_in_spike": True,
  "budget": {"farm_gib": 84, "single_user_max_gib": 110,
             "note": "weights + KV after the engine's own runtime. farm: the spike's 20.4 GiB weights + 58 GiB KV with 25-30 GB spare (a unified-memory OOM latched the GPU at 702 MHz until a cold power drain); single user: ~8-13 GB left to the OS, as in community runs (GLM-5.3-Flash Q2 108.7 GB with 13-14 GB free on one node; Qwen3.5-397B int4 226 GB + a 1.26M-token KV pool across two). Exact OS reserve not measured."},
  "ops_risk": "unified-memory OOM can latch GB10 at ~700 MHz until a full power drain (repo-results; NVIDIA forum threads 376039, 366590, 361294)",
  "sources": ["nv-spark-page", "repo-results", "repo-estimates", "spark-fp4-sparse"]},
 {"id": "dgx-spark-x2", "name": "2 x DGX Spark linked (ConnectX-7 / RoCE)", "kind": "cluster", "members": ["dgx-spark", "dgx-spark"],
  "arch": "2 x GB10, sm_121; one model split across both with tensor parallel (TP=2) over the CX-7 link",
  "memory_gb_nominal": 256, "memory_gib_visible": 242, "bandwidth_gbs": 273, "bandwidth_note": "273 GB/s per node. With TP=2 each node streams half the weights, but measured single-user speed-ups are 1.24-1.4x, not 2x (muninn-flashnext-tp2: 41.7 -> 51.9 tok/s, 'effective weight bandwidth 1.41x'; gpt-oss-120b ~55-60 -> ~75 tok/s).",
  "fp4_tflops_sparse": 2000, "fp4_tflops_dense": 1000, "fp8_tflops_dense": 500,
  "power_w": 480, "power_note": "2 x 240 W PSU",
  "price_eur_ttc": 13279.90, "price_note": "2 x EUR 6,599.95 (LDLC 2026-10-05) + ~EUR 80 cable (estimate from USD 66-159 listings); the studio already owns both units",
  "price_reliability": "medium (cable price estimated)", "needs_host_pc": False, "owned": 1,
  "link": {
    "what_it_is": "NOT NVLink: each Spark's ConnectX-7 NIC, one QSFP/QSFP112 passive copper cable, back to back. NVLink-C2C exists only inside GB10 (CPU<->GPU).",
    "nominal": "200 Gb/s per QSFP port; each port reaches the SoC through two PCIe Gen5 x4 links and shows up as two Linux Ethernet interfaces (nv-spark-stacking); Ethernet only (RoCE for NCCL)",
    "measured": ["RDMA ib_write_bw both rails 98.02 + 98.02 = 196.04 Gb/s; plain TCP iperf3 ~16 Gb/s (nvf-link-throughput, 2026-07-10)",
                 "RoCEv2 185.14 Gb/s aggregate (92.57 per interface pair); decode uses ~0.3% of it (muninn-flashnext-tp2, 2026-09-12)",
                 "nccl-tests all_reduce 39.34 GB/s (single report, nvf-qwen3-235b-rpc, 2025-12-17; exceeds the 25 GB/s line rate, so it is probably busbw on a small/odd config - treat as unverified)"],
    "approved_cables": "Amphenol NJAAKK-N911 (0.4 m) / NJAAKK0006 (0.5 m) per NVIDIA's guide (search snippet of nv-spark-stacking)",
    "max_nodes": "3 direct-cabled, 4 through a switch (NVIDIA Cluster Assistant, nv-spark-stacking)"},
  "nvidia_model_size_claims": {"1x 128GB": "up to 200B parameters", "2x (256 GB)": "up to 400B parameters (launch material: Llama 3.1 405B)", "4x (512 GB)": "up to 700B parameters", "source": "nv-spark-page"},
  "engines": {
    "vllm": "TP=2 documented by NVIDIA (playbook, vllm/vllm-openai:v0.28.0 container); many community runs (Qwen3.5-397B, DeepSeek-V4-Flash, GLM-5.3-Flash, MiniMax M2.7, gpt-oss-120b). Gotchas: NCCL_NET_GDR_LEVEL=0 needed for MiniMax (l1t-minimax-dual), interface binding errors (classmethod), host-RSS growth with prefix caching fixed by a newer image (gh-elsung-dsv4).",
    "sglang": "TP=2 community runs (gpt-oss-120b, GLM-5.3-Flash); needs per-rank SGLANG_HOST_IP etc. Not in NVIDIA's playbooks.",
    "tensorrt_llm": "NVIDIA playbook lists Qwen3-235B-A22B NVFP4 as 'two Sparks only'; NVIDIA measured 11.73 tok/s decode, 23,477 tok/s prefill (BS=1, ISL 2048) in Oct 2025. Community: slowest of the three for gpt-oss-120b at c=32 (62 vs 292-323 tok/s).",
    "llama_cpp": "RPC backend works (TCP, not NCCL; layer split) - 12.5 tok/s on Qwen3-235B Q4_K_XL in Dec 2025.",
    "pipeline_parallel": "NVIDIA documents only TP=2. No measured PP run on two Sparks found. (Not verified.)"},
  "measured_reports_ids": ["nv-blog-spark-perf", "nvf-two-sparks-engines", "muninn-flashnext-tp2", "nvf-q35-397b-dual-a", "nvf-q35-397b-dual-b", "gh-elsung-dsv4", "classmethod-dsv4-2node", "nvf-glm53flash-sglang", "nvf-glm53flash-mtp", "nvf-minimax-two"],
  "budget": {"farm_gib": 168, "single_user_max_gib": 220, "note": "2 x the single-Spark budgets; TP shards weights evenly, KV is split too. Not measured by the studio; the community's Qwen3.5-397B int4 run (210.8 GiB weights + ~19 GB KV) sits right at the single-user edge."},
  "throughput_note": "For a model that fits ONE Spark, two independent copies (one per Spark) give ~2x the people; TP=2 gives ~1.25-1.4x one person's speed. TP=2 is for models that do not fit one Spark.",
  "status": "owner has both units; link not yet set up", "measured_in_spike": False,
  "sources": ["nv-spark-page", "nv-spark-stacking", "nv-playbook-vllm-multinode", "nv-playbook-connect-two", "nv-playbook-trtllm", "nvf-link-throughput", "muninn-flashnext-tp2", "cable-prices"]},
 {"id": "rtx-5090", "name": "GeForce RTX 5090 (single-person reference)", "kind": "pcie-card", "arch": "Blackwell GB202 (170 SMs), sm_120",
  "memory_gb_nominal": 32, "memory_gib_visible": round(32 * 0.99576, 2), "memory_visible_note": "assumed",
  "memory_type": "GDDR7, 512-bit", "bandwidth_gbs": 1792, "bandwidth_note": "28 Gbps x 512 bit / 8 (derived; NVIDIA's page lists bus width, not GB/s)",
  "fp4_tflops_sparse": 3352, "fp4_tflops_dense": 1676, "fp8_tflops_dense": 838, "fp8_tflops_sparse": 1676,
  "tensor_note": "3,352 AI TOPS = FP4 sparse; dense and FP8 derived; GeForce may run FP8 with FP32 accumulate at half rate (not verified).",
  "power_w": 575, "price_eur_ttc": 6999.95, "price_source": "LDLC.com cheapest in stock (Gainward Phantom GS), 2026-10-07; listed range 6,599.95-8,499.95, mostly out of stock", "price_reliability": "high (volatile)",
  "needs_host_pc": True, "owned": 0, "status": "shipping, scarce", "measured_in_spike": False,
  "budget": {"single_user_max_gib": round(0.95 * 32 * 0.99576 - 1.66 - 3.7, 1), "farm_no_ocr_gib": round(0.92 * 32 * 0.99576 - 1.66 - 3.7, 1)},
  "sources": ["nv-rtx5090", "ldlc-5090"]},
 {"id": "rtx-4080", "name": "GeForce RTX 4080 16 GB (studio fleet, booked for 3D/VR; single-person reference)", "kind": "pcie-card", "arch": "Ada AD103, sm_89 (no FP4)",
  "memory_gb_nominal": 16, "memory_gib_visible": round(16 * 0.99576, 2), "memory_type": "GDDR6X, 256-bit", "bandwidth_gbs": 716.8,
  "bandwidth_note": "22.4 Gbps x 256 / 8 (derived); 4080 SUPER: 836 AI TOPS, 736 GB/s",
  "fp4_tflops_sparse": None, "fp4_tflops_dense": None, "fp8_tflops_sparse": 780, "fp8_tflops_dense": 390,
  "tensor_note": "780 AI TOPS = FP8 with sparsity (Ada); no FP4 tensor cores, NVFP4 only via weight-only kernels (not verified on this card).",
  "power_w": 320, "price_eur_ttc": None, "price_note": "owned; not for sale or purchase", "needs_host_pc": True, "owned": "most of the fleet (plan s9.2)",
  "status": "owned, booked for 3D/VR", "measured_in_spike": False,
  "budget": {"single_user_max_gib": round(0.95 * 16 * 0.99576 - 1.66 - 1.5, 1), "note": "llama.cpp/Ollama runtime assumed ~1.5 GiB; Windows desktop 1.66 GiB"},
  "sources": ["nv-rtx4080", "repo-plan-s9"]},
 {"id": "rtx-4070", "name": "GeForce RTX 4070 12 GB (studio, booked for 3D/VR; single-person reference)", "kind": "pcie-card", "arch": "Ada AD104, sm_89 (no FP4)",
  "memory_gb_nominal": 12, "memory_gib_visible": round(12 * 0.99576, 2), "memory_type": "GDDR6X (GDDR6 variant exists), 192-bit", "bandwidth_gbs": 504,
  "bandwidth_note": "21 Gbps x 192 / 8 (derived); the GDDR6 variant is 480 GB/s",
  "fp4_tflops_sparse": None, "fp4_tflops_dense": None, "fp8_tflops_sparse": 466, "fp8_tflops_dense": 233,
  "power_w": 200, "price_eur_ttc": None, "price_note": "owned", "needs_host_pc": True, "owned": "yes (count not given)",
  "status": "owned, booked for 3D/VR", "measured_in_spike": False,
  "budget": {"single_user_max_gib": round(0.95 * 12 * 0.99576 - 1.66 - 1.5, 1)},
  "sources": ["nv-rtx4070"]},
]

# ---------------------------------------------------------------- models
def kv_gqa(layers, kv_heads, k_dim, v_dim=None):
    return layers * kv_heads * (k_dim + (v_dim if v_dim is not None else k_dim))   # bytes/token at 1 byte/element (fp8)

def gdn_state(layers, v_heads, k_dim, v_dim, k_heads, conv=4):
    rec = v_heads * k_dim * v_dim * 4                       # fp32 recurrent state
    convb = (conv - 1) * (2 * k_heads * k_dim + v_heads * v_dim) * 2   # bf16 conv state
    return layers * (rec + convb)

def mamba2_state(layers, heads, head_dim, d_state, n_groups, conv=4):
    rec = heads * head_dim * d_state * 4
    convb = (conv - 1) * (heads * head_dim + 2 * n_groups * d_state) * 2
    return layers * (rec + convb)

def kda_state(layers, heads, head_dim, conv=4):
    rec = heads * head_dim * head_dim * 4
    convb = (conv - 1) * (3 * heads * head_dim) * 2
    return layers * (rec + convb)

def ck(fmt, repo, gb=None, **kw):
    d = {"format": fmt, "repo": repo, "disk_gb": gb}
    d.update(kw)
    if gb: d["disk_gib"] = round(gb * 1e9 / GiB, 2)
    return d

def q(bench, score, src, vendor=True, note=None):
    d = {"benchmark": bench, "score": score, "source": src, "vendor_reported": vendor}
    if note: d["note"] = note
    return d

MODELS = []
def M(**kw): MODELS.append(kw)

# ---- the three measured models
M(id="qwen3.6-35b-a3b", name="Qwen3.6-35B-A3B", vendor="Alibaba Qwen", released="2026-04-15", role="measured (farm default candidate)",
  params_total_b=35.95, params_active_b=3.0, params_note="35B total / 3B active (card); 35.95B in safetensors incl. vision + MTP",
  arch={"type": "MoE (256 experts, 8 routed + 1 shared)", "layers": 40, "attention": "hybrid: 30 Gated DeltaNet (linear) + 10 full gated-attention layers (every 4th)",
        "full_attn_layers": 10, "kv_heads": 2, "head_dim": 256, "linear": {"kind": "Gated DeltaNet", "layers": 30, "v_heads": 32, "qk_heads": 16, "head_dim": 128}},
  kv_bytes_per_token_fp8=kv_gqa(10, 2, 256), kv_calc="10 layers x 2 KV heads x (256+256) x 1 B = 10,240 B (matches vLLM's 21,463,040 B per 2,096-token page)",
  recurrent_state_bytes=gdn_state(30, 32, 128, 128, 16), recurrent_state_calc="30 x (32x128x128x4 B fp32 + 3x8192x2 B conv) = 64.4 MB",
  vllm_state_charge_bytes=6 * 21463040, vllm_state_charge_note="MEASURED: vLLM 0.30 align mode charges 6 pages = 128.8 MB per request (2 x raw state, rounded to pages)",
  kv_confidence="exact (verified against vLLM start-up lines)",
  context_native=262144, context_max=1010000, context_note="YaRN to 1,010,000; Qwen advises >= 128K to keep thinking quality",
  vision=True, tools=True, thinking_toggle=True, license="Apache-2.0",
  checkpoints=[ck("NVFP4 (experts W4A16 via Marlin on sm_120/121)", "nvidia/Qwen3.6-35B-A3B-NVFP4", st_gb("nvidia/Qwen3.6-35B-A3B-NVFP4"), loaded_gib_measured=20.37),
               ck("FP8", "Qwen/Qwen3.6-35B-A3B-FP8", st_gb("Qwen/Qwen3.6-35B-A3B-FP8")),
               ck("AWQ 4-bit", "cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit", st_gb("cyankiwi/Qwen3.6-35B-A3B-AWQ-4bit")),
               ck("GGUF UD-Q4_K_XL", "unsloth/Qwen3.6-35B-A3B-GGUF", gguf_gb("unsloth/Qwen3.6-35B-A3B-GGUF", "UD-Q4_K_XL")),
               ck("GGUF Q8_0", "unsloth/Qwen3.6-35B-A3B-GGUF", gguf_gb("unsloth/Qwen3.6-35B-A3B-GGUF", "Q8_0")),
               ck("BF16", "Qwen/Qwen3.6-35B-A3B", st_gb("Qwen/Qwen3.6-35B-A3B"))],
  engines={"vllm_sm120": "MEASURED vLLM 0.30.0 (PRO 6000)", "vllm_sm121": "MEASURED vLLM 0.30.0 (Spark), --moe-backend marlin per NVIDIA's Spark recipe",
           "llama_cpp": "mainline GGUF (unsloth, ggml-org); not measured (no GGUF on the box)", "sglang": "yes (card)"},
  quality=[q("SWE-bench Verified", 73.4, card("Qwen/Qwen3.6-35B-A3B")), q("SWE-bench Pro", 49.5, card("Qwen/Qwen3.6-35B-A3B")),
           q("Terminal-Bench 2.0", 51.5, card("Qwen/Qwen3.6-35B-A3B")), q("GPQA Diamond", 86.0, card("Qwen/Qwen3.6-35B-A3B")),
           q("LiveCodeBench v6", 80.4, card("Qwen/Qwen3.6-35B-A3B")), q("AIME26", 92.7, card("Qwen/Qwen3.6-35B-A3B")),
           q("SWE-bench Verified", 70.12, card("nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16"), vendor=False, note="NVIDIA's run (competitor's card)"),
           q("GPQA Diamond", 83.40, card("nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16"), vendor=False, note="NVIDIA's run")],
  spike_quality={"gate": "28-item smoke gate (10 code, 7 exact, 11 tool round-trips)", "pro6000_think_on_off": "27/28 (77k tok) / 28/28 (12k)", "spark_think_on_off": "27/28 (89k) / 26/28 (12k)", "source": "repo-results"},
  aggregate_index={"benchlm_open": 43.4, "rank": 42, "source": "benchlm-open"})

M(id="nemotron-3.5-lightning-30b-a3b", name="NVIDIA Nemotron 3.5 Lightning 30B-A3B", vendor="NVIDIA", released="2026-08 (card 2026-08-01; NVFP4 2026-08-04)", role="measured (head-count model, no vision)",
  params_total_b=31.58, params_active_b=3.0, params_note="30B (3B active) per card; 31.58B in safetensors incl. MTP",
  arch={"type": "MoE (128 experts, 6 routed + 1 shared)", "layers": 52, "attention": "hybrid: 23 Mamba-2 + 23 MoE + 6 attention layers",
        "full_attn_layers": 6, "kv_heads": 2, "head_dim": 128, "linear": {"kind": "Mamba-2", "layers": 23, "heads": 64, "head_dim": 64, "d_state": 128, "n_groups": 8}},
  kv_bytes_per_token_fp8=kv_gqa(6, 2, 128), kv_calc="6 x 2 x (128+128) x 1 B = 3,072 B (vLLM page 4,176 tok x 6 x 512 B)",
  recurrent_state_bytes=mamba2_state(23, 64, 64, 128, 8), recurrent_state_calc="23 x (64x64x128x4 B + 3x6144x2 B) = 49.1 MB",
  vllm_state_charge_bytes=8 * 12828672, vllm_state_charge_note="MEASURED: 8 pages = 102.6 MB per request in vLLM 0.30 align mode",
  kv_confidence="exact (verified against vLLM start-up lines)",
  context_native=262144, context_max=1000000, context_note="card: 1M input; config max_position_embeddings 262,144; validated 1M on GB10 per the NVFP4 card",
  vision=False, tools=True, thinking_toggle=True, license="OpenMDW-1.1 (NVIDIA open model)",
  checkpoints=[ck("NVFP4 (W4A16 via Marlin on GB10, per card)", "nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4", st_gb("nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4"), loaded_gib_measured=17.82),
               ck("FP8", "RedHatAI/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-FP8", st_gb("RedHatAI/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-FP8")),
               ck("W4A16", "useful-quants/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-W4A16", st_gb("useful-quants/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-W4A16")),
               ck("GGUF UD-Q4_K_XL", "unsloth/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF", gguf_gb("unsloth/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-GGUF", "UD-Q4_K_XL"), note="spike used the Q4_K_M already in Ollama"),
               ck("BF16", "nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16", st_gb("nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-BF16"))],
  engines={"vllm_sm120": "MEASURED vLLM 0.30.0", "vllm_sm121": "MEASURED vLLM 0.30.0", "llama_cpp": "MEASURED b10670 (Q4_K_M) on both boxes", "sglang": "yes (card)",
           "card_hardware_matrix": "GB10: NVFP4 stored, W4A16 compute via Marlin, 'No' native FP4 path, 1M validated; RTX 5090: 'confirm'"},
  quality=[q("SWE-bench Verified", 52.80, card("nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4"), note="NVFP4 column; BF16 51.56"),
           q("GPQA Diamond (no tools)", 75.57, card("nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4")),
           q("Terminal-Bench 2.1", 23.46, card("nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4")),
           q("MMLU-Pro", 81.62, card("nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4")),
           q("IFBench (loose)", 72.88, card("nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4"))],
  spike_quality={"pro6000_think_on_off": "25/28 (68k) / 26/28 (7k)", "spark_think_on_off": "26/28 (61k) / 27/28 (7k)", "llamacpp": "26/28 (65k)", "source": "repo-results"},
  aggregate_index={"benchlm_open": 20.8, "rank": 90, "source": "benchlm-open", "note": "looks like sparse coverage, not a quality verdict"})

M(id="qwen3.8-27b", name="Qwen3.8-27B (dense)", vendor="Alibaba Qwen", released="2026-08-05", role="measured (quality model; dense = slow on Spark)",
  params_total_b=27.78, params_active_b=27.0, params_note="dense 27B; 27.78B in safetensors incl. vision + MTP",
  arch={"type": "dense", "layers": 64, "attention": "hybrid: 48 Gated DeltaNet + 16 full gated-attention layers", "full_attn_layers": 16, "kv_heads": 4, "head_dim": 256,
        "linear": {"kind": "Gated DeltaNet", "layers": 48, "v_heads": 48, "qk_heads": 16, "head_dim": 128}},
  kv_bytes_per_token_fp8=kv_gqa(16, 4, 256), kv_calc="16 x 4 x 512 x 1 B = 32,768 B",
  recurrent_state_bytes=gdn_state(48, 48, 128, 128, 16), recurrent_state_calc="48 x (48x128x128x4 + 3x10240x2) = 153.9 MB",
  vllm_state_charge_bytes=6 * 1568 * 32768, vllm_state_charge_note="derived from RESULTS (26 pages per 30k conversation = 20 + 6; 1,568-token pages): 6 pages = 308 MB",
  kv_confidence="exact for KV; state charge derived",
  context_native=262144, context_max=1000000, vision=True, tools=True, thinking_toggle=True, license="Apache-2.0",
  checkpoints=[ck("NVFP4 W4A4 (native FP4 GEMM on sm_120)", "nvidia/Qwen3.8-27B-NVFP4", st_gb("nvidia/Qwen3.8-27B-NVFP4"), loaded_gib_measured=19.92),
               ck("FP8", "Qwen/Qwen3.8-27B-FP8", st_gb("Qwen/Qwen3.8-27B-FP8")),
               ck("AWQ INT4", "cyankiwi/Qwen3.8-27B-AWQ-INT4", st_gb("cyankiwi/Qwen3.8-27B-AWQ-INT4")),
               ck("GGUF UD-Q4_K_XL", "unsloth/Qwen3.8-27B-GGUF", gguf_gb("unsloth/Qwen3.8-27B-GGUF", "UD-Q4_K_XL")),
               ck("GGUF UD-Q4_K_M", "unsloth/Qwen3.8-27B-GGUF", gguf_gb("unsloth/Qwen3.8-27B-GGUF", "UD-Q4_K_M")),
               ck("BF16", "Qwen/Qwen3.8-27B", st_gb("Qwen/Qwen3.8-27B"))],
  engines={"vllm_sm120": "MEASURED vLLM 0.30.0 (native FP4 GEMM)", "vllm_sm121": "MEASURED (12.1 tok/s alone; MAX_JOBS=4 for FlashInfer JIT)", "llama_cpp": "MEASURED b10670 Q4_K_M (cache_reuse unsupported)", "sglang": "yes (card)", "tokenspeed": "yes (card)"},
  quality=[q("Terminal-Bench 2.1", 73.0, card("Qwen/Qwen3.8-27B")), q("SWE-bench Pro", 61.7, card("Qwen/Qwen3.8-27B")),
           q("GPQA Diamond", 89.2, card("Qwen/Qwen3.8-27B")), q("LiveCodeBench v6", 90.3, card("Qwen/Qwen3.8-27B")), q("HLE", 30.8, card("Qwen/Qwen3.8-27B"))],
  spike_quality={"pro6000_think_on_off": "26/28 (55k) / 28/28 (11k)", "spark_think_on_off": "26/28 (24k) / 28/28 (11k)", "source": "repo-results"},
  aggregate_index={"benchlm_open": 58.3, "rank": 13, "source": "benchlm-open"})

# ---- near-frontier models a 1-2 Spark (or one PRO 6000) setup could run
M(id="gpt-oss-120b", name="gpt-oss-120b", vendor="OpenAI", released="2025-08-05", role="fits 1 Spark / 1 PRO 6000",
  params_total_b=116.83, params_active_b=5.1, params_note="117B total / 5.1B active (OpenAI)",
  arch={"type": "MoE (128 experts, 4 active)", "layers": 36, "attention": "alternating: 18 full + 18 sliding-window (128 tokens), attention sinks", "full_attn_layers": 18, "kv_heads": 8, "head_dim": 64, "sliding_window": 128},
  kv_bytes_per_token_fp8=kv_gqa(18, 8, 64), kv_calc="18 full layers x 8 x 128 x 1 B = 18,432 B (bf16: 36,864); plus 18 SWA layers x 8 x 128 x 128 window",
  kv_constant_bytes_per_request=18 * 8 * 128 * 128, kv_confidence="exact from config; fp8 KV support for this model on sm_120/121 not verified (many deployments use bf16 KV)",
  recurrent_state_bytes=0, context_native=131072, context_max=131072, vision=False, tools=True, thinking_toggle="reasoning effort low/medium/high", license="Apache-2.0",
  checkpoints=[ck("MXFP4 (native release)", "openai/gpt-oss-120b", 65.25, note="repo also holds an 'original/' copy (65.25 GB)"),
               ck("GGUF MXFP4", "ggml-org/gpt-oss-120b-GGUF", gguf_gb("ggml-org/gpt-oss-120b-GGUF", "gpt-oss-120b-MXFP4"))],
  engines={"vllm_sm121": "community: yes (1 and 2 Sparks)", "llama_cpp": "mainline; NVIDIA measured on GB10", "sglang": "community on 2 Sparks", "tensorrt_llm": "community on 2 Sparks (slow)"},
  quality=[q("GPQA Diamond (no tools)", 80.1, "openai-gptoss-card"), q("AIME 2025 (with tools)", 97.9, "openai-gptoss-card"),
           q("SWE-bench Verified", 62.4, "openai-gptoss-card"), q("AIME 2025 (no tools)", 92.5, card("nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16"), vendor=False, note="as quoted in NVIDIA's table"),
           q("LiveCodeBench v6", 82.7, card("Qwen/Qwen3.5-122B-A10B"), vendor=False, note="Qwen's run"), q("Terminal-Bench 2", 18.7, card("Qwen/Qwen3.5-122B-A10B"), vendor=False, note="Qwen's run")],
  reported_runs=[
    {"hardware": "dgx-spark", "engine": "llama.cpp", "quant": "MXFP4", "users": 1, "decode_tok_s": 55.37, "prefill_tok_s": 1725.47, "note": "ISL 2048 / OSL 128", "date": "2025-10-24", "source": "nv-blog-spark-perf"},
    {"hardware": "dgx-spark", "engine": "vLLM", "quant": "MXFP4", "users": 1, "decode_tok_s": 60.4, "note": "plan s9.1; also 141.9 agg at 8, 160.5 at 10, 181.2 at 16", "date": "2026", "source": "repo-plan-s9"},
    {"hardware": "dgx-spark-x2", "engine": "vLLM TP=2", "quant": "MXFP4", "users": 1, "decode_tok_s": 75, "date": "2025-12", "source": "nvf-two-sparks-engines"},
    {"hardware": "dgx-spark-x2", "engine": "SGLang TP=2", "quant": "MXFP4", "users": 32, "aggregate_tok_s": 323.21, "note": "vLLM 292.46, TRT-LLM 62.13 at the same c=32", "date": "2025-12", "source": "nvf-two-sparks-engines"}],
  aggregate_index={"benchlm_open": 37.3, "rank": 52, "source": "benchlm-open"})

M(id="qwen3.5-122b-a10b", name="Qwen3.5-122B-A10B", vendor="Alibaba Qwen", released="2026-02-24", role="fits 1 Spark (NVFP4 83.5 GB) / tight on 1 PRO 6000",
  params_total_b=125.09, params_active_b=10.0, arch={"type": "MoE (256 experts, 8 routed + 1 shared)", "layers": 48, "attention": "hybrid: 36 Gated DeltaNet + 12 full", "full_attn_layers": 12, "kv_heads": 2, "head_dim": 256,
       "linear": {"kind": "Gated DeltaNet", "layers": 36, "v_heads": 64, "qk_heads": 16, "head_dim": 128}},
  kv_bytes_per_token_fp8=kv_gqa(12, 2, 256), kv_calc="12 x 2 x 512 = 12,288 B", recurrent_state_bytes=gdn_state(36, 64, 128, 128, 16), recurrent_state_calc="36 x (64x128x128x4 + 3x12288x2) = 153.6 MB",
  kv_confidence="exact from config (same family as Qwen3.6)", context_native=262144, context_max=1010000, vision=True, tools=True, thinking_toggle=True, license="Apache-2.0",
  checkpoints=[ck("NVFP4", "nvidia/Qwen3.5-122B-A10B-NVFP4", st_gb("nvidia/Qwen3.5-122B-A10B-NVFP4")), ck("GPTQ-Int4", "Qwen/Qwen3.5-122B-A10B-GPTQ-Int4", st_gb("Qwen/Qwen3.5-122B-A10B-GPTQ-Int4")),
               ck("FP8", "Qwen/Qwen3.5-122B-A10B-FP8", st_gb("Qwen/Qwen3.5-122B-A10B-FP8")), ck("GGUF UD-Q4_K_XL", "unsloth/Qwen3.5-122B-A10B-GGUF", gguf_gb("unsloth/Qwen3.5-122B-A10B-GGUF", "UD-Q4_K_XL")),
               ck("BF16", "Qwen/Qwen3.5-122B-A10B", st_gb("Qwen/Qwen3.5-122B-A10B"))],
  engines={"vllm_sm121": "community: yes (patched; up to ~51 tok/s with MTP)", "llama_cpp": "mainline GGUF", "sglang": "yes (card)"},
  quality=[q("SWE-bench Verified", 72.0, card("Qwen/Qwen3.5-122B-A10B")), q("Terminal Bench 2", 49.4, card("Qwen/Qwen3.5-122B-A10B")),
           q("GPQA Diamond", 86.6, card("Qwen/Qwen3.5-122B-A10B")), q("LiveCodeBench v6", 78.9, card("Qwen/Qwen3.5-122B-A10B"))],
  reported_runs=[{"hardware": "dgx-spark", "engine": "vLLM (patched) + MTP", "quant": "NVFP4/INT4 hybrids", "users": 1, "decode_tok_s": [30, 51], "note": "~30 plain, up to 51 with patches + MTP-2 (search snippets of the thread)", "date": "2026 spring", "source": "nvf-q35-122b-1spark"}],
  aggregate_index={"benchlm_open": 40.6, "rank": 48, "source": "benchlm-open"})

M(id="nemotron-3-super-120b-a12b", name="NVIDIA Nemotron 3 Super 120B-A12B", vendor="NVIDIA", released="2026-03-10", role="fits 1 Spark / 1 PRO 6000 (NVFP4 80 GB)",
  params_total_b=123.61, params_active_b=12.0, arch={"type": "MoE (512 experts, 22 routed + 1 shared, latent MoE)", "layers": 88, "attention": "hybrid: 40 Mamba-2 + 40 MoE + 8 attention", "full_attn_layers": 8, "kv_heads": 2, "head_dim": 128,
       "linear": {"kind": "Mamba-2", "layers": 40, "heads": 128, "head_dim": 64, "d_state": 128, "n_groups": 8}},
  kv_bytes_per_token_fp8=kv_gqa(8, 2, 128), kv_calc="8 x 2 x 256 = 4,096 B", recurrent_state_bytes=mamba2_state(40, 128, 64, 128, 8), recurrent_state_calc="40 x (128x64x128x4 + 3x10240x2) = 170.2 MB",
  kv_confidence="exact from config", context_native=262144, context_max=1000000, context_note="card: 1M", vision=False, tools=True, thinking_toggle=True, license="NVIDIA Nemotron Open Model License",
  checkpoints=[ck("NVFP4", "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4", st_gb("nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4")), ck("FP8", "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8", st_gb("nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-FP8")),
               ck("GGUF UD-Q4_K_XL", "unsloth/NVIDIA-Nemotron-3-Super-120B-A12B-GGUF", gguf_gb("unsloth/NVIDIA-Nemotron-3-Super-120B-A12B-GGUF", "UD-Q4_K_XL")), ck("BF16", "nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16", st_gb("nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16"))],
  engines={"vllm_sm121": "yes - vLLM's own Spark blog benchmarks it", "llama_cpp": "mainline GGUF", "sglang": "yes (card)"},
  quality=[q("SWE-bench (OpenHands)", 60.47, card("nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16")), q("Terminal Bench Core 2.0", 31.00, card("nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16")),
           q("GPQA (no tools)", 79.23, card("nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16")), q("LiveCodeBench v5", 81.19, card("nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16")), q("AIME25 (no tools)", 90.21, card("nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-BF16"))],
  reported_runs=[{"hardware": "dgx-spark", "engine": "vLLM cu130-nightly", "quant": "NVFP4", "users": 1, "decode_tok_s": [22.7, 23.7], "prefill_tok_s": [140, 1900], "note": "TTFT 0.42 s (58 tok) to 3.85 s (7,234 tok)", "date": "2026-06-01", "source": "vllm-blog-spark"},
                 {"hardware": "dgx-spark", "engine": "various", "quant": "NVFP4", "users": 1, "decode_tok_s": [14.8, 23.45], "note": "plan s9.1: recipe caps max-num-seqs 4; 'avoid on Spark'", "source": "repo-plan-s9"}],
  aggregate_index={"benchlm_open": None, "note": "not listed", "source": "benchlm-open"})

M(id="qwen3.8-flash-next", name="Qwen3.8-Flash-Next (Qwen4 architecture preview)", vendor="Alibaba Qwen", released="2026-08-24", role="1 Spark only with n-gram table offload; 2 Sparks comfortably",
  params_total_b=180.0, params_active_b=6.0, params_note="125B backbone with 6B activated, plus 51B n-gram embedding (offloadable) and 4B MTP (card)",
  arch={"type": "MoE (512 experts, 10 routed + 1 shared) + n-gram embedding", "layers": 48, "attention": "hybrid: 36 Gated DeltaNet + 12 Qwen Sparse Attention (block-sparse, budget 2,048 tokens)",
        "full_attn_layers": 12, "kv_heads": 2, "head_dim": 256, "indexer": "MQA, 4 query heads + 1 shared key head, dim 128", "linear": {"kind": "Gated DeltaNet", "layers": 36, "v_heads": 48, "qk_heads": 16, "head_dim": 128}},
  kv_bytes_per_token_fp8=kv_gqa(12, 2, 256) + 12 * 128, kv_calc="12 x 2 x 512 = 12,288 B + indexer keys 12 x 128 = 1,536 B (indexer dtype assumed 1 B) = ~13.8 KB",
  recurrent_state_bytes=gdn_state(36, 48, 128, 128, 16), recurrent_state_calc="36 x (48x128x128x4 + 3x10240x2) = 115.5 MB", kv_confidence="approx (indexer cache layout not verified)",
  context_native=262144, context_max=1000000, vision=True, tools=True, thinking_toggle=True, license="Qwen Community License 1.0 (not Apache)",
  checkpoints=[ck("NVFP4 (routed experts W4A4; attention + shared experts BF16; n-gram FP8)", "nvidia/Qwen3.8-Flash-Next-NVFP4", st_gb("nvidia/Qwen3.8-Flash-Next-NVFP4"), note="needs a recent vLLM commit; plan s9.1: n-gram table on NVMe + patched vLLM to fit one Spark"),
               ck("NVFP4, n-gram table offloaded to NVMe (patched vLLM)", "nvidia/Qwen3.8-Flash-Next-NVFP4", st_gb("nvidia/Qwen3.8-Flash-Next-NVFP4"),
                  resident_gib_est=round((132.68 - 51.0) * 1e9 / GiB, 1), note="ESTIMATE: resident = file minus the 51B FP8 n-gram embedding (~51 GB); plan s9.1 records this setup on one Spark"),
               ck("FP8", "Qwen/Qwen3.8-Flash-Next-FP8", st_gb("Qwen/Qwen3.8-Flash-Next-FP8")),
               ck("GGUF UD-Q4_K_XL", "unsloth/Qwen3.8-Flash-Next-GGUF", gguf_gb("unsloth/Qwen3.8-Flash-Next-GGUF", "UD-Q4_K_XL")),
               ck("GGUF UD-Q3_K_XL", "unsloth/Qwen3.8-Flash-Next-GGUF", gguf_gb("unsloth/Qwen3.8-Flash-Next-GGUF", "UD-Q3_K_XL")),
               ck("BF16", "Qwen/Qwen3.8-Flash-Next", st_gb("Qwen/Qwen3.8-Flash-Next"))],
  engines={"vllm_sm121": "community: yes (1 Spark patched; TP=2 on 2 Sparks)", "llama_cpp": "GGUF exists (unsloth, ggml-org forks?) - mainline support not verified", "sglang": "yes (card)", "tokenspeed": "yes (card)"},
  quality=[q("SWE-bench Pro", 62.5, card("Qwen/Qwen3.8-Flash-Next")), q("DeepSWE 1.1", 58.7, card("Qwen/Qwen3.8-Flash-Next")), q("GPQA Diamond", 91.7, card("Qwen/Qwen3.8-Flash-Next")),
           q("LiveCodeBench v6", 91.9, card("Qwen/Qwen3.8-Flash-Next")), q("HLE", 35.9, card("Qwen/Qwen3.8-Flash-Next"))],
  reported_runs=[{"hardware": "dgx-spark", "engine": "vLLM (patched)", "quant": "NVFP4", "users": 1, "decode_tok_s": 41.7, "note": "median; 47-100 agg at 4; 32k prefill TTFT 17.3 s (plan s9.1)", "date": "2026-09", "source": "muninn-flashnext-tp2"},
                 {"hardware": "dgx-spark-x2", "engine": "vLLM TP=2", "quant": "NVFP4 (242 GiB total across both nodes)", "users": 1, "decode_tok_s": 51.9, "ttft_s": 0.17, "kv_pool_tokens": 2128927, "note": "runs 56.6/51.7/51.9; a later post reaches 72.0 (muninn-index)", "date": "2026-09-12", "source": "muninn-flashnext-tp2"}],
  aggregate_index={"benchlm_open": 64.1, "rank": 6, "source": "benchlm-open"})

M(id="qwen3.5-397b-a17b", name="Qwen3.5-397B-A17B", vendor="Alibaba Qwen", released="2026-02-16", role="2 Sparks only (int4 ~226-236 GB, tight)",
  params_total_b=403.4, params_active_b=17.0, arch={"type": "MoE (512 experts, 10 routed + 1 shared)", "layers": 60, "attention": "hybrid: 45 Gated DeltaNet + 15 full", "full_attn_layers": 15, "kv_heads": 2, "head_dim": 256,
       "linear": {"kind": "Gated DeltaNet", "layers": 45, "v_heads": 64, "qk_heads": 16, "head_dim": 128}},
  kv_bytes_per_token_fp8=kv_gqa(15, 2, 256), kv_calc="15 x 2 x 512 = 15,360 B", recurrent_state_bytes=gdn_state(45, 64, 128, 128, 16), recurrent_state_calc="45 x 4.27 MB = 192.1 MB",
  kv_confidence="exact from config", context_native=262144, context_max=1010000, vision=True, tools=True, thinking_toggle=True, license="Apache-2.0",
  checkpoints=[ck("int4 AutoRound", "Intel/Qwen3.5-397B-A17B-int4-AutoRound", st_gb("Intel/Qwen3.5-397B-A17B-int4-AutoRound"), note="the checkpoint used on 2 Sparks"),
               ck("GPTQ-Int4", "Qwen/Qwen3.5-397B-A17B-GPTQ-Int4", st_gb("Qwen/Qwen3.5-397B-A17B-GPTQ-Int4")), ck("NVFP4", "nvidia/Qwen3.5-397B-A17B-NVFP4", st_gb("nvidia/Qwen3.5-397B-A17B-NVFP4")),
               ck("GGUF UD-Q3_K_XL", "unsloth/Qwen3.5-397B-A17B-GGUF", gguf_gb("unsloth/Qwen3.5-397B-A17B-GGUF", "UD-Q3_K_XL")), ck("GGUF UD-IQ2_XXS", "unsloth/Qwen3.5-397B-A17B-GGUF", gguf_gb("unsloth/Qwen3.5-397B-A17B-GGUF", "UD-IQ2_XXS")),
               ck("FP8", "Qwen/Qwen3.5-397B-A17B-FP8", st_gb("Qwen/Qwen3.5-397B-A17B-FP8"))],
  engines={"vllm_sm121": "community: yes, TP=2 on 2 Sparks (patches needed early 2026; vLLM 0.24 by July)", "llama_cpp": "mainline GGUF", "sglang": "yes (card)"},
  quality=[q("SWE-bench Verified", 76.4, card("Qwen/Qwen3.5-397B-A17B")), q("Terminal Bench 2", 52.5, card("Qwen/Qwen3.5-397B-A17B")), q("GPQA", 88.4, card("Qwen/Qwen3.5-397B-A17B")),
           q("LiveCodeBench v6", 83.6, card("Qwen/Qwen3.5-397B-A17B")), q("AIME26", 91.3, card("Qwen/Qwen3.5-397B-A17B"))],
  reported_runs=[{"hardware": "dgx-spark-x2", "engine": "vLLM TP=2", "quant": "int4-AutoRound", "users": 1, "decode_tok_s": [26, 30], "aggregate_tok_s_2_3_users": [42, 46], "date": "2026-03", "source": "nvf-q35-397b-dual-a"},
                 {"hardware": "dgx-spark-x2", "engine": "vLLM 0.24 TP=2 + KVarN KV quant", "quant": "int4-AutoRound", "users": 1, "decode_tok_s": 30.82, "prefill_tok_s": 1114.85, "ttft_s_2k": 1.66, "kv_pool_tokens": 1258492,
                  "note": "decode 14.16 tok/s at 524k context, 10.56 at 900k", "date": "2026-07-03", "source": "nvf-q35-397b-dual-b"}],
  aggregate_index={"benchlm_open": 53.7, "rank": 18, "source": "benchlm-open"})

M(id="minimax-m2.7", name="MiniMax-M2.7", vendor="MiniMax", released="2026-04-09", role="2 Sparks (NVFP4 140 GB / AWQ 130 GB); 1 Spark only at ~3-bit GGUF",
  params_total_b=228.69, params_active_b=10.0, params_note="~229B / 10B active",
  arch={"type": "MoE (256 experts, 8 active)", "layers": 62, "attention": "full GQA attention on every layer (no hybrid)", "full_attn_layers": 62, "kv_heads": 8, "head_dim": 128},
  kv_bytes_per_token_fp8=kv_gqa(62, 8, 128), kv_calc="62 x 8 x 256 = 126,976 B (~4.2 GB per person at 32k)", recurrent_state_bytes=0, kv_confidence="exact from config",
  context_native=204800, context_max=204800, vision=False, tools=True, thinking_toggle="always thinks (interleaved)", license="MiniMax custom licence ('other'; check LICENSE)",
  checkpoints=[ck("FP8 (native)", "MiniMaxAI/MiniMax-M2.7", st_gb("MiniMaxAI/MiniMax-M2.7")), ck("NVFP4 (SGLang)", "nvidia/MiniMax-M2.7-NVFP4", st_gb("nvidia/MiniMax-M2.7-NVFP4")),
               ck("AWQ 4-bit", "cyankiwi/MiniMax-M2.7-AWQ-4bit", st_gb("cyankiwi/MiniMax-M2.7-AWQ-4bit")), ck("GGUF UD-Q4_K_XL", "unsloth/MiniMax-M2.7-GGUF", gguf_gb("unsloth/MiniMax-M2.7-GGUF", "UD-Q4_K_XL")),
               ck("GGUF UD-Q3_K_XL", "unsloth/MiniMax-M2.7-GGUF", gguf_gb("unsloth/MiniMax-M2.7-GGUF", "UD-Q3_K_XL"))],
  engines={"vllm_sm121": "community: TP=2 works with NCCL_NET_GDR_LEVEL=0; lockups otherwise", "llama_cpp": "mainline GGUF", "sglang": "yes (card; NVIDIA's NVFP4 targets SGLang)"},
  quality=[q("SWE-bench Pro", 56.22, card("MiniMaxAI/MiniMax-M2.7")), q("Terminal Bench 2", 57.0, card("MiniMaxAI/MiniMax-M2.7")), q("SWE Multilingual", 76.5, card("MiniMaxAI/MiniMax-M2.7")),
           q("SWE-bench Verified", 75.3, card("nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-BF16"), vendor=False, note="NVIDIA's run"), q("GPQA", 86.6, card("nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-BF16"), vendor=False, note="NVIDIA's run"),
           q("LiveCodeBench v6", 77.2, card("nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-BF16"), vendor=False, note="NVIDIA's run")],
  reported_runs=[{"hardware": "dgx-spark-x2", "engine": "vLLM TP=2", "quant": "AWQ 4-bit", "users": 1, "decode_tok_s": 40, "note": "two ASUS GX10 (GB10); search snippet only", "source": "nvf-minimax-two"},
                 {"hardware": "dgx-spark-x2", "engine": "vLLM TP=2 (vllm-gb10 image)", "quant": "AWQ 4-bit", "users": 1, "decode_tok_s": None, "note": "8K context deployed, fp8 KV, util 0.75; 5/5 tool calls", "date": "2026-06-30", "source": "l1t-minimax-dual"}],
  aggregate_index={"benchlm_open": 47.7, "rank": 35, "source": "benchlm-open"})

M(id="minimax-m3", name="MiniMax-M3", vendor="MiniMax", released="2026-06-01/02", role="2 Sparks only at ~3-bit GGUF (NVFP4/MXFP4 ~243-250 GB do not fit)",
  params_total_b=427.04, params_active_b=23.0, params_note="~428B / ~23B active (card)",
  arch={"type": "MoE (128 experts, 4 routed + 1 shared)", "layers": 60, "attention": "MiniMax Sparse Attention (block top-k 16 x 128) on 57 of 60 layers; KV stored GQA 4 heads x 128", "full_attn_layers": 60, "kv_heads": 4, "head_dim": 128},
  kv_bytes_per_token_fp8=kv_gqa(60, 4, 128) + 57 * 128, kv_calc="60 x 4 x 256 = 61,440 B + index keys ~57 x 128 B (assumed) = ~68.7 KB", recurrent_state_bytes=0, kv_confidence="approx (MSA index cache layout not verified)",
  context_native=1048576, context_max=1048576, vision=True, tools=True, thinking_toggle="enabled / adaptive / disabled", license="MiniMax Community licence",
  checkpoints=[ck("NVFP4", "nvidia/MiniMax-M3-NVFP4", st_gb("nvidia/MiniMax-M3-NVFP4")), ck("MXFP4", "amd/MiniMax-M3-MXFP4", st_gb("amd/MiniMax-M3-MXFP4")),
               ck("GGUF UD-Q3_K_XL", "unsloth/MiniMax-M3-GGUF", gguf_gb("unsloth/MiniMax-M3-GGUF", "UD-Q3_K_XL")), ck("GGUF UD-Q2_K_XL", "unsloth/MiniMax-M3-GGUF", gguf_gb("unsloth/MiniMax-M3-GGUF", "UD-Q2_K_XL")),
               ck("MXFP8", "MiniMaxAI/MiniMax-M3-MXFP8", st_gb("MiniMaxAI/MiniMax-M3-MXFP8"))],
  engines={"vllm_sm121": "community: runs on 2 Sparks (quant not stated); NVFP4 thread targets 4 Sparks", "llama_cpp": "GGUF exists (unsloth); mainline support not verified", "sglang": "yes (card)"},
  quality=[q("SWE-bench Verified", 80.5, "benchlm-m3", note="vendor via aggregator"), q("SWE-bench Pro", 59.0, "benchlm-m3", note="vendor via aggregator"), q("Terminal-Bench 2.1", 66.0, "benchlm-m3", note="vendor via aggregator"),
           q("GPQA Diamond", 92.9, "benchlm-m3", vendor=False, note="Artificial Analysis"), q("LiveCodeBench", 82.2, "benchlm-m3", vendor=False, note="Vals AI")],
  reported_runs=[{"hardware": "dgx-spark-x2", "engine": "vLLM TP=2 (presumed)", "quant": "not stated", "users": 1, "decode_tok_s": [22, 25], "note": "22.96 tok/s at 32k context; max tested 65,536 with fp8 KV", "date": "2026-07-03", "source": "nvf-q35-397b-dual-b"}],
  aggregate_index={"benchlm_open": 54.4, "rank": 17, "source": "benchlm-open"})

M(id="glm-4.7", name="GLM-4.7", vendor="Z.ai", released="2025-12-22", role="2 Sparks at AWQ 194 GB (tight); huge KV",
  params_total_b=358.34, params_active_b=32.0, params_note="355B / 32B active (GLM-4.5 lineage)",
  arch={"type": "MoE (160 experts, 8 routed + 1 shared)", "layers": 92, "attention": "full GQA on every layer", "full_attn_layers": 92, "kv_heads": 8, "head_dim": 128},
  kv_bytes_per_token_fp8=kv_gqa(92, 8, 128), kv_calc="92 x 8 x 256 = 188,416 B (~6.2 GB per person at 32k)", recurrent_state_bytes=0, kv_confidence="exact from config",
  context_native=202752, context_max=202752, vision=False, tools=True, thinking_toggle=True, license="MIT",
  checkpoints=[ck("AWQ", "QuantTrio/GLM-4.7-AWQ", st_gb("QuantTrio/GLM-4.7-AWQ")), ck("NVFP4", "nvidia/GLM-4.7-NVFP4", st_gb("nvidia/GLM-4.7-NVFP4")), ck("FP8", "zai-org/GLM-4.7-FP8", st_gb("zai-org/GLM-4.7-FP8")),
               ck("GGUF UD-Q3_K_XL", "unsloth/GLM-4.7-GGUF", gguf_gb("unsloth/GLM-4.7-GGUF", "UD-Q3_K_XL")), ck("GGUF UD-Q2_K_XL", "unsloth/GLM-4.7-GGUF", gguf_gb("unsloth/GLM-4.7-GGUF", "UD-Q2_K_XL"))],
  engines={"vllm_sm121": "not verified on 2 Sparks (4-Spark FP8 runs reported in search results)", "llama_cpp": "mainline GGUF", "sglang": "yes"},
  quality=[q("SWE-bench Verified", 73.8, card("zai-org/GLM-4.7")), q("Terminal Bench 2.0", 41.0, card("zai-org/GLM-4.7")), q("GPQA-Diamond", 85.7, card("zai-org/GLM-4.7")),
           q("LiveCodeBench v6", 84.9, card("zai-org/GLM-4.7")), q("AIME 2025", 95.7, card("zai-org/GLM-4.7"))],
  aggregate_index={"benchlm_open": 48.3, "rank": 33, "source": "benchlm-open"}, superseded_by="glm-5.3-flash (smaller, better, hybrid attention)")

M(id="glm-5.3-flash", name="GLM-5.3-Flash", vendor="Z.ai", released="2026-08-25", role="2 Sparks (NVFP4 204 GB, tight) or 1 Spark at Q2 (108.7 GB)",
  params_total_b=321.32, params_active_b=18.0, params_note="320B / 18B active (card)",
  arch={"type": "MoE (288 experts, 8 routed + 1 shared) + mHC", "layers": 45, "attention": "hybrid: 34 Kimi Delta Attention (linear) + 11 DeepSeek-sparse-attention MLA layers (NoPE)", "full_attn_layers": 11,
        "mla": {"kv_lora_rank": 512, "rope_dim": 0}, "indexer": "32 heads x 128, top-2048, k-pool 4", "linear": {"kind": "KDA", "layers": 34, "heads": 64, "head_dim": 128}},
  kv_bytes_per_token_fp8=11 * (512 + 128), kv_calc="11 MLA layers x (512 latent + 128 indexer key) x 1 B = ~7.0 KB (k-pool may shrink the indexer part)",
  recurrent_state_bytes=kda_state(34, 64, 128), recurrent_state_calc="34 x (64x128x128x4 + 3x3x8192x2) = 147.6 MB", kv_confidence="approx",
  context_native=1048576, context_max=1048576, vision=True, tools=True, thinking_toggle="reasoning_effort low/high/max", license="MIT",
  checkpoints=[ck("NVFP4", "nvidia/GLM-5.3-Flash-NVFP4", st_gb("nvidia/GLM-5.3-Flash-NVFP4")), ck("FP8 (native)", "zai-org/GLM-5.3-Flash", st_gb("zai-org/GLM-5.3-Flash")),
               ck("GGUF UD-Q4_K_XL", "unsloth/GLM-5.3-Flash-GGUF", gguf_gb("unsloth/GLM-5.3-Flash-GGUF", "UD-Q4_K_XL")), ck("GGUF UD-Q3_K_XL", "unsloth/GLM-5.3-Flash-GGUF", gguf_gb("unsloth/GLM-5.3-Flash-GGUF", "UD-Q3_K_XL")),
               ck("GGUF UD-Q2_K_XL", "unsloth/GLM-5.3-Flash-GGUF", gguf_gb("unsloth/GLM-5.3-Flash-GGUF", "UD-Q2_K_XL"), note="the one-Spark choice (13-14 GB left)")],
  engines={"vllm_sm121": "community: TP=2 day-0 (vLLM >= 0.29 needed; FlashInfer >= 0.6.17)", "sglang_sm121": "community: TP=2 with 4 GB10 fixes", "llama_cpp": "mainline (llama.cpp commit 8a8d0bcc on GB10)"},
  quality=[q("Terminal-Bench 2.1", 84.3, "glm53flash-chart"), q("DeepSWE v1.1", 63.4, "glm53flash-chart"), q("HLE w/ tools", 55.3, "glm53flash-chart"), q("Agents' Last Exam", 26.3, "glm53flash-chart")],
  reported_runs=[{"hardware": "dgx-spark", "engine": "llama.cpp", "quant": "UD-Q2_K_XL (108.72 GB)", "users": 1, "decode_tok_s": [15.4, 23.64], "note": "prose 15.4-16.2, three.js code 23.6; 262k ctx loads", "date": "2026-08-30", "source": "muninn-glm53flash-1spark"},
                 {"hardware": "dgx-spark-x2", "engine": "SGLang TP=2", "quant": "NVFP4 (community)", "users": 1, "decode_tok_s": 14.7, "decode_tok_s_spec": [23.4, 29.4], "aggregate_tok_s": {"c4": 36.8, "c8": 55.1, "c8_fp8kv": 78, "c12_fp8kv": 83.5}, "ttft_s": {"4k": 2.3, "16k": 7.9}, "date": "2026-08-28", "source": "nvf-glm53flash-sglang"},
                 {"hardware": "dgx-spark-x2", "engine": "vLLM TP=2 + MTP-5", "quant": "NVFP4", "users": 1, "decode_tok_s_spec": [24.7, 30.3], "date": "~2026-08", "source": "nvf-glm53flash-mtp"}],
  aggregate_index={"benchlm_open": 57.4, "rank": 14, "source": "benchlm-open"})

M(id="deepseek-v4-flash-0731", name="DeepSeek-V4-Flash-0731", vendor="DeepSeek", released="2026-07-31 (preview 2026-04-22)", role="2 Sparks (native 167 GB); 1 Spark only at ~2-bit",
  params_total_b=284.0, params_active_b=13.0, params_note="284B / 13B active (+ DSpark draft module; 304B in safetensors)",
  arch={"type": "MoE (256 experts, 6 routed + 1 shared) + mHC", "layers": 43, "attention": "compressed attention: 21 CSA layers (ratio 4, sparse top-512) + 20 HCA layers (ratio 128) + sliding window 128; single 512-dim KV head",
        "full_attn_layers": 0, "kv_heads": 1, "head_dim": 512},
  kv_bytes_per_token_fp8=round(21 * 576 / 4 + 20 * 576 / 128 + 21 * 64 / 4), kv_calc="ESTIMATE: CSA 21 x 576 B / 4 + HCA 20 x 576 B / 128 + fp4 indexer 21 x 64 B / 4 = ~3.4 KB; plus SWA 43 x 128 x 576 B = 3.2 MB per request",
  kv_constant_bytes_per_request=43 * 128 * 576, recurrent_state_bytes=0, kv_confidence="rough estimate (+-50%); DeepSeek's own figure not extracted",
  context_native=1048576, context_max=1048576, vision=False, tools=True, thinking_toggle="reasoning_effort low/high/max", license="MIT",
  checkpoints=[ck("FP8 attention + FP4 experts (official)", "deepseek-ai/DeepSeek-V4-Flash-0731", st_gb("deepseek-ai/DeepSeek-V4-Flash-0731")), ck("NVFP4 (experts W4A4)", "nvidia/DeepSeek-V4-Flash-0731-NVFP4", 175.55, note="2026-08-19; size from the HF API"),
               ck("FP8 all", "sgl-project/DeepSeek-V4-Flash-FP8", st_gb("sgl-project/DeepSeek-V4-Flash-FP8"))],
  engines={"vllm_sm121": "community: TP=2 on 2 Sparks (needs interface-binding patches; vLLM image fix for host RSS growth)", "llama_cpp": "antirez ds4 engine / GGUF variants (community); mainline not verified", "sglang": "yes (card)"},
  quality=[q("Terminal Bench 2.1", 82.7, card("deepseek-ai/DeepSeek-V4-Flash-0731")), q("DeepSWE", 54.4, card("deepseek-ai/DeepSeek-V4-Flash-0731")),
           q("SWE-bench Pro", 56.0, card("Qwen/Qwen3.8-Flash-Next"), vendor=False, note="Qwen's run"), q("GPQA Diamond", 90.8, card("Qwen/Qwen3.8-Flash-Next"), vendor=False, note="Qwen's run"),
           q("LiveCodeBench v6", 90.6, card("Qwen/Qwen3.8-Flash-Next"), vendor=False, note="Qwen's run")],
  reported_runs=[{"hardware": "dgx-spark-x2", "engine": "vLLM TP=2", "quant": "official FP8+FP4", "users": 1, "decode_tok_s": 41, "aggregate_tok_s": {"c32": 350}, "kv_pool_tokens": 1105096, "note": "decode 32-40 tok/s up to 500k; 500k TTFT ~6 min", "date": "2026-06", "source": "gh-elsung-dsv4"},
                 {"hardware": "dgx-spark-x2", "engine": "vLLM TP=2 + DSpark", "quant": "official", "users": 1, "decode_tok_s": [41.9, 55.17], "ttft_s": [0.6, 8.8], "note": "55.17 thinking off, 41.90 thinking on", "date": "2026-06-30", "source": "classmethod-dsv4-2node"},
                 {"hardware": "dgx-spark", "engine": "antirez ds4 / entrpi", "quant": "~2-bit (IQ2_XXS)", "users": 1, "decode_tok_s": [14, 17.9], "date": "2026-08-02", "source": "muninn-index"}],
  aggregate_index={"benchlm_open": None, "note": "V4.1 Flash 67.8 (#4); 0731 not listed", "source": "benchlm-open"})

# ---- reference: too big for two Sparks (shown so the explorer can say "no")
M(id="deepseek-v4.1-flash", name="DeepSeek-V4.1-Flash", vendor="DeepSeek", released="2026-09-10", role="too big for 2 Sparks (510 GB); 4+ Sparks",
  params_total_b=748.0, params_active_b=16.0, params_note="552B backbone + 196B Engram memory; 8B active in prefill, 16B in decode (card); 763B in safetensors",
  arch={"type": "MoE (384 experts, 6 routed + 1 shared), causal encoder-decoder, Engram, mHC", "layers": 40, "attention": "CSA2 compressed sparse attention (full/reindex/reuse modes)"},
  kv_bytes_per_token_fp8=None, kv_calc="vendor: ~4x smaller global KV per token than V4-Flash (so roughly 1 KB/token); not computed", recurrent_state_bytes=0, kv_confidence="vendor ratio only",
  context_native=1048576, context_max=1048576, vision=True, tools=True, license="MIT",
  checkpoints=[ck("FP8 + FP4 experts (official)", "deepseek-ai/DeepSeek-V4.1-Flash", st_gb("deepseek-ai/DeepSeek-V4.1-Flash")), ck("NVFP4", "nvidia/DeepSeek-V4.1-Flash-NVFP4", st_gb("nvidia/DeepSeek-V4.1-Flash-NVFP4")),
               ck("GGUF Q2 (antirez)", "antirez/deepseek-v4.1-flash-gguf", gguf_gb("antirez/deepseek-v4.1-flash-gguf", "Q2"))],
  quality=[q("GPQA Diamond", 90.9, card("deepseek-ai/DeepSeek-V4.1-Flash")), q("Terminal-Bench 2.1", 90.6, card("deepseek-ai/DeepSeek-V4.1-Flash")), q("DeepSWE v1.1", 74.2, card("deepseek-ai/DeepSeek-V4.1-Flash")), q("HLE", 36.8, card("deepseek-ai/DeepSeek-V4.1-Flash"))],
  aggregate_index={"benchlm_open": 67.8, "rank": 4, "source": "benchlm-open"})

M(id="glm-5.3", name="GLM-5.3", vendor="Z.ai", released="2026-08-25", role="too big for 2 Sparks (NVFP4 464 GB; Q2 GGUF 254 GB)",
  params_total_b=753.33, params_active_b=40.0, params_note="~744-753B / ~40B active (GLM-5 family: 744B-A40B)",
  arch={"type": "MoE (256 experts, 8 routed + 1 shared)", "layers": 78, "attention": "MLA + DeepSeek sparse attention (DSA) on every layer", "mla": {"kv_lora_rank": 512, "rope_dim": 64}},
  kv_bytes_per_token_fp8=78 * (512 + 64 + 128), kv_calc="78 x (576 MLA + 128 indexer) x 1 B = ~54.9 KB (vLLM's fp8_ds_mla layout ~656 B/layer would give ~61 KB)", recurrent_state_bytes=0, kv_confidence="approx",
  context_native=1048576, context_max=1048576, vision=False, tools=True, license="GLM-5.3 licence ('other')",
  checkpoints=[ck("NVFP4", "nvidia/GLM-5.3-NVFP4", st_gb("nvidia/GLM-5.3-NVFP4")), ck("FP8 (native)", "zai-org/GLM-5.3", st_gb("zai-org/GLM-5.3")), ck("GGUF UD-Q2_K_XL", "unsloth/GLM-5.3-GGUF", gguf_gb("unsloth/GLM-5.3-GGUF", "UD-Q2_K_XL"))],
  quality=[q("Terminal Bench 2.1", 88.2, card("zai-org/GLM-5.3")), q("DeepSWE v1.1", 66.9, card("zai-org/GLM-5.3")), q("FrontierSWE", 78.1, card("zai-org/GLM-5.3")),
           q("GPQA Diamond", 88.1, card("deepseek-ai/DeepSeek-V4.1-Flash"), vendor=False, note="DeepSeek's table")],
  aggregate_index={"benchlm_open": 68.7, "rank": 3, "source": "benchlm-open"})

M(id="kimi-k2.6", name="Kimi K2.6", vendor="Moonshot AI", released="2026-04-14", role="too big for 2 Sparks (595 GB INT4)",
  params_total_b=1026.9, params_active_b=32.0, arch={"type": "MoE (384 experts, 8 active), DeepSeek-V3 layout", "layers": 61, "attention": "MLA on every layer", "mla": {"kv_lora_rank": 512, "rope_dim": 64}},
  kv_bytes_per_token_fp8=61 * 576, kv_calc="61 x 576 = 35,136 B (bf16 70,272)", recurrent_state_bytes=0, kv_confidence="exact from config",
  context_native=262144, context_max=262144, vision=True, tools=True, license="Modified MIT",
  checkpoints=[ck("INT4 (native, compressed-tensors)", "moonshotai/Kimi-K2.6", st_gb("moonshotai/Kimi-K2.6")), ck("NVFP4", "nvidia/Kimi-K2.6-NVFP4", st_gb("nvidia/Kimi-K2.6-NVFP4"))],
  quality=[q("SWE-Bench Verified", 80.2, card("moonshotai/Kimi-K2.6")), q("SWE-Bench Pro", 58.6, card("moonshotai/Kimi-K2.6")), q("LiveCodeBench v6", 89.6, card("moonshotai/Kimi-K2.6")),
           q("GPQA-Diamond", 90.5, card("moonshotai/Kimi-K2.6")), q("AIME 2026", 96.4, card("moonshotai/Kimi-K2.6"))],
  aggregate_index={"benchlm_open": 58.7, "rank": 12, "source": "benchlm-open"})

M(id="kimi-k3", name="Kimi K3", vendor="Moonshot AI", released="2026-06-13 (weights; aggregators say July)", role="too big (1.56 TB MXFP4)",
  params_total_b=2779.9, params_active_b=104.0, arch={"type": "latent MoE (896 experts, 16 active, 2 shared)", "layers": 93, "attention": "hybrid: 69 Kimi Delta Attention + 24 gated MLA"},
  kv_bytes_per_token_fp8=24 * 576, kv_calc="24 MLA x 576 = 13,824 B", recurrent_state_bytes=kda_state(69, 96, 128), recurrent_state_calc="69 x (96x128x128x4 + conv) = 449 MB", kv_confidence="approx",
  context_native=1048576, context_max=1048576, vision=True, tools=True, license="Kimi K3 licence ('other')",
  checkpoints=[ck("MXFP4 (native)", "moonshotai/Kimi-K3", st_gb("moonshotai/Kimi-K3"))],
  quality=[q("GPQA Diamond", 93.5, card("moonshotai/Kimi-K3")), q("Terminal-Bench 2.1", 88.3, card("moonshotai/Kimi-K3")), q("DeepSWE", 67.5, card("moonshotai/Kimi-K3")), q("FrontierSWE", 81.2, card("moonshotai/Kimi-K3"))],
  aggregate_index={"benchlm_open": None, "note": "not listed", "source": "benchlm-open"})

M(id="qwen3.8-2.4t-a95b", name="Qwen3.8-2.4T-A95B (open Qwen3.8-Max)", vendor="Alibaba Qwen", released="2026-08-08", role="too big (NVFP4 1.44 TB)",
  params_total_b=2446.2, params_active_b=95.0, arch={"type": "MoE (512 experts, 10 routed + 1 shared)", "layers": 92, "attention": "hybrid: 69 Gated DeltaNet + 23 full", "full_attn_layers": 23, "kv_heads": 4, "head_dim": 256},
  kv_bytes_per_token_fp8=kv_gqa(23, 4, 256), kv_calc="23 x 4 x 512 = 47,104 B", recurrent_state_bytes=gdn_state(69, 128, 128, 128, 16), recurrent_state_calc="69 x 8.5 MB = 587 MB", kv_confidence="exact from config",
  context_native=262144, context_max=1010000, vision=False, tools=True, thinking_toggle="thinking required (open weights)", license="Qwen3.8-Max licence ('other')",
  checkpoints=[ck("NVFP4", "nvidia/Qwen3.8-2.4T-A95B-NVFP4", st_gb("nvidia/Qwen3.8-2.4T-A95B-NVFP4")), ck("FP8", "Qwen/Qwen3.8-2.4T-A95B-FP8", st_gb("Qwen/Qwen3.8-2.4T-A95B-FP8"))],
  quality=[q("Terminal Bench 2.1", 86.6, card("Qwen/Qwen3.8-2.4T-A95B")), q("SWE-bench Pro", 67.7, card("Qwen/Qwen3.8-2.4T-A95B")), q("GPQA Diamond", 92.6, card("Qwen/Qwen3.8-2.4T-A95B")), q("HLE", 43.6, card("Qwen/Qwen3.8-2.4T-A95B"))],
  aggregate_index={"benchlm_open": 70.5, "rank": 2, "source": "benchlm-open"})

M(id="mimo-v2.6-flash", name="MiMo-V2.6-Flash", vendor="Xiaomi", released="2026-09-21/22", role="2 Sparks (native 173 GB); no GB10 report found",
  params_total_b=310.76, params_active_b=15.0, params_note="309B / 15B active (card); omni (text, image, video, audio in)",
  arch={"type": "MoE (256 experts, 8 active)", "layers": 48, "attention": "hybrid: 9 global GQA layers + 39 sliding-window (128) layers", "full_attn_layers": 9, "kv_heads": 4, "head_dim": "192 (K) / 128 (V)", "sliding_window": 128},
  kv_bytes_per_token_fp8=kv_gqa(9, 4, 192, 128), kv_calc="9 x 4 x (192+128) = 11,520 B; plus SWA 39 x 8 x 320 x 128 = 12.8 MB per request",
  kv_constant_bytes_per_request=39 * 8 * 320 * 128, recurrent_state_bytes=0, kv_confidence="exact from config",
  context_native=1048576, context_max=1048576, vision=True, tools=True, license="MIT",
  checkpoints=[ck("FP8 + MXFP4 experts (native)", "XiaomiMiMo/MiMo-V2.6-Flash-RL", 172.93, note="+1.87 GB audio tokenizer, +2.94 GB DFlash draft"),
               ck("GGUF MXFP4", "ggml-org/MiMo-V2.6-Flash-RL-GGUF", gguf_gb("ggml-org/MiMo-V2.6-Flash-RL-GGUF", "RL-MXFP4")), ck("GGUF Q2_K", "ggml-org/MiMo-V2.6-Flash-RL-GGUF", gguf_gb("ggml-org/MiMo-V2.6-Flash-RL-GGUF", "Q2_K")),
               ck("NVFP4 (community)", "ProCreations/MiMo-V2.6-Flash-RL-NVFP4", st_gb("ProCreations/MiMo-V2.6-Flash-RL-NVFP4"))],
  engines={"vllm_sm121": "not verified", "llama_cpp": "mainline GGUF (ggml-org)", "sglang": "card lists SGLang/vLLM (not re-checked)"},
  quality=[q("DeepSWE v1.1", 67.9, card("XiaomiMiMo/MiMo-V2.6-Flash-RL")), q("Terminal Bench 2.1", 87.6, card("XiaomiMiMo/MiMo-V2.6-Flash-RL")), q("Terminal Bench 4.0", 28.8, card("XiaomiMiMo/MiMo-V2.6-Flash-RL"))],
  aggregate_index={"benchlm_open": 65.4, "rank": 5, "source": "benchlm-open"})

M(id="nemotron-3-ultra-550b-a55b", name="NVIDIA Nemotron 3 Ultra 550B-A55B", vendor="NVIDIA", released="2026-06-03", role="too big for 2 Sparks at 4-bit (NVFP4 352 GB); only 2-bit GGUF (194-202 GB)",
  params_total_b=560.5, params_active_b=55.0, arch={"type": "latent MoE (512 experts, 22 active)", "layers": 108, "attention": "hybrid: 48 Mamba-2 + 48 MoE + 12 attention", "full_attn_layers": 12, "kv_heads": 2, "head_dim": 128,
       "linear": {"kind": "Mamba-2", "layers": 48, "heads": 256, "head_dim": 64, "d_state": 128}},
  kv_bytes_per_token_fp8=kv_gqa(12, 2, 128), kv_calc="12 x 2 x 256 = 6,144 B", recurrent_state_bytes=mamba2_state(48, 256, 64, 128, 8), recurrent_state_calc="48 x 8.5 MB = 408 MB", kv_confidence="exact from config",
  context_native=262144, context_max=1000000, vision=False, tools=True, license="OpenMDW-1.1",
  checkpoints=[ck("NVFP4", "nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4", st_gb("nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-NVFP4")), ck("GGUF UD-Q2_K_XL", "unsloth/NVIDIA-Nemotron-3-Ultra-550B-A55B-GGUF", gguf_gb("unsloth/NVIDIA-Nemotron-3-Ultra-550B-A55B-GGUF", "UD-Q2_K_XL"))],
  quality=[q("SWE-Bench Verified", 70.7, card("nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-BF16")), q("Terminal Bench 2.1", 56.4, card("nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-BF16")),
           q("GPQA (no tools)", 87.0, card("nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-BF16")), q("LiveCodeBench v6", 89.0, card("nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B-BF16"))],
  aggregate_index={"benchlm_open": 45.9, "rank": 39, "source": "benchlm-open"}, note="55B active at 273 GB/s: bandwidth-bound, single-digit tok/s expected even if it fitted")

M(id="mistral-small-4-119b", name="Mistral Small 4 119B-A6B", vendor="Mistral AI", released="2026-01/03 (repo 2026-01-23, NVFP4 2026-03-03)", role="fits 1 Spark / 1 PRO 6000 (NVFP4 71 GB)",
  params_total_b=119.4, params_active_b=6.5, arch={"type": "MoE (128 experts, 4 routed + 1 shared)", "layers": 36, "attention": "MLA on every layer", "mla": {"kv_lora_rank": 256, "rope_dim": 64}},
  kv_bytes_per_token_fp8=36 * (256 + 64), kv_calc="36 x 320 = 11,520 B (bf16 23,040)", recurrent_state_bytes=0, kv_confidence="exact from config",
  context_native=262144, context_max=262144, context_note="card: 256k (config allows 1M)", vision=True, tools=True, thinking_toggle="reasoning effort per request", license="Apache-2.0",
  checkpoints=[ck("NVFP4 (official)", "mistralai/Mistral-Small-4-119B-2603-NVFP4", st_gb("mistralai/Mistral-Small-4-119B-2603-NVFP4")), ck("FP8 (native)", "mistralai/Mistral-Small-4-119B-2603", st_gb("mistralai/Mistral-Small-4-119B-2603", halve=True), note="repo holds consolidated + HF copies; one copy shown"),
               ck("GGUF UD-Q4_K_XL", "unsloth/Mistral-Small-4-119B-2603-GGUF", gguf_gb("unsloth/Mistral-Small-4-119B-2603-GGUF", "UD-Q4_K_XL"))],
  engines={"vllm_sm121": "not verified", "llama_cpp": "mainline GGUF", "vllm": "yes (card)"},
  quality=[q("LiveCodeBench (reasoning)", 64, "mistral-small4-charts", note="read off the vendor chart; instruct mode 32"), q("AIME 2025 (reasoning)", 84, "mistral-small4-charts", note="vendor chart; instruct 36")],
  aggregate_index={"benchlm_open": 34.8, "rank": 57, "source": "benchlm-open"})

M(id="mistral-medium-3.5-128b", name="Mistral Medium 3.5 128B (dense)", vendor="Mistral AI", released="2026-03-31", role="fits 1 Spark (NVFP4 95 GB) but dense 128B = ~2-3 tok/s there",
  params_total_b=127.7, params_active_b=127.7, arch={"type": "dense", "layers": 88, "attention": "full GQA on every layer", "full_attn_layers": 88, "kv_heads": 8, "head_dim": 128},
  kv_bytes_per_token_fp8=kv_gqa(88, 8, 128), kv_calc="88 x 8 x 256 = 180,224 B", recurrent_state_bytes=0, kv_confidence="exact from config",
  context_native=262144, context_max=262144, vision=True, tools=True, license="Modified MIT (exceptions for large-revenue companies)",
  checkpoints=[ck("NVFP4", "nvidia/Mistral-Medium-3.5-128B-NVFP4", st_gb("nvidia/Mistral-Medium-3.5-128B-NVFP4")), ck("FP8 (native)", "mistralai/Mistral-Medium-3.5-128B", st_gb("mistralai/Mistral-Medium-3.5-128B", halve=True), note="one copy shown"),
               ck("GGUF Q4_K_M", "unsloth/Mistral-Medium-3.5-128B-GGUF", gguf_gb("unsloth/Mistral-Medium-3.5-128B-GGUF", "Q4_K_M"))],
  engines={"vllm_sm121": "not verified", "llama_cpp": "mainline GGUF (use the fixed config)", "vllm": "yes (card)"},
  quality=[q("SWE-bench Verified", 77.6, "mistral-medium35-card"), q("AIME25 avg@16", 86.3, "mistral-medium35-card"), q("IFBench", 69.0, "mistral-medium35-card")],
  aggregate_index={"benchlm_open": 35.4, "rank": 56, "source": "benchlm-open"}, note="dense: bandwidth-bound; roofline ~273 GB/s / ~70 GB per token = ~3-4 tok/s on a Spark (estimate)")

M(id="mistral-large-3-675b", name="Mistral Large 3 675B-A41B", vendor="Mistral AI", released="2025-12", role="too big for 2 Sparks (NVFP4 403 GB)",
  params_total_b=675.0, params_active_b=41.0, arch={"type": "MoE (128 experts, 4 routed + 1 shared), DeepSeek-V3-like", "layers": 61, "attention": "MLA", "mla": {"kv_lora_rank": 512, "rope_dim": 64}},
  kv_bytes_per_token_fp8=61 * 576, kv_calc="61 x 576 = 35,136 B", recurrent_state_bytes=0, kv_confidence="from params.json",
  context_native=262144, context_max=262144, vision=True, tools=True, license="Apache-2.0",
  checkpoints=[ck("NVFP4", "mistralai/Mistral-Large-3-675B-Instruct-2512-NVFP4", st_gb("mistralai/Mistral-Large-3-675B-Instruct-2512-NVFP4")), ck("FP8", "mistralai/Mistral-Large-3-675B-Instruct-2512", st_gb("mistralai/Mistral-Large-3-675B-Instruct-2512"))],
  quality=[], quality_note="benchmarks not extracted (low relevance: does not fit)", aggregate_index={"benchlm_open": None, "note": "not listed", "source": "benchlm-open"})

M(id="llama-4-scout", name="Llama 4 Scout 17B-16E (109B)", vendor="Meta", released="2025-04", role="legacy; fits 1 Spark (NVFP4 65 GB)",
  params_total_b=108.6, params_active_b=17.0, arch={"type": "MoE (16 experts, 1 routed + shared)", "layers": 48, "attention": "36 chunked-local layers (8,192-token chunks, RoPE) + 12 global NoPE layers", "full_attn_layers": 12, "kv_heads": 8, "head_dim": 128},
  kv_bytes_per_token_fp8=kv_gqa(12, 8, 128), kv_calc="12 global x 8 x 256 = 24,576 B; chunked layers hold at most 8,192 tokens: 36 x 2,048 x 8,192 = 604 MB per request",
  kv_constant_bytes_per_request=36 * 2048 * 8192, recurrent_state_bytes=0, kv_confidence="exact from config",
  context_native=10485760, context_max=10485760, context_note="claimed 10M", vision=True, tools=True, license="Llama 4 Community License",
  checkpoints=[ck("NVFP4", "nvidia/Llama-4-Scout-17B-16E-Instruct-NVFP4", st_gb("nvidia/Llama-4-Scout-17B-16E-Instruct-NVFP4")), ck("GGUF Q4_K_M", "unsloth/Llama-4-Scout-17B-16E-Instruct-GGUF", gguf_gb("unsloth/Llama-4-Scout-17B-16E-Instruct-GGUF", "Q4_K_M"))],
  quality=[q("GPQA Diamond", 57.2, "meta-llama4-card"), q("LiveCodeBench (2024-10..2025-02)", 32.8, "meta-llama4-card"), q("MMLU Pro", 74.3, "meta-llama4-card")],
  aggregate_index={"benchlm_open": 29.5, "rank": 73, "source": "benchlm-open"}, note="superseded; shown for completeness")

M(id="llama-4-maverick", name="Llama 4 Maverick 17B-128E (400B)", vendor="Meta", released="2025-04", role="legacy; 2 Sparks (NVFP4 234 GB, too tight) or Q3 GGUF 180 GB",
  params_total_b=401.6, params_active_b=17.0, arch={"type": "MoE (128 experts, 1 routed + shared, MoE every 2nd layer)", "layers": 48, "attention": "as Scout", "full_attn_layers": 12, "kv_heads": 8, "head_dim": 128},
  kv_bytes_per_token_fp8=kv_gqa(12, 8, 128), kv_calc="as Scout", kv_constant_bytes_per_request=36 * 2048 * 8192, recurrent_state_bytes=0, kv_confidence="exact from config",
  context_native=1048576, context_max=1048576, vision=True, tools=True, license="Llama 4 Community License",
  checkpoints=[ck("NVFP4", "RedHatAI/Llama-4-Maverick-17B-128E-Instruct-NVFP4", st_gb("RedHatAI/Llama-4-Maverick-17B-128E-Instruct-NVFP4")), ck("GGUF UD-Q3_K_XL", "unsloth/Llama-4-Maverick-17B-128E-Instruct-GGUF", gguf_gb("unsloth/Llama-4-Maverick-17B-128E-Instruct-GGUF", "UD-Q3_K_XL")),
               ck("FP8", "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8", st_gb("meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8"))],
  quality=[q("GPQA Diamond", 69.8, "meta-llama4-card"), q("LiveCodeBench (2024-10..2025-02)", 43.4, "meta-llama4-card"), q("MMLU Pro", 80.5, "meta-llama4-card")],
  aggregate_index={"benchlm_open": 22.8, "rank": 88, "source": "benchlm-open"}, note="superseded; shown for completeness")

# ---- small models (one person on a small GPU, or co-tenants)
M(id="ternary-bonsai-2-27b", name="Ternary-Bonsai-2-27B (PrismML)", vendor="PrismML", released="2026-09-16", role="one person on a small GPU / laptop; llama.cpp fork only",
  params_total_b=27.36, params_active_b=24.35, params_note="Qwen3.8-27B with ternary weights (1.72 bits/weight); 24.35B language backbone",
  arch={"type": "dense (Qwen3.8-27B backbone)", "layers": 64, "attention": "as Qwen3.8-27B: 48 Gated DeltaNet + 16 full", "full_attn_layers": 16, "kv_heads": 4, "head_dim": 256},
  kv_bytes_per_token_fp8=kv_gqa(16, 4, 256), kv_calc="as Qwen3.8-27B: 32,768 B at 1 B/element (llama.cpp q8_0 ~34.8 KB, f16 65.5 KB)", recurrent_state_bytes=gdn_state(48, 48, 128, 128, 16), kv_confidence="exact (inherits Qwen3.8-27B)",
  context_native=262144, context_max=262144, vision=True, vision_note="0.63 GB mmproj Q8_0", tools=True, license="Apache-2.0",
  checkpoints=[ck("GGUF PTQ1_0 (dense trits, 1.75 bpw)", "prism-ml/Ternary-Bonsai-2-27B-gguf", 5.95), ck("GGUF PQ2_0 (2-bit slots, 2.13 bpw)", "prism-ml/Ternary-Bonsai-2-27B-gguf", 7.21)],
  engines={"llama_cpp": "PrismML fork ONLY (stock llama.cpp rejects PQ2_0/PTQ1_0); builds for Windows/Linux x64 CUDA + macOS, no arm64 CUDA (plan s4.3) -> not on a Spark without building it", "vllm": "no", "ollama": "no"},
  quality=[q("AIME26", 95.83, card("prism-ml/Ternary-Bonsai-2-27B-gguf"), note="FP16 base 94.58"), q("LiveCodeBench", 90.07, card("prism-ml/Ternary-Bonsai-2-27B-gguf"), note="FP16 base 90.05"),
           q("IFBench (prompt-loose)", 74.00, card("prism-ml/Ternary-Bonsai-2-27B-gguf")), q("14-benchmark thinking avg", 84.78, card("prism-ml/Ternary-Bonsai-2-27B-gguf"), note="98.2% of FP16; IQ2_XXS 72.59")],
  reported_runs=[{"hardware": "rtx-5090", "engine": "PrismML llama.cpp", "quant": "PQ2_0", "users": 1, "decode_tok_s": 129.9, "prefill_tok_s_pp512": 3893, "source": card("prism-ml/Ternary-Bonsai-2-27B-gguf"), "vendor_reported": True},
                 {"hardware": "rtx-pro-6000-ws", "engine": "PrismML llama.cpp", "quant": "PQ2_0", "users": 1, "decode_tok_s": 124.8, "prefill_tok_s_pp512": 4020, "source": card("prism-ml/Ternary-Bonsai-2-27B-gguf"), "vendor_reported": True},
                 {"hardware": "RTX 4090 (not in catalog)", "engine": "PrismML llama.cpp", "quant": "PTQ1_0", "users": 1, "decode_tok_s": 91.1, "source": card("prism-ml/Ternary-Bonsai-2-27B-gguf"), "vendor_reported": True}],
  aggregate_index={"benchlm_open": 53.3, "rank": 26, "source": "benchlm-open"})

M(id="gemma-4-26b-a4b", name="Gemma 4 26B-A4B", vendor="Google", released="2026-03-11", role="small vision MoE; fits a 24-32 GB card",
  params_total_b=25.81, params_active_b=3.8, arch={"type": "MoE (128 experts)", "layers": 30, "attention": "5 global (2 KV heads x 512) + 25 sliding-window (1,024) layers", "full_attn_layers": 5, "kv_heads": 2, "head_dim": 512, "sliding_window": 1024},
  kv_bytes_per_token_fp8=5 * 2 * 1024, kv_calc="5 x 2 x (512+512) = 10,240 B; plus SWA 25 x 8 x 512 x 1,024 = 105 MB per request", kv_constant_bytes_per_request=25 * 8 * 512 * 1024, recurrent_state_bytes=0,
  kv_confidence="exact from config (global layers use num_global_key_value_heads / global_head_dim)", context_native=262144, context_max=262144, vision=True, tools=True, license="Apache-2.0",
  checkpoints=[ck("NVFP4", "nvidia/Gemma-4-26B-A4B-NVFP4", st_gb("nvidia/Gemma-4-26B-A4B-NVFP4")), ck("GGUF UD-Q4_K_XL", "unsloth/gemma-4-26B-A4B-it-GGUF", gguf_gb("unsloth/gemma-4-26B-A4B-it-GGUF", "UD-Q4_K_XL")), ck("BF16", "google/gemma-4-26B-A4B-it", st_gb("google/gemma-4-26B-A4B-it"))],
  engines={"vllm_sm121": "community: 52 tok/s NVFP4 on a Spark (plan s9.1)", "llama_cpp": "mainline"},
  quality=[q("GPQA Diamond", 82.3, card("google/gemma-4-26B-A4B-it")), q("LiveCodeBench v6", 77.1, card("google/gemma-4-26B-A4B-it")), q("AIME 2026 no tools", 88.3, card("google/gemma-4-26B-A4B-it")),
           q("SWE-bench Verified", 17.4, card("Qwen/Qwen3.6-35B-A3B"), vendor=False, note="Qwen's run: weak agentic coding")],
  aggregate_index={"benchlm_open": 46.0, "rank": 38, "source": "benchlm-open"})

M(id="gemma-4-12b", name="Gemma 4 12B (the farm's Ollama default, gemma4:12b)", vendor="Google", released="2026-05-23", role="small GPU default (12-16 GB cards)",
  params_total_b=11.96, params_active_b=11.96, arch={"type": "dense", "layers": 48, "attention": "8 global (1 KV head x 512) + 40 sliding-window (1,024) layers", "full_attn_layers": 8, "kv_heads": 1, "head_dim": 512, "sliding_window": 1024},
  kv_bytes_per_token_fp8=8 * 1 * 1024, kv_calc="8 x 1 x 1,024 = 8,192 B; plus SWA 40 x 8 x 512 x 1,024 = 168 MB per request", kv_constant_bytes_per_request=40 * 8 * 512 * 1024, recurrent_state_bytes=0,
  kv_confidence="exact from config", context_native=262144, context_max=262144, vision=True, tools=True, license="Apache-2.0",
  checkpoints=[ck("GGUF QAT Q4_0 (official)", "google/gemma-4-12B-it-qat-q4_0-gguf", gguf_gb("google/gemma-4-12B-it-qat-q4_0-gguf", "gemma-4-12b-it-qat-q4_0.gguf")), ck("GGUF Q4_K_M", "unsloth/gemma-4-12b-it-GGUF", gguf_gb("unsloth/gemma-4-12b-it-GGUF", "Q4_K_M")),
               ck("BF16", "google/gemma-4-12B-it", st_gb("google/gemma-4-12B-it"))],
  engines={"ollama": "the farm's default (CLAUDE.md)", "llama_cpp": "mainline", "vllm": "yes (w4a16 QAT checkpoint exists)"},
  quality=[q("GPQA Diamond", 78.8, card("google/gemma-4-12B-it")), q("LiveCodeBench v6", 72.0, card("google/gemma-4-12B-it")), q("AIME 2026 no tools", 77.5, card("google/gemma-4-12B-it"))],
  aggregate_index={"benchlm_open": 31.9, "rank": 64, "source": "benchlm-open"})

M(id="qwen3-coder-next", name="Qwen3-Coder-Next (80B-A3B)", vendor="Alibaba Qwen", released="2026-01-30", role="coding agent alternative; fits a PRO 5000 48 / 1 Spark",
  params_total_b=79.67, params_active_b=3.0, arch={"type": "MoE (512 experts, 10 active)", "layers": 48, "attention": "hybrid: 36 Gated DeltaNet + 12 full", "full_attn_layers": 12, "kv_heads": 2, "head_dim": 256},
  kv_bytes_per_token_fp8=kv_gqa(12, 2, 256), kv_calc="12 x 2 x 512 = 12,288 B", recurrent_state_bytes=gdn_state(36, 32, 128, 128, 16), recurrent_state_calc="36 x 2.15 MB = 77.3 MB", kv_confidence="exact from config",
  context_native=262144, context_max=262144, vision=False, tools=True, thinking_toggle="non-thinking coder", license="Apache-2.0",
  checkpoints=[ck("FP8", "Qwen/Qwen3-Coder-Next-FP8", st_gb("Qwen/Qwen3-Coder-Next-FP8")), ck("GGUF UD-Q4_K_XL", "unsloth/Qwen3-Coder-Next-GGUF", gguf_gb("unsloth/Qwen3-Coder-Next-GGUF", "UD-Q4_K_XL")), ck("BF16", "Qwen/Qwen3-Coder-Next", st_gb("Qwen/Qwen3-Coder-Next"))],
  quality=[q("SWE-bench Verified", 70.6, "repo-plan-s9", note="as recorded in plan s9.1 (vendor); not re-verified today")],
  reported_runs=[{"hardware": "dgx-spark", "engine": "vLLM", "quant": "NVFP4 (42.7 GiB)", "users": 1, "decode_tok_s": 60.8, "note": "72.0 with EAGLE3", "source": "repo-plan-s9"}],
  aggregate_index={"benchlm_open": None, "note": "not listed", "source": "benchlm-open"})

# ---------------------------------------------------------------- measured spike anchors (repo-results)
SPIKE = {
 "pass_rule": "TTFT p95 < 5 s AND per-user decode p10 >= 15 tok/s; people = largest passing concurrency, 'every turn' (all start within 3 s) / 'steady' (later turns)",
 "engine": "vLLM 0.30.0 (torch 2.13.0+cu132, FlashInfer 0.6.18.post1); llama.cpp b10670",
 "kv_pool": "--kv-cache-memory-bytes 62277025792 (58 GiB) on both boxes; fp8 KV",
 "people": {
   "rtx-pro-6000-ws": {
     "qwen3.6-35b-a3b": {"32k": [96, 128], "64k": [48, 64], "128k": [32, 40]},
     "nemotron-3.5-lightning-30b-a3b": {"32k": [160, ">=192"], "64k": [16, ">=64"], "128k": [24, 48], "note": "64k first turn 5.15 s at 32 users"},
     "qwen3.8-27b": {"32k": [16, 32], "64k": [">=24", ">=24"], "128k": [">=12", ">=12"]},
     "llamacpp:nemotron-3.5-lightning-30b-a3b": {"32k": [4, 8], "128k": [0, ">=4"]},
     "llamacpp:qwen3.8-27b": {"32k": ["<=1", "<=1"]}},
   "dgx-spark": {
     "qwen3.6-35b-a3b": {"32k": [8, 8], "64k": [8, 8], "128k": [4, 4]},
     "nemotron-3.5-lightning-30b-a3b": {"32k": [16, 16], "64k": ["<8 (4-6 probable, unmeasured)", "<8"], "128k": [4, 4]},
     "qwen3.8-27b": {"32k": [0, 0], "64k": [0, 0], "128k": [0, 0], "note": "12.1 tok/s alone; ~4 people at a 10 tok/s bar"},
     "llamacpp:nemotron-3.5-lightning-30b-a3b": {"32k": [2, 2], "128k": [1, 1]},
     "llamacpp:qwen3.8-27b": {"32k": [0, 0]}}},
 "single_user_decode_tok_s": {"rtx-pro-6000-ws": {"qwen3.6-35b-a3b": 193, "nemotron-3.5-lightning-30b-a3b": 243, "qwen3.8-27b": 64},
                              "dgx-spark": {"qwen3.6-35b-a3b": 76, "nemotron-3.5-lightning-30b-a3b": 69, "qwen3.8-27b": 12}},
 "peak_aggregate_tok_s_agent": {"rtx-pro-6000-ws": {"qwen3.6-35b-a3b": 3431, "nemotron-3.5-lightning-30b-a3b": 4959}, "dgx-spark": {"qwen3.6-35b-a3b": 585, "nemotron-3.5-lightning-30b-a3b": 858}},
 "cold_prefill_s": {"rtx-pro-6000-ws": {"qwen3.6-35b-a3b": {"32k": 1.13, "64k": 3.0, "128k": 8.0}, "nemotron-3.5-lightning-30b-a3b": {"32k": 1.07, "128k": 5.7}, "qwen3.8-27b": {"32k": 3.25, "64k": 8.1, "128k": 20.9}},
                    "dgx-spark": {"qwen3.6-35b-a3b": {"32k": 6.1, "64k": 15.2, "128k": 38.7}, "nemotron-3.5-lightning-30b-a3b": {"32k": 5.7, "64k": 13.0, "128k": 29.8}, "qwen3.8-27b": {"32k": 14.7, "64k": 36.7, "128k": 93.2}}},
 "kv_pool_tokens_58gib": {"qwen3.6-35b-a3b": 5510722, "nemotron-3.5-lightning-30b-a3b": 15905587, "qwen3.8-27b": 1765102},
 "vllm_real_capacity_58gib": {"qwen3.6-35b-a3b": {"32k": 132, "64k": 76, "128k": 42}, "nemotron-3.5-lightning-30b-a3b": {"32k": 303, "64k": 202, "128k": 121}, "qwen3.8-27b": {"30k": 46.6}},
 "pro6000_decode_fit": "p10 step = 6.96 ms + 0.1372 ms*N + 10.96 ms*(N*C in M tokens) (Qwen3.6, round 2; repo-estimates Method 3)",
 "pro6000_ttft_fit": "round-1 TTFT p95 = 0.196 s + 1.384 s*(N*C in M tokens) (repo-estimates Method 5)",
 "source": "repo-results, repo-estimates"}

# ---------------------------------------------------------------- fit verdicts
def gib(gb): return gb * 1e9 / GiB
FIT_TARGETS = [("rtx-pro-6000-ws", "farm_with_ocr_gib"), ("rtx-pro-6000-ws", "single_user_max_gib"), ("rtx-pro-5500", "farm_with_ocr_gib"), ("rtx-pro-5000-72", "farm_with_ocr_gib"),
               ("rtx-pro-5000-48", "farm_with_ocr_gib"), ("dgx-spark", "farm_gib"), ("dgx-spark", "single_user_max_gib"), ("dgx-spark-x2", "farm_gib"), ("dgx-spark-x2", "single_user_max_gib"),
               ("rtx-5090", "single_user_max_gib"), ("rtx-4080", "single_user_max_gib"), ("rtx-4070", "single_user_max_gib")]
HW = {h["id"]: h for h in HARDWARE}
LOW_BIT = ("Q2", "Q3", "IQ2", "IQ3", "TQ1", "PTQ1", "PQ2")
def is_low(c): return any(s in c["format"] for s in LOW_BIT)
def is_gguf(c): return c["format"].startswith("GGUF")
def is_bf16(c): return c["format"].startswith("BF16")
def verdict_for(m, cands, budget, single):
    min_kv, tight = (1.0, 2.0) if single else (4.0, 8.0)
    # prefer >=4-bit (smallest first = most KV room), then <=3-bit; never BF16 unless nothing else is listed
    order = sorted([c for c in cands if not is_low(c) and not is_bf16(c)], key=lambda c: c["disk_gb"]) +             sorted([c for c in cands if is_low(c)], key=lambda c: -c["disk_gb"]) + [c for c in cands if is_bf16(c)]
    for c in order:
        w = c.get("resident_gib_est") or c.get("loaded_gib_measured") or gib(c["disk_gb"])
        room = budget - w
        if room >= min_kv:
            out = {"checkpoint": c["format"], "weights_gib": round(w, 1), "kv_room_gib": round(room, 1)}
            per = m.get("kv_bytes_per_token_fp8")
            if per:
                person32 = 32768 * per + 2 * (m.get("recurrent_state_bytes") or 0) + (m.get("kv_constant_bytes_per_request") or 0)
                out["people_by_kv_at_32k_est"] = int(0.93 * room * GiB // person32)
            out["verdict"] = "fits only at <=3-bit" if is_low(c) else ("tight" if room < tight else "fits")
            return out
    sm = min((c["disk_gb"] for c in cands), default=None)
    return {"verdict": "no" if cands else "no checkpoint of this kind", "smallest_gib": round(gib(sm), 1) if sm else None}
for m in MODELS:
    fits = {}
    cks = [c for c in m.get("checkpoints", []) if c.get("disk_gb")]
    for hid, bkey in FIT_TARGETS:
        budget = HW[hid]["budget"].get(bkey)
        if budget is None: continue
        single = bkey.startswith("single")
        fits["%s@%s" % (hid, bkey)] = {"budget_gib": budget,
            "vllm_sglang": verdict_for(m, [c for c in cks if not is_gguf(c)], budget, single),
            "llama_cpp": verdict_for(m, [c for c in cks if is_gguf(c)], budget, single)}
    m["fit"] = fits

for m in MODELS:
    m["kv_bytes_per_token_bf16"] = (m["kv_bytes_per_token_fp8"] * 2) if m.get("kv_bytes_per_token_fp8") else None
    for c in m.get("checkpoints", []):
        if c.get("disk_gb") and m.get("params_total_b"):
            c["bytes_per_param_avg"] = round(c["disk_gb"] / m["params_total_b"], 3)

catalog = {
 "meta": {
   "name": "LlmOnLan hardware x model catalog for the capacity explorer",
   "generated": "2026-10-07",
   "generator": "scratchpad/explorer/_work/build.py (curated facts + Hugging Face API dumps in _work/hf/, fetched 2026-10-07)",
   "units": {"memory_gib": "GiB (2^30) for VRAM and budgets", "disk_gb": "decimal GB (10^9) as files on disk; disk_gib also given", "bandwidth_gbs": "GB/s (10^9)",
             "kv_bytes_per_token_fp8": "bytes per token of context at 1 byte/element, attention KV only (excludes recurrent state and sliding-window constants)",
             "recurrent_state_bytes": "raw per-request state of linear/Mamba layers (fp32 state + bf16 conv); vLLM 0.30 align mode charged 2x raw, rounded to whole pages, on the two measured hybrids",
             "kv_constant_bytes_per_request": "sliding-window / chunked-attention KV that stops growing with context (fp8)",
             "tflops": "dense unless the field says sparse"},
   "fit_rule": "fit[<hw>@<budget>] has two verdicts, vllm_sglang (non-GGUF checkpoints) and llama_cpp (GGUF). Each picks the SMALLEST >=4-bit, non-BF16 checkpoint (most KV room), then <=3-bit ones (verdict 'fits only at <=3-bit'), BF16 last; weights = measured loaded GiB, else resident estimate, else file size. It must leave >= 4 GiB for KV on farm budgets (>= 1 GiB on single_user budgets); 'tight' below 8 GiB (2 GiB). people_by_kv_at_32k_est = 0.93 x KV room / (32,768 x kv/token + 2 x recurrent state + constants): vLLM 0.30-style accounting (align mode charges 2x the state; 0.93 = highest pool fill that passed in the spike); ignores page rounding, so it reads ~3-10% high (it gives 107 for Qwen3.6 in a 50 GiB pool where ESTIMATES has 96-110). KV capacity only - throughput usually binds first (RESULTS finding 5). Fit says nothing about speed: see reported_runs and spike_measured.",
   "dgx_spark_link_correction": "Two DGX Sparks link through their ConnectX-7 NICs (200 Gb/s Ethernet/RoCE over a QSFP cable), not NVLink.",
   "caveats": [
     "Only the RTX PRO 6000 and one DGX Spark were measured by the studio (3 models). Everything else is vendor data, community reports or estimates.",
     "Vendor benchmarks use different harnesses; cross-vendor rows are flagged vendor_reported=false.",
     "Community Spark numbers come from single posts with different builds, quants and speculative decoding; treat as order-of-magnitude.",
     "KV sizes for DeepSeek V4/V4.1, MiniMax M3, GLM-5.3(-Flash) and Qwen3.8-Flash-Next indexer caches are approximations."]},
 "hardware": HARDWARE,
 "models": MODELS,
 "spike_measured": SPIKE,
 "sources": SOURCES,
}
json.dump(catalog, open(OUT, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print("wrote", OUT, len(HARDWARE), "hardware,", len(MODELS), "models")
for m in MODELS:
    print("%-34s kv/tok %-8s state %-12s  fits: %s" % (m["id"], m.get("kv_bytes_per_token_fp8"), m.get("recurrent_state_bytes"),
          " ".join("%s=%s|%s" % (k.split("@")[0].replace("rtx-pro-", "p").replace("dgx-spark", "spk") + ("/" + k.split("@")[1][:4]), v["vllm_sglang"]["verdict"][:5], v["llama_cpp"]["verdict"][:5]) for k, v in m["fit"].items())))
