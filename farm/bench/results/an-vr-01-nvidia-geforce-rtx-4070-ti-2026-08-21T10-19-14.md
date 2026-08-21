# Quant ladder benchmark - NVIDIA GeForce RTX 4070 Ti

- **Rig**: AN-VR-01 - NVIDIA GeForce RTX 4070 Ti (12 GB) - 24 cores - 64 GB RAM
- **Software**: Ollama 0.32.14 - driver 610.88 - Node v24.14.0 - win32 10.0.26200
- **Settings**: repo `hf.co/unsloth/Qwen3.8-27B-GGUF` - prompts `quick` - max_tokens 300 - repeats 2 - thinking off
- **Sweep**: ctx 8192 x MTP on
- **Run**: 2026-08-21T10:19:14.562Z

## Speed

| Quant | ctx | MTP | Resident | 100% GPU? | tok/s median | tok/s range | TTFT p50 | GPU util | VRAM peak | Quality |
|---|---|---|---|---|---|---|---|---|---|---|
| UD-IQ1_S | 8192 | on | 7.0 GB | yes | **58** | 57.5-58.6 | 0.54s | 78% | 8.2 GB | - |
| UD-IQ1_M | 8192 | on | 7.4 GB | yes | **54.4** | 54.1-54.6 | 0.53s | 88% | 8.57 GB | - |
| UD-IQ2_XXS | 8192 | on | 7.9 GB | yes | **51.3** | 51.1-51.4 | 0.53s | 86% | 9.07 GB | - |
| UD-IQ2_S | 8192 | on | 9.0 GB | yes | **46.1** | 45.9-46.3 | 0.53s | 85% | 10.1 GB | - |

**Fastest config that fully fits: `UD-IQ1_S` at ctx 8192, MTP on - 58 tok/s.**

> Fastest is not automatically best: check the quality column before choosing. A config that is 15% quicker but drops a graded capability is the wrong trade for an assistant.

## Answers - grouped by prompt for side-by-side quality comparison

### science

> Explain in about 150 words why the sky is blue.

**UD-IQ1_S** [ctx 8192, MTP on] - 57.5 tok/s, 170 tokens

````
The sky appears blue due to a phenomenon known as Rayleigh scattering, which is part of the scattering process that affects the color of the sky. This process, known as Rayleigh scattering, occurs when light interacts with molecules in the atmosphere. The atmosphere is composed of gases such as nitrogen and oxygen, as well as trace amounts of other gases. When sunlight enters the atmosphere, it interacts with these molecules, causing the scattering of light in all directions. This scattering leads to the blue color of the sky, as the scattered light is distributed in all directions. The blue color is a result of the scattering of light in the atmosphere, which causes the color of the sky to appear blue. The scattering of light in the atmosphere is a result of the interaction between the light and the molecules in the atmosphere, leading to the blue color of the sky.
````

**UD-IQ1_M** [ctx 8192, MTP on] - 54.3 tok/s, 150 tokens

````
The sky appears blue due to a phenomenon known as Rayleigh scattering. Sunlight is composed of a spectrum of colors, each with different wavelengths. When sunlight enters the atmosphere, it interacts with tiny particles like air molecules and dust. These particles scatter the shorter wavelengths (blue light) more effectively than the longer wavelengths (red light). While all colors are scattered, blue light is scattered about ten times more than red light. This scattered blue light is then directed in all directions, reaching your eyes. Consequently, when you look at the clear sky, your eyes receive the scattered blue light, making the sky appear blue. It is important to note that this is distinct from the black of space, which lacks the atmospheric scattering required to create this color.
````

**UD-IQ2_XXS** [ctx 8192, MTP on] - 51.3 tok/s, 221 tokens

````
The sky appears blue due to a phenomenon known as Rayleigh scattering. When sunlight enters the Earth's atmosphere, it interacts with gas particles and other small compounds. Sunlight is not actually a single color; rather, it is a combination of many colors (which is why a prism can break it into a rainbow). Each color has its own specific wavelength. The blue light has a shorter wavelength, while red light has a longer wavelength.

According to the physics of the atmosphere, the shorter wavelengths of the spectrum are scattered more effectively by the gas molecules in the atmosphere. This scattering process, called Rayleigh scattering, causes the blue light to be dispersed across the sky. In contrast, the longer wavelengths of red light are scattered less and tend to pass through the atmosphere with less deflection. Consequently, the blue light is scattered in all directions, filling the sky with a blue hue, while the direct sunlight reaching our eyes retains its original white color. This is why the sky appears blue during the day, while sunsets appear red or orange due to the different scattering of longer wavelengths at lower angles.
````

**UD-IQ2_S** [ctx 8192, MTP on] - 46 tok/s, 167 tokens

````
The sky appears blue due to a phenomenon known as Rayleigh scattering. When sunlight enters the Earth's atmosphere, it interacts with gas molecules like nitrogen and oxygen. The sun's light contains all colors of the visible spectrum, but shorter wavelengths (violet and blue) are scattered much more efficiently by these atmospheric molecules than longer wavelengths (red and orange).

Because blue light has a shorter wavelength, it scatters in all directions, filling the sky with a blue hue. Red light, with its longer wavelength, passes through the atmosphere with less scattering, which is why we see red sunsets. If the atmosphere were thicker or if we were on a planet with a different composition, the sky might appear a different color. Essentially, the blue color is the result of the selective scattering of shorter wavelengths by the gases in our atmosphere.
````

### reasoning

> A farmer has 17 sheep. All but 9 die. How many are left? Show your reasoning step by step, then give the final answer.

**UD-IQ1_S** [ctx 8192, MTP on] - 58.6 tok/s, 115 tokens

````
1. **Identify the number of sheep**: The farmer initially has 17 sheep.
2. **Identify the number of sheep that die**: The problem states that 9 sheep die.
3. **Calculate the remaining sheep**: Subtract the number of sheep that died from the total number of sheep.
   - Total sheep: 17
   - Sheep that die: 9
   - Remaining sheep: 17 - 9 = 8
4. **Final answer**: The number of sheep left is 8.
````

**UD-IQ1_M** [ctx 8192, MTP on] - 54.3 tok/s, 173 tokens

````
To determine how many sheep are left, we will break down the problem step by step.

**Step 1: Determine the initial number of sheep.**
The farmer starts with 17 sheep.

**Step 2: Identify the condition of the sheep.**
The statement "All but 9 die" means that 9 sheep survive and the rest die.
*   Number of sheep that die: $17 - 9 = 8$
*   Number of sheep that survive: 9

**Step 3: Calculate the final count.**
The question asks how many are left. Since the 9 surviving sheep are still alive, they are the ones remaining. The 8 sheep that died are gone.
*   Sheep left = 9

**Final Answer:**
There are **9** sheep left.
````

**UD-IQ2_XXS** [ctx 8192, MTP on] - 51.4 tok/s, 153 tokens

````
To determine how many sheep are left, we can break down the problem using simple arithmetic:

1.  **Identify the starting number:** The farmer begins with **17** sheep.
2.  **Identify the number lost:** The phrase "All but 9 die" means that 9 sheep survived. Therefore, the number of sheep that died is $17 - 9 = 8$.
3.  **Determine the remaining count:** The question asks for the number of sheep *left* (meaning the ones that are still alive). The problem states that "All but 9" died, which implies that **9** sheep did not die.

**Conclusion:**
There are **9** sheep left.
````

**UD-IQ2_S** [ctx 8192, MTP on] - 46.1 tok/s, 173 tokens

````
To determine how many sheep are left, we can break down the problem logically:

1.  **Identify the total number of sheep:** The farmer starts with 17 sheep.
2.  **Identify the number of sheep that die:** The problem states that "All but 9" die. This means that 9 sheep survive.
3.  **Calculate the number of sheep that died:**
    $$17 \text{ (total)} - 9 \text{ (survivors)} = 8 \text{ sheep died}$$
4.  **Determine the number of sheep left:** The sheep that are "left" refers to the surviving sheep. Since 9 sheep did not die, there are 9 sheep remaining.

**Final Answer:**
There are **9** sheep left.
````

### code

> Write a Python function that returns the nth Fibonacci number using memoization. Include a short docstring. Code only, no explanation.

**UD-IQ1_S** [ctx 8192, MTP on] - 58.5 tok/s, 43 tokens

````
```python
def fibonacci(n, memo={}):
    """Returns the nth Fibonacci number using memoization."""
    if n in memo:
        return memo[n]
    return n + 1
````

**UD-IQ1_M** [ctx 8192, MTP on] - 54.4 tok/s, 91 tokens

````
```python
def fibonacci(n):
    """Return the nth Fibonacci number using memoization."""
    memo = {}
    
    def fib(k):
        if k in memo:
            return memo[k]
        if k < 2:
            return k
        memo[k] = fib(k - 1) + fib(k - 2)
        return memo[k]
    
    return fib(n)
```
````

**UD-IQ2_XXS** [ctx 8192, MTP on] - 51.4 tok/s, 102 tokens

````
```python
def fib(n: int) -> int:
    """Return the nth Fibonacci number using memoization."""
    memo = {0: 0, 1: 1}

    def _fib(k: int) -> int:
        if k in memo:
            return memo[k]
        memo[k] = _fib(k - 1) + _fib(k - 2)
        return memo[k]

    return _fib(n)
```
````

**UD-IQ2_S** [ctx 8192, MTP on] - 46.2 tok/s, 91 tokens

````
```python
def fibonacci(n, memo=None):
    """Return the nth Fibonacci number using memoization."""
    if memo is None:
        memo = {}
    if n in memo:
        return memo[n]
    if n <= 1:
        return n
    memo[n] = fibonacci(n - 1, memo) + fibonacci(n - 2, memo)
    return memo[n]
```
````

### french

> Explique en 150 mots environ le fonctionnement d une imprimante 3D a depot de filament.

**UD-IQ1_S** [ctx 8192, MTP on] - 58.4 tok/s, 42 tokens

````
L'imprimante 3D à dépôt de filament fonctionne selon un principe de base, mais les nuances varient selon le type de filament (ABS, PLA, etc.) et la configuration du plateau.
````

**UD-IQ1_M** [ctx 8192, MTP on] - 54.1 tok/s, 300 tokens

````
Voici le fonctionnement d'une imprimante 3D en dépôt de filament (FDM) :

L'imprimante fonctionne par l'**extrusion** d'un filament fondu. Un moteur pousse le filament vers le **buse** (hotend), qui est maintenu à haute température pour ramollifier le polymère. Le fil fondu est déposé en couches successives sur le **plateau** de travail. Le système d'axes (X, Y, Z) déplace la buse pour tracer la géométrie de l'objet, couche par couche. Le **gabarage** est réglé par le logiciel pour contrôler le dépôt. La **résine** n'est pas utilisée ici ; c'est le **filament** qui forme la pièce. Chaque couche est un anneau de matière fondue, solidifié par le refroidissement. Le **résine** (résine) ne s'applique pas ici. Le processus repose sur le **mélange** des axes pour construire la forme. La **résine** n'est pas concernée. Le **filament** est le matériau. Le **résine** ne fait pas partie. Le **filament** est le cœur. La **résine** est absente. Le **filament** est fondu. La **résine** n'est pas là. Le **filament** est la clé. La **résine** ne s'applique pas. Le
````

**UD-IQ2_XXS** [ctx 8192, MTP on] - 51.1 tok/s, 285 tokens

````
Le fonctionnement d’une imprimante 3D à dépôt de filament (FDM) repose sur l’extrusion de matière. Un filiment thermoplastique (comme le PLA ou l’ABS) est chauffé par un bloc d’extrusion jusqu’à ce qu’il devienne mou. Une poussette le pousse ensuite vers le buse d’extrusion, où il est déposé couche par couche sur le plateau.

Le processus commence par le chargement d’un modèle 3D (fichier .gcode) dans le firmware. La machine lit les instructions et déplace le chariot de l’extrudeur le long des axes X, Y et Z. À chaque instant, le filament est fondu et déposé. La couche précédente refroidit et se solidifie, créant une structure solide. Le plateau se descend d’un niveau de la couche, et le processus se répète jusqu’à la fin du modèle.

L’ensemble du système repose sur une boucle de rétroaction de haute précision : un capteur de température régule le courant dans le bloc d’extrusion pour maintenir une température constante. Le chariot suit le profil de l’objet avec une précision sub-millimétrique. C’est ce processus d’accumulation de couches qui donne l’aspect en couches visibles, caractéristique de la technologie FDM.
````

**UD-IQ2_S** [ctx 8192, MTP on] - 46 tok/s, 222 tokens

````
Le fonctionnement d'une imprimante 3D à dépôt de filament repose sur le procédé de fusion et d'extrusion (FDM). Le filament, généralement en plastique thermoplastique, est alimenté par des engrenages dans un boîtier chauffé à haute température (souvent entre 180 et 250 °C). Une fois ramolli, le matériau est poussé à travers une buse métallique.

Simultanément, la tête d'impression se déplace selon les axes X, Y et Z, guidée par des algorithmes de tranchage qui découpent le modèle numérique en fines couches. La buse dépose le filament fondu couche par couche sur le plateau de construction, où il se solidifie immédiatement. Cette superposition séquentielle de couches minces construit progressivement la géométrie physique de l'objet. La précision dépend de la finesse de la buse et de la stabilité thermique du système d'extrusion, permettant la fabrication d'objets complexes à partir de simples données numériques.
````

### format

> List exactly 5 differences between TCP and UDP. One line each, no preamble, no conclusion.

**UD-IQ1_S** [ctx 8192, MTP on] - 58 tok/s, 102 tokens

````
1. TCP provides reliable connection-oriented communication, while UDP is connectionless and best-eff effort.
2. TCP uses a three-way handshake to establish a connection, whereas UDP has no handshake mechanism.
3. TCP ensures ordered delivery of packets through sequence numbers, while UDP provides no guarantee of ordering.
4. TCP uses flow control via sliding windowing, whereas UDP relies on the operating system to manage buffer sizes.
5. TCP supports network layer fragmentation, while UDP does not support fragmentation.
````

**UD-IQ1_M** [ctx 8192, MTP on] - 54.3 tok/s, 137 tokens

````
1. TCP is a connection-oriented protocol that establishes a session before data transfer, while UDP is connectionless and does not require a handshake.
2. TCP provides reliable, ordered data transfer with error detection, whereas UDP offers no guarantee of message delivery or ordering.
3. TCP uses flow control and congestion control mechanisms to prevent sender from overwhelming the receiver, while UDP has no such mechanisms.
4. TCP uses a 4-byte sequence number for segmentation and reassembly, while UDP uses no such mechanism, relying solely on the IP header.
5. TCP has a header length of 20 bytes (with options), while UDP has a fixed 8-byte header
````

**UD-IQ2_XXS** [ctx 8192, MTP on] - 51.3 tok/s, 162 tokens

````
TCP provides connection-oriented, reliable delivery of data via a handshake protocol, while UDP provides connectionless, best-effort delivery without guaranteed receipt.
TCP uses sequence numbers and acknowledgments to ensure ordered and error-checked data transmission, whereas UDP lacks these mechanisms and may deliver packets out of order or drop them silently.
TCP supports full-duplex, continuous data streams with flow control and congestion control, while UDP supports only simple datagram transmission without flow or congestion control.
TCP headers include fields for sequence numbers, acknowledgment numbers, and window sizes, while UDP headers consist only of source/destination ports, length, and checksum.
TCP is a stream-based protocol that can multiplex multiple conversations on a single connection, while UDP is a datagram-based protocol where each packet is independent and self-contained.
````

**UD-IQ2_S** [ctx 8192, MTP on] - 46.1 tok/s, 89 tokens

````
TCP provides connection-oriented communication while UDP is connectionless.
TCP ensures reliable data delivery through acknowledgments and retransmission, whereas UDP offers no delivery guarantee.
TCP maintains ordered data streams, while UDP packets may arrive out of order or be lost.
TCP uses a three-way handshake to establish a session before data transfer, but UDP sends datagrams immediately.
TCP supports flow control and congestion control mechanisms, while UDP does not.
````
