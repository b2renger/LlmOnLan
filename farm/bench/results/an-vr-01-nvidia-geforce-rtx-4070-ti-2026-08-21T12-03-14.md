# Quant ladder benchmark - NVIDIA GeForce RTX 4070 Ti

- **Rig**: AN-VR-01 - NVIDIA GeForce RTX 4070 Ti (12 GB) - 24 cores - 64 GB RAM
- **Software**: Ollama 0.32.14 - driver 610.88 - Node v24.14.0 - win32 10.0.26200
- **Settings**: repo `hf.co/unsloth/Qwen3.8-27B-GGUF` - prompts `hard` - max_tokens 700 - repeats 3 - thinking off
- **Sweep**: ctx 8192, 65536 x MTP on
- **Run**: 2026-08-21T12:03:14.701Z

## Speed

| Quant | ctx | MTP | Resident | 100% GPU? | tok/s median | tok/s range | TTFT p50 | GPU util | VRAM peak | Quality |
|---|---|---|---|---|---|---|---|---|---|---|
| UD-IQ1_S | 8192 | on | 7.0 GB | yes | **57.9** | 56.6-87 | 0.55s | 66% | 8.3 GB | 12/18 (67%) |
| UD-IQ1_S | 65536 | on | 11 GB | **NO - spilled** | **19.9** | 1.4-40.8 | 0.65s | 31% | 10.77 GB | 12/18 (67%) |
| UD-IQ1_M | 8192 | on | 7.4 GB | yes | **54.6** | 1.8-57.8 | 0.55s | 72% | 8.68 GB | 16/18 (89%) |
| UD-IQ1_M | 65536 | on | 12 GB | **NO - spilled** | **13** | 12.4-15.6 | 0.73s | 31% | 10.73 GB | 15/18 (83%) |
| UD-IQ2_XXS | 8192 | on | 7.9 GB | yes | **51.8** | 50.8-58.1 | 0.55s | 73% | 9.18 GB | 17/18 (94%) |
| UD-IQ2_XXS | 65536 | on | 12 GB | **NO - spilled** | **10.4** | 1.4-15.8 | 0.78s | 35% | 10.73 GB | 15/18 (83%) |
| UD-IQ2_S | 8192 | on | 9.0 GB | yes | **46.9** | 45.5-49 | 0.55s | 79% | 10.2 GB | 16/18 (89%) |
| UD-IQ2_S | 65536 | on | 13 GB | **NO - spilled** | **8.1** | 7.7-11.7 | 0.90s | 30% | 10.78 GB | 17/18 (94%) |

## Quality by prompt (pass rate over 3 repeats)

| Config | arith | json | constraints | recall | french | code-edge | total |
|---|---|---|---|---|---|---|---|
| UD-IQ1_S ctx8192 mtpon | 0/3 | 3/3 | 0/3 | 3/3 | 3/3 | 3/3 | **67%** |
| UD-IQ1_S ctx65536 mtpon **(spilled)** | 2/3 | 3/3 | 1/3 | 3/3 | 3/3 | 0/3 | **67%** |
| UD-IQ1_M ctx8192 mtpon | 1/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | **89%** |
| UD-IQ1_M ctx65536 mtpon **(spilled)** | 0/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | **83%** |
| UD-IQ2_XXS ctx8192 mtpon | 2/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | **94%** |
| UD-IQ2_XXS ctx65536 mtpon **(spilled)** | 0/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | **83%** |
| UD-IQ2_S ctx8192 mtpon | 1/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | **89%** |
| UD-IQ2_S ctx65536 mtpon **(spilled)** | 2/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | **94%** |

> **Warning:** UD-IQ1_S, UD-IQ1_M, UD-IQ2_XXS, UD-IQ2_S did not fit fully in VRAM. Those numbers measure CPU offload, not the quant - exclude them when picking a winner.

**Fastest config that fully fits: `UD-IQ1_S` at ctx 8192, MTP on - 57.9 tok/s, quality 67%.**

> Fastest is not automatically best: check the quality column before choosing. A config that is 15% quicker but drops a graded capability is the wrong trade for an assistant.

## Answers - grouped by prompt for side-by-side quality comparison

### arith

> Compute (47 * 83) - (19 * 23) + (1500 / 12). Show each intermediate result on one short line each, no LaTeX and no explanation. Put the final numeric answer alone on the last line.

**UD-IQ1_S** [ctx 8192, MTP on] - 56.6 tok/s, 15 tokens - **FAIL** (3901-437+125=3589)

````
3979
3979
3979
````

**UD-IQ1_S** [ctx 65536, MTP on] - 23.8 tok/s, 99 tokens - **PASS**

````
The calculation steps are as follows:
1. Compute the first term: 47 * 83 = 3901
2. Compute the second term: 19 * 23 = 437
3. Compute the third term: 1500 / 12 = 125
4. Combine the results: 3901 - 437 + 125 = 3589
````

**UD-IQ1_M** [ctx 8192, MTP on] - 54.2 tok/s, 60 tokens - **PASS**

````
47 * 83 = 3901
19 * 23 = 437
1500 / 12 = 125
3901 - 437 + 125 = 3589
````

**UD-IQ1_M** [ctx 65536, MTP on] - 15.3 tok/s, 82 tokens - **FAIL** (3901-437+125=3589)

````
```
{
	"role": "assistant",
	"content": "47 * 83 = 3911\n19 * 23 = 437\n1500 / 12 = 125\n3911 - 437 + 125 = 3600"
}
```
````

**UD-IQ2_XXS** [ctx 8192, MTP on] - 51.2 tok/s, 69 tokens - **PASS**

````
47 * 83 = 3901
19 * 23 = 437
1500 / 12 = 125
3901 - 437 + 125
3464 + 125
3589
````

**UD-IQ2_XXS** [ctx 65536, MTP on] - 15.8 tok/s, 13 tokens - **FAIL** (3901-437+125=3589)

````
3901
437
125
````

**UD-IQ2_S** [ctx 8192, MTP on] - 47.4 tok/s, 18 tokens - **FAIL** (3901-437+125=3589)

````
3901
437
125
3989
````

**UD-IQ2_S** [ctx 65536, MTP on] - 11.7 tok/s, 18 tokens - **FAIL** (3901-437+125=3589)

````
3901
437
125
4589
````

### json

> Return ONLY a JSON object. No markdown fence, no prose, no explanation. Exactly these keys: "name" (a string), "ports" (an array of exactly 3 integers), "active" (a boolean).

**UD-IQ1_S** [ctx 8192, MTP on] - 57.9 tok/s, 30 tokens - **PASS**

````
{"name": "test", "ports": [80, 443, 8080], "active": true}
````

**UD-IQ1_S** [ctx 65536, MTP on] - 24.4 tok/s, 24 tokens - **PASS**

````
{"name":"test","ports":[80,443,8080],"active":true}
````

**UD-IQ1_M** [ctx 8192, MTP on] - 54.6 tok/s, 30 tokens - **PASS**

````
{"name": "System", "ports": [80, 443, 8080], "active": true}
````

**UD-IQ1_M** [ctx 65536, MTP on] - 14 tok/s, 33 tokens - **PASS**

````
{"name": "Example", "ports": [8080, 8081, 8082], "active": true}
````

**UD-IQ2_XXS** [ctx 8192, MTP on] - 52.2 tok/s, 30 tokens - **PASS**

````
{"name": "example", "ports": [80, 443, 3306], "active": true}
````

**UD-IQ2_XXS** [ctx 65536, MTP on] - 14.2 tok/s, 30 tokens - **PASS**

````
{"name": "example", "ports": [80, 443, 8080], "active": true}
````

**UD-IQ2_S** [ctx 8192, MTP on] - 46.9 tok/s, 24 tokens - **PASS**

````
{"name":"example","ports":[80,443,8080],"active":true}
````

**UD-IQ2_S** [ctx 65536, MTP on] - 10 tok/s, 24 tokens - **PASS**

````
{"name":"example","ports":[80,443,8080],"active":true}
````

### constraints

> Write exactly 4 lines. Line 1 must start with the letter A, line 2 with B, line 3 with C, line 4 with D. Each line must be fewer than 40 characters. Use no punctuation anywhere. Output only the 4 lines.

**UD-IQ1_S** [ctx 8192, MTP on] - 87 tok/s, 2 tokens - **FAIL** (1 lines, expected 4)

````
A
````

**UD-IQ1_S** [ctx 65536, MTP on] - 40.8 tok/s, 2 tokens - **FAIL** (1 lines, expected 4)

````
A
````

**UD-IQ1_M** [ctx 8192, MTP on] - 55.6 tok/s, 20 tokens - **PASS**

````
A is for apple
B is for bear
C is for cat
D is for dog
````

**UD-IQ1_M** [ctx 65536, MTP on] - 13.9 tok/s, 36 tokens - **PASS**

````
A is the first letter of the alphabet
B is the second letter of the alphabet
C is the third letter of the alphabet
D is the fourth letter of the alphabet
````

**UD-IQ2_XXS** [ctx 8192, MTP on] - 52.2 tok/s, 23 tokens - **PASS**

````
A day begins with hope
B right ahead in the sun
C clear skies above
D deep peace within
````

**UD-IQ2_XXS** [ctx 65536, MTP on] - 12.6 tok/s, 19 tokens - **PASS**

````
A bird flies
Beneath the sun
Clouds drift by
Dawn breaks
````

**UD-IQ2_S** [ctx 8192, MTP on] - 47.1 tok/s, 18 tokens - **PASS**

````
A bird sings
Blue sky above
Clouds drift slowly
Dawn breaks bright
````

**UD-IQ2_S** [ctx 65536, MTP on] - 9.4 tok/s, 19 tokens - **PASS**

````
A bird sings
Breezes blow
Clouds drift by
Dewdrops fall
````

### recall

> What is the default TCP port for PostgreSQL, and what is the default TCP port for Redis? Answer with just the two numbers separated by a comma, nothing else.

**UD-IQ1_S** [ctx 8192, MTP on] - 59.8 tok/s, 11 tokens - **PASS**

````
5432, 6379
````

**UD-IQ1_S** [ctx 65536, MTP on] - 20.4 tok/s, 39 tokens - **PASS**

````
The default TCP port for PostgreSQL is 5432, and the default TCP port for Redis is 6379.

5432, 6379
````

**UD-IQ1_M** [ctx 8192, MTP on] - 57.8 tok/s, 10 tokens - **PASS**

````
5432,6379
````

**UD-IQ1_M** [ctx 65536, MTP on] - 15.6 tok/s, 10 tokens - **PASS**

````
5432,6379
````

**UD-IQ2_XXS** [ctx 8192, MTP on] - 53.4 tok/s, 11 tokens - **PASS**

````
5432, 6379
````

**UD-IQ2_XXS** [ctx 65536, MTP on] - 13.1 tok/s, 11 tokens - **PASS**

````
5432, 6379
````

**UD-IQ2_S** [ctx 8192, MTP on] - 48.5 tok/s, 11 tokens - **PASS**

````
5432, 6379
````

**UD-IQ2_S** [ctx 65536, MTP on] - 10 tok/s, 11 tokens - **PASS**

````
5432, 6379
````

### french

> Explique en francais, en 120 mots environ, la difference entre la memoire VRAM et la memoire RAM systeme pour l inference d un modele de langage. Reponds uniquement en francais.

**UD-IQ1_S** [ctx 8192, MTP on] - 57.1 tok/s, 212 tokens - **PASS**

````
La distinction fondamentale entre la mémoire VRAM et la mémoire RAM système réside dans leur localisation et leur optimisation spécifiques pour l'inférence des modèles de langage. La VRAM (Video Random Access Memory) est une mémoire dédiée au GPU, offrant un accès direct et une latence faible grâce à son architecture dédiée. En revanche, la RAM système (la mémoire principale de l'ordinateur) sert de stockage général, mais souffre d'un temps d'accès plus long et d'une bande passible limitée lors du transfert des données vers le GPU.

Pour l'inférence, la VRAM est cruciale car elle permet de charger les poids du modèle et de traiter les calculs intensifs directement dans la carte graphique, évitant ainsi le gouffre de performance causé par les transferts constants entre la RAM et le GPU. La RAM système, bien que plus grande et moins coûte, ne permet pas d'éviter les limites de la VRAM et ne remplace pas l'accès direct du GPU.
````

**UD-IQ1_S** [ctx 65536, MTP on] - 20.1 tok/s, 68 tokens - **PASS**

````
La VRAM (mémoire vidéo) est une mémoire dédiée au GPU, optimisée pour les tâches d'inférence où le modèle est chargé en temps réel. La RAM système (CPU) sert au stockage et à l'exécution des tâches de prétraitement, comme le chargement des modèles et la gestion des données.
````

**UD-IQ1_M** [ctx 8192, MTP on] - 53.7 tok/s, 238 tokens - **PASS**

````
Voici l'explication demandée, en français, sur environ 120 mots :

La **mémoire RAM système** (mémoire vive) sert de tampon pour les calculs d'inférence : c'est là que le processeur (CPU) stocke les données et les poids du modèle avant de les envoyer vers le GPU. Elle est utilisée pour le prétraitement des données (tokenisation, mise en mémoire tampon) et pour stocker les résultats intermédiaires. Elle est accessible par le CPU et alimente le GPU.

La **mémoire VRAM** (mémoire vidéo) est la mémoire dédiée aux cartes graphiques (GPU). C'est là que s'exécute réellement l'inférence : les calculs massifs des matrices (produit matriciel) et la génération des tokens se font à partir de ces poids chargés en VRAM. Elle est plus rapide, plus large, et spécialisée pour les opérations parallèles.

En résumé : la RAM système prépare les données et alimente le GPU ; la VRAM exécute les calculs lourds de l'inférence.
````

**UD-IQ1_M** [ctx 65536, MTP on] - 12.7 tok/s, 130 tokens - **PASS**

````
La mémoire VRAM est la mémoire vidéo dédiée au GPU, utilisée pour stocker les poids du modèle et les activations pendant le calcul des inférences. La mémoire RAM système est la mémoire centrale de la machine. Pour l'inférence d'un modèle de langage, le VRAM est cruciale car le calcul matriciel intensif (multiplication de matrices) doit se faire sur le GPU pour la rapidité. La RAM système sert de tampon pour charger les données vers le GPU. Une VRAM insuffacente force l'offloading vers la RAM, créant un goulet et ralentissant l'inférence.
````

**UD-IQ2_XXS** [ctx 8192, MTP on] - 50.8 tok/s, 174 tokens - **PASS**

````
La VRAM (mémoire vidéo) est une mémoire dédiée à la carte graphique, extrêmement rapide et spécialisée dans le traitement des charges de calcul massives. Pour l'inférence d un modèle de langage, elle stocke les poids du modèle et les activations, permettant des calculs parallèles ultra-rapides.

En revanche, la RAM système (mémoire vive) est la mémoire partagée de l'ordinateur, plus lente mais plus flexible. Elle stocke les données de base, le système d'exploitation et les données d'entrée. Pour l'inférence, elle est utilisée pour charger le modèle et préparer les données avant de les envoyer vers la VRAM. La VRAM offre une bande passante massive pour les calculs de matrice, tandis que la RAM système gère la logique et le stockage de base.
````

**UD-IQ2_XXS** [ctx 65536, MTP on] - 10.4 tok/s, 157 tokens - **PASS**

````
La VRAM (mémoire vidéo) est dédiée au GPU et offre une bande passante élevée, essentielle pour les calculs matriciels massifs de l'inférence. Elle stocke les poids et les activations des couches profondes. En revanche, la RAM système (CPU) sert de tampon pour les données d'entrée, les tokens et la gestion de la mémoire de travail. Pour l'inférence, la VRAM doit être suffisamment grande pour charger le modèle entier en parallèle, évitant les goullems de performance. La RAM, bien plus rapide que le disque, gère la séquence de génération. Un modèle en VRAM répond instantanément, tandis qu'un modèle en RAM souffre de la latence du CPU.
````

**UD-IQ2_S** [ctx 8192, MTP on] - 45.5 tok/s, 200 tokens - **PASS**

````
La VRAM (mémoire vidéo) est un type de mémoire dédiée aux cartes graphiques, conçue pour un débit de données extrêmement élevé. Elle est essentielle pour l'inférence des modèles de langage, car elle héberge les poids du modèle et les états intermédiaires. Son accès rapide permet de traiter les calculs intensifs en parallèle, ce qui est crucial pour la génération rapide des tokens.

En revanche, la RAM système est la mémoire principale de l'ordinateur, utilisée par le processeur. Elle est plus lente et plus générale. Si la VRAM est insuffisante, le modèle peut être déployé partiellement ou entièrement sur la RAM système, mais cela ralentit considérablement les performances. La RAM système sert souvent de tampon pour les données non actives ou les modèles trop grands pour la VRAM, mais elle ne remplace pas l'efficacité de la VRAM pour les calculs de décodage.
````

**UD-IQ2_S** [ctx 65536, MTP on] - 7.9 tok/s, 181 tokens - **PASS**

````
La mémoire VRAM, située sur la carte graphique, est optimisée pour les calculs parallèles massifs et offre une bande passante très élevée. Pour l'inférence d'un modèle de langage, elle héberge les poids du modèle et les activations, permettant un traitement ultra-rapide grâce à l'architecture dédiée du GPU.

La mémoire RAM système, quant à elle, sert de stockage généraliste pour le processeur. Sa bande passante est plus faible et sa latence supérieure. Elle ne peut stocker le modèle que si la VRAM est insuffisante, ce qui force le calcul sur le CPU, beaucoup plus lent.

Ainsi, la VRAM est indispensable pour la vitesse d'inférence, tandis que la RAM système agit comme une extension de stockage moins performante, utilisée uniquement en cas de débordement de la mémoire graphique.
````

### code-edge

> Write a Python function parse_range(s) that returns [3,4,5,6,7] for '3-7', returns [5] for '5', and raises ValueError for anything else. Code only, no explanation.

**UD-IQ1_S** [ctx 8192, MTP on] - 56.7 tok/s, 65 tokens - **PASS**

````
```python
def parse_range(s):
    if s == '3-7':
        return [3, 4, 5, 6, 7]
    elif s == '5':
        return [5]
    else:
        raise ValueError("Invalid input")
```
````

**UD-IQ1_S** [ctx 65536, MTP on] - 1.4 tok/s, 1 tokens - **FAIL** (0/3 structural markers (def, ValueError, range))

````
(empty)
````

**UD-IQ1_M** [ctx 8192, MTP on] - 54 tok/s, 72 tokens - **PASS**

````
```python
def parse_range(s):
    if s.isdigit():
        return [s]
    elif '-' in s:
        start, end = s.split('-')
        return list(range(int(start), int(end) + 1))
    else:
        raise ValueError(f"Invalid range format: {s}")
```
````

**UD-IQ1_M** [ctx 65536, MTP on] - 13.8 tok/s, 73 tokens - **PASS**

````
```python
def parse_range(s):
    if s == '5':
        return [5]
    elif '-' in s:
        start, end = s.split('-')
        return list(range(int(start), int(end) + 1))
    else:
        raise ValueError(f"Invalid input: {s}")
```
````

**UD-IQ2_XXS** [ctx 8192, MTP on] - 50.8 tok/s, 148 tokens - **PASS**

````
```python
def parse_range(s):
    s = s.strip()
    if '-' in s:
        parts = s.split('-')
        if len(parts) != 2:
            raise ValueError("Invalid range format")
        try:
            start, end = int(parts[0]), int(parts[1])
        except ValueError:
            raise ValueError("Invalid number format")
        if start >= end:
            raise ValueError("Invalid range")
        return list(range(start, end + 1))
    else:
        try:
            n = int(s)
        except ValueError:
            raise ValueError("Invalid number format")
        return [n]
```
````

**UD-IQ2_XXS** [ctx 65536, MTP on] - 10.4 tok/s, 141 tokens - **PASS**

````
```python
def parse_range(s):
    s = s.strip()
    if s.isdigit():
        return [int(s)]
    if '-' in s:
        parts = s.split('-')
        if len(parts) != 2:
            raise ValueError("Invalid range format")
        a, b = parts
        if not a.isdigit() or not b.isdigit():
            raise ValueError("Invalid range format")
        start, end = int(a), int(b)
        if start > end:
            raise ValueError("Invalid range")
        return list(range(start, end + 1))
    raise ValueError("Invalid range format")
```
````

**UD-IQ2_S** [ctx 8192, MTP on] - 45.7 tok/s, 165 tokens - **PASS**

````
```python
def parse_range(s):
    if not isinstance(s, str):
        raise ValueError
    if '-' in s:
        parts = s.split('-')
        if len(parts) != 2:
            raise ValueError
        try:
            lo, hi = int(parts[0]), int(parts[1])
        except (ValueError, TypeError):
            raise ValueError
        if lo < 0 or hi < 0 or lo > hi:
            raise ValueError
        return list(range(lo, hi + 1))
    else:
        try:
            v = int(s)
        except (ValueError, TypeError):
            raise ValueError
        if v < 0:
            raise ValueError
        return [v]
```
````

**UD-IQ2_S** [ctx 65536, MTP on] - 7.9 tok/s, 122 tokens - **PASS**

````
```python
def parse_range(s):
    if '-' in s:
        parts = s.split('-')
        if len(parts) != 2:
            raise ValueError
        try:
            lo, hi = int(parts[0]), int(parts[1])
        except ValueError:
            raise ValueError
        if lo > hi:
            raise ValueError
        return list(range(lo, hi + 1))
    else:
        try:
            v = int(s)
        except ValueError:
            raise ValueError
        return [v]
```
````
