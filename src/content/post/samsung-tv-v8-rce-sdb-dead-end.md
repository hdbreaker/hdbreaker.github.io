---
title: "Samsung TV V8 RCE #2 — Why SDB was a dead end"
publishDate: "2026-06-18"
description: "Why pulling libchrome.so over SDB fails on a production Tizen TV, and the pivot to dumping the library from inside the render process with read32()."
tags: ["samsung-tv", "tizen", "chromium", "v8", "wasm", "type-confusion", "arm32", "browser-exploitation", "rce"]
draft: false
listed: false
lang: "en"
altSlug: "samsung-tv-v8-rce-sdb-es"
series: "samsung-tv-v8-rce"
seriesOrder: 2
seriesLabel: "02 · Why SDB was a dead end"
---

I've got arbitrary R/W over the browser process ([previous post](/blog/samsung-tv-v8-rce-primitives)). Sounds like we're basically done, but to build the ROP chain I'm still missing the single most important thing in the world: the offsets of `libchrome.so`. Those offsets are the exact positions, *inside* the library, of the two things the chain needs: the **gadgets** (the little chunks of code that already exist in `.text`) and the **GOT slot that points to `mprotect`**. With those offsets plus the address where the library ended up loaded in memory, I can compute the real address of every piece, and only then build the chain. And to pull them out I need the binary on my laptop, where I can run [`ROPgadget`](https://github.com/JonathanSalwan/ROPgadget) and do symbol analysis at my leisure, offline.

The obvious route, the one anybody would try first: download it over **SDB** — the *Samsung Smart Development Bridge*, Tizen's `adb`. Spoiler: it didn't work, and the why says a lot about what we're up against.

## The obvious idea (that didn't work)

I grabbed the official SDB (v4.2.36) from the Tizen Studio SDK and connected to the TV:

```
/tmp/sdb_pkg/data/tools/sdb connect 192.168.100.76   # 192.168.100.76 = TV's IP on my LAN
```

The IP was whitelisted in the TV's developer mode, so the connection came up without a fight — the device showed up nice and clean in `sdb devices`. Up to there, all an illusion.

## Where it hits a wall

Because from that point on, everything actually useful is locked down:

```
sdb shell <cmd>     -> connects but does NOT return stdout
sdb root on         -> "Permission denied"
sdb pull /usr/...   -> "You cannot pull files from this path"
```

The cause is **SMACK** (*Simplified Mandatory Access Control*), the LSM Tizen uses on production firmware. The SDB daemon runs with a SMACK label that **has no access** to the system paths where `libchrome.so` lives, and without `root` (denied) there's no way to re-label or read those paths. Watch the detail here, because it's the key: **this is not a matter of classic UNIX permissions**. Even if you were root-equivalent, the SMACK policy cuts you off all the same.

> On a **development** device (or one with *engineering* firmware) SDB would hand you shell and pull without blinking. On a **production** TV, extracting the binary over SDB is a **dead end**.

## The strategic consequence

And here's the point that defines the rest of the research. Without the binary on disk I can't port the ROP chain via static analysis. The front door is locked. But I'm already inside:

> If I can't pull the `.so` from the *outside*, I'm going to **read it from the inside**: locate `libchrome.so` in the render process's own memory and **dump it with `read32()`**.

That turns the problem into a purely *in-process* one, and reorders the whole series into a concrete to-do list:

1. Find the **ELF base** of `libchrome.so` in memory.
2. Read its *program headers* to learn the size and segments.
3. Dump `[elf_base, elf_base + image_size)` in chunks to `server.py`.
4. Run the offline analysis on that dump.

Step 1 — finding the ELF base — turned out to be **the real hard problem** of the entire writeup, and it's where [chapter 03](/blog/samsung-tv-v8-rce-golden-chain) kicks off: how to get, from JavaScript, a pointer that lands for sure inside the `libchrome.so` mapping.
