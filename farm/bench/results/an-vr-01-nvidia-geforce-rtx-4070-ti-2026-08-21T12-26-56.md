# Quant ladder benchmark - NVIDIA GeForce RTX 4070 Ti

- **Rig**: AN-VR-01 - NVIDIA GeForce RTX 4070 Ti (12 GB) - 24 cores - 64 GB RAM
- **Software**: Ollama 0.32.14 - driver 610.88 - Node v24.14.0 - win32 10.0.26200
- **Settings**: repo `hf.co/unsloth/Qwen3.8-27B-GGUF` - prompts `hard` - max_tokens 700 - repeats 2 - thinking off
- **Sweep**: ctx 16384, 32768 x MTP on
- **Run**: 2026-08-21T12:26:56.277Z

## Speed

| Quant | ctx | MTP | Resident | 100% GPU? | tok/s median | tok/s range | TTFT p50 | GPU util | VRAM peak | Quality |
|---|---|---|---|---|---|---|---|---|---|---|
| UD-IQ2_XXS | 16384 | on | 8.5 GB | yes | **51.3** | 50.8-54.1 | 0.55s | 70% | 9.68 GB | 12/12 (100%) |
| UD-IQ2_XXS | 32768 | on | 9.6 GB | yes | **51.6** | 50.8-53.9 | 0.55s | 75% | 10.7 GB | 12/12 (100%) |

## Quality by prompt (pass rate over 2 repeats)

| Config | arith | json | constraints | recall | french | code-edge | total |
|---|---|---|---|---|---|---|---|
| UD-IQ2_XXS ctx16384 mtpon | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | **100%** |
| UD-IQ2_XXS ctx32768 mtpon | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | 2/2 | **100%** |

**Fastest config that fully fits: `UD-IQ2_XXS` at ctx 32768, MTP on - 51.6 tok/s, quality 100%.**

> Fastest is not automatically best: check the quality column before choosing. A config that is 15% quicker but drops a graded capability is the wrong trade for an assistant.

## Answers - grouped by prompt for side-by-side quality comparison

### arith

> Compute (47 * 83) - (19 * 23) + (1500 / 12). Show each intermediate result on one short line each, no LaTeX and no explanation. Put the final numeric answer alone on the last line.

**UD-IQ2_XXS** [ctx 16384, MTP on] - 51.3 tok/s, 60 tokens - **PASS**

````
47 * 83 = 3901
19 * 23 = 437
1500 / 12 = 125
3901 - 437 + 125 = 3589
````

**UD-IQ2_XXS** [ctx 32768, MTP on] - 51 tok/s, 69 tokens - **PASS**

````
47 * 83 = 3901
19 * 23 = 437
1500 / 12 = 125
3901 - 437 + 125
3464 + 125
3589
````

### json

> Return ONLY a JSON object. No markdown fence, no prose, no explanation. Exactly these keys: "name" (a string), "ports" (an array of exactly 3 integers), "active" (a boolean).

**UD-IQ2_XXS** [ctx 16384, MTP on] - 52.2 tok/s, 24 tokens - **PASS**

````
{"name":"Example","ports":[80,443,8080],"active":true}
````

**UD-IQ2_XXS** [ctx 32768, MTP on] - 51.7 tok/s, 38 tokens - **PASS**

````
{
  "name": "sample",
  "ports": [80, 443, 8080],
  "active": true
}
````

### constraints

> Write exactly 4 lines. Line 1 must start with the letter A, line 2 with B, line 3 with C, line 4 with D. Each line must be fewer than 40 characters. Use no punctuation anywhere. Output only the 4 lines.

**UD-IQ2_XXS** [ctx 16384, MTP on] - 51.1 tok/s, 23 tokens - **PASS**

````
A bird flies high
Beneath the blue sky
Clouds drift slowly
Dancing in the wind
````

**UD-IQ2_XXS** [ctx 32768, MTP on] - 52.2 tok/s, 20 tokens - **PASS**

````
A bird flies high
B is for blue
C is for cat
D is for dog
````

### recall

> What is the default TCP port for PostgreSQL, and what is the default TCP port for Redis? Answer with just the two numbers separated by a comma, nothing else.

**UD-IQ2_XXS** [ctx 16384, MTP on] - 54.1 tok/s, 10 tokens - **PASS**

````
5432,6379
````

**UD-IQ2_XXS** [ctx 32768, MTP on] - 53.9 tok/s, 11 tokens - **PASS**

````
5432, 6379
````

### french

> Explique en francais, en 120 mots environ, la difference entre la memoire VRAM et la memoire RAM systeme pour l inference d un modele de langage. Reponds uniquement en francais.

**UD-IQ2_XXS** [ctx 16384, MTP on] - 51.1 tok/s, 133 tokens - **PASS**

````
La VRAM est une mémoire dédiée à la carte graphique, extrêmement rapide pour les opérations massives parallèles. En revanche, la RAM système, bien plus lente et partagée par l'ensemble du système, sert de tampon pour les données d'entrée et de sortie. Pour l'inférence d'un modèle de langage, la VRAM est cruciale car elle héberge le modèle et les calculs de matrice, exigeant une bande passante massive. La RAM système, quant à elle, gère le prétraitement et la gestion des flux, mais ne peut pas rivaliser avec la VRAM pour le calcul intensif.
````

**UD-IQ2_XXS** [ctx 32768, MTP on] - 50.9 tok/s, 158 tokens - **PASS**

````
La VRAM (mémoire vidéo) est dédiée au GPU et stocke les poids du modèle ainsi que les activations pendant l'inférence. Elle offre une bande passante massive pour les opérations parallèles, ce qui accélère le calcul matriciel. En revanche, la RAM système (CPU) sert de mémoire de base pour le système d'exploitation et le chargement initial des données. Pour l'inférence, la VRAM est critique car elle héberge le calcul principal, tandis que la RAM système gère le prétraitement des entrées et la sortie finale. Utiliser la RAM système pour l'inférence est nettement plus lent et limité par la latence du CPU, rendant le processus inadapté aux charges lourdes.
````

### code-edge

> Write a Python function parse_range(s) that returns [3,4,5,6,7] for '3-7', returns [5] for '5', and raises ValueError for anything else. Code only, no explanation.

**UD-IQ2_XXS** [ctx 16384, MTP on] - 51 tok/s, 150 tokens - **PASS**

````
```python
def parse_range(s):
    s = s.strip()
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
            raise ValueError("Invalid range")
        return list(range(start, end + 1))
    else:
        try:
            value = int(s)
        except ValueError:
            raise ValueError("Invalid range format")
        return [value]
```
````

**UD-IQ2_XXS** [ctx 32768, MTP on] - 51 tok/s, 130 tokens - **PASS**

````
```python
def parse_range(s):
    s = s.strip()
    if s.isdigit():
        return [int(s)]
    if '-' in s:
        parts = s.split('-')
        if len(parts) == 2:
            a, b = parts
            if a.isdigit() and b.isdigit():
                start, end = int(a), int(b)
                if start <= end:
                    return list(range(start, end + 1))
        raise ValueError("Invalid range format: {}".format(s))
    raise ValueError("Invalid range format: {}".format(s))
```
````
