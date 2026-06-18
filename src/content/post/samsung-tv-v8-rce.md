---
title: "Pwning Samsung TV Browser - Chrome V8 WASM Type Confusion bug"
publishDate: "2026-06-18"
description: "From a single web page to a reverse shell on a Samsung QLED (Tizen 9, Chromium 120, ARM32) — exploiting a V8 WebAssembly-GC type confusion."
tags: ["samsung-tv", "tizen", "chromium", "v8", "wasm", "type-confusion", "arm32", "browser-exploitation", "rce"]
draft: false
listed: true
lang: "en"
altSlug: "samsung-tv-v8-rce-es"
series: "samsung-tv-v8-rce"
seriesOrder: 0
seriesLabel: "00 · The story and the idea"
---

> 📦 All the code, blog and exploit for this research can be found on my GitHub: [hdbreaker/samsung-smarttv-tizen-9-chromium-120-v8-rce](https://github.com/hdbreaker/samsung-smarttv-tizen-9-chromium-120-v8-rce)

It's been a while since I found the space to write. Life has thrown a few changes my way lately — personal, work-related, a new city. Only now, with everything more settled and on track, did I make the time to spend a few weekends on something new that sparked my curiosity.

About a year ago I moved to a new city and, amid all the rearranging, I bought myself a new television. I've always loved living rooms: that place where you watch a movie, gather family and friends, give the home a bit of warmth. For me a good living room absolutely needs a great TV — so I ended up buying the **Samsung 65" QLED 2025**: model **QN65Q7FAAGXZS**, software **T-RSLFUABC-0090-1296.8**.

What I hadn't planned was to end up staring at *the television itself*. Most of the time it plays movies and, every now and then, it turns into the most interesting computer in the house. One night I started wondering just how powerful it really was, and I ran into something uncomfortable: I couldn't manage it. ADB didn't work. It required a special software development kit, a developer mode setup, a whole permissions ceremony to do anything at all. And I said: no. I want to be able to access this TV without restrictions — and I'm going to do it my way.

That's how the question that guided the whole project was born:

**Can I hack this TV? What's its attack surface?**

I started poking around the TV and right away the most interesting thing it had to offer showed up: a web browser installed by default, capable of connecting to the outside world. Since I already have some prior experience finding and exploiting bugs in browsers, I figured it might be worth analyzing as a potential attack surface. And there was a bonus: browser fingerprinting is part of my day job in bot detection, so I felt I had good tools for understanding what browser I was standing in front of.

So the first thing I did was what I've gotten best at lately: **fingerprint the browser**. What it returned was revealing: an **old** version of Chrome, with the whole machine running — JavaScript, WebRTC, WebAssembly, the full surface of a desktop browser crammed inside a television.

That led me to the right question. If it runs an engine that's several years old, isn't there some public vulnerability that still applies? It wouldn't be the first time an old browser is the way into a closed device: the precedent that came to mind was **Nintendo**, whose console ended up being opened through an old WebKit CVE in the built-in browser ([Switch jailbreak via WebKit](https://techcrunch.com/2017/03/13/hackers-release-proof-of-concept-nintendo-switch-jailbreak/)) — the browser as a crack into the rest of the system. If that concept worked there, could it work here?

With the target chosen, I began my search. The whole plan ended up reduced to a single web page served from my own PC: this series is the logbook of going from *that web page* to a very real shell on the television, abusing only the browser's V8 JavaScript engine.

> All of this was done on my **own** television, on my **own** network, for research purposes. Throughout the writeup the only machine that does anything is my PC — the **researcher machine** at `192.168.100.80`. The TV is `192.168.100.76`. No third parties involved.

## The target

Before thinking about breaking anything, it's worth taking a good look at what we're getting into. The TV introduces itself like this:

```
Model        : Samsung 65" QLED  QN65Q7FAAGXZS
Software     : T-RSLFUABC-0090-1296.8, E2592299, BT-S
Browser UA   : Mozilla/5.0 (SMART-TV; Linux; Tizen 9.0) AppleWebKit/537.36
               SamsungBrowser/8.0 Chrome/120.0.6099.5 TV Safari/537.36
```

That's everything the TV itself tells you up front: the browser is **SamsungBrowser 8.0**, **compiled by Samsung** and embedded in **Tizen 9.0** (the TV's operating system). Under the hood it's **based on Chromium 120**, with the **V8** engine, from the stable branch of late **2023**. The fine-grained breakdown of that version string — and the one architecture detail that ends up deciding the entire exploit — I'm saving for the close of the chapter.

> This research was carried out with **Claude Code Opus 4.8** as an augmentative copilot. The direction, the hypotheses and the decisions were made by a human; the AI undoubtedly sped up the process, although it wasn't able to bring it to a full end-to-end conclusion — both because it deemed certain parts risky or unsafe, and because of development errors that, without proper guidance, wouldn't have been correctly resolved or that fell into continuous rabbit holes while trying to validate specific invalid execution flows.

## The starting bug

We started the research the way you almost always do: looking for prior work. What had others investigated about similar — or even newer — versions of this browser, of Chrome, or of anything based on Chromium?

Browsing the internet I found a repository: [`PumpkinBridge/Chrome-CVE-2024-2887-RCE-POC`](https://github.com/PumpkinBridge/Chrome-CVE-2024-2887-RCE-POC). It talked about a Chrome bug — **CVE-2024-2887** — fixed in 123.0.6312.86 and presented at **TyphoonPWN 2024 (Vancouver)** by **Seunghyun Lee ([@0x10n](https://x.com/0x10n))**. That repo, together with the [SSD advisory](https://ssd-disclosure.com/ssd-advisory-google-chrome-rce/), was all the information I found about the bug.

What is it? A **WebAssembly GC type confusion**. To decide whether two Wasm types are equivalent, V8 assigns each one a *canonical type index* — an internal identifier it shares with any structurally identical type. The bug lives in that canonicalization: by reserving close to a million recursive (isorecursive) types, the index overflows and **two structurally distinct types end up receiving the same canonical id**. From there the engine considers them interchangeable and operates on an object with the layout of the other — classic type confusion. That layout mismatch is the crack: chained correctly, it gives you the primitives to read and write memory at will. And the detail that makes it relevant for me: the fix landed in 123.0.6312.86, but **this TV runs 120** — squarely in the vulnerable range.

Seunghyun's PoC targets specifically **Chrome 125 x64 on Windows**, with **all the offsets hardcoded** — gadgets, vtables, etc — pulled from a static analysis of `chrome.dll`. In other words: the bug might work, but the exploit didn't. Not even close.

## Why the port is the real challenge

Porting that PoC to the TV **is not a tweak**: it's **redoing close to 80% of the exploit**. The starting hypothesis was that the bug would be the **only piece that could survive intact** — though that still had to be proven. Does the type confusion actually fire inside the TV's real browser? Was the bug Windows-specific, or did it share a root cause with other builds? Did it apply to Linux too? To other architectures, like ARM? None of that was a given: it was exactly the first thing to answer. And everything around the bug, by contrast, changes platform, architecture and threat model all at once.

The fastest way to see the size of the leap is to put the protections of both worlds side by side:

| Dimension | Original PoC (Chrome 125) | TV (SamsungBrowser / Chromium 120) |
|-----------|---------------------------|-------------------------------------|
| **OS / architecture** | Windows, x64 | Tizen 9.0 (Linux), **ARM32** (ARMv7 LE) |
| **Pointer-compression cage** | Present — bounds the bug's reach | **Absent** in 32-bit V8 → R/W of the **entire** address space |
| **Mitigations** | DEP, ASLR, CFG, V8 cage | Full RELRO, BIND_NOW, stack NX, **strict W^X** |
| **Final stage (getting RWX)** | `VirtualAlloc` / `VirtualProtect` | **ROP to `mprotect`** |
| **Calling convention (`this`)** | in `rcx` (Win64 ABI) | in **`r0`** (ARM ABI) |
| **Reference binary** | `chrome.dll`, public and with symbols | `libchrome.so` (Tizen 9.0, compiled by Samsung) — **nonexistent publicly** |
| **Device access** | debugger, offline diffing | **no ADB, no debugger** (SDB blocked by SMACK) |
| **Offsets** | hardcoded from `chrome.dll` analysis | must be **derived from your own dump** of the live process |

Each row is a piece of the exploit that has to be redone. Three of them are the heart of the challenge:

- **A different mitigation landscape.** Every assumption about what's writable, what's executable and where the pointers live has to be re-derived from scratch — and with it the final stage changes: ROP to `mprotect` instead of to `VirtualAlloc`.
- **A different architecture.** No compression cage (which turns a bounded corruption into arbitrary R/W of the *entire* 32-bit space), plus a different calling convention (`this` in `r0`), a different gadget set, and a different vtable/ABI shape to hijack.
- **A closed, proprietary target.** The final stage is ROP, and to build it I need two things that live **inside `libchrome.so`**: the **gadgets** (sequences of code from `.text` that I chain to execute the chain) and the address of `mprotect` (to make my buffer executable). Without the binary I have neither gadgets nor offsets — and **there is no public `libchrome.so` for this firmware anywhere**. So before I can hardcode a single offset I have to **exfiltrate the library from the live process, byte by byte**, through the arbitrary read, and **reconstruct Samsung's and Tizen's proprietary binaries from scratch, off the TV**.

That's the backbone of this series: the memory exfiltration, the library reconstruction, and the mitigation-by-mitigation re-derivation against a black-box device. The bug was the easy part.

## The lab

Nothing exotic. The TV browses to a page I serve myself.

```
┌────────────┐     HTTP :80      ┌──────────────────────┐
│  Samsung   │  ◄────────────►   │  researcher PC       │
│  TV browser│                   │  server.py           │
│  .76       │   POST /save ──►  │  index.html          │
└────────────┘                   │  payloads/*.js       │
                                 └──────────────────────┘
```

It's two files. `server.py` serves `index.html` and the `.js` payloads — and here it's worth underlining something: since this is a **V8** vuln, **the entire validation and exploitation method is JavaScript**. There's no binary to compile and no agent to install on the TV; every stage of the kill chain is a `.js` payload that runs inside the browser. On top of that, my server exposes the `POST /save` endpoint to store the JavaScript's results and keep consistent logs that let me trace what happens on each browser run (a new `tv_output_YYYYMMDD_HHMMSS.txt` for each JS run). `index.html` is the *start point*, where everything comes together, and it does three things that turn out to be essential:

- A **dropdown** that presents the series of scripts that make up the kill chain, in the order the research executes them:
  1. **`payloads/diagnostic.js`** — fires the type confusion and builds the base primitives (`addrOf`, `read32`, `write32`). *The question it answers:* does the bug actually fire in SamsungBrowser/V8 120 and give me arbitrary read/write?
  2. **`payloads/anchor.js`** — the whole browser lives inside a single library, `libchrome.so`: V8 (the engine where the bug lives), Blink, and the `.text` with the gadgets we need to build the ROP chain. Starting from a JS object (a DOM wrapper), the payload finds the **embedder field** (`+0x0c`) that points **inside** the mapping of `libchrome.so`: the first evidence of a pointer that falls within the library. It doesn't compute the base yet — it just confirms that this anchor pointer exists and marks which region it falls in. *The question it answers:* is there, from JavaScript, a pointer that falls inside `libchrome.so`?
  3. **`payloads/soscan.js`** — closes the circle: it takes that embedder field, reads inside it the **function table** that points to `.text`, and from there pulls out the real **anchor** (an address inside the library's code); only then does it compute the `elf_base`, the address where the system loaded `libchrome.so`, i.e. the start of the binary. ASLR randomizes that address on every boot, so you can't hardcode it; but the distance between the anchor and that base **is** constant, so `soscan` does `elf_base = anchor − fixed_offset`. That makes it "ASLR-proof": the derivation survives randomization. *The question it answers:* from what base address can I compute the location of any gadget or function inside the library (which I later need for the ROP)?
  4. **`payloads/sodump.js`** — dumps the library's `PT_LOAD` segments byte by byte via `POST /dump`, to reconstruct `libchrome.so` off the TV and from there pull the ROP gadgets and offsets. *The question it answers:* can I exfiltrate the entire binary to analyze it on my PC?
  5. **`payloads/vtable.js`** — a validation rehearsal of the final attack, in **read-only** mode. Before writing anything to memory, it checks that all the pieces needed to take control of execution are in place and at the correct address: the browser object I'm going to hijack, the library base, the address of `mprotect`, and the gadget that diverts execution into my chain. Since it modifies nothing, it doesn't risk a crash — it just confirms that the trigger is going to work. *The question it answers:* are all the pieces of the attack aligned, before pulling the trigger?
  6. **`payloads/pwn.js`** — exploitation phase: plants the fake vtable + the ROP chain and fires. *The question it answers:* do I get a reverse shell from the TV?
- A **crash watchdog**. Working with an arbitrary read means that, sooner or later, I'm going to read an invalid address (unmapped memory). When that happens, the system kills the browser process with a **native SIGSEGV** — a C++-level crash, not a JavaScript exception, so **no `try/catch` can catch it**: the page simply dies. The only signal that something went wrong is exactly that: that it restarted. To recover the process if it crashes, `index.html` carries a `<meta http-equiv="refresh">` that **reloads the page every 90 seconds**; if a payload crashes, at most 90s later the page comes back on its own and picks up where it left off (hand in hand with the resume state in `localStorage`, below).
- **Resume state in `localStorage`**. Some payloads read millions of addresses — `sodump`, for example, exfiltrates tens of MB of the library. If halfway through an error occurs and the process crashes, I don't want to start from zero. That's why, **before every dangerous read**, the payload saves its progress (which address/offset it's at) in `localStorage`; when the watchdog reloads the page, it reads that state and **continues exactly where it was cut off**, instead of restarting the whole read. On top of that there's an auto-save every 15s that pushes the log to the server, so nothing already recorded is lost.

Why so much scaffolding? Because working with an arbitrary read inside someone else's process means always being one bad pointer away from a reset. The whole apparatus is designed to survive that and keep going. This mechanic is central to entries [03](/blog/samsung-tv-v8-rce-golden-chain) and [04](/blog/samsung-tv-v8-rce-elf-base-dump).

## A gift from the environment: semi-stable ASLR

Here it's worth clearing up a reasonable doubt: **does the TV have ASLR or not?** The answer is that it **does** — between different sessions, the addresses change: in one run V8's heap was at `0x35xxxxxx` and in a later one it showed up relocated at `0x28xxxxxx`. The base **is** randomized.

The curious thing is the rest: an empirical observation across hundreds of reloads showed that, **within the same burst**, the addresses stay identical. The same pointer (`real_cl = 0x5e005000`) came out the same shot after shot, even after a crash and the watchdog's reload. Why, if there's ASLR?

The explanation is simple: ASLR randomizes the addresses **only once per process, at startup** — not every time you reload the page. And in Chromium tabs don't start from scratch: they're cloned from a template process (the *zygote*), and that copy **inherits the same memory map without re-randomizing**. That's why, as long as the browser doesn't restart, all the reloads — and even the crashes — share exactly the same addresses. Only when the whole browser restarts does ASLR re-randomize everything: that's what happens between the "more separated sessions."

This gave me a key advantage: a crash that doesn't close the browser (only tears down the tab) **doesn't trigger an ASLR re-randomization**. The addresses stay the same after the reload, so I can bypass ASLR by computing everything **relative to the anchor**. We take advantage of this in [soscan](/blog/samsung-tv-v8-rce-golden-chain).

## The detail that changes everything

Before closing, it's worth breaking down that version string, because every piece comes back later:

- `T-RSLFUABC-0090-1296.8` — the firmware version (platform `RSLFUABC`, build `1296.8`). Why does it matter to write it down? Because the exploit ends up with a pile of hardcoded offsets (gadgets, GOT slots, the anchor offset) that come from **one specific build** of `libchrome.so`. Each firmware ships a different `libchrome.so`, with different offsets: the exact version is what ties the exploit to its binary. If your TV has this firmware, the offsets hold as-is; if it has another, they have to be re-derived.
- `E2592299` — micom/version checksum.
- `BT-S` — Bluetooth module revision.

But if there's a single takeaway from the whole chapter, it's this: **this TV's userland is ARM 32-bit (ARMv7, little-endian)**. In 64-bit V8 the pointers live locked inside the *pointer-compression cage*: a cage that bounds how far a memory-corruption bug can read and write. **In 32-bit V8 that cage doesn't exist** — and that single absence is what turns a bounded corruption into an **arbitrary read/write over the entire 32-bit address space**, as in this case.

That detail is what holds up everything that follows. In the [next chapter](/blog/samsung-tv-v8-rce-primitives) we see it in action: how that type confusion transforms into three read and write primitives — and why there's no cage here to contain them.
