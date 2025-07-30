---
title: "Introducing Nimhawk C2"
publishDate: "2024-11-15"
description: "A powerful, modular, lightweight and efficient command & control framework written in Nim for red team operations."
tags: ["nimhawk", "c2", "red-team", "nim", "edr-evasion"]
draft: false
---

## Introducing Nimhawk C2

Now that I have some more time, I've decided to get back to my technical side. Today I'm presenting **Nimhawk C2** – a powerful command & control framework written in Nim.

![Nimhawk Framework Overview](/assets/blog/n1.png)
*Nimhawk C2 framework presentation and main interface*

## What is Nimhawk?

Nimhawk is a **modular, lightweight and efficient C2 framework** designed for red team operations and security research. Written in Nim for superior performance and stealth capabilities.

### Agent Management

The framework provides comprehensive agent management with **four distinct connection states**: **Active** (green), **Disconnected** (red), **Late** (orange), and **Inactive** (gray). This allows operators to monitor the real-time status of all deployed implants across the network.

![Nimhawk Agent States](/assets/blog/n2.png)
*Operator dashboard displaying the four agent states: Active, Disconnected, Late, and Inactive with network information*

### Interactive Agent Panels

Each agent features a dedicated **interaction panel** providing full control over the compromised system. Operators can execute commands, manage processes, explore the network, and maintain persistent access through an intuitive interface.

![Nimhawk Agent Interaction](/assets/blog/n3.png)
*Individual agent interaction panel with Console, Process, Network, Downloads, and History tabs*

### File Management & Downloads

The framework includes a comprehensive **file download viewer** that tracks all files extracted from target systems. This feature provides detailed information about downloaded content, timestamps, and file sizes for efficient data management during operations.

![Nimhawk Download Viewer](/assets/blog/n4.png)
*Downloaded files viewer showing extracted data with comprehensive file information and management*

## Core Features

- **Execute-Assembly**: In-memory .NET assembly execution  
- **PowerShell Integration**: XOR-encrypted PowerShell execution
- **Shellcode Injection**: Advanced injection using DInvoke for OPSEC
- **Multi-Platform Support**: Cross-platform agent deployment
- **Modular Architecture**: Plugin-based command system
- **EDR Evasion**: Built-in techniques to bypass modern security solutions

## Recent Improvements

**April 2025 Updates:**
- **CRL Self-Hosting**: Multiple .NET assembly execution without implant termination
- **DInvoke Integration**: Enhanced OPSEC for shellcode injection  
- **PowerShell Fixes**: Stable PowerShell command execution
- **XOR Encryption**: Encrypted reverse shell with enhanced security

## Why Nim?

- **Performance**: Compiles to native code with minimal overhead
- **Stealth**: Small binary size and low memory footprint  
- **Development Speed**: Modern language features
- **Interoperability**: Seamless C/C++ integration

## Getting Started

```bash
# Clone the repository
git clone https://github.com/hdbreaker/Nimhawk.git
cd Nimhawk

# Build the framework
python3 nimhawk.py build

# Configure and start server
cp config.toml.example config.toml
python3 nimhawk.py server

# Access operator dashboard at https://localhost:8443
```

## Roadmap

**Upcoming Features:**
- NTDLL Unhooking for advanced EDR bypass
- SOCKS4 tunneling capabilities
- COM-based keylogger functionality
- Nimjacker integration for additional loader techniques
- Process hollowing and thread hijacking
- Call stack spoofing for enhanced evasion

## Status
Nimhawk agents remain undetected by major security vendors: 29 Jul 2025.

## Get Involved

**GitHub:** [hdbreaker/Nimhawk](https://github.com/hdbreaker/Nimhawk)

Perfect for red team professionals, security researchers, and cybersecurity students learning offensive security in controlled environments.

Join us in building the future of red team operations. 