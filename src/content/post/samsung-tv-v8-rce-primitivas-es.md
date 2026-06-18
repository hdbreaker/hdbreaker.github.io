---
title: "RCE en V8 de una Samsung TV #1 — Tres primitivas, sin jaula"
publishDate: "2026-06-18"
description: "Una type confusion de WasmGC convertida en addrOf, read32 y write32 — R/W total del proceso de 32 bits sin jaula de V8 que escapar."
tags: ["samsung-tv", "tizen", "chromium", "v8", "wasm", "type-confusion", "arm32", "browser-exploitation", "rce"]
draft: false
listed: false
lang: "es"
altSlug: "samsung-tv-v8-rce-primitives"
series: "samsung-tv-v8-rce"
seriesOrder: 1
seriesLabel: "01 · Tres primitivas (sin jaula)"
---

El bug de WasmGC confunde los tipos de los campos de un struct. Suena académico hasta que lo convertís en herramientas. Construí tres módulos Wasm chiquitos, hechos a medida: cada uno usa esa misma confusión de tipos pero apuntada a un fin distinto. Los nombro según el tipo que confunden:

- **`e_*`** (de `externref`) — guarda un objeto JS en un campo y me lo deja leer de vuelta como si fuera un número. Ese número *es* la dirección del objeto en memoria.
- **`i_*`** (de `i32`) — el cargador: le pongo el número que quiero usar como dirección.
- **`ip_*`** (de *i32 como puntero*) — agarra esa dirección y la trata como un puntero, para leer o escribir los 32 bits que viven ahí.

Combinándolos salen exactamente las tres primitivas que sostienen el resto de la explotación:

- **`addrOf(obj)`** — la dirección de un objeto JS. (`e_*`: meto el objeto y lo leo como entero.)
- **`read32(addr)`** — lee 32 bits en cualquier dirección. (`i_*` carga la dirección, `ip_*` la lee.)
- **`write32(addr, val)`** — escribe 32 bits en cualquier dirección. (igual que `read32`, pero `ip_*` escribe.)

```js
function addrOf(obj)     { e_set(E, obj); return i2u(i_get0(E)); }
function read32(addr)    { i_set0(I, u2i(((addr >>> 0) - 7) >>> 0)); return i2u(ip_read(I)); }
function write32(addr,v) { i_set0(I, u2i(((addr >>> 0) - 7) >>> 0)); ip_write(I, u2i(v)); }
```

El `-7` compensa el header del struct interno `ip_*` (un `ref` a `oneRef` cuyo campo `i32` cae en `addr`), de modo que el `StructGet` final lee exactamente la dirección que pedí.

## Por qué esto es *arbitrario*, no "enjaulado"

En el PoC original de Windows x64 estas dos funciones se llamaban `caged_read` / `caged_write` — *caged*, enjauladas — porque allá el read/write quedaba atrapado **dentro** del cage de V8. Acá las renombré a `read32` / `write32` a propósito: **en esta TV no hay jaula**, y esa diferencia es la que hace viable todo lo demás.

En V8 de **64 bits** existe el pointer-compression cage: los punteros son offsets de 32 bits relativos a una base de 4 GB, así que un read por confusión sólo alcanza memoria *dentro* de esa región. Para salir hace falta romper la jaula aparte, como un paso más del exploit.

En V8 de **32 bits no hay compresión**. Cada puntero ya es una dirección nativa completa de 32 bits. La confusión `i32 ↔ ref` te entrega esa dirección **cruda**, sin traducir. Por lo tanto `read32` y `write32` no tienen techo: les paso **cualquier** dirección del proceso —un número entre 0 y los 4 GB— y leo o escribo los 32 bits que viven ahí.

Es un **read/write de todo el espacio de direcciones del proceso**, gratis. Sin tener que escapar del cage de V8, sin romper nada extra. Leak de punteros, walk de estructuras C++, búsqueda del ELF en memoria, dump del binario entero.

## El primer payload: `diagnostic.js`

`diagnostic.js` es el primer payload de la cadena y tiene un solo trabajo: **probar que el bug dispara en este browser y que las tres primitivas funcionan de verdad**, antes de construir nada encima.

Por dentro hace tres cosas. Primero **llena la tabla de tipos canónicos de Wasm** —más de un millón de slots— para forzar la colisión de índices que *es* el bug. Después **arma los módulos `e_*` / `i_*` / `ip_*`** y deriva `addrOf` / `read32` / `write32`. Y por último **los pone a prueba contra un objeto real**: agarra un `ArrayBuffer` cualquiera y lo usa de conejillo de Indias.

```
ab (ArrayBuffer)    →  addrOf = 0x50709be1   ← su dirección en el heap de V8
read32(0x50709be1)  →  0x75391a5c            ← lo primero que tiene adentro (su "map")
read32(ab + 0x18)   →  0x902a0400            ← dónde guarda sus bytes de datos
```

Dos lecturas, dos pruebas distintas:

- **`read32(0x50709be1) = 0x75391a5c`** lee el **primer word del objeto** — y eso en V8 nunca es un dato cualquiera: el primer word de *todo* objeto del heap es un puntero a su *map* (el "hidden class", el descriptor que dice de qué tipo es el objeto). Los maps viven agrupados en su propia región del heap, así que ver un valor del rango `0x753…` —donde caen los maps en este proceso— confirma dos cosas de un saque: que el read aterrizó en el objeto correcto y que leyó bien su primer word.
- **`read32(ab + 0x18) = 0x902a0400`** lee otro campo del `ArrayBuffer`: el puntero a su *backing store*, el bloque donde guarda los bytes de datos. Y acá está la prueba que buscaba: ese bloque **no vive en el heap de V8**. Los `ArrayBuffer` reservan su memoria aparte, por fuera del heap del garbage collector, con el allocator del embedder (un `mmap`/`malloc` propio) — por eso `0x902…` cae en una región lejana y totalmente separada. Poder leer ahí prueba lo único que importa: el alcance del read **no está acotado a nada**.

> Las direcciones exactas (`0x753…`, `0x902…`) son de *este* proceso —el ASLR las corre en cada arranque—; lo que importa es que pertenecen a **regiones distintas**, y que el primer word es un map válido. Si querés ir a la fuente de por qué es así: el map siempre está en el offset 0 del objeto ([`v8/src/objects/map.h`](https://source.chromium.org/chromium/chromium/src/+/main:v8/src/objects/map.h)) y la backing store se reserva fuera del heap ([`v8/src/objects/backing-store.h`](https://source.chromium.org/chromium/chromium/src/+/main:v8/src/objects/backing-store.h)).

![Payload `diagnostic` corriendo en el Tizen Browser del TV](/assets/blog/samsung-tv-rce-1-diagnostic.png)

*`diagnostic.js` corriendo en el navegador del TV: las tres primitivas (`addrOf` y el read/write arbitrario de 32 bits) dan resultados correctos contra un `ArrayBuffer` real, y el log cierra detectando la arquitectura del proceso: `ARM v7 32-bit` — el dato que confirma que estamos en un V8 sin cage.*

## Una primitiva más rápida para volcar memoria

`read32()` lee de a 32 bits y, para volcar regiones grandes, es lento: cada word son varias llamadas a Wasm. Pero mirando cómo V8 guarda un `ArrayBuffer` en memoria me di cuenta de que podía fabricar una primitiva mucho más apropiada para esta tarea, aprovechando un detalle: el propio `ArrayBuffer` lleva, en campos que puedo editar, **cuántos bytes mide** y **dónde están sus datos**. Esto se usa después en la [entrada 04](/blog/samsung-tv-v8-rce-elf-base-es) para exfiltrar la librería `libchrome.so` de forma eficiente.

La idea es usar `write32()` —que ya escribe en cualquier lado— para pisarle a un `ArrayBuffer` esos campos: le hago creer que mide 64 MB y que sus bytes viven en la dirección que yo quiera. Desde ese momento lo leo con un `DataView` nativo, a velocidad de C, sin una llamada Wasm por cada word:

```js
const ab_addr = addrOf(ab);
write32(ab_addr + 0x16, 0x200000 << 5);  // byteLength    → 64 MB
write32(ab_addr + 0x1e, 0x200000 << 5);  // maxByteLength → 64 MB
write32(ab_addr + 0x26, 0);              // offset del backing store → 0
const dv = new DataView(ab);             // dv lee memoria "real" a toda velocidad
```

## Resumen

Con esto ya tenemos sobre la mesa lo que necesitamos para todo lo que viene, validado en el propio televisor: las tres primitivas base (`addrOf`, `read32`, `write32`) más el atajo de lectura masiva por `DataView`.

| Primitiva | Qué hace | Alcance |
|-----------|----------|---------|
| `addrOf(obj)` | te devuelve la dirección en memoria de un objeto JS | — |
| `read32(addr)` | lee 32 bits en `addr` | **cualquier** dirección del proceso (los 4 GB) |
| `write32(addr, v)` | escribe 32 bits en `addr` | **cualquier** dirección del proceso |
| `ArrayBuffer` redirigido | lectura masiva por `DataView` nativo (rápida) | repuntarlo **antes** de crear el `DataView` |

En este punto el problema cambia de naturaleza. Deja de ser de *capacidad* y pasa a ser de *información*. Tengo R/W total sobre el proceso. Para armar la cadena ROP necesito los offsets de `libchrome.so` — y conseguir ese binario, en una TV que no me deja sacarlo, es el resto de la serie. Empieza con un callejón sin salida: [la entrada 02](/blog/samsung-tv-v8-rce-sdb-es).
