# Quant ladder benchmark - NVIDIA GeForce RTX 4070 Ti

- **Rig**: AN-VR-01 - NVIDIA GeForce RTX 4070 Ti (12 GB) - 24 cores - 64 GB RAM
- **Software**: Ollama 0.32.15 - driver 610.88 - Node v24.14.0 - win32 10.0.26200
- **Settings**: repo `hf.co/unsloth/Qwen3.8-27B-GGUF` - prompts `hard` - max_tokens 700 - repeats 2 - thinking off
- **Sweep**: ctx 16384, 32768 x MTP on
- **Run**: 2026-08-21T13:02:49.722Z

## Speed

| Quant | ctx | MTP | Resident | 100% GPU? | tok/s median | tok/s range | TTFT p50 | GPU util | VRAM peak | Quality |
|---|---|---|---|---|---|---|---|---|---|---|
| UD-IQ2_XXS | 16384 | on | 8.5 GB | yes | **51.5** | 50.6-53.8 | 0.22s | 90% | 9.68 GB | 12/12 (100%) |
| UD-IQ2_XXS | 32768 | on | 9.6 GB | yes | **51.4** | 4.5-55.2 | 0.23s | 85% | 10.7 GB | 10/12 (83%) |

## Quality by prompt (pass rate over 2 repeats)

| Config | arith | json | constraints | recall | french | code-edge | total |
|---|---|---|---|---|---|---|---|
| UD-IQ2_XXS ctx16384 mtpon | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | **100%** |
| UD-IQ2_XXS ctx32768 mtpon | 0/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | **83%** |

**Fastest config that fully fits: `UD-IQ2_XXS` at ctx 16384, MTP on - 51.5 tok/s, quality 100%.**

> Fastest is not automatically best: check the quality column before choosing. A config that is 15% quicker but drops a graded capability is the wrong trade for an assistant.

## Answers - grouped by prompt for side-by-side quality comparison

### arith

> Compute (47 * 83) - (19 * 23) + (1500 / 12). Show each intermediate result on one short line each, no LaTeX and no explanation. Put the final numeric answer alone on the last line.

**UD-IQ2_XXS** [ctx 16384, MTP on] - 51.2 tok/s, 60 tokens - **PASS**

````
47 * 83 = 3901
19 * 23 = 437
1500 / 12 = 125
3901 - 437 + 125 = 3589
````

**UD-IQ2_XXS** [ctx 32768, MTP on] - 4.5 tok/s, 1 tokens - **FAIL** (3901-437+125=3589)

````
(empty)
````

### json

> Return ONLY a JSON object. No markdown fence, no prose, no explanation. Exactly these keys: "name" (a string), "ports" (an array of exactly 3 integers), "active" (a boolean).

**UD-IQ2_XXS** [ctx 16384, MTP on] - 51.9 tok/s, 24 tokens - **PASS**

````
{"name":"example","ports":[80,443,8080],"active":true}
````

**UD-IQ2_XXS** [ctx 32768, MTP on] - 51.5 tok/s, 30 tokens - **PASS**

````
{"name": "example", "ports": [80, 443, 8080], "active": true}
````

### constraints

> Write exactly 4 lines. Line 1 must start with the letter A, line 2 with B, line 3 with C, line 4 with D. Each line must be fewer than 40 characters. Use no punctuation anywhere. Output only the 4 lines.

**UD-IQ2_XXS** [ctx 16384, MTP on] - 51.8 tok/s, 23 tokens - **PASS**

````
A bird flies high
Beneath the blue sky
Calm winds blow softly
Days bring new joys
````

**UD-IQ2_XXS** [ctx 32768, MTP on] - 51.8 tok/s, 16 tokens - **PASS**

````
A big apple
B is best
C is cool
D is done
````

### recall

> What is the default TCP port for PostgreSQL, and what is the default TCP port for Redis? Answer with just the two numbers separated by a comma, nothing else.

**UD-IQ2_XXS** [ctx 16384, MTP on] - 53.7 tok/s, 11 tokens - **PASS**

````
5432, 6379
````

**UD-IQ2_XXS** [ctx 32768, MTP on] - 53.8 tok/s, 10 tokens - **PASS**

````
5432,6379
````

### french

> Explique en francais, en 120 mots environ, la difference entre la memoire VRAM et la memoire RAM systeme pour l inference d un modele de langage. Reponds uniquement en francais.

**UD-IQ2_XXS** [ctx 16384, MTP on] - 50.7 tok/s, 179 tokens - **PASS**

````
La VRAM (mémoire vidéo) est dédiée à la GPU et offre une bande passante massive pour traiter les poids du modèle et les activations en parallèle. Elle est essentielle pour l'inférence haute vitesse, car les opérations matricielles y sont exécutées à très haute fréquence.

La RAM système, en revanche, est partagée avec le CPU et le reste du système. Sa bande passante est bien plus faible et elle sert de stockage temporaire pour les données d'entrée ou de sortie. Si le modèle dépasse la VRAM, l'inférence bascule sur la RAM système, devenant alors extrêmement lente.

En résumé, la VRAM est le moteur de vitesse pour le calcul des tokens, tandis que la RAM système n'est qu'un espace de transit lent, limitant les performances si la VRAM est saturée.
````

**UD-IQ2_XXS** [ctx 32768, MTP on] - 50.7 tok/s, 180 tokens - **PASS**

````
La distinction entre la VRAM et la RAM système est fondamentale pour l'inférence de modèles de langage. La VRAM, dédiée au GPU, offre une bande passante massive et une latence minimale, permettant l'exécution parallèle rapide des opérations matricielles lourdes. C'est le choix idéal pour les modèles performants nécessitant une vitesse d'exécution élevée.

En revanche, la RAM système (CPU) offre une capacité mémoire souvent plus grande et un coût par gigaoctet inférieur, mais avec des temps de latence beaucoup plus longs. Pour l'inférence, cela signifie que la génération du texte sera nettement plus lente. Par conséquent, le choix dépend de l'objectif : privilégier la VRAM pour la rapidité et le débit, ou la RAM système pour charger des modèles très volumineux sur du matériel plus accessible.
````

### code-edge

> Write a Python function parse_range(s) that returns [3,4,5,6,7] for '3-7', returns [5] for '5', and raises ValueError for anything else. Code only, no explanation.

**UD-IQ2_XXS** [ctx 16384, MTP on] - 50.7 tok/s, 136 tokens - **PASS**

````
```python
def parse_range(s):
    if '-' in s:
        parts = s.split('-')
        if len(parts) != 2:
            raise ValueError("Invalid range format")
        try:
            start = int(parts[0])
            end = int(parts[1])
        except ValueError:
            raise ValueError("Invalid range format")
        if start >= end:
            raise ValueError("Invalid range format")
        return list(range(start, end + 1))
    else:
        if not s.isdigit():
            raise ValueError("Invalid range format")
        return [int(s)]
```
````

**UD-IQ2_XXS** [ctx 32768, MTP on] - 50.7 tok/s, 141 tokens - **PASS**

````
```python
def parse_range(s):
    if s.isdigit():
        return [int(s)]
    if '-' in s:
        parts = s.split('-')
        if len(parts) != 2:
            raise ValueError("Invalid range format")
        a, b = parts
        if not a.isdigit() or not b.isdigit():
            raise ValueError("Invalid range format")
        a, b = int(a), int(b)
        if a >= b:
            raise ValueError("Invalid range: start must be less than end")
        return list(range(a, b + 1))
    raise ValueError("Invalid input format")
```
````
