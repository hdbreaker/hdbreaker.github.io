---
title: "Samsung TV V8 RCE #1 — Three primitives, no cage"
publishDate: "2026-06-18"
description: "A WasmGC type confusion turned into addrOf, read32 and write32 — full 32-bit process R/W with no V8 cage to escape."
tags: ["samsung-tv", "tizen", "chromium", "v8", "wasm", "type-confusion", "arm32", "browser-exploitation", "rce"]
draft: false
listed: false
lang: "en"
altSlug: "samsung-tv-v8-rce-primitivas-es"
series: "samsung-tv-v8-rce"
seriesOrder: 1
seriesLabel: "01 · Three primitives (no cage)"
---

The WasmGC bug confuses the types of a struct's fields. It sounds academic until you turn it into tools. I built three tiny, custom-made Wasm modules: each one uses that same type confusion but aimed at a different goal. I name them after the type they confuse:

- **`e_*`** (for `externref`) — stores a JS object in a field and lets me read it back as if it were a number. That number *is* the object's address in memory.
- **`i_*`** (for `i32`) — the loader: I hand it the number I want to use as an address.
- **`ip_*`** (for *i32 as pointer*) — takes that address and treats it as a pointer, to read or write the 32 bits that live there.

Combining them yields exactly the three primitives that hold up the rest of the exploitation:

- **`addrOf(obj)`** — the address of a JS object. (`e_*`: I put the object in and read it back as an integer.)
- **`read32(addr)`** — reads 32 bits at any address. (`i_*` loads the address, `ip_*` reads it.)
- **`write32(addr, val)`** — writes 32 bits at any address. (same as `read32`, but `ip_*` writes.)

```js
function addrOf(obj)     { e_set(E, obj); return i2u(i_get0(E)); }
function read32(addr)    { i_set0(I, u2i(((addr >>> 0) - 7) >>> 0)); return i2u(ip_read(I)); }
function write32(addr,v) { i_set0(I, u2i(((addr >>> 0) - 7) >>> 0)); ip_write(I, u2i(v)); }
```

The `-7` compensates for the header of the internal `ip_*` struct (a `ref` to `oneRef` whose `i32` field falls at `addr`), so that the final `StructGet` reads exactly the address I asked for.

## Why this is *arbitrary*, not "caged"

In the original Windows x64 PoC these two functions were called `caged_read` / `caged_write` — *caged* — because over there the read/write stayed trapped **inside** V8's cage. Here I renamed them to `read32` / `write32` on purpose: **on this TV there's no cage**, and that difference is what makes everything else viable.

In **64-bit** V8 the pointer-compression cage exists: pointers are 32-bit offsets relative to a 4 GB base, so a read by confusion only reaches memory *inside* that region. To get out you need to break the cage separately, as one more step of the exploit.

In **32-bit** V8 there's no compression. Each pointer is already a full 32-bit native address. The `i32 ↔ ref` confusion hands you that **raw** address, untranslated. Therefore `read32` and `write32` have no ceiling: I pass them **any** address in the process — a number between 0 and 4 GB — and I read or write the 32 bits that live there.

It's a **read/write of the process's entire address space**, for free. Without having to escape V8's cage, without breaking anything extra. Leaking pointers, walking C++ structures, searching for the ELF in memory, dumping the whole binary.

## The first payload: `diagnostic.js`

`diagnostic.js` is the first payload in the chain and has a single job: **to prove that the bug fires in this browser and that the three primitives really work**, before building anything on top.

Under the hood it does three things. First it **fills Wasm's canonical type table** — over a million slots — to force the index collision that *is* the bug. Then it **builds the `e_*` / `i_*` / `ip_*` modules** and derives `addrOf` / `read32` / `write32`. And finally it **puts them to the test against a real object**: it grabs any `ArrayBuffer` and uses it as a guinea pig.

```
ab (ArrayBuffer)    →  addrOf = 0x50709be1   ← its address in V8's heap
read32(0x50709be1)  →  0x75391a5c            ← the first thing inside it (its "map")
read32(ab + 0x18)   →  0x902a0400            ← where it stores its data bytes
```

Two reads, two different proofs:

- **`read32(0x50709be1) = 0x75391a5c`** reads the **first word of the object** — and in V8 that's never just any data: the first word of *every* heap object is a pointer to its *map* (the "hidden class", the descriptor that says what type the object is). Maps live grouped in their own region of the heap, so seeing a value in the `0x753…` range — where the maps fall in this process — confirms two things at once: that the read landed on the correct object and that it read its first word correctly.
- **`read32(ab + 0x18) = 0x902a0400`** reads another field of the `ArrayBuffer`: the pointer to its *backing store*, the block where it keeps its data bytes. And here's the proof I was looking for: that block **doesn't live in V8's heap**. `ArrayBuffer`s reserve their memory separately, outside the garbage collector's heap, with the embedder's allocator (its own `mmap`/`malloc`) — that's why `0x902…` falls in a distant, completely separate region. Being able to read there proves the only thing that matters: the read's reach **isn't bounded to anything**.

> The exact addresses (`0x753…`, `0x902…`) are from *this* process — ASLR shifts them on each boot —; what matters is that they belong to **different regions**, and that the first word is a valid map. If you want to go to the source for why it's like this: the map is always at offset 0 of the object ([`v8/src/objects/map.h`](https://source.chromium.org/chromium/chromium/src/+/main:v8/src/objects/map.h)) and the backing store is reserved outside the heap ([`v8/src/objects/backing-store.h`](https://source.chromium.org/chromium/chromium/src/+/main:v8/src/objects/backing-store.h)).

![Payload `diagnostic` running in the TV's Tizen Browser](/assets/blog/samsung-tv-rce-1-diagnostic.png)

*`diagnostic.js` running in the TV's browser: the three primitives (`addrOf` and the arbitrary 32-bit read/write) give correct results against a real `ArrayBuffer`, and the log closes by detecting the process's architecture: `ARM v7 32-bit` — the detail that confirms we're in a V8 without a cage.*

## A faster primitive for dumping memory

`read32()` reads 32 bits at a time and, for dumping large regions, it's slow: each word is several Wasm calls. But looking at how V8 stores an `ArrayBuffer` in memory I realized I could fabricate a much more suitable primitive for this task, taking advantage of a detail: the `ArrayBuffer` itself carries, in fields I can edit, **how many bytes it measures** and **where its data is**. This is used later in [entry 04](/blog/samsung-tv-v8-rce-elf-base-dump) to exfiltrate the `libchrome.so` library efficiently.

The idea is to use `write32()` — which already writes anywhere — to overwrite those fields on an `ArrayBuffer`: I make it believe it measures 64 MB and that its bytes live at whatever address I want. From that moment on I read it with a native `DataView`, at C speed, without one Wasm call per word:

```js
const ab_addr = addrOf(ab);
write32(ab_addr + 0x16, 0x200000 << 5);  // byteLength    → 64 MB
write32(ab_addr + 0x1e, 0x200000 << 5);  // maxByteLength → 64 MB
write32(ab_addr + 0x26, 0);              // backing store offset → 0
const dv = new DataView(ab);             // dv reads "real" memory at full speed
```

## Summary

With this we already have on the table what we need for everything that's coming, validated on the television itself: the three base primitives (`addrOf`, `read32`, `write32`) plus the bulk-read shortcut via `DataView`.

| Primitive | What it does | Reach |
|-----------|----------|---------|
| `addrOf(obj)` | gives you the memory address of a JS object | — |
| `read32(addr)` | reads 32 bits at `addr` | **any** address in the process (the 4 GB) |
| `write32(addr, v)` | writes 32 bits at `addr` | **any** address in the process |
| redirected `ArrayBuffer` | bulk read via native `DataView` (fast) | re-point it **before** creating the `DataView` |

At this point the problem changes nature. It stops being one of *capability* and becomes one of *information*. I have full R/W over the process. To build the ROP chain I need the offsets of `libchrome.so` — and getting that binary, on a TV that won't let me pull it out, is the rest of the series. It starts with a dead end: [entry 02](/blog/samsung-tv-v8-rce-sdb-dead-end).
