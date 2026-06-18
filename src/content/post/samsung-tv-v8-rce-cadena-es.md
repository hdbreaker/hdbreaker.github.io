---
title: "RCE en V8 de una Samsung TV #3 — La cadena de oro al .text"
publishDate: "2026-06-18"
description: "¿Qué objeto alcanzable desde JS contiene un puntero que caiga, sí o sí, dentro del mapeo de libchrome.so? La respuesta es un DOM wrapper."
tags: ["samsung-tv", "tizen", "chromium", "v8", "wasm", "type-confusion", "arm32", "browser-exploitation", "rce"]
draft: false
listed: false
lang: "es"
altSlug: "samsung-tv-v8-rce-golden-chain"
series: "samsung-tv-v8-rce"
seriesOrder: 3
seriesLabel: "03 · La cadena de oro al .text"
---

Tengo R/W arbitrario, pero para encontrar `libchrome.so` en memoria me falta un punto de partida confiable. La pregunta exacta es: **¿qué objeto alcanzable desde JS contiene un puntero que caiga, sí o sí, dentro del mapeo de `libchrome.so`?** Si lo tengo, tengo un ancla: una dirección que sé que cae *dentro* de la librería. Y desde ahí, llegar al ELF base es solo cuestión de leer hacia atrás página por página hasta dar con el inicio del binario.

La respuesta resultó ser algo que cualquier página web tiene a mano: un **DOM wrapper**.

## La cadena de oro

En Blink, cada objeto JS que envuelve un nodo del DOM (`document.body`, un `<div>`, lo que sea) es un objeto V8 con **embedder fields**: punteros crudos a la maquinaria C++ nativa. Tiene dos que nos importan: en `+0x10` guarda el `ScriptWrappable` —el objeto C++ vivo del nodo, que vamos a secuestrar recién en el [final](/blog/samsung-tv-v8-rce-rop-es)—, y en `+0x0c` guarda un puntero al **`WrapperTypeInfo`**: una estructura **estática**, parte de la propia `libchrome.so`, que describe el tipo de ese wrapper. Para *anclarnos* al `.so` el que sirve es el `+0x0c`, y por una razón hermosa: al ser estático vive dentro del binario (offset fijo), y su cuerpo está lleno de punteros a código (`.text`).

```
addrOf(document.body)            -> objeto V8 wrapper (heap de V8)
   └─ +0x0c  embedder field      -> WrapperTypeInfo (estático, DENTRO de libchrome.so)
         └─ cuerpo               -> tabla de punteros a .text   ✅
```

## Cómo lo encontré (payload `anchor`)

El payload `anchor` hace una sola cosa, y la hace sin escribir nada: agarra unos cuantos DOM wrappers (`document.body`, `document.documentElement`, un `<div>` nuevo) y lee, con `read32`, los primeros words de cada uno. Como sólo lee objetos que ya están vivos, no hay forma de que crashee — y eso, en una TV donde un puntero malo te reinicia el navegador, vale oro. Por cada word que vuelca, anota además en qué región de memoria cae ese valor, para ver de un vistazo a dónde apunta.

El patrón saltó a la vista. Fijate sólo en la columna del `+0x0c`: los tres wrappers, objetos distintos y sin relación entre sí, guardaban ahí un puntero que empieza igual, `0xb4______`:

```
                          +0x0c         <- la columna que importa
document.body             0xb4cd9410    ┐
document.documentElement  0xb4cda954    ├─ todos 0xb4______ : misma región
nuevo <div>               0xb4cd9928    ┘
```

(El dump también imprime otros campos —el `+0x10`, que va a tener su protagonismo recién en el [final](/blog/samsung-tv-v8-rce-rop-es), y demás— pero para *anclar* son ruido: lo que se repite, idéntico en los tres, es el `+0x0c`.)

¿Por qué importa ese `0xb4______`? Porque esa es la zona clásica de **mmap de librerías en ARM32 Linux** — muy por encima del heap de V8, donde viven los objetos JS. Un puntero ahí no apunta a otro objeto JS: apunta **afuera**, a la imagen de `libchrome.so` cargada en memoria. Eso es exactamente lo que buscaba: el `+0x0c` de cualquier DOM wrapper es un embedder field que cae dentro del mapeo de la librería.

![Payload `anchor` corriendo en el Tizen Browser del TV](/assets/blog/samsung-tv-rce-2-anchor.png)

*`anchor` (read-only): vuelca los embedder fields de los DOM wrappers y marca los candidatos `0xb4____` como `← ANCLA?` — punteros nativos muy por encima del heap de V8.*

## De ancla a ELF base (payload `soscan`)

`soscan` cierra el círculo. Hace primero la parte segura y la guarda **antes** de cualquier scan: `addrOf(document.body)` → lee el embedder `+0x0c` (el `WrapperTypeInfo`) → derefa su cuerpo buscando punteros a código nativo → imprime todo como evidencia de que el ancla cae en el `.so`. Recién después escanea hacia abajo buscando `\x7fELF` + `EM_ARM`.

Antes de escanear nada, `soscan` lee los primeros words de ese `WrapperTypeInfo` para ver qué tiene adentro. Que la lectura funcione **sin crashear** ya dice algo: la estructura está en memoria mapeada, es real. Y esto es lo que hay:

```
[*] WrapperTypeInfo = 0xb4c1c410
    +0x00 : 0x1            <- tag del struct, NO un vtable
    +0x04 : 0xb439e439    ┐
    +0x08 : 0xb439e535    │  14 punteros 0xb439e4xx–0xb439ebxx,
    +0x20 : 0xb439e6a9    │  todos impares (bit Thumb de ARM)
    +0x24 : 0xb439e769    ┘  -> TABLA de funciones en .text de libchrome.so
```

Ese `0xb4c1c410` no es memoria de Oilpan ni del heap de V8: cae en la **`.data.rel.ro` de la propia `libchrome.so`** — es una estructura **estática** del binario, no un objeto del GC. Por eso no arranca con un vtable sino con un tag chico —ese `0x1` del `+0x00`—, y lo jugoso está en el cuerpo: una **tabla de funciones**, 14 punteros con el mismo prefijo `0xb439` apuntando al `.text` de `libchrome.so`. Toda la zona `0xaf__–0xb4__` es el mapeo de la librería.

Para elegir el ancla, `soscan` se queda con ese **cluster** de punteros que comparten prefijo (la tabla de funciones) y toma el menor de todos —el más cercano al ELF base—: acá, `0xb439e438`. Desde ahí baja página por página buscando `\x7fELF`.

![Payload `soscan` escaneando hacia el header ELF en el TV](/assets/blog/samsung-tv-rce-3-soscan.png)

*`soscan` bajando desde el ancla, página por página, hasta dar con el `\x7fELF` de la librería en la base del mapeo.*

### Por qué el ancla es ASLR-proof

El ancla es una entrada de la tabla de funciones, y esa tabla tiene **offsets fijos dentro del binario**. El ASLR reubica la librería entera en cada arranque, pero su layout interno no cambia: ese entry siempre cae en `elf_base + 0x49a2438`. Así que la base se despeja sola:

```
elf_base = derive_ancla() - 0x49a2438
```

Funciona en cada run, sin importar dónde quedó mapeada la lib. Y sirve también para el crash-resume: en vez de guardar la dirección absoluta del cursor (que el ASLR movería tras un crash), `soscan` guarda el **offset relativo al ancla** (`delta = ancla - addr`); al reanudar re-deriva el ancla y aplica el mismo `delta`.

Con esto la base deja de ser un offset hardcodeado y pasa a ser una **cadena calculable y verificable**: DOM wrapper → `WrapperTypeInfo` (estático) → tabla de funciones (`.text`) → `.so`.

Ya tengo el `elf_base` y sé que es estable. La pregunta ahora es cómo se saca un `.so` de 80 MB de una TV usando nada más que JavaScript. Veámoslo en la [próxima entrada](/blog/samsung-tv-v8-rce-elf-base-dump).
