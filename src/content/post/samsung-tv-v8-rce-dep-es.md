---
title: "RCE en V8 de una Samsung TV #5 — ¿DEP o shellcode? ROP"
publishDate: "2026-06-18"
description: "Antes de construir la etapa de ejecución, una pregunta decide toda la estrategia: ¿el proceso del navegador tiene alguna región RWX?"
tags: ["samsung-tv", "tizen", "chromium", "v8", "wasm", "type-confusion", "arm32", "browser-exploitation", "rce"]
draft: false
listed: false
lang: "es"
altSlug: "samsung-tv-v8-rce-dep-or-rop"
series: "samsung-tv-v8-rce"
seriesOrder: 5
seriesLabel: "05 · ¿DEP o shellcode? Veredicto: ROP"
---

Ya tengo R/W arbitrario ([01](/blog/samsung-tv-v8-rce-primitivas-es)), `elf_base` ASLR-proof ([04](/blog/samsung-tv-v8-rce-elf-base-es)) y 395k gadgets. Antes de ponerme a construir la etapa de ejecución, hay una pregunta que decide *toda* la estrategia, y conviene responderla con certeza y no a las apuradas:

> ¿El proceso del navegador tiene alguna región **RWX** (escribible *y* ejecutable)?

Si la respuesta es **sí**, el camino es el más simple del mundo: escribís shellcode ARM32 en esa región y saltás. Cero ROP. Si es **no** (W^X / DEP en vigor), toca **ROP**: encadenar gadgets para llamar a `mprotect(page, len, RWX)`, volver ejecutable un buffer controlado, y recién ahí saltar al shellcode.

Spoiler: para Chromium 120 la respuesta es **no hay RWX**. Y lo lindo es que lo puedo afirmar sin siquiera arriesgar un crash en la TV — me lo dicen el binario y la historia de V8.

## Nivel 1 — lo que el binario ya dice (estático, riesgo cero)

El dump de `libchromium-impl.so` ([04](/blog/samsung-tv-v8-rce-elf-base-es)) trae los program headers y los flags del `.dynamic`. Eso ya fija el prior con certeza:

| Señal | Valor | Implica |
|-------|-------|---------|
| `PT_GNU_STACK` | `RW-` (sin bit X) | **Stack NO ejecutable** (NX pedido por el toolchain) |
| `PT_GNU_RELRO` | presente, `R--` | Full RELRO: la GOT queda de solo-lectura tras el load |
| `DT_FLAGS` | `0x8` = `DF_BIND_NOW` | BIND_NOW: no hay lazy-binding que abusar |
| `DT_FLAGS_1` | `0x1` = `DF_1_NOW` | refuerza el RELRO completo |
| Segmentos | `R--` / `R-X` / `RW-` separados | **W^X** estricto en la librería (nada RWX en el `.so`) |

La conclusión parcial es segura: el binario fue compilado para un entorno con DEP/NX. El clásico "volver al stack y ejecutar shellcode ahí" está descartado — el stack es `RW-`. La librería no tiene ni un byte RWX. Pero eso es el *toolchain de la librería*; no prueba nada sobre el **code-space JIT de V8** del proceso vivo. Esa era la única chance de saltarnos el ROP. Y para cerrarla no hace falta tocar el televisor.

## Nivel 2 — el corte de versión de V8: code-space R-X, no RWX

Por años V8 mantuvo su code-space (donde vive el código JIT de Liftoff/TurboFan/wasm) en **RWX**: era más rápido parchear código sin un `mprotect` por cada emisión. Esa era exactamente la grieta que un infoleak + arbitrary-write convertía en "escribí shellcode en el code-space y saltá", sin ROP.

Ese modelo **se eliminó**. A partir del trabajo de write-protection del code memory de V8 (el viejo `--write-protect-code-memory`, después la migración a un code-space **permanentemente `R-X`** con un alias `RW-` separado para la escritura, y donde hay soporte, *thread-isolation* vía PKU/MPK), el code-space dejó de ser RWX en producción. Las páginas de código quedan **`R-X` en reposo** y sólo se flipean a `RW-` de forma transitoria durante la generación de código — no hay una ventana RWX permanente que se pueda racear de forma fiable.

ARM32 no tiene PKU, así que el build usa el toggle basado en `mprotect` (RW↔RX), pero el **estado en reposo es el mismo: `R-X`**. Cualquier escritura mía a una página de código JIT cae sobre una página de solo-lectura-ejecución → SIGSEGV. Y **Chromium 120.0.6099.5** está *muy* por encima de ese corte, así que medir en runtime no agregaría información: el resultado ya está determinado. Directo a ROP.

## El árbol de decisión (resuelto)

```
   ¿RWX en el proceso vivo?
        │
   ┌────┴─────────────────────────────┐
   │ estático .so: W^X estricto, NX    │
   │ V8 ≥ corte W^X: code-space R-X    │
   └────┬─────────────────────────────┘
        │
     RWX = NO  (determinado, sin medir en la TV)
        │
   ROP: leak mprotect (GOT) → mprotect(buf, RWX) → jump → shellcode
        │
   backconnect ARM32  → /bin/sh contra 192.168.100.80  (validación / reporte)
```

El camino elegido es la cadena ARM32 clásica, y **no** depende de que el stack sea ejecutable: leak de `mprotect` del GOT (ya poblado por `BIND_NOW`), pivot + cadena ROP que arma `mprotect(page, len, RWX)` sobre un buffer controlado, y salto al buffer ya ejecutable con el shellcode. El detalle fino de *cómo* hago que la CPU empiece a ejecutar mis gadgets — el hijack — y la cadena completa de explotación van en la [entrada 06](/blog/samsung-tv-v8-rce-rop-es), el final.
