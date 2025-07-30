---
title: "Nimhawk v2.0: Development Update"
publishDate: "2025-01-13"
description: "C4-style relay multi-agent architecture, cross-platform agents, and upcoming self-contained TCP mesh networking."
tags: ["nimhawk", "c2", "relay", "mesh-network", "multi-platform", "red-team"]
draft: false
---

## Nimhawk v2.0 Development Update

Working on the next evolution of Nimhawk with some game-changing features for the red team community.

## 🧠 C4-Style Relay Multi-Agent Architecture

The core innovation is a **C4-style relay multi-agent architecture** that changes how operators interact with target networks.

![Nimhawk Login Interface](/assets/blog/nimhawk1.jpeg)
*Nimhawk v2.0 login interface and server configuration*

**Operators can now reach internal, non-exposed networks by chaining agents that relay traffic between them.**

![Nimhawk Agent Selection](/assets/blog/nimhawk2.jpeg)
*Agent selection interface for building relay chains*

### Decoupled UI

**UI is fully decoupled, built with React Flow and runs on Electron**:
- Visual network topology representation
- Drag-and-drop operation planning  
- Cross-platform consistency
- Enhanced OPSEC (UI runs independently)

![Nimhawk Network Topology](/assets/blog/nimhawk3.jpeg)
*Real-time network topology visualization with debug console*

## 💻 Multi-Platform Agent Revolution

**Multi-platform agent already working (Linux, macOS, ARM, MIPS)**

**✅ Fully Operational:**
- Linux (x86_64, ARM64, ARM32, MIPS)
- macOS (Intel x64, Apple M1/M2)
- Embedded systems (MIPS, ARM, RISC-V)

**⚠️ Work in Progress:**
- Windows agent not yet compatible with the new relay system

![Nimhawk Agent Management](/assets/blog/nimhawk4.jpeg)
*Agent management interface showing multiple platform support*

## 🔜 Next: Self-Contained TCP Mesh

**Next: integrate smoltcp to build a 100% self-contained TCP mesh 🕸️ Hamachi-style, no external binaries, no root.**

Benefits:
- No external dependencies
- No root privileges required
- 100% self-contained networking
- Built-in encryption and authentication
- Dynamic routing and failover

## Get Involved

**GitHub:** [hdbreaker/Nimhawk](https://github.com/hdbreaker/Nimhawk)

**Follow progress:** [@hdbreaker_](https://twitter.com/hdbreaker_) 

Join us in building the next generation of red team tools. 