---
title: "RCE en V8 de una Samsung TV #2 — Por qué SDB fue un callejón"
publishDate: "2026-06-18"
description: "Por qué bajar libchrome.so por SDB falla en una TV Tizen de producción, y el giro a dumpear la librería desde adentro del render process con read32()."
tags: ["samsung-tv", "tizen", "chromium", "v8", "wasm", "type-confusion", "arm32", "browser-exploitation", "rce"]
draft: false
listed: false
lang: "es"
altSlug: "samsung-tv-v8-rce-sdb-dead-end"
series: "samsung-tv-v8-rce"
seriesOrder: 2
seriesLabel: "02 · El callejón de SDB"
---

Tengo R/W arbitrario sobre el proceso del navegador ([post anterior](/blog/samsung-tv-v8-rce-primitivas-es)). Suena a que ya está, pero para armar la cadena ROP me falta lo más importante del mundo: los offsets de `libchrome.so`. Esos offsets son las posiciones exactas, *dentro* de la librería, de las dos cosas que la cadena necesita: los **gadgets** (los pedacitos de código que ya existen en el `.text`) y el **slot del GOT que apunta a `mprotect`**. Con esos offsets más la dirección donde la librería quedó cargada en memoria puedo calcular la dirección real de cada pieza y recién ahí construir la cadena. Y para sacarlos necesito el binario en mi laptop, donde puedo correr [`ROPgadget`](https://github.com/JonathanSalwan/ROPgadget) y análisis de símbolos tranquilo, offline.

El camino obvio, el que cualquiera intentaría primero: bajarlo por **SDB** — el *Samsung Smart Development Bridge*, el `adb` de Tizen. Spoiler: no se pudo, y el porqué dice mucho de contra qué estamos jugando.

## La idea obvia (que no funcionó)

Bajé el SDB oficial (v4.2.36) del SDK de Tizen Studio y conecté contra la TV:

```
/tmp/sdb_pkg/data/tools/sdb connect 192.168.100.76   # 192.168.100.76 = IP de la TV en mi LAN
```

La IP estaba whitelisteada en el modo desarrollador de la TV, así que la conexión se estableció sin drama — el device aparecía prolijo en `sdb devices`. Hasta ahí, todo ilusión.

## Dónde se choca

Porque a partir de ese punto, todo lo realmente útil está bloqueado:

```
sdb shell <cmd>     -> conecta pero NO devuelve stdout
sdb root on         -> "Permission denied"
sdb pull /usr/...   -> "You cannot pull files from this path"
```

La causa es **SMACK** (*Simplified Mandatory Access Control*), el LSM que Tizen usa en firmware de producción. El daemon de SDB corre con una etiqueta SMACK que **no tiene acceso** a las rutas del sistema donde vive `libchrome.so`, y sin `root` (denegado) no hay forma de re-etiquetar ni de leer esos paths. Ojo con el detalle, porque es la clave: **no es un tema de permisos UNIX clásicos**. Aunque fueras root-equivalente, la política SMACK te corta igual.

> En un device de **desarrollo** (o con firmware *engineering*) SDB te daría shell y pull sin chistar. En una TV de **producción**, extraer el binario por SDB es un **callejón sin salida**.

## La consecuencia estratégica

Y acá está el punto que define todo el resto de la investigación. Sin el binario en disco no puedo portar la cadena ROP por análisis estático. La puerta de afuera está cerrada con llave. Pero yo ya estoy adentro:

> Si no puedo sacar el `.so` desde *afuera*, lo voy a **leer desde adentro**: localizar `libchrome.so` en la memoria del propio render process y **dumpearlo con `read32()`**.

Eso convierte el problema en uno puramente *in-process*, y reordena toda la serie en una lista de tareas concretas:

1. Encontrar el **ELF base** de `libchrome.so` en memoria.
2. Leer sus *program headers* para conocer tamaño y segmentos.
3. Volcar `[elf_base, elf_base + image_size)` por chunks al `server.py`.
4. Correr el análisis offline sobre ese dump.

El paso 1 — encontrar el ELF base — resultó ser **el verdadero problema difícil** de todo el writeup, y es donde arranca la [entrada 03](/blog/samsung-tv-v8-rce-cadena-es): cómo conseguir, desde JavaScript, un puntero que caiga sí o sí adentro del mapeo de `libchrome.so`.
