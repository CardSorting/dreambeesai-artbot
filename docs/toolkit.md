# 🛠️ Developer Toolkit & Maintenance

The `scripts/` directory contains a comprehensive set of tools for managing the DreamBees Hive, from initial provisioning to high-load stress testing.

---

## 🏗️ Setup & Provisioning

- **`register-commands.js`**: Registers/updates the bot's slash commands with Discord global or per-guild.
  - Usage: `node scripts/register-commands.js`
- **`provision-db.js`**: Rebuilds/initializes the Firestore collections and indexes (use with caution).
- **`verify-config.js`**: A sanity check for the `.env` file, ensuring all required credentials are present and formatted correctly.

---

## 🧹 Maintenance & Operations

- **`cleanup-jobs.js`**: Safely clears stale generation locks from Firestore.
  - Triggered automatically on bot startup, but can be run as a standalone cron job for high-volume servers.
- **`audit-user.js <userId>`**: Generates a detailed report on a user's transaction history, generation success rate, and safety violation count.
- **`health-check.js`**: A diagnostic tool that pings the Modal AI endpoints, Firebase, and Backblaze B2 to verify full-stack connectivity.

---

## 🔬 Testing & Simulation

- **`simulate-generations.js`**: Populates the database with mock generation data for testing the UI or metrics pipelines.
- **`stress-test-locks.js`**: Simulates concurrent users to verify that Firestore transaction locks and cooldowns are functioning under load.
- **`test-modal-direct.js`**: A low-level client for testing direct connectivity to Modal GPU endpoints without going through the Discord bot layer.
- **`test-real-transactions.js`**: Executes real credit/debit cycles on a test user to verify wallet integrity.

---

## 📊 Metrics & Performance

Performance data is logged during every generation via `lib/metrics.js`. 
- **Latency**: Tracked per model (SDXL, Flux, Illustrious).
- **Success Rate**: Monitored for circuit-breaker activation.
- **Error Categories**: Logged to help differentiate between user prompt failures and upstream API outages.

### Monitoring Commands
```bash
# Register all Slash Commands for the first time
npm run register

# Verify environment before deployment
npm run verify

# Run a quick health check on infrastructure
node scripts/health-check.js
```

> [!TIP]
> Always run `npm run verify` before a major deployment to ensure your production `.env` is fully aligned with the requirements of the new build.
