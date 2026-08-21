# Quant ladder benchmark - NVIDIA GeForce RTX 4070 Ti

- **Rig**: AN-VR-01 - NVIDIA GeForce RTX 4070 Ti (12 GB) - 24 cores - 64 GB RAM
- **Software**: Ollama 0.32.14 - driver 610.88 - Node v24.14.0 - win32 10.0.26200
- **Settings**: repo `hf.co/unsloth/Qwen3.8-27B-GGUF` - ctx 8192 - max_tokens 300 - repeats 2 - MTP on - thinking off
- **Run**: 2026-08-21T07:57:46.544Z

## Speed

| Quant | Resident | 100% GPU? | tok/s median | tok/s range | TTFT p50 | GPU util avg | VRAM peak |
|---|---|---|---|---|---|---|---|
| UD-IQ1_M | 7.4 GB | yes | **53.9** | 53.5-54.1 | 0.54s | 84% | 8.65 GB |
| UD-IQ2_XXS | 7.9 GB | yes | **51** | 50.6-51 | 0.54s | 85% | 9.15 GB |
| UD-IQ2_S | 9.0 GB | yes | **45.5** | 45.4-45.7 | 0.54s | 89% | 10.18 GB |
| UD-Q2_K_XL | 11 GB | **NO - spilled** | **7.1** | 5.7-11.5 | 2.21s | 22% | 10.18 GB |

> **Warning:** UD-Q2_K_XL did not fit fully in VRAM. Those numbers measure CPU offload, not the quant - exclude them when picking a winner.

**Fastest quant that fully fits: `UD-IQ1_M` at 53.9 tok/s.**

## Answers - grouped by prompt for side-by-side quality comparison

### science

> Explain in about 150 words why the sky is blue.

**UD-IQ1_M** - 53.8 tok/s, 144 tokens

````
The reason the sky is blue is a phenomenon known as **Rayleigh scattering**. When sunlight reaches the upper atmosphere, it interacts with the air molecules. Unlike larger particles that scatter all wavelengths of light, these tiny molecules scatter the shorter, blue wavelengths of the visible light spectrum much more effectively than the longer, red wavelengths. This effect, known as Rayleigh scattering, causes the shorter blue wavelengths to be scattered more strongly than the longer red wavelengths. When you look at the sky, the light reaching your eyes is predominantly the scattered blue light, which is why the sky appears blue. This is why the sun appears yellow or orange when viewed from the surface of the Earth, as the longer wavelengths are scattered less effectively.
````

**UD-IQ2_XXS** - 51 tok/s, 193 tokens

````
The sky appears blue due to a phenomenon known as Rayleigh scattering. As sunlight enters the atmosphere, it collides with gases and other particles, causing the light to scatter in many directions. Because blue light has a shorter wavelength than red or yellow light, it scatters more efficiently through the atmosphere.

Specifically, the molecules in the air scatter blue light about four times as effectively as they do red light. When you look at the sky, you are seeing this scattered blue light. However, the sky isn't a uniform blue; it is often lighter near the horizon and darker at the zenith because the path of the light through the atmosphere is shorter near the horizon.

The intensity of the blue color depends on the time of day and the season. At sunrise and sunset, the sky is often orange or red because the light has to travel through more of the atmosphere, and the shorter-wavelength blue light is scattered away before it reaches your eyes.
````

**UD-IQ2_S** - 45.6 tok/s, 188 tokens

````
The sky appears blue due to a phenomenon known as Rayleigh scattering. Sunlight, which is actually white, enters the Earth's atmosphere and interacts with gas molecules (mainly nitrogen and oxygen). These molecules scatter shorter wavelengths of light, such as blue and violet, much more effectively than longer wavelengths like red or orange.

While violet light is scattered even more strongly than blue, the human eye is less sensitive to violet, and our perception blends the scattered blue light with the less-scattered green and yellow light to create the characteristic azure hue we see. If the sun were closer to us or if the atmosphere were different, the color might appear different, but under standard conditions, the preferential scattering of short-wavelength light makes the sky blue. This same process is why sunsets appear red or orange; the light travels through more of the atmosphere, scattering away the blue light and leaving the longer red wavelengths to reach our eyes.
````

**UD-Q2_K_XL** - 6.5 tok/s, 163 tokens

````
The sky appears blue due to a phenomenon called Rayleigh scattering. Sunlight enters the Earth's atmosphere and is scattered by gases and small particles in the air. Blue light travels in shorter, higher-frequency waves, so it is scattered more than other colors because it hits more frequently with the molecules in the atmosphere.

When sunlight hits the atmosphere, the shorter wavelengths—blue and violet—scatter in all directions, while the longer wavelengths—red, orange, and yellow—scatter much less. Violet is scattered even more than blue, but our eyes are more sensitive to blue light, and our brains interpret this combination as blue. If the sky were just blue, it would be a simple result of physics; however, the specific interaction between light wavelengths and atmospheric molecules creates the vibrant blue we see during the day.
````

### reasoning

> A farmer has 17 sheep. All but 9 die. How many are left? Show your reasoning step by step, then give the final answer.

**UD-IQ1_M** - 54.1 tok/s, 114 tokens

````
**Step-by-step reasoning:**

1.  **Initial count:** The farmer starts with a total of **17** sheep.
2.  **The event:** The problem states that "all but 9" die.
3.  **Interpretation:** The phrase "all but 9" means that 9 sheep survive and the rest die.
4.  **Result:** Since 9 sheep are explicitly stated to survive (not die), the number of sheep left is 9.

**Final Answer:**
**9**
````

**UD-IQ2_XXS** - 51 tok/s, 106 tokens

````
To determine the number of sheep remaining, we can break down the problem logically:

1.  **Initial Count:** The farmer starts with 17 sheep.
2.  **The Condition:** The phrase "All but 9" means that every sheep *except* 9 of them died.
3.  **Calculation:** If 9 sheep did not die, they are the ones that are left.

Therefore, the number of sheep left is **9**.

**Final Answer:** 9
````

**UD-IQ2_S** - 45.5 tok/s, 300 tokens

````
To determine how many sheep are left, we need to carefully analyze the wording of the problem.

1.  **Initial Count**: The farmer starts with 17 sheep.
2.  **The Event**: The statement says "All but 9 die."
    *   This phrasing implies that 9 sheep survived and the rest died.
    *   Alternatively, it could be interpreted as "9 sheep died," but the standard grammatical interpretation of "All but [number]" means "Everything except [number]."
    *   Let's look at the structure: "All [sheep] but [9 sheep] die." This means the 9 sheep did **not** die. The other sheep (17 - 9 = 8) died.
    *   Therefore, the 9 sheep are the ones that are still alive.

Let's double-check the logic:
*   Total sheep = 17.
*   "All but 9 die" means 9 sheep remain alive.
*   The sheep that died = Total - Survivors = 17 - 9 = 8 sheep died.
*   The question asks: "How many are left?"
*   "Left" in this context refers to the surviving sheep.

Therefore, the number of sheep left is 9.

**Step-by-Step Reasoning:**
1.  Start with the total number of sheep: 1
````

**UD-Q2_K_XL** - 8.6 tok/s, 149 tokens

````
This is a classic riddle that relies on reading comprehension and logic rather than simple arithmetic. Here is the step-by-step reasoning:

1.  **Analyze the total population**: The farmer starts with a total of 17 sheep.
2.  **Analyze the condition**: The phrase "All but 9 die" means that every sheep died *except* for 9 of them.
3.  **Determine the survivors**: The 9 sheep that did not die are the ones that remain alive.
4.  **Calculate the final count**: Therefore, the number of sheep left alive is exactly the number specified in the exception.

**Final Answer:**
There are **9** sheep left.
````

### code

> Write a Python function that returns the nth Fibonacci number using memoization. Include a short docstring. Code only, no explanation.

**UD-IQ1_M** - 54 tok/s, 116 tokens

````
```python
def fib(n):
    """Return the nth Fibonacci number using memoization."""
    memo = {}
    def helper(k):
        if k in memo:
            return memo[k]
        if k < 0:
            return 0
        if k == 0:
            return 0
        if k == 1:
            return 1
        memo[k] = helper(k - 1) + helper(k - 2)
        return memo[k]
    return helper(n)
```
````

**UD-IQ2_XXS** - 51 tok/s, 101 tokens

````
```python
def fibonacci(n: int) -> int:
    """Return the nth Fibonacci number using memoization."""
    memo = {}
    def fib(k):
        if k in memo:
            return memo[k]
        if k <= 1:
            memo[k] = k
        else:
            memo[k] = fib(k - 1) + fib(k - 2)
        return memo[k]
    return fib(n)
```
````

**UD-IQ2_S** - 45.7 tok/s, 99 tokens

````
```python
def fib(n: int, memo: dict = None) -> int:
    """Return the nth Fibonacci number using memoization."""
    if memo is None:
        memo = {}
    if n <= 1:
        return n
    if n in memo:
        return memo[n]
    memo[n] = fib(n - 1, memo) + fib(n - 2, memo)
    return memo[n]
```
````

**UD-Q2_K_XL** - 11.5 tok/s, 93 tokens

````
```python
def fib(n, memo={}):
    """Return the nth Fibonacci number using memoization."""
    if n < 0:
        raise ValueError("n must be non-negative")
    if n <= 1:
        return n
    if n not in memo:
        memo[n] = fib(n - 1, memo) + fib(n - 2, memo)
    return memo[n]
```
````

### french

> Explique en 150 mots environ le fonctionnement d une imprimante 3D a depot de filament.

**UD-IQ1_M** - 53.7 tok/s, 300 tokens

````
Voici l'explication demandée (environ 150 mots) :

Une imprimante 3D fonctionne par le principe de **fourniture de filaments** (FDM) ou, plus spécifiquement, **dépôt de filaments** (FDM). Le processus commence par la numérisation d'un modèle 3D (STL) qui est converti en trames de couches fines.

Le cœur du système est l'extrudeur qui pousse le filament fondu à travers le buse (nozzle). Le filament (souvent en PLA ou ABS) est chauffé par un bloc chauffé (hotend) qui le transforme en un fluide thermoplasique. Ce flux est ensuite déposé sur la plaque de construction (build plate) en couches successives.

Chaque couche est une section horizontale de l'objet final. Pour assurer l'adhésion, le filament est fondu et déposé par le buse, qui se déplace selon des trajectoires définies par le logiciel. La géométrie de la pièce est construite en superposant ces couches.

La qualité de l'objet final dépend de la précision du dépôt, du débit de flux du filament, et de la température de fusion. La géométrie de la pièce est construite en superposant ces couches. La géométrie de la pièce est constr
````

**UD-IQ2_XXS** - 50.6 tok/s, 253 tokens

````
Le fonctionnement d'une imprimante 3D à dépot de filament (FDM, ou FFF) repose sur le principe de la fabrication additive. Le processus commence par l'extrusion d'un filin thermoplastique (comme le PLA ou le PETG) qui est fondu dans un extrudeur chauffé par un bloc chauffant. Ce matériau fondu est ensuite déposé couche par couche sur une plateau de construction, généralement en plastique ou en verre.

L'ensemble du processus est piloté par un système d'électronique qui lit un fichier G-code. Ce fichier, généré par un logiciel de tranchage, définit la géométrie de l'objet en fines couches (généralement de 0,1 à 0,3 mm). La tête d'extrusion, contrôlée par des moteurs pas-à-pas sur des axes X, Y et Z, dépose le filin fondu avec une grande précision. À la fin de chaque couche, la plateforme descend (ou la tête monte) pour laisser l'espace nécessaire pour la couche suivante. Ce processus est répété jusqu'à la fin du modèle, créant ainsi un objet solide à partir de son propre profil.
````

**UD-IQ2_S** - 45.4 tok/s, 300 tokens

````
Une imprimante 3D à dépôt de filament (FDM) fonctionne principalement par extrusion. Le processus commence avec l'alimentation d'un bobineur de filaments thermoplastiques, comme du PLA ou du PETG, qui sont généralement enroulés sur un spool. Ce filament est ensuite tiré par un système d'engrenages, le « drive », vers le cœur de l'imprimante.

Là, le filament passe à travers un bloc chauffant, ou hot-end, qui le fond à haute température pour le rendre mou et fluide. Une buse, souvent en laiton ou en acier, pousse le matériau fondu à travers un petit orifice. Ce processus de fusion et d'extrusion se fait couche par couche.

Le cœur de l'imprimante, appelé le « hot-end », est composé d'un bloc chauffant et d'une buse. Le filament est tiré par un moteur pas-à-pas et des engrenages vers le cœur de l'imprimante. Le filament passe à travers un bloc chauffant, ou hot-end, qui le fond à haute température pour le rendre mou et fluide. Une buse, souvent en laiton ou en acier, pousse le matériau fondu à travers un petit orifice. Ce processus de fusion et d'extrusion se fait couche par couche.

Le plateau d'impression, ou plateau, est la surface sur laquelle l'imprim
````

**UD-Q2_K_XL** - 6 tok/s, 203 tokens

````
L'imprimante 3D à dépôt de filament, ou FDM (Fused Deposition Modeling), fonctionne par l'empilement successif de couches minuscules de matière. Le processus commence par la conversion d'un modèle numérique 3D en tranches horizontales via un logiciel de tranchage. L'imprimante est équipée d'une buse chauffante, généralement en laiton, qui fond le filament plastique (comme le PLA ou l'ABS) alimenté par des pincers. Cette buse, guidée par des moteurs pas-à-pas sur des axes X, Y et Z, dépose le matériau fondu couche par couche sur une plate-forme. Chaque couche adhère à la précédente, créant progressivement l'objet physique. Ce procédé additive permet de réaliser des pièces complexes avec précision, tout en minimisant le gaspillage de matière, offrant une solution économique et flexible pour le prototypage et la fabrication de pièces fonctionnelles.
````

### format

> List exactly 5 differences between TCP and UDP. One line each, no preamble, no conclusion.

**UD-IQ1_M** - 53.8 tok/s, 78 tokens

````
TCP is connection-oriented, while UDP is connectionless.
TCP guarantees ordered data delivery, whereas UDP offers no delivery guarantees.
TCP uses flow control and congestion control, while UDP has no built-in flow control.
TCP has a maximum payload size limit, whereas UDP can carry variable-length messages.
TCP headers are 20 bytes, while UDP headers are 8 bytes.
````

**UD-IQ2_XXS** - 51 tok/s, 93 tokens

````
- TCP provides connection-oriented, reliable communication, whereas UDP is connectionless and best-effort.
- TCP uses a 3-way handshake to establish sessions, while UDP requires no handshake.
- TCP guarantees ordered delivery of segments, whereas UDP offers no ordering guarantee.
- TCP uses flow control and congestion control mechanisms, while UDP does not.
- TCP is a stream protocol (byte-oriented), whereas UDP is a datagram protocol (message-oriented).
````

**UD-IQ2_S** - 45.5 tok/s, 96 tokens

````
TCP is connection-oriented, requiring a handshake to establish a session before data transfer.
UDP is connectionless, sending data packets without establishing a prior connection.
TCP provides reliable delivery with acknowledgments and retransmission of lost packets.
UDP offers no guarantees of delivery, order, or duplicate prevention.
TCP uses a sliding window mechanism for flow control to prevent overwhelming the receiver.
UDP has no built-in flow control mechanism, relying on the application layer for regulation.
````

**UD-Q2_K_XL** - 7.1 tok/s, 137 tokens

````
1. TCP is a connection-oriented protocol that establishes a handshake before data transfer, while UDP is connectionless and sends data without prior setup.
2. TCP guarantees reliable, in-order delivery of data segments, whereas UDP offers no guarantee of delivery or ordering.
3. TCP uses flow control and congestion avoidance mechanisms to prevent network overload, while UDP transmits packets at the rate the application generates them.
4. TCP provides built-in error detection and retransmission of lost segments, while UDP relies on the application layer for error handling.
5. TCP has higher overhead due to headers and acknowledgments, while UDP has minimal overhead and is faster for time-sensitive data.
````
