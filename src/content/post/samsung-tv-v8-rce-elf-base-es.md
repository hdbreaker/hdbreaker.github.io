---
title: "RCE en V8 de una Samsung TV #4 — ELF base y dump del .so"
publishDate: "2026-06-18"
description: "Con la cadena de oro, soscan corrió contra la TV y encontró la base de la librería junto al offset de ancla constante que sobrevive cualquier reboot."
tags: ["samsung-tv", "tizen", "chromium", "v8", "wasm", "type-confusion", "arm32", "browser-exploitation", "rce"]
draft: false
listed: false
lang: "es"
altSlug: "samsung-tv-v8-rce-elf-base-dump"
series: "samsung-tv-v8-rce"
seriesOrder: 4
seriesLabel: "04 · ELF base y dump del .so"
---

Con la cadena de oro de la [entrada anterior](/blog/samsung-tv-v8-rce-cadena-es), `soscan` corrió contra la TV y encontró la base de la librería. Esta es la salida real del run (evidencia cruda: [`soscan_v3_ELFBASE_FOUND_190515.txt`](https://github.com/hdbreaker/samsung-smarttv-tizen-9-chromium-120-v8-rce/blob/main/blog/assets/soscan_v3_ELFBASE_FOUND_190515.txt)):

```
[+] ===== libchrome.so ENCONTRADO =====
    elf_base    = 0xaf9fc000
    ancla       = 0xb439e438  (off +0x4 del objeto C++)
    anchor_ofs  = 0x49a2438   (= ancla - elf_base, constante)
    => en el exploit: elf_base = ancla() - 0x49a2438
    e_type=0x3 e_machine=0x28 e_entry=0x0
    e_phoff=0x34 e_phentsize=32 e_phnum=12
```

`e_machine=0x28` (EM_ARM) y `e_type=0x3` (ET_DYN, shared object) confirman que es el ELF correcto. El premio es **`anchor_ofs = 0x49a2438`**: la distancia constante entre el ancla y la base, que sobrevive cualquier reboot.

> Verificación cruzada: `0x49a2438` cae dentro del segmento R-X (`vaddr 0x1184880 .. 0x5020830`). El ancla **es** un puntero a `.text` real, no un string. La heurística de densidad acertó.

## El mapa de `libchrome.so` (program headers)

Con `elf_base` y los program headers, el mapa de la librería queda así:

```
LOAD off=0x000000  vaddr=0x00000000 filesz=0x117487c R--   (ELF hdr, .dynsym/.dynstr, .rodata)
LOAD off=0x1174880 vaddr=0x01184880 filesz=0x3e9bfb0 R-X   (.text -> 62 MB de gadgets)
LOAD off=0x5010840 vaddr=0x05030840 filesz=0x23f308  RW-   (.data)
LOAD off=0x524fb48 vaddr=0x0527fb48 filesz=0x3d8c4   RW-   (.data/.bss)
image span: 0x0 .. 0x57fdf9d  (~88 MB)
```

La clave para entender el dump es que un ELF tiene **dos direcciones para lo mismo**: dónde queda un segmento *en memoria* (`p_vaddr`) y en qué parte del *archivo* en disco vive (`p_offset`). No coinciden. Así que dumpear es traducir de una a la otra: el byte `i` de un segmento lo **leo** de memoria en `elf_base + p_vaddr + i`, y lo **escribo** en el archivo reconstruido en la posición `p_offset + i`. Recorrés cada segmento de punta a punta haciendo esa cuenta y el `.so` se rearma idéntico al de disco.

## El crash de un solo tiro, explicado

El scan de `soscan` crasheó **una vez** (delta `0x3820000` → vaddr `0x1182000`) y reanudó. No fue azar: ese vaddr cae en el **gap entre el segmento R-- (termina en `0x117487c`) y el R-X (empieza en `0x1184880`)** — un hueco de ~48 KB que el loader deja sin mapear (PROT_NONE) por el padding de alineación a 64 KB entre PT_LOADs. Leer ahí es un SIGSEGV. El watchdog recargó, el resume saltó el gap (+64 KB) y bajó hasta el header ELF. Dos lecciones de un solo crash: la infraestructura de crash-resume (offset-relativo-al-ancla) se validó en producción, y un dump **debe iterar por segmento** usando `[vaddr, vaddr+filesz)`, sin cruzar los gaps entre PT_LOADs.

## El dump: 82.6 MB en ~80 segundos, cero crashes

El payload `sodump` recorre cada PT_LOAD `[elf_base+vaddr, +filesz)` en bloques de 64 KB, los codifica, y hace `POST` de cada uno a `/dump` con su `p_offset` destino; el server reconstruye el archivo colocando cada bloque en su lugar. Corrió de un tiro (evidencia: [`sodump_v1_DUMP_COMPLETO_191521.txt`](https://github.com/hdbreaker/samsung-smarttv-tizen-9-chromium-120-v8-rce/blob/main/blog/assets/sodump_v1_DUMP_COMPLETO_191521.txt)):

```
[+] magic '\x7fELF' verificado en 0xaf9fc000
[*] plan de dump (4 PT_LOAD, R-X primero):
    off=0x1174880 vaddr=0x1184880 filesz=0x3e9bfb0 R-X
    off=0x0       vaddr=0x0       filesz=0x117487c R--
    ...
[+] segmento 0 completo (off=0x1174880, 62.61 MB)
...
[+] ===== DUMP COMPLETO =====  (82.6 MB de PT_LOADs)
```

Y acá vale la pena el detalle que hace que esto funcione: **dentro de un segmento mapeado no hay gaps `PROT_NONE`**, así que las ~21 millones de lecturas de 4 bytes salieron **sin un solo crash**. El cursor en `localStorage` ni hizo falta. Quedó `dumps/libchrome.leak.so` de **86,561,804 bytes** (`= seg4_off + seg4_filesz`, exacto).

![Payload `sodump` volcando los PT_LOAD por chunks en el TV](/assets/blog/samsung-tv-rce-4-sodump.png)

*`sodump`: `Primitives ready`, el plan de los 4 PT_LOAD (R-X primero) y el progreso de chunks vía `POST /dump` hasta 82.6 MB — la librería entera saliendo del televisor solo con R/W, sin ADB.*

## Dos fixups para que un dump de memoria sea analizable

Tener los bytes no alcanza: lo que dumpeé es una **foto de la librería ya cargada**, y eso no es igual al `.so` tal como está en disco. Cuando el loader monta una librería, le toca y le cambia cosas; mi foto quedó con esos cambios, y por eso `objdump`/`readelf`/[ROPgadget](https://github.com/JonathanSalwan/ROPgadget) la rechazan. Hay dos diferencias concretas, y `utils/fix_elf.py` deshace las dos:

1. **Le faltan las section headers.** Un ELF tiene dos tablas que lo describen: los *program headers* (lo que el loader necesita para correrlo) y las *section headers* (el detalle fino que usan las tools de análisis). Las primeras se cargan en memoria; las segundas **no** —sólo existen en el archivo de disco—, así que mi foto no las tiene. El problema es que el header ELF igual dice "están en el offset `0x528d574`", y las tools van a buscarlas ahí, no las encuentran y abortan con *"section header table goes past the end of the file"*. La solución es decirles que no hay: se ponen en cero los campos que apuntan a esa tabla (`e_shoff`, `e_shnum`, `e_shstrndx`), y las tools caen a su modo "sin secciones", trabajando sólo con los program headers.
2. **Punteros que el loader ya reescribió a direcciones reales.** Dentro del `.dynamic` (la sección con la metadata de linking) hay punteros que en el archivo de disco son *offsets* relativos, pero que el loader, al cargar la lib, reescribe a la dirección absoluta donde quedó cada cosa en memoria. Por ejemplo `DT_STRTAB` —el puntero a la tabla de strings— en mi foto valía `0xafa130d8`, una dirección absoluta, en vez del valor original. Para volver al valor de disco hay que restarle el `elf_base`: `0xafa130d8 − 0xaf9fc000 = 0x170d8`. `fix_elf.py` hace esa resta en los **7 punteros** del `.dynamic` que estaban reescritos.

> `fix_elf.py` **normaliza un snapshot de memoria** para devolverlo a algo que las tools estáticas entienden. (Y escribe una copia `*.static.so`, sin tocar el dump crudo `*.leak.so`.)

## El ajá moment

Con los dos fixups, el `.dynamic` se lee limpio. Y ahí aparece la confirmación que cierra todo el arco de "no podía sacar el binario":

```
SONAME   libchromium-impl.so
NEEDED   libecore.so.1   libevas.so.1   libecore_evas.so.1   libelementary.so.1
NEEDED   libefl-extension.so.0   libecore_wl2.so.1   libedje.so.1   libeina.so.1
NEEDED   libtts.so   libvconf.so.0   libcapi-appfw-application.so.0   ...
```

El `SONAME` real es **`libchromium-impl.so`** (el naming de Samsung), y los `NEEDED` son el **stack gráfico EFL de Tizen** (Ecore/Evas/Elementary/Edje/Eina) — la huella inconfundible del Chromium embebido de la TV. Desde JavaScript y un read arbitrario, reconstruí **el binario exacto que corre en el televisor**, listo para análisis estático.

Hay un solo símbolo dinámico exportado: es una librería **de producción stripped**. Chromium linkea casi todo estáticamente, así que `mprotect`/`mmap`/`system` no están acá como símbolos definidos — son *imports* vía PLT a las libc de los `NEEDED`. No importa: para ROP no necesito símbolos, necesito **bytes de `.text`**. Y de eso hay de sobra:

```
$ ROPgadget --binary dumps/libchrome.static.so
Unique gadgets found: 395075
```

Casi **400.000 gadgets únicos**, con `pop {…, pc}` de sobra para controlar registros y saltar. El binario de la TV pasó de caja negra inalcanzable (SDB bloqueado por SMACK, [entrada 02](/blog/samsung-tv-v8-rce-sdb-es)) a un ELF analizable en la laptop. Con el arsenal sobre la mesa, la pregunta pasa a ser cómo ejecutarlo — y eso arranca por entender qué [protecciones hay in place](/blog/samsung-tv-v8-rce-dep-es) en la TV.
