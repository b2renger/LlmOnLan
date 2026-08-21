# Quant ladder benchmark - NVIDIA RTX PRO 6000 Blackwell Workstation Edition

- **Rig**: AN-A6000PRO - NVIDIA RTX PRO 6000 Blackwell Workstation Edition (95.6 GB) - 32 cores - 126 GB RAM
- **Software**: Ollama 0.32.14 - driver 596.36 - Node v24.14.0 - win32 10.0.26200
- **Settings**: repo `hf.co/unsloth/Qwen3.8-27B-GGUF` - prompts `hard` - max_tokens 700 - repeats 3 - thinking off
- **Sweep**: ctx 8192 x MTP on
- **Run**: 2026-08-21T10:09:12.056Z

## Speed

| Quant | ctx | MTP | Resident | 100% GPU? | tok/s median | tok/s range | TTFT p50 | GPU util | VRAM peak | Quality |
|---|---|---|---|---|---|---|---|---|---|---|
| UD-IQ1_S | 8192 | on | 7.0 GB | yes | **127.7** | 3.3-130.5 | 0.30s | 66% | 10.25 GB | 10/18 (56%) |
| UD-IQ1_M | 8192 | on | 7.5 GB | yes | **124.9** | 3.3-126.3 | 0.30s | 70% | 10.78 GB | 13/18 (72%) |
| UD-IQ2_XXS | 8192 | on | 8.1 GB | yes | **122.4** | 3.6-123.8 | 0.30s | 70% | 10.65 GB | 16/18 (89%) |
| UD-IQ2_S | 8192 | on | 9.2 GB | yes | **114.3** | 113.4-115.3 | 0.30s | 65% | 11.68 GB | 16/18 (89%) |

## Quality by prompt (pass rate over 3 repeats)

| Config | arith | json | constraints | recall | french | code-edge | total |
|---|---|---|---|---|---|---|---|
| UD-IQ1_S ctx8192 mtpon | 0/3 | 3/3 | 1/3 | 3/3 | 3/3 | 0/3 | **56%** |
| UD-IQ1_M ctx8192 mtpon | 0/3 | 2/3 | 3/3 | 2/3 | 3/3 | 3/3 | **72%** |
| UD-IQ2_XXS ctx8192 mtpon | 1/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | **89%** |
| UD-IQ2_S ctx8192 mtpon | 1/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | **89%** |

**Fastest config that fully fits: `UD-IQ1_S` at ctx 8192, MTP on - 127.7 tok/s, quality 56%.**

> Fastest is not automatically best: check the quality column before choosing. A config that is 15% quicker but drops a graded capability is the wrong trade for an assistant.

## Answers - grouped by prompt for side-by-side quality comparison

### arith

> Compute (47 * 83) - (19 * 23) + (1500 / 12). Show each intermediate result on one short line each, no LaTeX and no explanation. Put the final numeric answer alone on the last line.

**UD-IQ1_S** [ctx 8192, MTP on] - 130.5 tok/s, 160 tokens - **FAIL** (3901-437+125=3589)

````
Here is the step-by-step calculation:

1. Calculate the product of 47 and 83.
2. Calculate the product of 19 and 23.
3. Calculate the division of 1500 by 12.
4. Subtract the second product from the first product.
5. Add the result of the division to the result of the subtraction.

47 * 83 = 3907
19 * 23 = 437
1500 / 12 = 125
3907 - 437 = 3470
3470 + 125 = 3595

3595
````

**UD-IQ1_M** [ctx 8192, MTP on] - 123.2 tok/s, 17 tokens - **FAIL** (3901-437+125=3589)

````
3941
437
125
434
````

**UD-IQ2_XXS** [ctx 8192, MTP on] - 123 tok/s, 60 tokens - **PASS**

````
47 * 83 = 3901
19 * 23 = 437
1500 / 12 = 125
3901 - 437 + 125 = 3589
````

**UD-IQ2_S** [ctx 8192, MTP on] - 114 tok/s, 13 tokens - **FAIL** (3901-437+125=3589)

````
3901
437
125
````

### json

> Return ONLY a JSON object. No markdown fence, no prose, no explanation. Exactly these keys: "name" (a string), "ports" (an array of exactly 3 integers), "active" (a boolean).

**UD-IQ1_S** [ctx 8192, MTP on] - 129.7 tok/s, 24 tokens - **PASS**

````
{"name":"example","ports":[80,443,8080],"active":true}
````

**UD-IQ1_M** [ctx 8192, MTP on] - 126 tok/s, 31 tokens - **PASS**

````
{"name": "example_service", "ports": [8080, 443, 22], "active": true}
````

**UD-IQ2_XXS** [ctx 8192, MTP on] - 121.8 tok/s, 24 tokens - **PASS**

````
{"name":"example","ports":[80,443,8080],"active":true}
````

**UD-IQ2_S** [ctx 8192, MTP on] - 114.3 tok/s, 24 tokens - **PASS**

````
{"name":"example","ports":[80,443,8080],"active":true}
````

### constraints

> Write exactly 4 lines. Line 1 must start with the letter A, line 2 with B, line 3 with C, line 4 with D. Each line must be fewer than 40 characters. Use no punctuation anywhere. Output only the 4 lines.

**UD-IQ1_S** [ctx 8192, MTP on] - 129.8 tok/s, 418 tokens - **FAIL** (38 lines, expected 4)

````
Let's think. I need to write 4 lines.

Line 1 starts with "A".
Line 2 starts with "B".
Line  3 starts with "C".
Line 4 starts with "D".

Each line must be fewer than 40 characters.
No punctuation anywhere.
Output only the 4 lines.

Let's draft some lines:

Line 1: A bird sees the sky
Line 2: B is for being bold
Line 3: C is for calm and clear
Line 4: D is for doing it well

Wait, no punctuation. So no periods, no commas, no quotes. Just plain text.

Let's check character counts.

Line 1: A bird sees the sky -> 19 chars. Good.
Line 2: B is for being bold -> 19 chars. Good.
Line 3: C is for calm and clear -> 23 chars. Good.
Line 4: D is for doing it well -> 22 chars. Good.

But wait, the user said "Use no punctuation anywhere". So no periods, no commas, no exclamation marks, etc. Just the raw text.

Output only the 4 lines. So I should output:

A bird sees the sky
B is for being bold
C is for calm and clear
D is for doing it well

But wait, the user said "Output only the 4 lines." So I should output exactly those 4 lines.

Let me double-check:
Line 1 starts with A. Good.
Line 2 starts with B. Good.
Line 3 starts with C. Good.
Line 4 starts with D. Good.
Each line is fewer than 40 characters. Good.
No punctuation. Good.

So the output is:

A bird sees the sky
B is for being bold
C is for calm and clear
D is for doing it well
````

**UD-IQ1_M** [ctx 8192, MTP on] - 123.1 tok/s, 24 tokens - **PASS**

````
A is the first letter
B is the second letter
C is the third letter
D is the fourth letter
````

**UD-IQ2_XXS** [ctx 8192, MTP on] - 122.4 tok/s, 24 tokens - **PASS**

````
A bird flies high
Beneath the blue sky
Calm clouds drift by
Dawn breaks the night
````

**UD-IQ2_S** [ctx 8192, MTP on] - 114.1 tok/s, 17 tokens - **PASS**

````
A bird sings
Blue sky above
Clouds drift by
Dawn breaks
````

### recall

> What is the default TCP port for PostgreSQL, and what is the default TCP port for Redis? Answer with just the two numbers separated by a comma, nothing else.

**UD-IQ1_S** [ctx 8192, MTP on] - 120.9 tok/s, 11 tokens - **PASS**

````
5432, 6379
````

**UD-IQ1_M** [ctx 8192, MTP on] - 119 tok/s, 10 tokens - **PASS**

````
5432,6379
````

**UD-IQ2_XXS** [ctx 8192, MTP on] - 119.6 tok/s, 11 tokens - **PASS**

````
5432, 6379
````

**UD-IQ2_S** [ctx 8192, MTP on] - 113.6 tok/s, 10 tokens - **PASS**

````
5432,6379
````

### french

> Explique en francais, en 120 mots environ, la difference entre la memoire VRAM et la memoire RAM systeme pour l inference d un modele de langage. Reponds uniquement en francais.

**UD-IQ1_S** [ctx 8192, MTP on] - 130.5 tok/s, 139 tokens - **PASS**

````
L'inférence d'un modèle de langage repose sur deux mémoires distinctes. La mémoire système (RAM) sert d'abord à charger les poids du modèle et les tokens de l'input dans le système de mémoire système. Ensuite, le calcul de l'inférence se fait dans la mémoire VRAM. La VRAM est utilisée pour stocker les résultats intermédiaires et les activations des couches de réseau. La RAM système est utilisée pour stocker les poids du modèle et les tokens de l'input, ainsi que pour les calculs intermédiaires. La VRAM est utilisée pour stocker les résultats intermédiaires et les activations des couches de réseau.
````

**UD-IQ1_M** [ctx 8192, MTP on] - 125.1 tok/s, 168 tokens - **PASS**

````
La mémoire VRAM et la mémoire RAM système sont distinctes lors de l'inférence d'un modèle de langage. La VRAM, située sur la carte graphique (GPU), est utilisée pour stocker les poids du modèle et effectuer les calculs massifs de la matrice de multiplication. Elle offre une bande passante élevée, cruciale pour le calcul parallisé des opérations matricielles. En revanche, la RAM système (CPU) sert à charger les données initiales et à gérer la logique de contrôle. Pour les modèles LLM, la VRAM doit contenir l'architecture complète du réseau. Si la VRAM est insuffisante, le système utilise la RAM comme déborde, ce qui ralentit considérablement l'inférence en raison du goulet de communication entre les unités.
````

**UD-IQ2_XXS** [ctx 8192, MTP on] - 123.7 tok/s, 143 tokens - **PASS**

````
La VRAM (mémoire vidéo) est dédiée au GPU et stocke les poids du modèle ainsi que les activations. La RAM système, quant à elle, sert de tampon pour les données d'entrée (tokens) et les sorties finales. En inférence, le GPU requiert une VRAM suffisante pour charger le modèle et effectuer les calculs matriciels massifs. La RAM système gère le pré-traitement des données brutes avant leur envoi vers le GPU, puis reçoit les résultats bruts. La VRAM offre une bande passante immense pour les opérations parallèles, tandis que la RAM système assure la liaison logicielle entre l'application et le matériel.
````

**UD-IQ2_S** [ctx 8192, MTP on] - 114.2 tok/s, 204 tokens - **PASS**

````
La VRAM (mémoire vidéo) est un type de mémoire dédiée aux cartes graphiques, conçue pour un débit de données extrêmement élevé et une latence faible. Pour l'inférence des modèles de langage, cette rapidité est cruciale car les opérations matricielles (comme les multiplications de matrices) nécessitent un accès constant et rapide aux poids du modèle.

En revanche, la RAM système (généralement de la DDR) est plus lente et possède une latence supérieure. Bien qu'elle soit plus abordable et plus abondante, son débit limité crée un goulot d'étranglement significatif lors du calcul des jetons.

Ainsi, utiliser la VRAM accélère considérablement la génération du texte. La RAM système, bien qu'utile pour le stockage des données ou le prétraitement, est trop lente pour le calcul intensif de l'inférence elle-même, rendant la VRAM indispensable pour les performances optimales.
````

### code-edge

> Write a Python function parse_range(s) that returns [3,4,5,6,7] for '3-7', returns [5] for '5', and raises ValueError for anything else. Code only, no explanation.

**UD-IQ1_S** [ctx 8192, MTP on] - 3.6 tok/s, 1 tokens - **FAIL** (0/3 structural markers (def, ValueError, range))

````
(empty)
````

**UD-IQ1_M** [ctx 8192, MTP on] - 125.1 tok/s, 110 tokens - **PASS**

````
```python
def parse_range(s):
    if isinstance(s, int):
        return [s]
    if isinstance(s, str):
        if '-' in s:
            parts = s.split('-')
            if len(parts) == 2:
                start, end = int(parts[0]), int(parts[1])
                return list(range(start, end + 1))
        else:
            raise ValueError("Invalid range format")
    else:
        raise ValueError("Invalid input type")
````

**UD-IQ2_XXS** [ctx 8192, MTP on] - 123.4 tok/s, 134 tokens - **PASS**

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
        start, end = int(start), int(end)
        if start >= end:
            raise ValueError("Invalid range format")
        return list(range(start, end + 1))
    raise ValueError("Invalid format")
```
````

**UD-IQ2_S** [ctx 8192, MTP on] - 114.9 tok/s, 163 tokens - **PASS**

````
```python
def parse_range(s):
    if not isinstance(s, str):
        raise ValueError("Input must be a string")
    
    if '-' in s:
        parts = s.split('-')
        if len(parts) != 2:
            raise ValueError("Invalid range format")
        try:
            start = int(parts[0])
            end = int(parts[1])
        except ValueError:
            raise ValueError("Invalid range format")
        if start > end:
            raise ValueError("Invalid range")
        return list(range(start, end + 1))
    else:
        try:
            num = int(s)
        except ValueError:
            raise ValueError("Invalid input")
        return [num]
```
````
