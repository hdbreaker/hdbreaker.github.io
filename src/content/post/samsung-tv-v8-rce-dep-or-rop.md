---
title: "Samsung TV V8 RCE #5 — DEP or shellcode? Verdict: ROP"
publishDate: "2026-06-18"
description: "Before building the execution stage, one question decides the whole strategy: does the browser process have any RWX region?"
tags: ["samsung-tv", "tizen", "chromium", "v8", "wasm", "type-confusion", "arm32", "browser-exploitation", "rce"]
draft: false
listed: false
lang: "en"
altSlug: "samsung-tv-v8-rce-dep-es"
series: "samsung-tv-v8-rce"
seriesOrder: 5
seriesLabel: "05 · DEP or shellcode? Verdict: ROP"
---

I've already got arbitrary R/W ([01](/blog/samsung-tv-v8-rce-primitives)), an ASLR-proof `elf_base` ([04](/blog/samsung-tv-v8-rce-elf-base-dump)), and 395k gadgets. Before I start building the execution stage, there's one question that decides the *whole* strategy, and it's worth answering it for sure instead of in a rush:

> Does the browser process have any **RWX** region (writable *and* executable)?

If the answer is **yes**, the path is the simplest in the world: you write ARM32 shellcode into that region and you jump. Zero ROP. If it's **no** (W^X / DEP in force), then it's **ROP**: chain gadgets to call `mprotect(page, len, RWX)`, turn a controlled buffer executable, and only then jump to the shellcode.

Spoiler: for Chromium 120 the answer is **there's no RWX**. And the nice part is I can claim that without even risking a crash on the TV — the binary and V8's history tell me so.

## Level 1 — what the binary already says (static, zero risk)

The dump of `libchromium-impl.so` ([04](/blog/samsung-tv-v8-rce-elf-base-dump)) carries the program headers and the `.dynamic` flags. That alone pins down the prior with certainty:

| Signal | Value | Implies |
|-------|-------|---------|
| `PT_GNU_STACK` | `RW-` (no X bit) | **Stack NOT executable** (NX requested by the toolchain) |
| `PT_GNU_RELRO` | present, `R--` | Full RELRO: the GOT becomes read-only after load |
| `DT_FLAGS` | `0x8` = `DF_BIND_NOW` | BIND_NOW: there's no lazy-binding to abuse |
| `DT_FLAGS_1` | `0x1` = `DF_1_NOW` | reinforces full RELRO |
| Segments | `R--` / `R-X` / `RW-` separated | strict **W^X** in the library (nothing RWX in the `.so`) |

The partial conclusion is safe: the binary was compiled for an environment with DEP/NX. The classic "return to the stack and execute shellcode there" is ruled out — the stack is `RW-`. The library doesn't have a single RWX byte. But that's the *library's toolchain*; it proves nothing about V8's **JIT code-space** in the live process. That was the one chance we had to skip ROP. And to close it I don't need to touch the TV at all.

## Level 2 — V8's version cutoff: code-space R-X, not RWX

For years V8 kept its code-space (where the JIT code of Liftoff/TurboFan/wasm lives) in **RWX**: it was faster to patch code without an `mprotect` for every emission. That was exactly the crack that an infoleak + arbitrary-write turned into "write shellcode into the code-space and jump," no ROP.

That model **was removed**. Starting with V8's code-memory write-protection work (the old `--write-protect-code-memory`, then the migration to a **permanently `R-X`** code-space with a separate `RW-` alias for writing, and where supported, *thread-isolation* via PKU/MPK), the code-space stopped being RWX in production. The code pages stay **`R-X` at rest** and only flip to `RW-` transiently during code generation — there's no permanent RWX window that can be raced reliably.

ARM32 doesn't have PKU, so the build uses the `mprotect`-based toggle (RW↔RX), but the **resting state is the same: `R-X`**. Any write of mine to a JIT code page lands on a read-only-execute page → SIGSEGV. And **Chromium 120.0.6099.5** is *way* past that cutoff, so measuring at runtime wouldn't add any information: the result is already determined. Straight to ROP.

## The decision tree (resolved)

```
   RWX in the live process?
        │
   ┌────┴─────────────────────────────┐
   │ static .so: strict W^X, NX        │
   │ V8 ≥ W^X cutoff: code-space R-X    │
   └────┬─────────────────────────────┘
        │
     RWX = NO  (determined, without measuring on the TV)
        │
   ROP: leak mprotect (GOT) → mprotect(buf, RWX) → jump → shellcode
        │
   ARM32 backconnect  → /bin/sh against 192.168.100.80  (validation / report)
```

The chosen path is the classic ARM32 chain, and it does **not** depend on the stack being executable: leak `mprotect` from the GOT (already populated by `BIND_NOW`), pivot + ROP chain that builds `mprotect(page, len, RWX)` over a controlled buffer, and jump to the now-executable buffer with the shellcode. The fine detail of *how* I get the CPU to start executing my gadgets — the hijack — and the full exploitation chain go in [entry 06](/blog/samsung-tv-v8-rce-rop-reverse-shell), the finale.
