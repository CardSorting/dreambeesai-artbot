# 🐝 DreamBees Discord Bot

DreamBees is a high-performance, feature-rich Discord bot designed for AI-powered creative workflows. It brings state-of-the-art image generation and manipulation directly to your Discord server, featuring a robust economy system and enterprise-grade safety controls.

---

## ✨ Key Features

- **🎨 Multi-Model Image Generation**: Generate stunning artwork using advanced models via `/dream` and `/flash`.
- **🔄 Advanced Remixing**: Perform surgical image edits and style transformations with the `/remix` suite.
- **⚡ Zap Economy**: Integrated currency system ("Zaps") to manage generation costs and user rewards.
- **🛡️ Queen's Guard (Hive Security)**: Sophisticated prompt filtering and safety layers to ensure community-appropriate content.
- **📦 Cloud-Native Architecture**: Built with Node.js, leveraging Firebase for real-time data and Backblaze B2/S3 for scalable asset storage.
- **🚀 Modal Integration**: High-speed inference powered by Modal GPU endpoints.

---

## 🛠️ Prerequisites

- **Node.js**: `v20.x` or higher (Uses ESM)
- **Firebase Project**: For Firestore database and authentication.
- **Backblaze B2 / S3**: For storing generated images.
- **Discord Developer Account**: To create and manage your bot application.
- **Modal Account**: For AI inference endpoints.

---

## 🚀 Getting Started

### 1. Clone the Repository
```bash
git clone https://github.com/your-repo/DreamBees-DiscordBot.git
cd DreamBees-DiscordBot
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
Copy the example environment file and fill in your credentials:
```bash
cp .env.example .env
```
*Required fields include Discord tokens, Firebase service accounts, B2 credentials, and Modal endpoints.*

### 4. Register Slash Commands
```bash
npm run register
```

### 5. Start the Bot
```bash
# Development
node index.js

# Production (using PM2 or similar)
pm2 start index.js --name "dreambees-bot"
```

---

## 📖 Command Reference

| Command | Description |
| :--- | :--- |
| `/dream` | Generate high-quality images from a text prompt. |
| `/flash` | Rapid image generation for quick iterations. |
| `/remix` | Transform or evolve an existing image. |
| `/claim` | Daily rewards and Zap collection. |
| `/status` | Check your wallet balance and bot health. |
| `/config` | Server-specific configuration (Admin only). |

---

## 🏗️ Architecture

- **Core**: `index.js` (Entry point & Event handling)
- **Commands**: `commands/` (Slash command definitions)
- **Logic**: `lib/`
  - `generator.js`: Orchestrates the image generation pipeline.
  - `hive.js`: Safety and moderation logic.
  - `db/`: Firestore interaction layer.
- **Interactions**: `interactions/` (Button and Modal handlers)

---

## 🧠 Knowledge Base

Explore more technical details about the DreamBees architecture and systems:

- **[🏛️ Architecture Overview](file:///Users/bozoegg/Desktop/DreamBees-DiscordBot/docs/architecture.md)**: High-level service design and generation sequence diagrams.
- **[🛡️ Safety & Moderation](file:///Users/bozoegg/Desktop/DreamBees-DiscordBot/docs/safety.md)**: Deep dive into the Queen's Guard and Hive security layers.
- **[⚡ Zap Economy](file:///Users/bozoegg/Desktop/DreamBees-DiscordBot/docs/economy.md)**: Transaction lifecycle and financial integrity.
- **[📊 Data Model](file:///Users/bozoegg/Desktop/DreamBees-DiscordBot/docs/data-model.md)**: Detailed Firestore ERD and storage strategy.
- **[🚢 Deployment & DevOps](file:///Users/bozoegg/Desktop/DreamBees-DiscordBot/docs/deployment.md)**: GCE "Always-On" setup and Dockerization instructions.
- **[🛠️ Developer Toolkit](file:///Users/bozoegg/Desktop/DreamBees-DiscordBot/docs/toolkit.md)**: Guide to administrative, maintenance, and testing scripts.
- **[🩺 Troubleshooting](file:///Users/bozoegg/Desktop/DreamBees-DiscordBot/docs/troubleshooting.md)**: Common errors, lock resets, and connectivity diagnostics.

---

## 📄 License

This project is licensed under the **Apache License 2.0**. See the [LICENSE](./LICENSE) file for details.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request or open an issue for feature requests and bug reports.

*Built with ❤️ by the DreamBees AI Team.*
