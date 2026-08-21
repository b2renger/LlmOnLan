# Quant ladder benchmark - NVIDIA RTX PRO 6000 Blackwell Workstation Edition

- **Rig**: AN-A6000PRO - NVIDIA RTX PRO 6000 Blackwell Workstation Edition (95.6 GB) - 32 cores - 126 GB RAM
- **Software**: Ollama 0.32.14 - driver 596.36 - Node v24.14.0 - win32 10.0.26200
- **Settings**: repo `hf.co/unsloth/Qwen3.8-27B-GGUF` - prompts `hard` - max_tokens 700 - repeats 1 - thinking off
- **Sweep**: ctx 8192 x MTP on
- **Run**: 2026-08-21T10:08:44.298Z

## Speed

| Quant | ctx | MTP | Resident | 100% GPU? | tok/s median | tok/s range | TTFT p50 | GPU util | VRAM peak | Quality |
|---|---|---|---|---|---|---|---|---|---|---|
| UD-IQ2_S | 8192 | on | 9.2 GB | yes | **111.7** | 110.6-112 | 0.28s | 61% | 12.2 GB | 6/6 (100%) |

## Quality by prompt (pass rate over 1 repeats)

| Config | arith | json | constraints | recall | french | code-edge | total |
|---|---|---|---|---|---|---|---|
| UD-IQ2_S ctx8192 mtpon | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | 1/1 | **100%** |

**Fastest config that fully fits: `UD-IQ2_S` at ctx 8192, MTP on - 111.7 tok/s, quality 100%.**

> Fastest is not automatically best: check the quality column before choosing. A config that is 15% quicker but drops a graded capability is the wrong trade for an assistant.

## Answers - grouped by prompt for side-by-side quality comparison

### arith

> Compute (47 * 83) - (19 * 23) + (1500 / 12). Show each intermediate result on one short line each, no LaTeX and no explanation. Put the final numeric answer alone on the last line.

**UD-IQ2_S** [ctx 8192, MTP on] - 111.1 tok/s, 18 tokens - **PASS**

````
3901
437
125
3589
````

### json

> Return ONLY a JSON object. No markdown fence, no prose, no explanation. Exactly these keys: "name" (a string), "ports" (an array of exactly 3 integers), "active" (a boolean).

**UD-IQ2_S** [ctx 8192, MTP on] - 110.6 tok/s, 24 tokens - **PASS**

````
{"name":"test","ports":[80,443,8080],"active":true}
````

### constraints

> Write exactly 4 lines. Line 1 must start with the letter A, line 2 with B, line 3 with C, line 4 with D. Each line must be fewer than 40 characters. Use no punctuation anywhere. Output only the 4 lines.

**UD-IQ2_S** [ctx 8192, MTP on] - 111.7 tok/s, 22 tokens - **PASS**

````
A bright day begins
Breezes blow softly
Clouds drift slowly
Dew drops glisten
````

### recall

> What is the default TCP port for PostgreSQL, and what is the default TCP port for Redis? Answer with just the two numbers separated by a comma, nothing else.

**UD-IQ2_S** [ctx 8192, MTP on] - 111.1 tok/s, 10 tokens - **PASS**

````
5432,6379
````

### french

> Explique en francais, en 120 mots environ, la difference entre la memoire VRAM et la memoire RAM systeme pour l inference d un modele de langage. Reponds uniquement en francais.

**UD-IQ2_S** [ctx 8192, MTP on] - 111.7 tok/s, 192 tokens - **PASS**

````
La VRAM, mémoire dédiée au GPU, est optimisée pour le calcul parallèle massif nécessaire à l'inférence. Elle offre une bande passante élevée et une latence faible, permettant de traiter simultanément des millions de paramètres. En revanche, la RAM système, généralement utilisée par le CPU, possède une bande passante plus faible et une latence supérieure.

Lorsqu'un modèle ne tient pas en VRAM, le système utilise la RAM comme dérivation. Cela entraîne un goulot d'étranglement majeur : le transfert de données entre le CPU et le GPU devient le facteur limitant, ralentissant drastiquement la génération des tokens.

Ainsi, bien que la RAM système serve de solution de repli, elle ne peut pas remplacer la VRAM en termes de performance pure. La VRAM est indispensable pour une inférence rapide, tandis que la RAM système sacrifie la vitesse pour la capacité de stockage.
````

### code-edge

> Write a Python function parse_range(s) that returns [3,4,5,6,7] for '3-7', returns [5] for '5', and raises ValueError for anything else. Code only, no explanation.

**UD-IQ2_S** [ctx 8192, MTP on] - 112 tok/s, 140 tokens - **PASS**

````
```python
def parse_range(s):
    if '-' in s:
        parts = s.split('-')
        if len(parts) != 2:
            raise ValueError("Invalid range")
        try:
            start = int(parts[0])
            end = int(parts[1])
        except ValueError:
            raise ValueError("Invalid range")
        if start > end:
            raise ValueError("Invalid range")
        return list(range(start, end + 1))
    else:
        try:
            n = int(s)
        except ValueError:
            raise ValueError("Invalid range")
        return [n]
```
````
