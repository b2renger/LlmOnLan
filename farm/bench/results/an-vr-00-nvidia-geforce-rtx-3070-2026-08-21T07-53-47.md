# Quant ladder benchmark - NVIDIA GeForce RTX 3070

- **Rig**: AN-VR-00 - NVIDIA GeForce RTX 3070 (8 GB) - 16 cores - 32 GB RAM
- **Software**: Ollama 0.32.14 - driver 591.74 - Node v24.14.0 - win32 10.0.26200
- **Settings**: repo `hf.co/unsloth/Qwen3.8-27B-GGUF` - ctx 8192 - max_tokens 300 - repeats 2 - MTP on - thinking off
- **Run**: 2026-08-21T07:53:47.676Z

## Speed

| Quant | Resident | 100% GPU? | tok/s median | tok/s range | TTFT p50 | GPU util avg | VRAM peak |
|---|---|---|---|---|---|---|---|
| UD-IQ1_S | 7.4 GB | **NO - spilled** | **8.4** | 8.1-8.8 | 2.33s | 29% | 6.71 GB |

> **Warning:** UD-IQ1_S did not fit fully in VRAM. Those numbers measure CPU offload, not the quant - exclude them when picking a winner.

## Answers - grouped by prompt for side-by-side quality comparison

### science

> Explain in about 150 words why the sky is blue.

**UD-IQ1_S** - 8.4 tok/s, 300 tokens

````
The sky appears blue due to the scattering of sunlight by the atmosphere. Sunlight is composed of many colors, and when it enters the atmosphere, the gases, dust, and other particles scatter the light in all directions. This is known as scattering. The scattering is not uniform; it is more likely for shorter wavelengths (blue light) than for longer wavelengths (red light). As a result, the blue light is scattered more than the red light. This is why the sky appears blue. The blue light is scattered more, and the red light is scattered less. The blue light is scattered more, and the red light is scattered less. The blue light is scattered more, and the red light is scattered less. The blue light is scattered more, and the red light is scattered less.

The sky appears blue due to the scattering of sunlight by the atmosphere. Sunlight is composed of many colors, and when it enters the atmosphere, the gases, dust, and other particles scatter the light in all directions. This is known as scattering. The scattering is not uniform; it is more likely for shorter wavelengths (blue light) than for longer wavelengths (red light). As a result, the blue light is scattered more than the red light. This is why the sky appears blue. The blue light is scattered more, and the red light is scattered less. The blue light is scattered more, and the red light is scattered less. The blue light is scattered more, and the red light is scattered
````

### reasoning

> A farmer has 17 sheep. All but 9 die. How many are left? Show your reasoning step by step, then give the final answer.

**UD-IQ1_S** - 8.8 tok/s, 139 tokens

````
Let's think about this. The problem states that a farmer has 17 sheep, and then says "All but 9 die." This means that 9 sheep are still alive (or "left"), and the rest die. So the number of sheep left is 9.

But let me reason through it more carefully:

- The farmer has 17 sheep.
- "All but 9 die" means that 9 sheep do **not** die (they survive), and the remaining 17 - 9 = 8 sheep die.
- So the number of sheep left (alive) is 9.

Final answer: **9**
````

### code

> Write a Python function that returns the nth Fibonacci number using memoization. Include a short docstring. Code only, no explanation.

**UD-IQ1_S** - 8.8 tok/s, 77 tokens

````
```python
def fib(n):
    """Returns the nth Fibonacci number using memoization."""
    memo = {0: 0, 1: 1}
    for i in range(2, n + 1):
        memo[i] = memo[i - 1] + memo[i - 2]
    return memo[n]
```
````

### french

> Explique en 150 mots environ le fonctionnement d une imprimante 3D a depot de filament.

**UD-IQ1_S** - 8.5 tok/s, 167 tokens

````
L'imprimante 3D à dépôt de filament (FDM) fonctionne selon le principe de la fusion et du dépôt. Le matériau, souvent une solution polymère (comme le PEG-DA) ou un pré-polymère, est d'abord mélangé avec des réactifs chimiques. Ce mélange est ensuite chargé dans la chambre d'extrusion.

L'extrusion se fait à travers une buse, où le polymère est fondu sous pression. Le polymère fondu est ensuite extrudé dans un moule en forme d'anneau. Ce moule est ensuite refroidi et polymérisé.

La structure finale est polymérisée dans un moule en forme d'anneau, ce qui donne un polymère à structure polymérisée.
````

### format

> List exactly 5 differences between TCP and UDP. One line each, no preamble, no conclusion.

**UD-IQ1_S** - 8.3 tok/s, 300 tokens

````
1. TCP is connection-oriented, while UDP is connectionless.
2. TCP provides reliable delivery, whereas UDP offers best-effort delivery.
4. TCP uses flow control, while UDP does not.
5. TCP is connection-oriented, and UDP is connectionless.

Wait, let me re-read the prompt. "List exactly 5 differences between TCP and UDP. One line each, no preamble, no conclusion."

Okay, 5 differences, one line each. Let me list 5 differences:

1. TCP is connection-oriented, UDP is connectionless.
2. TCP provides reliable delivery, UDP is best-effort.
3. TCP uses flow control, UDP does not.
4. TCP is connection-oriented, UDP is connectionless.

Wait, I'm repeating myself. Let me think of 5 distinct differences:

1. TCP is connection-oriented, UDP is connectionless.
2. TCP provides reliable delivery, UDP is best-effert.
3. TCP uses flow control, UDP does not.
4. TCP is connection-oriented, UDP is connectionless.

Hmm, I keep repeating. Let me think of 5 distinct differences:

1. TCP is connection-oriented, UDP is connectionless.
2. TCP provides reliable delivery, UDP is best-effort.
3. TCP uses flow control, UDP does not.
4. TCP is connection-oriented, UDP is connectionless.

Wait, I'm stuck
````
