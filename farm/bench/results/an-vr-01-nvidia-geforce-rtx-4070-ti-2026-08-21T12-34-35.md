# Quant ladder benchmark - NVIDIA GeForce RTX 4070 Ti

- **Rig**: AN-VR-01 - NVIDIA GeForce RTX 4070 Ti (12 GB) - 24 cores - 64 GB RAM
- **Software**: Ollama 0.32.14 - driver 610.88 - Node v24.14.0 - win32 10.0.26200
- **Settings**: repo `hf.co/unsloth/Qwen3.8-27B-GGUF` - prompts `hard` - max_tokens 700 - repeats 2 - thinking off
- **Sweep**: ctx 16384, 32768 x MTP on
- **Run**: 2026-08-21T12:34:35.295Z

## Speed

| Quant | ctx | MTP | Resident | 100% GPU? | tok/s median | tok/s range | TTFT p50 | GPU util | VRAM peak | Quality |
|---|---|---|---|---|---|---|---|---|---|---|
| UD-IQ2_XXS | 16384 | on | 8.5 GB | yes | **51.9** | 1.8-54.5 | 0.54s | 72% | 9.68 GB | 10/12 (83%) |
| UD-IQ2_XXS | 32768 | on | 9.6 GB | yes | **51.5** | 50.8-53.8 | 0.54s | 74% | 10.7 GB | 10/12 (83%) |

## Quality by prompt (pass rate over 2 repeats)

| Config | arith | json | constraints | recall | french | code-edge | total |
|---|---|---|---|---|---|---|---|
| UD-IQ2_XXS ctx16384 mtpon | 0/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | **83%** |
| UD-IQ2_XXS ctx32768 mtpon | 1/2 | 2/2 | 1/2 | 2/2 | 2/2 | 2/2 | **83%** |

**Fastest config that fully fits: `UD-IQ2_XXS` at ctx 16384, MTP on - 51.9 tok/s, quality 83%.**

> Fastest is not automatically best: check the quality column before choosing. A config that is 15% quicker but drops a graded capability is the wrong trade for an assistant.

## Answers - grouped by prompt for side-by-side quality comparison

### arith

> Compute (47 * 83) - (19 * 23) + (1500 / 12). Show each intermediate result on one short line each, no LaTeX and no explanation. Put the final numeric answer alone on the last line.

**UD-IQ2_XXS** [ctx 16384, MTP on] - 1.8 tok/s, 1 tokens - **FAIL** (3901-437+125=3589)

````
(empty)
````

**UD-IQ2_XXS** [ctx 32768, MTP on] - 52.8 tok/s, 20 tokens - **FAIL** (3901-437+125=3589)

````
391
437
125
391
437
````

### json

> Return ONLY a JSON object. No markdown fence, no prose, no explanation. Exactly these keys: "name" (a string), "ports" (an array of exactly 3 integers), "active" (a boolean).

**UD-IQ2_XXS** [ctx 16384, MTP on] - 51.9 tok/s, 30 tokens - **PASS**

````
{"name": "example", "ports": [80, 443, 8080], "active": true}
````

**UD-IQ2_XXS** [ctx 32768, MTP on] - 52.4 tok/s, 24 tokens - **PASS**

````
{"name":"example","ports":[80,443,8080],"active":true}
````

### constraints

> Write exactly 4 lines. Line 1 must start with the letter A, line 2 with B, line 3 with C, line 4 with D. Each line must be fewer than 40 characters. Use no punctuation anywhere. Output only the 4 lines.

**UD-IQ2_XXS** [ctx 16384, MTP on] - 52.3 tok/s, 19 tokens - **PASS**

````
A bird flies high
B is the second letter
C is close
D is down
````

**UD-IQ2_XXS** [ctx 32768, MTP on] - 51.5 tok/s, 35 tokens - **PASS**

````
A bird flies high in the sky
B is the second letter of the alphabet
C is the third letter of the alphabet
D is the fourth letter of the alphabet
````

### recall

> What is the default TCP port for PostgreSQL, and what is the default TCP port for Redis? Answer with just the two numbers separated by a comma, nothing else.

**UD-IQ2_XXS** [ctx 16384, MTP on] - 54.5 tok/s, 11 tokens - **PASS**

````
5432, 6379
````

**UD-IQ2_XXS** [ctx 32768, MTP on] - 53.7 tok/s, 11 tokens - **PASS**

````
5432, 6379
````

### french

> Explique en francais, en 120 mots environ, la difference entre la memoire VRAM et la memoire RAM systeme pour l inference d un modele de langage. Reponds uniquement en francais.

**UD-IQ2_XXS** [ctx 16384, MTP on] - 50.8 tok/s, 148 tokens - **PASS**

````
La VRAM, dédiée au GPU, offre une bande passante massive pour traiter les matrices de poids, accélérant ainsi les opérations de calcul intensives. La RAM système, gérée par le CPU, sert de mémoire de base pour les tâches logiques générales. Pour l'inférence, la VRAM stocke les poids du modèle et les activations pour un accès ultra-rapide. La RAM système, quant à elle, gère le flux d'entrée et la mémoire de contexte. Utiliser la VRAM pour les calculs matriciels évite le goulot d'étranglement de latence, permettant des débits de génération de texte bien supérieurs à ceux obtenus via la seule mémoire système.
````

**UD-IQ2_XXS** [ctx 32768, MTP on] - 50.9 tok/s, 179 tokens - **PASS**

````
La VRAM, dédiée au GPU, offre une bande passante élevée pour les opérations massivement parallèles, permettant d'accelérer le calcul des produits de matrices (GEMM) nécessaires à l'inférence. La RAM système, gérée par le CPU, a une bande passante inférieure et une latence supérieure, limitant la vitesse d'exécution.

Pour un modèle de langage, la VRAM stocke les poids et les activations sur la carte graphique, réduisant le temps de réponse et la latence par token. La RAM système, quant à elle, stocke les poids sur le processeur, ralentissant considérablement l'inférence. En somme, la VRAM optimise la vitesse de calcul, tandis que la RAM système offre une capacité de stockage plus grande, mais au prix d'une performance nettement inférieure.
````

### code-edge

> Write a Python function parse_range(s) that returns [3,4,5,6,7] for '3-7', returns [5] for '5', and raises ValueError for anything else. Code only, no explanation.

**UD-IQ2_XXS** [ctx 16384, MTP on] - 50.8 tok/s, 209 tokens - **PASS**

````
```python
def parse_range(s):
    if not isinstance(s, str):
        raise ValueError("Input must be a string")
    
    s = s.strip()
    if not s:
        raise ValueError("Empty string")
    
    # Try to parse as a range "a-b"
    if '-' in s:
        parts = s.split('-')
        if len(parts) != 2:
            raise ValueError("Invalid range format")
        a, b = parts
        if not a.isdigit() or not b.isdigit():
            raise ValueError("Non-numeric values in range")
        start, end = int(a), int(b)
        if end < start:
            raise ValueError("End must be greater than start")
        return list(range(start, end + 1))
    
    # Try to parse as a single number
    if s.isdigit():
        return [int(s)]
    
    raise ValueError("Invalid input format")
```
````

**UD-IQ2_XXS** [ctx 32768, MTP on] - 51 tok/s, 147 tokens - **PASS**

````
```python
def parse_range(s):
    if s.isdigit():
        return [int(s)]
    if '-' in s:
        parts = s.split('-')
        if len(parts) != 2:
            raise ValueError("Invalid range format")
        start, end = parts
        if not start.isdigit() or not end.isdigit():
            raise ValueError("Invalid range format")
        start_val = int(start)
        end_val = int(end)
        if start_val > end_val:
            raise ValueError("Invalid range: start greater than end")
        return list(range(start_val, end_val + 1))
    raise ValueError("Invalid range format")
```
````
