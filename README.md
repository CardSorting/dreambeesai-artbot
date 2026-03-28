# 🐝 DreamBees Discord Bot

[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node](https://img.shields.io/badge/Node-v20+-green.svg)](https://nodejs.org/)
[![Discord](https://img.shields.io/badge/Discord-Hive-blue.svg?logo=discord&logoColor=white)](https://discord.com/invite/curMHRAN8y)
[![Status](https://img.shields.io/badge/Inference-Modal-purple.svg)](https://modal.com)

DreamBees is a high-performance, feature-rich Discord bot designed for AI-powered creative workflows. It brings state-of-the-art image generation and manipulation directly to your Discord server, featuring a robust economy system and enterprise-grade safety controls.

---

### 🚀 [Getting Started](#🚀-getting-started) • 📖 [Commands](#📖-command-reference) • 🧠 [Knowledge Base](#🧠-knowledge-base) • 🩺 [Troubleshooting](#🩺-troubleshooting) • 🤝 [Support](#🤝-community--support)

---

## 📑 Table of Contents

- [✨ Key Features](#✨-key-features)
- [🛠️ Prerequisites](#🛠️-prerequisites)
- [🚀 Getting Started](#🚀-getting-started)
- [📖 Command Reference](#📖-command-reference)
- [🏗️ Project Architecture](#🏗️-architecture)
- [🧠 Knowledge Base (Internal Docs)](#🧠-knowledge-base)
- [🤝 Community & Support](#🤝-community--support)
- [📄 License](#📄-license)

---

## ✨ Key Features

- **🎨 Multi-Model Image Generation**: Generate artwork via `/dream` (Illustrious) and `/flash` (Rapid).
- **🔄 Advanced Remixing**: Perform surgical image edits and style transformations with the `/remix` suite.
- **⚡ Zap Economy**: Integrated currency system ("Zaps") to manage generation costs and rewards.
- **🛡️ Queen's Guard (Hive Security)**: Sophisticated prompt filtering and safety layers to protect the community.
- **📦 Cloud-Native Architecture**: Built with Node.js, leveraging Firebase and Backblaze B2/S3.
- **🚀 Modal Integration**: High-speed, GPU-accelerated AI inference powered by Modal.

---

## 🛠️ Prerequisites

- **Node.js**: `v20.x` or higher (Uses ESM)
- **Firebase Project**: For Firestore database (Users, Generations, Transactions).
- **Backblaze B2 / S3**: For storing generated assets.
- **Discord Developer Account**: To create and manage your bot application.
- **Modal Account**: For AI inference endpoints.

---

## 🚀 Getting Started

### 1. Clone & Install
```bash
git clone https://github.com/your-repo/DreamBees-DiscordBot.git
cd DreamBees-DiscordBot
npm install
```

### 2. Configure Environment
Copy the example environment file and fill in your credentials:
```bash
cp .env.example .env
```
*Required: Discord tokens, Firebase service account, B2 credentials, and Modal endpoints.*

### 3. Initialize & Register
```bash
# Verify config before starting
npm run verify

# Register slash commands with Discord
npm run register
```

### 4. Start the Hive
```bash
# Development
node index.js

# Production
pm2 start index.js --name "dreambees-bot"
```

---

## 📖 Command Reference

| Command | Description | Cost |
| :--- | :--- | :--- |
| `/dream` | Generate high-quality images from a text prompt. | ⚡ Variable |
| `/flash` | Rapid image generation for quick iterations. | ⚡ Variable |
| `/remix` | Transform or evolve an existing image. | ⚡ Variable |
| `/claim` | Daily rewards and Zap collection. | — |
| `/status` | Check your wallet balance and bot health. | — |
| `/config` | Server-specific configuration (Admin only). | — |

---

## 🏗️ Architecture

- **Core Engine**: `index.js` (Root Orchestrator)
- **Slash Commands**: `commands/` (Command logic)
- **Hive Logic**: `lib/`
  - `generator.js`: The image generation workflow manager.
  - `hive.js`: Security gatekeeper and moderation.
  - `db/`: Firestore interaction layer.
- **Interaction Handlers**: `interactions/` (Button and Modal processing)

---

## 🧠 Knowledge Base

Explore deep technical documentation for the DreamBees ecosystem:

- **[🏛️ Architecture Overview](./docs/architecture.md)**: Service design and generation sequence diagrams.
- **[🛡️ Safety & Moderation](./docs/safety.md)**: Deep dive into the Queen's Guard and Hive security.
- **[⚡ Zap Economy](./docs/economy.md)**: Transaction lifecycle and financial integrity via Firestore.
- **[📊 Data Model](./docs/data-model.md)**: Firestore ERD and storage strategy.
- **[🧬 Evolution UX & Advanced Interactions](./docs/ux-interactions.md)**: Guide to surgical edits, lineage murals, and the Prism of Dimensions.
- **[🚢 Deployment & DevOps](./docs/deployment.md)**: GCE "Always-On" setup and Dockerization.
- **[🛠️ Developer Toolkit](./docs/toolkit.md)**: Guide to administrative and maintenance scripts.
- **[🩺 Troubleshooting](./docs/troubleshooting.md)**: Common errors, lock resets, and connectivity diagnostics.

---

## 🤝 Community & Support

- **Official Discord**: Join the [DreamBees Hive](https://discord.com/invite/curMHRAN8y) for support, updates, and feedback.
- **Contributing**: Please see [CONTRIBUTING.md](./CONTRIBUTING.md) for local development guidelines.
- **Security**: For vulnerability reporting, see [SECURITY.md](./SECURITY.md).

---

## 📄 License

This project is licensed under the **Apache License 2.0**. See the [LICENSE](./LICENSE) file for details.

*Built with ❤️ by the DreamBees AI Team.*
