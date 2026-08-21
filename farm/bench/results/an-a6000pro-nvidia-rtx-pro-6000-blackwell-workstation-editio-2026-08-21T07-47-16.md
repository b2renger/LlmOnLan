# Quant ladder benchmark - NVIDIA RTX PRO 6000 Blackwell Workstation Edition

- **Rig**: AN-A6000PRO - NVIDIA RTX PRO 6000 Blackwell Workstation Edition (95.6 GB) - 32 cores - 126 GB RAM
- **Software**: Ollama 0.32.14 - driver 596.36 - Node v24.14.0 - win32 10.0.26200
- **Settings**: repo `hf.co/unsloth/Qwen3.8-27B-GGUF` - ctx 8192 - max_tokens 300 - repeats 2 - MTP on - thinking off
- **Run**: 2026-08-21T07:47:16.156Z

## Speed

| Quant | Resident | 100% GPU? | tok/s median | tok/s range | TTFT p50 | GPU util avg | VRAM peak |
|---|---|---|---|---|---|---|---|
| UD-IQ2_S | 9.2 GB | yes | **112.7** | 112-113.4 | 0.28s | 82% | 11.59 GB |
| UD-Q2_K_XL | 10 GB | yes | **151.7** | 114.4-208.4 | 0.29s | 66% | 13.76 GB |
| UD-IQ3_XXS | 11 GB | yes | **150.9** | 115.6-233.3 | 0.29s | 78% | 14.86 GB |

**Fastest quant that fully fits: `UD-Q2_K_XL` at 151.7 tok/s.**

## Answers - grouped by prompt for side-by-side quality comparison

### science

> Explain in about 150 words why the sky is blue.

**UD-IQ2_S** - 113.4 tok/s, 189 tokens

````
The sky appears blue due to a phenomenon known as Rayleigh scattering. Sunlight, which appears white, is actually composed of all visible colors. As this light enters the Earth's atmosphere, it collides with gas molecules, primarily nitrogen and oxygen. These molecules scatter light in every direction, but they scatter shorter wavelengths—like blue and violet—much more effectively than longer wavelengths, such as red and orange.

Because blue light has a shorter wavelength, it scatters more strongly and spreads out to reach our eyes from all directions, making the sky look blue. Violet light is scattered even more than blue, but our eyes are more sensitive to blue light, and the sun emits more blue light than violet. Consequently, the dominant color we perceive is blue. During sunrise or sunset, when the light travels through a longer path in the atmosphere, the blue light is scattered away, leaving the longer red and orange wavelengths to dominate the sky.
````

**UD-Q2_K_XL** - 151.7 tok/s, 189 tokens

````
The sky appears blue due to a phenomenon known as Rayleigh scattering. When sunlight enters Earth's atmosphere, it collides with gas molecules and small particles. Sunlight is composed of all colors of the visible spectrum, but shorter wavelengths—specifically blue and violet—scatter much more efficiently than longer wavelengths like red and orange. Because blue light scatters more intensely, it spreads throughout the sky, making it appear blue to our eyes.

You might wonder why the sky isn't violet, given that violet light scatters even more than blue. However, human eyes are less sensitive to violet light, and the sun’s radiation contains less violet energy than blue. Furthermore, some violet light is absorbed by the upper atmosphere. Consequently, our eyes perceive the dominant scattered blue light, creating the characteristic blue hue we see during the day. This effect is why sunsets appear red, as the light travels through more atmosphere, scattering away the blues.
````

**UD-IQ3_XXS** - 150.1 tok/s, 181 tokens

````
The sky appears blue due to a phenomenon known as Rayleigh scattering. Sunlight, which appears white, is actually a mixture of all visible colors, each with different wavelengths. When this light enters the Earth’s atmosphere, it collides with gas molecules and small particles. Shorter wavelengths, such as blue and violet, scatter much more efficiently than longer wavelengths like red and orange.

Violet light scatters even more than blue, but the sun emits less violet light than blue. Additionally, our eyes are more sensitive to blue light, and some violet is absorbed by the upper atmosphere. Consequently, the scattered blue light dominates the sky’s appearance during the day. This same principle explains why sunsets appear red or orange; when the sun is low on the horizon, light travels through more atmosphere, scattering away the blue and green wavelengths and leaving the longer red and orange hues to reach our eyes.
````

### reasoning

> A farmer has 17 sheep. All but 9 die. How many are left? Show your reasoning step by step, then give the final answer.

**UD-IQ2_S** - 112.7 tok/s, 300 tokens

````
To determine how many sheep are left, we can look at the problem using two different logical approaches:

**Method 1: Direct Subtraction**
1.  Start with the total number of sheep: **17**.
2.  Identify how many died: **9**.
3.  Subtract the number of sheep that died from the total number of sheep:
    $$17 - 9 = 8$$

**Method 2: Interpreting "All but"**
1.  The phrase "All but 9 die" means that every sheep died *except* for 9 of them.
2.  Therefore, the 9 sheep that did not die are the ones remaining.
3.  This leaves **9** sheep?

*Wait, let's re-read the standard interpretation of this riddle.*

Usually, this is a trick question based on language. Let's look at the phrasing carefully:
"All but 9 die."
This means 9 sheep survived.
If 9 sheep survived, then the number of sheep left is 9.

However, let's look at the math again.
Total = 17.
If "all but 9 die", it implies that 9 sheep did *not* die.
So, 9 sheep are left alive.

Let's double-check the alternative interpretation.
Does it mean 9 died?
"All but 9 die" ->
````

**UD-Q2_K_XL** - 168.9 tok/s, 179 tokens

````
This is a classic riddle that relies on wordplay rather than arithmetic. Here is the step-by-step reasoning:

**Step 1: Analyze the phrasing**
The problem states: "All but 9 die."
This phrase means that every sheep died **except for** 9 of them. It does not mean "All sheep died, leaving 9." It means that the group of sheep that survived consists of 9 individuals.

**Step 2: Identify the survivors**
Since "all but 9" died, the only sheep remaining are the 9 that did not die.

**Step 3: Calculate the final number**
The number of sheep left is simply the number of sheep that survived.
$$ \text{Sheep left} = 9 $$

**Final Answer**
There are **9** sheep left.
````

**UD-IQ3_XXS** - 158 tok/s, 300 tokens

````
Here is the step-by-step reasoning to solve this problem:

1.  **Analyze the phrase "All but 9 die":**
    The phrase "all but" is a common idiom that means "everyone except." Therefore, "All but 9 die" translates to "Everyone *except* 9 dies."

2.  **Determine who is alive and who is dead:**
    *   Since everyone *except* 9 dies, the 9 sheep mentioned are the ones that **survive** (are left alive).
    *   The rest of the sheep die.

3.  **Calculate the number of sheep left:**
    *   The question asks "How many are left?" In the context of riddles involving death, "left" usually refers to the surviving animals.
    *   Based on step 2, the 9 sheep are the survivors.

    *(Note: If one were to interpret "left" as total physical bodies remaining including dead ones, the answer would be 17. However, standard logical riddle interpretation focuses on the survivors. If the question meant "how many sheep remain on the farm," the answer is 9. If it meant "how many corpses are left," the answer would be $17 - 9 = 8$. Given the standard phrasing of this riddle, it asks for the survivors.)*

    Let's stick to the most standard interpretation
````

### code

> Write a Python function that returns the nth Fibonacci number using memoization. Include a short docstring. Code only, no explanation.

**UD-IQ2_S** - 112.1 tok/s, 99 tokens

````
```python
def fibonacci(n: int, memo: dict = None) -> int:
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

**UD-Q2_K_XL** - 208.4 tok/s, 79 tokens

````
```python
def fibonacci(n, memo={}):
    """Return the nth Fibonacci number using memoization."""
    if n in memo:
        return memo[n]
    if n <= 1:
        return n
    memo[n] = fibonacci(n - 1, memo) + fibonacci(n - 2, memo)
    return memo[n]
```
````

**UD-IQ3_XXS** - 233.3 tok/s, 94 tokens

````
```python
def fibonacci(n: int) -> int:
    """Return the nth Fibonacci number using memoization."""
    memo = {}
    def fib(k):
        if k in memo:
            return memo[k]
        if k <= 1:
            return k
        memo[k] = fib(k - 1) + fib(k - 2)
        return memo[k]
    return fib(n)
```
````

### french

> Explique en 150 mots environ le fonctionnement d une imprimante 3D a depot de filament.

**UD-IQ2_S** - 112 tok/s, 263 tokens

````
Le fonctionnement d'une imprimante 3D par dépôt de filament repose sur la technologie FDM (Fused Deposition Modeling). Le processus commence par la numérisation d'un modèle 3D, qui est ensuite découpé en fines tranches horizontales via un logiciel de tramage.

L'imprimante, contrôlée par un système de moteurs pas à pas, déplace une tête d'impression (l'extrudeuse) selon les axes X, Y et Z. Un filament thermoplastique, généralement enroulé sur une bobine, est alimenté par un système d'entraînement vers un axe de température. Là, un moteur le pousse à travers un tube réchauffé par une résistance électrique, où le plastique fond et devient visqueux.

La tête d'impression dépose ce matériau fondu couche par couche sur le plateau d'impression, qui se déplace verticalement vers le bas à chaque nouveau niveau. Les couches se solidifient rapidement, assurant l'adhésion entre elles. Ce processus itératif, où le fil est déposé et refroidi, permet de construire l'objet en volume, de la première couche jusqu'à la fin du modèle, garantissant la précision dimensionnelle du résultat final.
````

**UD-Q2_K_XL** - 123.6 tok/s, 247 tokens

````
Une imprimante 3D à dépôt de filament, aussi appelée FDM (Fused Deposition Modeling), fonctionne par le principe de la fabrication additive. Le processus commence par la conversion d'un modèle numérique 3D en instructions précises pour la machine. Le filament, une longue bobine de thermoplastique (comme le PLA ou le PETG), est tiré par des moteurs et passé dans un extrudeur. Ce dernier, souvent chauffé, fond le matériau jusqu'à sa température de fusion. La buse d'extrusion, contrôlée avec précision par des axes X, Y et Z, dépose alors la matière fondu couche par couche sur le plateau d'impression.

Chaque couche, d'une épaisseur minuscule (souvent 0,1 à 0,3 mm), se solidifie rapidement au contact de la couche précédente ou de l'air. Ce processus se répète des centaines de fois, empilant les filaments jusqu'à la formation complète de l'objet physique. À la fin, l'imprimante se déplace pour préparer la couche suivante, créant ainsi une structure solide et fonctionnelle à partir d'un simple flux continu de matière.
````

**UD-IQ3_XXS** - 115.6 tok/s, 240 tokens

````
Une imprimante 3D par dépôt de filament (FDM) transforme du plastique thermoplastique en objets solides par accumulation de couches successives. Le processus commence par l'alimentation d'un filament en bobine dans une extrudeuse. Ce dernier est entraîné vers un bloc chauffant où une résistance le porte à sa température de fusion (souvent entre 180 et 250 °C). Le filament fondu passe alors à travers une buse métallique fine, appelée buse d'extrusion.

Pendant ce temps, une plateforme mobile positionne la buse selon des coordonnées précises définies par un logiciel de tranchage. La buse dépose le plastique fondu sur le plateau d'impression, qui s'est rapidement solidifié au contact de l'air. Le système déplace ensuite la buse pour tracer la couche suivante, légèrement superposée à la précédente. En répétant ce cycle millimètre par millimètre, l'imprimante construit l'objet couche par couche jusqu'à sa finalisation, créant ainsi des pièces géométriquement complexes à partir de simples fils de plastique.
````

### format

> List exactly 5 differences between TCP and UDP. One line each, no preamble, no conclusion.

**UD-IQ2_S** - 112.2 tok/s, 103 tokens

````
TCP provides connection-oriented communication with a three-way handshake, while UDP is connectionless.
TCP guarantees reliable, in-order delivery of data, whereas UDP offers no delivery guarantees.
TCP uses a sliding window mechanism for flow control, but UDP has no flow control mechanism.
TCP supports error correction via checksums and retransmission, while UDP only uses checksums for data integrity.
TCP allocates a fixed port for the session, whereas UDP can send datagrams to different ports without establishing a session.
````

**UD-Q2_K_XL** - 126.9 tok/s, 100 tokens

````
1. TCP is connection-oriented, establishing a session before data transfer, while UDP is connectionless.
2. TCP guarantees reliable delivery of data packets, whereas UDP offers no guarantee of delivery.
3. TCP maintains the correct order of data segments, while UDP transmits packets independently without ordering.
4. TCP includes flow control and congestion management, features absent in UDP.
5. TCP has higher overhead due to headers and handshakes, making UDP faster for real-time applications.
````

**UD-IQ3_XXS** - 143 tok/s, 120 tokens

````
TCP is a connection-oriented protocol requiring a three-way handshake, while UDP is connectionless and stateless.
TCP guarantees reliable, in-order delivery of data segments, whereas UDP offers no delivery or ordering guarantees.
TCP includes flow control and congestion control mechanisms to prevent network overload, while UDP lacks these features.
TCP headers are larger (20 bytes minimum) due to sequence numbers and control flags, while UDP headers are fixed at 8 bytes.
TCP is generally slower due to its overhead, making it suitable for critical data, while UDP is faster and preferred for real-time applications.
````
