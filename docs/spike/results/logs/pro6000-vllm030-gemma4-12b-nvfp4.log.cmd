[serve] 2026-10-09T16:28:00+02:00 host=AN-A6000PRO pgid=1369 port=8177 model=/home/ateliernum/lol-vllm-scratch/hf/gemma-4-12b-it-NVFP4 daemon=1 min_free_gb=off
[serve] GPU before start: 17950 MiB, 97887 MiB
INFO 10-09 16:28:06 [api_utils.py:286] non-default args: {'model_tag': '/home/ateliernum/lol-vllm-scratch/hf/gemma-4-12b-it-NVFP4', 'enable_auto_tool_choice': True, 'tool_call_parser': 'gemma4', 'uds': '/home/ateliernum/lol-vllm-scratch/run/vllm.sock', 'model': '/home/ateliernum/lol-vllm-scratch/hf/gemma-4-12b-it-NVFP4', 'max_model_len': 65536, 'served_model_name': ['gemma-4-12b'], 'override_generation_config': {'max_new_tokens': 32768}, 'reasoning_parser': 'gemma4', 'kv_cache_memory_bytes': 55834574848, 'kv_cache_dtype': 'fp8', 'enable_prefix_caching': True, 'limit_mm_per_prompt': {'image': 4, 'audio': 1, 'video': 0}, 'max_num_seqs': 192}
INFO 10-09 16:28:15 [config.py:252] Gemma4 model has heterogeneous head dimensions {'sliding_attention': 256, 'full_attention': 512}. FA4 not available, forcing TRITON_ATTN backend.
WARNING 10-09 16:28:15 [cuda.py:351] Forcing --disable_chunked_mm_input for models with multimodal-bidirectional attention.
INFO 10-09 16:28:31 [cuda.py:478] Using AttentionBackendEnum.TRITON_ATTN backend.
INFO 10-09 16:28:37 [model_runner.py:428] Model loading took 9.25 GiB memory and 6.697128 seconds
INFO 10-09 16:29:40 [monitor.py:53] torch.compile took 54.26 s in total
INFO 10-09 16:31:37 [gpu_worker.py:559] Initial free memory 93.04 GiB, reserved 52.0 GiB memory for KV Cache as specified by kv_cache_memory_bytes config and skipped memory profiling. This does not respect the gpu_memory_utilization config. Only use kv_cache_memory_bytes config when you want manual control of KV cache memory size. If OOM'ed, check the difference of initial free memory between the current run and the previous run where kv_cache_memory_bytes is suggested and update it correspondingly.
INFO 10-09 16:31:38 [kv_cache_utils.py:2395] GPU KV cache size: 1,078,887 tokens, Maximum concurrency for 65,536 tokens per request: 16.46x
INFO 10-09 16:33:00 [kv_cache_utils.py:748] kv cache group sizes [16, 16, 16, 16, 16, 64]
WARNING 10-09 16:33:26 [model.py:1772] Default vLLM sampling parameters have been overridden by the model's `generation_config.json`: `{'temperature': 1.0, 'top_k': 64, 'top_p': 0.95, 'max_tokens': 32768}`. If this is not intended, please relaunch vLLM instance with `--generation-config vllm`.
[serve] 2026-10-09T16:33:29+02:00 ready: http://127.0.0.1:8177/v1
