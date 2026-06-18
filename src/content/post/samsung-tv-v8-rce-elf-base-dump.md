---
title: "Samsung TV V8 RCE #4 — ELF base & dumping the .so"
publishDate: "2026-06-18"
description: "With the golden chain, soscan found the library base on the TV and recovered the constant anchor offset that survives any reboot."
tags: ["samsung-tv", "tizen", "chromium", "v8", "wasm", "type-confusion", "arm32", "browser-exploitation", "rce"]
draft: false
listed: false
lang: "en"
altSlug: "samsung-tv-v8-rce-elf-base-es"
series: "samsung-tv-v8-rce"
seriesOrder: 4
seriesLabel: "04 · ELF base & dumping the .so"
---

With the golden chain from the [previous chapter](/blog/samsung-tv-v8-rce-golden-chain), `soscan` ran against the TV and found the library's base. This is the real output of the run (raw evidence: [`soscan_v3_ELFBASE_FOUND_190515.txt`](https://github.com/hdbreaker/samsung-smarttv-tizen-9-chromium-120-v8-rce/blob/main/blog/assets/soscan_v3_ELFBASE_FOUND_190515.txt)):

```
[+] ===== libchrome.so FOUND =====
    elf_base    = 0xaf9fc000
    anchor      = 0xb439e438  (off +0x4 of the C++ object)
    anchor_ofs  = 0x49a2438   (= anchor - elf_base, constant)
    => in the exploit: elf_base = anchor() - 0x49a2438
    e_type=0x3 e_machine=0x28 e_entry=0x0
    e_phoff=0x34 e_phentsize=32 e_phnum=12
```

`e_machine=0x28` (EM_ARM) and `e_type=0x3` (ET_DYN, shared object) confirm it's the right ELF. The prize is **`anchor_ofs = 0x49a2438`**: the constant distance between the anchor and the base, which survives any reboot.

> Cross-check: `0x49a2438` falls inside the R-X segment (`vaddr 0x1184880 .. 0x5020830`). The anchor **is** a pointer to real `.text`, not a string. The density heuristic was right.

## The `libchrome.so` map (program headers)

With `elf_base` and the program headers, the library's map looks like this:

```
LOAD off=0x000000  vaddr=0x00000000 filesz=0x117487c R--   (ELF hdr, .dynsym/.dynstr, .rodata)
LOAD off=0x1174880 vaddr=0x01184880 filesz=0x3e9bfb0 R-X   (.text -> 62 MB of gadgets)
LOAD off=0x5010840 vaddr=0x05030840 filesz=0x23f308  RW-   (.data)
LOAD off=0x524fb48 vaddr=0x0527fb48 filesz=0x3d8c4   RW-   (.data/.bss)
image span: 0x0 .. 0x57fdf9d  (~88 MB)
```

The key to understanding the dump is that an ELF has **two addresses for the same thing**: where a segment ends up *in memory* (`p_vaddr`) and what part of the *file* on disk it lives in (`p_offset`). They don't match. So dumping is translating from one to the other: byte `i` of a segment I **read** from memory at `elf_base + p_vaddr + i`, and I **write** it to the reconstructed file at position `p_offset + i`. You walk each segment end to end doing that arithmetic and the `.so` reassembles identical to the one on disk.

## The single-shot crash, explained

The `soscan` scan crashed **once** (delta `0x3820000` → vaddr `0x1182000`) and resumed. It wasn't chance: that vaddr falls in the **gap between the R-- segment (ends at `0x117487c`) and the R-X (starts at `0x1184880`)** — a ~48 KB hole the loader leaves unmapped (PROT_NONE) because of the 64 KB alignment padding between PT_LOADs. Reading there is a SIGSEGV. The watchdog reloaded, the resume jumped the gap (+64 KB) and went down to the ELF header. Two lessons from a single crash: the crash-resume infrastructure (offset-relative-to-the-anchor) was validated in production, and a dump **must iterate per segment** using `[vaddr, vaddr+filesz)`, without crossing the gaps between PT_LOADs.

## The dump: 82.6 MB in ~80 seconds, zero crashes

The `sodump` payload walks each PT_LOAD `[elf_base+vaddr, +filesz)` in 64 KB blocks, encodes them, and `POST`s each one to `/dump` with its destination `p_offset`; the server reconstructs the file placing each block in its spot. It ran in one shot (evidence: [`sodump_v1_DUMP_COMPLETO_191521.txt`](https://github.com/hdbreaker/samsung-smarttv-tizen-9-chromium-120-v8-rce/blob/main/blog/assets/sodump_v1_DUMP_COMPLETO_191521.txt)):

```
[+] magic '\x7fELF' verified at 0xaf9fc000
[*] dump plan (4 PT_LOAD, R-X first):
    off=0x1174880 vaddr=0x1184880 filesz=0x3e9bfb0 R-X
    off=0x0       vaddr=0x0       filesz=0x117487c R--
    ...
[+] segment 0 complete (off=0x1174880, 62.61 MB)
...
[+] ===== DUMP COMPLETE =====  (82.6 MB of PT_LOADs)
```

And here's the detail worth calling out, the one that makes this work: **inside a mapped segment there are no `PROT_NONE` gaps**, so the ~21 million 4-byte reads went through **without a single crash**. The cursor in `localStorage` wasn't even needed. The result was `dumps/libchrome.leak.so` at **86,561,804 bytes** (`= seg4_off + seg4_filesz`, exact).

![Payload `sodump` dumping the PT_LOADs in chunks on the TV](/assets/blog/samsung-tv-rce-4-sodump.png)

*`sodump`: `Primitives ready`, the plan for the 4 PT_LOADs (R-X first) and the chunk progress via `POST /dump` up to 82.6 MB — the whole library coming out of the TV with just R/W, no ADB.*

## Two fixups to make a memory dump analyzable

Having the bytes isn't enough: what I dumped is a **snapshot of the library already loaded**, and that's not the same as the `.so` as it sits on disk. When the loader mounts a library, it touches and changes things; my snapshot kept those changes, and that's why `objdump`/`readelf`/[ROPgadget](https://github.com/JonathanSalwan/ROPgadget) reject it. There are two concrete differences, and `utils/fix_elf.py` undoes both:

1. **It's missing the section headers.** An ELF has two tables that describe it: the *program headers* (what the loader needs to run it) and the *section headers* (the fine-grained detail the analysis tools use). The former get loaded into memory; the latter **don't** —they only exist in the on-disk file—, so my snapshot doesn't have them. The problem is that the ELF header still says "they're at offset `0x528d574`", and the tools go look for them there, don't find them, and abort with *"section header table goes past the end of the file"*. The fix is to tell them there aren't any: you zero out the fields that point to that table (`e_shoff`, `e_shnum`, `e_shstrndx`), and the tools fall back to their "no sections" mode, working only with the program headers.
2. **Pointers the loader already rewrote to real addresses.** Inside the `.dynamic` (the section with the linking metadata) there are pointers that in the on-disk file are relative *offsets*, but which the loader, on loading the lib, rewrites to the absolute address where each thing ended up in memory. For example `DT_STRTAB` —the pointer to the string table— in my snapshot held `0xafa130d8`, an absolute address, instead of the original value. To get back to the disk value you subtract `elf_base`: `0xafa130d8 − 0xaf9fc000 = 0x170d8`. `fix_elf.py` does that subtraction on the **7 pointers** in `.dynamic` that were rewritten.

> `fix_elf.py` **normalizes a memory snapshot** to turn it back into something the static tools understand. (And it writes a `*.static.so` copy, without touching the raw `*.leak.so` dump.)

## The aha moment

With the two fixups, the `.dynamic` reads clean. And there appears the confirmation that closes the whole "I couldn't pull the binary" arc:

```
SONAME   libchromium-impl.so
NEEDED   libecore.so.1   libevas.so.1   libecore_evas.so.1   libelementary.so.1
NEEDED   libefl-extension.so.0   libecore_wl2.so.1   libedje.so.1   libeina.so.1
NEEDED   libtts.so   libvconf.so.0   libcapi-appfw-application.so.0   ...
```

The real `SONAME` is **`libchromium-impl.so`** (Samsung's naming), and the `NEEDED`s are Tizen's **EFL graphics stack** (Ecore/Evas/Elementary/Edje/Eina) — the unmistakable fingerprint of the TV's embedded Chromium. From JavaScript and an arbitrary read, I reconstructed **the exact binary that runs on the TV**, ready for static analysis.

There's a single exported dynamic symbol: it's a **stripped production library**. Chromium links almost everything statically, so `mprotect`/`mmap`/`system` aren't here as defined symbols — they're *imports* via PLT to the libc's of the `NEEDED`s. Doesn't matter: for ROP I don't need symbols, I need **`.text` bytes**. And there's plenty of those:

```
$ ROPgadget --binary dumps/libchrome.static.so
Unique gadgets found: 395075
```

Nearly **400,000 unique gadgets**, with `pop {…, pc}` to spare for controlling registers and jumping. The TV's binary went from an unreachable black box (SDB blocked by SMACK, [chapter 02](/blog/samsung-tv-v8-rce-sdb-dead-end)) to an ELF I can analyze on the laptop. With the arsenal on the table, the question becomes how to execute it — and that starts with understanding what [protections are in place](/blog/samsung-tv-v8-rce-dep-or-rop) on the TV.
