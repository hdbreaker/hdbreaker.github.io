---
title: "Samsung TV V8 RCE #3 — The golden chain to .text"
publishDate: "2026-06-18"
description: "What object reachable from JS holds a pointer that lands, for sure, inside the libchrome.so mapping? The answer is a DOM wrapper."
tags: ["samsung-tv", "tizen", "chromium", "v8", "wasm", "type-confusion", "arm32", "browser-exploitation", "rce"]
draft: false
listed: false
lang: "en"
altSlug: "samsung-tv-v8-rce-cadena-es"
series: "samsung-tv-v8-rce"
seriesOrder: 3
seriesLabel: "03 · The golden chain to .text"
---

I've got arbitrary R/W, but to find `libchrome.so` in memory I'm missing a reliable starting point. The exact question is: **what object reachable from JS holds a pointer that lands, for sure, inside the `libchrome.so` mapping?** If I have that, I have an anchor: an address I know falls *inside* the library. And from there, reaching the ELF base is just a matter of reading backwards page by page until I hit the start of the binary.

The answer turned out to be something every web page has on hand: a **DOM wrapper**.

## The golden chain

In Blink, every JS object that wraps a DOM node (`document.body`, a `<div>`, whatever) is a V8 object with **embedder fields**: raw pointers into the native C++ machinery. It has two that matter to us: at `+0x10` it stores the `ScriptWrappable` —the live C++ object for the node, which we'll hijack only at the [very end](/blog/samsung-tv-v8-rce-rop-reverse-shell)—, and at `+0x0c` it stores a pointer to the **`WrapperTypeInfo`**: a **static** struct, part of `libchrome.so` itself, that describes the type of that wrapper. To *anchor* ourselves to the `.so`, the one that works is `+0x0c`, and for a beautiful reason: being static, it lives inside the binary (fixed offset), and its body is full of pointers to code (`.text`).

```
addrOf(document.body)            -> V8 wrapper object (V8 heap)
   └─ +0x0c  embedder field      -> WrapperTypeInfo (static, INSIDE libchrome.so)
         └─ body                 -> table of pointers into .text   ✅
```

## How I found it (payload `anchor`)

The `anchor` payload does exactly one thing, and it does it without writing anything: it grabs a handful of DOM wrappers (`document.body`, `document.documentElement`, a fresh `<div>`) and reads, with `read32`, the first words of each. Since it only reads objects that are already alive, there's no way for it to crash — and that, on a TV where one bad pointer reboots the browser on you, is worth gold. For every word it dumps, it also notes which memory region that value falls into, so you can see at a glance where it points.

The pattern jumped right out. Look only at the `+0x0c` column: the three wrappers, distinct objects with no relation to each other, all stored a pointer there that starts the same, `0xb4______`:

```
                          +0x0c         <- the column that matters
document.body             0xb4cd9410    ┐
document.documentElement  0xb4cda954    ├─ all 0xb4______ : same region
new <div>                 0xb4cd9928    ┘
```

(The dump also prints other fields —the `+0x10`, which gets its moment only at the [very end](/blog/samsung-tv-v8-rce-rop-reverse-shell), and so on— but for *anchoring* they're noise: what repeats, identical across all three, is the `+0x0c`.)

Why does that `0xb4______` matter? Because that's the classic **library mmap region on ARM32 Linux** — way above the V8 heap, where the JS objects live. A pointer there doesn't point to another JS object: it points **outside**, to the image of `libchrome.so` loaded in memory. That's exactly what I was after: the `+0x0c` of any DOM wrapper is an embedder field that lands inside the library's mapping.

![Payload `anchor` running in the TV's Tizen Browser](/assets/blog/samsung-tv-rce-2-anchor.png)

*`anchor` (read-only): dumps the embedder fields of the DOM wrappers and flags the `0xb4____` candidates as `← ANCLA?` — native pointers way above the V8 heap.*

## From anchor to ELF base (payload `soscan`)

`soscan` closes the loop. It does the safe part first and saves it **before** any scan: `addrOf(document.body)` → reads the embedder `+0x0c` (the `WrapperTypeInfo`) → dereferences its body looking for pointers to native code → prints it all as evidence that the anchor lands in the `.so`. Only afterwards does it scan downward looking for `\x7fELF` + `EM_ARM`.

Before scanning anything, `soscan` reads the first words of that `WrapperTypeInfo` to see what's inside. The fact that the read works **without crashing** already says something: the struct is in mapped memory, it's real. And here's what's there:

```
[*] WrapperTypeInfo = 0xb4c1c410
    +0x00 : 0x1            <- struct tag, NOT a vtable
    +0x04 : 0xb439e439    ┐
    +0x08 : 0xb439e535    │  14 pointers 0xb439e4xx–0xb439ebxx,
    +0x20 : 0xb439e6a9    │  all odd (ARM Thumb bit)
    +0x24 : 0xb439e769    ┘  -> function TABLE in libchrome.so's .text
```

That `0xb4c1c410` is neither Oilpan memory nor V8 heap: it lands in **`libchrome.so`'s own `.data.rel.ro`** — it's a **static** struct of the binary, not a GC object. That's why it doesn't start with a vtable but with a small tag —that `0x1` at `+0x00`—, and the juicy part is in the body: a **function table**, 14 pointers all sharing the `0xb439` prefix, pointing into `libchrome.so`'s `.text`. The whole `0xaf__–0xb4__` zone is the library's mapping.

To pick the anchor, `soscan` keeps that **cluster** of pointers sharing a prefix (the function table) and takes the smallest of them all —the one closest to the ELF base—: here, `0xb439e438`. From there it goes down page by page looking for `\x7fELF`.

![Payload `soscan` scanning toward the ELF header on the TV](/assets/blog/samsung-tv-rce-3-soscan.png)

*`soscan` going down from the anchor, page by page, until it hits the library's `\x7fELF` at the base of the mapping.*

### Why the anchor is ASLR-proof

The anchor is an entry of the function table, and that table has **fixed offsets within the binary**. ASLR relocates the whole library on every boot, but its internal layout doesn't change: that entry always lands at `elf_base + 0x49a2438`. So the base resolves itself:

```
elf_base = derive_ancla() - 0x49a2438
```

It works on every run, no matter where the lib ended up mapped. And it also serves the crash-resume: instead of saving the cursor's absolute address (which ASLR would move after a crash), `soscan` saves the **offset relative to the anchor** (`delta = ancla - addr`); on resume it re-derives the anchor and applies the same `delta`.

With this the base stops being a hardcoded offset and becomes a **computable, verifiable chain**: DOM wrapper → `WrapperTypeInfo` (static) → function table (`.text`) → `.so`.

I've got the `elf_base` now and I know it's stable. The question now is how you pull an 80 MB `.so` off a TV using nothing but JavaScript. Let's see it in the [next chapter](/blog/samsung-tv-v8-rce-elf-base-dump).
