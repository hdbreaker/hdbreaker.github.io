---
title: "Pwneando el browser de una Samsung TV — type confusion en Chrome V8 WASM"
publishDate: "2026-06-18"
description: "De una sola página web a una reverse shell en una Samsung QLED (Tizen 9, Chromium 120, ARM32) — explotando una type confusion de V8 WebAssembly-GC."
tags: ["samsung-tv", "tizen", "chromium", "v8", "wasm", "type-confusion", "arm32", "browser-exploitation", "rce"]
draft: false
listed: false
lang: "es"
altSlug: "samsung-tv-v8-rce"
series: "samsung-tv-v8-rce"
seriesOrder: 0
seriesLabel: "00 · La historia y la idea"
---

Hace algún tiempo que no encontraba el espacio para escribir. La vida me puso por delante algunos cambios últimamente — personales, laborales, de ciudad. Recién ahora, con todo más resuelto y encaminado, me hice el tiempo para dedicarle unos fines de semana a algo nuevo que me dio curiosidad.

Aproximadamente hace un año me mudé de ciudad y, entre toda la reacomodación, me compré un televisor nuevo. Siempre fui amante de los livings: ese lugar donde ver una película, juntar a la familia y a los amigos, darle algo de calidez al hogar. Para mí un buen living necesita, sí o sí, un gran TV — así que me terminé comprando el **Samsung 65" QLED 2025**: modelo **QN65Q7FAAGXZS**, software **T-RSLFUABC-0090-1296.8**.

Lo que no tenía planeado era quedarme mirando *el televisor en sí*. Casi siempre reproduce películas y, de vez en cuando, se convierte en la computadora más interesante de la casa. Una noche me puse a pensar qué tan potente era realmente, y me choqué con algo incómodo: no lo podía administrar. ADB no funcionaba. Requería un software development kit especial, una configuración de developer mode, toda una ceremonia de permisos para hacer cualquier cosa. Y dije: no. Quiero poder acceder a este TV sin restricciones — y lo voy a hacer a mi manera.

Así nació la pregunta que guió todo el proyecto:

**¿Puedo hackear este TV? ¿Cuál es su superficie de ataque?**

Empecé a hurgar en el TV y enseguida apareció lo más interesante que tenía para ofrecer: un navegador web instalado por defecto, capaz de conectarse con el exterior. Como ya tengo algo de experiencia previa detectando y explotando bugs en browsers, pensé que podía valer la pena analizarlo como potencial superficie de ataque. Y había un plus: el fingerprinting de browsers es parte de mi trabajo diario en detección de bots, así que sentía que tenía buenas herramientas para entender ante qué navegador me estaba parando.

Lo primero que hice, entonces, fue lo que mejor vengo haciendo últimamente: **fingerprintear el navegador**. Lo que devolvió fue revelador: una versión **vieja** de Chrome, con todo el parque encendido — JavaScript, WebRTC, WebAssembly, la superficie completa de un browser de escritorio metida adentro de un televisor.

Eso me llevó a la pregunta correcta. Si corre un engine con varios años de antigüedad, ¿no habrá alguna vulnerabilidad pública que todavía aplique? No sería la primera vez que un navegador viejo es la puerta de entrada a un dispositivo cerrado: el precedente que me vino a la cabeza fue **Nintendo**, cuya consola se terminó abriendo a través de un viejo CVE de WebKit en el navegador integrado ([Switch jailbreak vía WebKit](https://techcrunch.com/2017/03/13/hackers-release-proof-of-concept-nintendo-switch-jailbreak/)) — el browser como grieta hacia el resto del sistema. Si ese concepto funcionó ahí, ¿podría funcionar acá?

Con el target elegido, comencé mi búsqueda. Todo el plan terminó reducido a una sola página web servida desde mi propia PC: esta serie es la bitácora de ir desde *esa página web* hasta una shell muy real en el televisor abusando únicamente el motor de JavaScript V8 del browser.

> Todo esto se hizo sobre mi **propio** televisor, en mi **propia** red, con fines de investigación. A lo largo del writeup la única máquina que hace algo es mi PC — la **researcher machine** en `192.168.100.80`. La TV es `192.168.100.76`. No hay terceros.

## El objetivo

Antes de pensar en romper nada, conviene mirar bien con qué nos vamos a meter. La TV se presenta así:

```
Modelo       : Samsung 65" QLED  QN65Q7FAAGXZS
Software     : T-RSLFUABC-0090-1296.8, E2592299, BT-S
Navegador UA : Mozilla/5.0 (SMART-TV; Linux; Tizen 9.0) AppleWebKit/537.36
               SamsungBrowser/8.0 Chrome/120.0.6099.5 TV Safari/537.36
```

Eso es todo lo que la propia TV te cuenta de arranque: el navegador es **SamsungBrowser 8.0**, **compilado por Samsung** y embebido en **Tizen 9.0** (el sistema operativo de la TV). Por debajo está **basado en Chromium 120**, con motor **V8**, de la rama estable de fines de **2023**. El desglose fino de ese string de versión — y el único detalle de arquitectura que termina decidiendo todo el exploit — lo dejo para el cierre del capítulo.

> Esta investigación fue realizada con **Claude Code Opus 4.8** como copiloto aumentativo. La dirección, las hipótesis y las decisiones fueron tomadas por un humano; la IA sin duda aceleró el proceso si bien no fue capaz de concluirlo de fin a fin, tanto por considerar riesgosas o inseguras ciertas partes, como por errores de desarrollo, que sin guía apropiada no hubieran sido correctamente resueltos o caían en rabbit holes continuos al tratar de validar flujos específicos inválidos de ejecución.

## El bug de partida

Empezamos el research como se empieza casi siempre: buscando trabajo previo. ¿Qué habían investigado otros sobre versiones parecidas — o incluso más nuevas — de este browser, de Chrome o de cualquier cosa basada en Chromium?

Navegando por internet encontré un repositorio: [`PumpkinBridge/Chrome-CVE-2024-2887-RCE-POC`](https://github.com/PumpkinBridge/Chrome-CVE-2024-2887-RCE-POC). Hablaba de un bug de Chrome — **CVE-2024-2887** — corregido en 123.0.6312.86 y presentado en **TyphoonPWN 2024 (Vancouver)** por **Seunghyun Lee ([@0x10n](https://x.com/0x10n))**. Ese repo, junto con el [advisory de SSD](https://ssd-disclosure.com/ssd-advisory-google-chrome-rce/), fue toda la información que encontré del bug.

¿Qué es? Una **type confusion de WebAssembly GC**. Para decidir si dos tipos de Wasm son equivalentes, V8 le asigna a cada uno un *canonical type index* — un identificador interno que comparte con cualquier tipo estructuralmente idéntico. El bug está en esa canonicalización: reservando cerca de un millón de tipos recursivos (isorecursivos), el índice desborda y **dos tipos estructuralmente distintos terminan recibiendo el mismo canonical id**. A partir de ahí el motor los considera intercambiables y opera sobre un objeto con el layout del otro — clásica confusión de tipos. Esa discrepancia de layouts es la grieta: bien encadenada, da las primitivas para leer y escribir memoria a voluntad. Y el dato que lo vuelve relevante para mí: el fix llegó en 123.0.6312.86, pero **esta TV corre 120** — de lleno en el rango vulnerable.

El PoC de Seunghyun apunta específicamente a **Chrome 125 x64 en Windows**, con **todos los offsets hardcodeados** — gadgets, vtables, etc — sacados de un análisis estático de `chrome.dll`. O sea: el bug quizás servía, pero el exploit no. Ni de cerca.

## Por qué el port es el verdadero desafío

Portar ese PoC a la TV **no es un ajuste**: es **rehacer cerca del 80% del exploit**. La hipótesis de partida era que el bug sería la **única pieza que podría sobrevivir intacta** — aunque eso todavía había que demostrarlo. ¿La type confusion realmente dispara dentro del navegador real del TV? ¿El bug era específico de Windows, o compartía causa raíz con otras compilaciones? ¿Aplicaba también a Linux? ¿A otras arquitecturas, como ARM? Nada de eso estaba dado: era exactamente lo primero que había que responder. Y todo lo que rodea al bug, en cambio, cambia de plataforma, de arquitectura y de modelo de amenaza a la vez.

La forma más rápida de ver el tamaño del salto es poner las protecciones de ambos mundos lado a lado:

| Dimensión | PoC original (Chrome 125) | TV (SamsungBrowser / Chromium 120) |
|-----------|---------------------------|-------------------------------------|
| **SO / arquitectura** | Windows, x64 | Tizen 9.0 (Linux), **ARM32** (ARMv7 LE) |
| **Pointer-compression cage** | Presente — acota el alcance del bug | **Ausente** en V8 de 32-bit → R/W de **todo** el espacio |
| **Mitigaciones** | DEP, ASLR, CFG, cage de V8 | Full RELRO, BIND_NOW, stack NX, **W^X estricto** |
| **Etapa final (hacer RWX)** | `VirtualAlloc` / `VirtualProtect` | **ROP a `mprotect`** |
| **Convención de llamada (`this`)** | en `rcx` (ABI Win64) | en **`r0`** (ABI ARM) |
| **Binario de referencia** | `chrome.dll`, público y con símbolos | `libchrome.so` (Tizen 9.0, compilado por Samsung) — **inexistente públicamente** |
| **Acceso al device** | debugger, diffing offline | **sin ADB, sin debugger** (SDB bloqueado por SMACK) |
| **Offsets** | hardcodeados del análisis de `chrome.dll` | hay que **derivarlos de un dump propio** del proceso vivo |

Cada fila es una pieza del exploit que hay que rehacer. Tres de ellas son el corazón del desafío:

- **Otro panorama de mitigaciones.** Cada supuesto sobre qué es escribible, qué es ejecutable y dónde viven los punteros hay que rederivarlo desde cero — y con él cambia la etapa final: ROP a `mprotect` en vez de a `VirtualAlloc`.
- **Otra arquitectura.** Sin cage de compresión (lo que convierte una corrupción acotada en R/W arbitrario de *todo* el espacio de 32 bits), más otra convención de llamada (`this` en `r0`), otro set de gadgets y otra forma de vtable/ABI que secuestrar.
- **Un target cerrado y privativo.** La etapa final es ROP, y para armarla necesito dos cosas que viven **dentro de `libchrome.so`**: los **gadgets** (secuencias de código del `.text` que encadeno para ejecutar la cadena) y la dirección de `mprotect` (para volver ejecutable mi buffer). Sin el binario no tengo ni gadgets ni offsets — y **no existe un `libchrome.so` público para este firmware en ningún lado**. Así que antes de poder hardcodear un solo offset hay que **exfiltrar la librería del proceso vivo, byte a byte**, a través del read arbitrario, y **reconstruir los binarios privativos de Samsung y Tizen desde cero, afuera del TV**.

Esa es la columna vertebral de esta serie: la exfiltración de memoria, la reconstrucción de la librería y la rederivación mitigación por mitigación contra un aparato de caja negra. El bug fue la parte fácil.

## El laboratorio

Nada exótico. La TV navega a una página que sirvo yo.

```
┌────────────┐     HTTP :80      ┌──────────────────────┐
│  Samsung   │  ◄────────────►   │  researcher PC       │
│  TV browser│                   │  server.py           │
│  .76       │   POST /save ──►  │  index.html          │
└────────────┘                   │  payloads/*.js       │
                                 └──────────────────────┘
```

Son dos archivos. `server.py` sirve `index.html` y los payloads `.js` — y acá conviene subrayar algo: como esto es una vuln de **V8**, **todo el método de validación y explotación es JavaScript**. No hay binario que compilar ni agente que instalar en la TV; cada etapa del kill chain es un payload `.js` que corre dentro del navegador. Además, mi server expone el endpoint `POST /save` para almacenar los resultados del JavaScript y mantener logs consistentes que permitan tracear qué sucede en cada ejecución del browser (un `tv_output_YYYYMMDD_HHMMSS.txt` nuevo por cada ejecución de JS). `index.html` es el *start point*, donde todo se une, y hace tres cosas que resultan esenciales:

- Un **dropdown** que presenta la serie de scripts que componen el kill chain, en orden de ejecución del research:
  1. **`payloads/diagnostic.js`** — dispara la type confusion y construye las primitivas base (`addrOf`, `read32`, `write32`). *Pregunta que resuelve:* ¿el bug realmente dispara en SamsungBrowser/V8 120 y me da read/write arbitrario?
  2. **`payloads/anchor.js`** — todo el navegador vive dentro de una sola librería, `libchrome.so`: V8 (el motor donde está el bug), Blink y el `.text` con los gadgets que necesitamos para construir el ROP chain. Partiendo de un objeto JS (un DOM wrapper), el payload encuentra el **embedder field** (`+0x0c`) que apunta **adentro** del mapeo de `libchrome.so`: la primera evidencia de un puntero que cae dentro de la librería. Todavía no calcula la base — sólo confirma que ese puntero-ancla existe y marca en qué región cae. *Pregunta que resuelve:* ¿hay, desde JavaScript, un puntero que caiga dentro de `libchrome.so`?
  3. **`payloads/soscan.js`** — cierra el círculo: toma ese embedder field, lee adentro la **tabla de funciones** que apunta al `.text` y de ahí saca el **ancla** real (una dirección dentro del código de la librería); recién entonces calcula el `elf_base`, la dirección donde el sistema cargó `libchrome.so`, es decir el comienzo del binario. El ASLR randomiza esa dirección en cada arranque, así que no se puede hardcodear; pero la distancia entre el ancla y esa base **sí** es constante, entonces `soscan` hace `elf_base = ancla − offset_fijo`. Eso lo vuelve "ASLR-proof": la derivación sobrevive a la randomización. *Pregunta que resuelve:* ¿desde qué dirección base puedo calcular la ubicación de cualquier gadget o función dentro de la librería (lo que después necesito para el ROP)?
  4. **`payloads/sodump.js`** — vuelca los segmentos `PT_LOAD` de la librería byte a byte vía `POST /dump`, para reconstruir `libchrome.so` afuera del TV y de ahí sacar los gadgets y offsets del ROP. *Pregunta que resuelve:* ¿puedo exfiltrar el binario entero para analizarlo en mi PC?
  5. **`payloads/vtable.js`** — un ensayo de validación del ataque final, en modo **solo lectura**. Antes de escribir nada en memoria, chequea que todas las piezas necesarias para tomar el control de la ejecución estén en su lugar y en la dirección correcta: el objeto del navegador que voy a secuestrar, la base de la librería, la dirección de `mprotect` y el gadget que desvía la ejecución hacia mi cadena. Como no modifica nada, no arriesga un crash — solo confirma que el disparo va a funcionar. *Pregunta que resuelve:* ¿están todas las piezas del ataque alineadas, antes de apretar el gatillo?
  6. **`payloads/pwn.js`** — fase de explotación: planta la fake-vtable + la cadena ROP y dispara. *Pregunta que resuelve:* ¿obtengo una reverse shell desde el TV?
- Un **watchdog de crash**. Trabajar con un read arbitrario implica que, tarde o temprano, voy a leer una dirección inválida (memoria no mapeada). Cuando eso pasa, el sistema mata el proceso del navegador con un **SIGSEGV nativo** — un crash a nivel C++, no una excepción de JavaScript, así que **ningún `try/catch` lo puede atrapar**: la página simplemente muere. La única señal de que algo salió mal es justamente esa: que se reinició. Para recuperar el proceso si crashea, `index.html` lleva un `<meta http-equiv="refresh">` que **recarga la página cada 90 segundos**; si un payload crashea, a lo sumo 90s después la página vuelve por sí misma y retoma desde donde quedó (de la mano del resume en `localStorage`, acá abajo).
- **Estado de resume en `localStorage`**. Algunos payloads leen millones de direcciones — `sodump`, por ejemplo, exfiltra decenas de MB de la librería. Si a mitad de camino se produce un error y el proceso crashea, no quiero empezar de cero. Por eso, **antes de cada read peligroso**, el payload guarda su progreso (en qué dirección/offset va) en `localStorage`; cuando el watchdog recarga la página, lee ese estado y **continúa exactamente desde donde se cortó**, en vez de reiniciar toda la lectura. A eso se suma un auto-save cada 15s que empuja el log al server, para no perder lo ya registrado.

¿Por qué tanto andamiaje? Porque trabajar con un read arbitrario en el proceso ajeno significa estar siempre a un puntero malo de un reset. Todo el aparato está pensado para sobrevivir eso y seguir. Esta mecánica es central en las entradas [03](/blog/samsung-tv-v8-rce-cadena-es) y [04](/blog/samsung-tv-v8-rce-elf-base-es).

## Un regalo del entorno: ASLR semi-estable

Acá conviene aclarar una duda razonable: **¿el TV tiene ASLR o no?** La respuesta es que **sí lo tiene** — entre sesiones distintas, las direcciones cambian: en un run el heap de V8 estaba en `0x35xxxxxx` y en otro posterior aparecía reubicado en `0x28xxxxxx`. La base **está** randomizada.

Lo curioso es lo otro: una observación empírica de cientos de reloads mostró que, **dentro de una misma ráfaga**, las direcciones se mantienen idénticas. El mismo puntero (`real_cl = 0x5e005000`) salía igual tiro tras tiro, incluso después de un crash y el reload del watchdog. ¿Por qué, si hay ASLR?

La explicación es simple: el ASLR randomiza las direcciones **una sola vez por proceso, al arrancarlo** — no cada vez que recargás la página. Y en Chromium las pestañas no arrancan de cero: se clonan de un proceso plantilla (el *zygote*), y esa copia **hereda el mismo mapa de memoria sin volver a randomizar**. Por eso, mientras no se reinicie el navegador, todas las recargas — e incluso los crashes — comparten exactamente las mismas direcciones. Recién cuando el navegador entero se reinicia, el ASLR vuelve a randomizar todo: eso es lo que pasa entre las "sesiones más separadas".

Esto me dio una ventaja clave: un crash que no cierra el navegador (solo tira abajo la pestaña) **no dispara una re-randomización del ASLR**. Las direcciones siguen siendo las mismas después del reload, así que puedo bypassear ASLR calculando todo **en relación al ancla**. Lo aprovechamos en [soscan](/blog/samsung-tv-v8-rce-cadena-es).

## El detalle que lo cambia todo

Antes de cerrar, vale desglosar ese string de versión, porque cada pieza vuelve más adelante:

- `T-RSLFUABC-0090-1296.8` — la versión de firmware (plataforma `RSLFUABC`, build `1296.8`). ¿Por qué importa anotarla? Porque el exploit termina con un montón de offsets hardcodeados (gadgets, slots del GOT, el offset del ancla) que salen de **un build puntual** de `libchrome.so`. Cada firmware trae un `libchrome.so` distinto, con offsets distintos: la versión exacta es lo que ata el exploit a su binario. Si tu TV tiene este firmware, los offsets valen tal cual; si tiene otro, hay que re-derivarlos.
- `E2592299` — micom/checksum de versión.
- `BT-S` — revisión del módulo de Bluetooth.

Pero si hay un solo dato para llevarse de todo el capítulo, es este: **el userland de esta TV es ARM 32-bit (ARMv7, little-endian)**. En V8 de 64 bits los punteros viven encerrados en el *pointer-compression cage*: una jaula que acota hasta dónde puede leer y escribir un bug de corrupción de memoria. **En V8 de 32 bits esa jaula no existe** — y esa única ausencia es lo que convierte una corrupción acotada en un **read/write arbitrario sobre todo el espacio de direcciones de 32 bits**, como en este caso.

Ese dato es el que sostiene todo lo que viene. En el [próximo capítulo](/blog/samsung-tv-v8-rce-primitivas-es) lo vemos en acción: cómo esa type confusion se transforma en tres primitivas de lectura y escritura — y por qué acá no hay ninguna jaula que las contenga.
