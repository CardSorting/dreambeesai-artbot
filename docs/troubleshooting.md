# 🩺 Troubleshooting Guide

Common issues encountered when running or maintaining the DreamBees Discord Bot.

---

## 🐝 Hive-Specific Errors

| Error Message | Cause | Resolution |
| :--- | :--- | :--- |
| **"Empty Jar!"** | User balance < transaction cost. | Advise user to claim daily Zaps or participation rewards. |
| **"Active Worker!"** | User already has a generation lock. | Wait for current generation or run `node scripts/cleanup-jobs.js` to clear a stuck lock. |
| **"Hive Swarmed!"** | Global concurrency limit reached. | Retry in a few moments (30s+). |
| **"Queen's Guard Alert!"** | Prompt blocked by safety filters. | Refine the prompt to remove prohibited terms. |

---

## 🔒 Session & State Issues

### Stuck Generation Locks
If the bot crashes mid-generation, a user's `artbot_locks` record might remain active, preventing them from starting a new generation until the 5-minute auto-expiry passes.

**Manual Reset**:
```bash
# Clear all stale locks immediately
node scripts/cleanup-jobs.js
```

### Auth & Permission Denied (Firestore)
Errors like `permission-denied` or `unauthenticated` usually indicate expired Google Cloud credentials on the host machine.

**Resolution**:
```bash
gcloud auth application-default login
```

---

## 📡 Connectivity & API Outages

### Circuit Breaker Active (`isCircuitOpen`)
The bot will automatically enter a fail-safe mode if the Modal AI endpoints consistently return errors (e.g., 502/504).
- **Symptom**: "Restoring Nectar..." response to all slash commands.
- **Resolution**: Monitor the Modal AI dashboard to verify endpoint status. Error state resets after a cooldown period once connectivity is restored.

### Storage Failures (Backblaze B2)
Errors during image upload (`uploadToS3WithRetry`) are automatically retried 3 times with exponential backoff.
- **Persistent Failure**: Verify `B2_APPLICATION_KEY` and `B2_KEY_ID` in the `.env` file.
- **Check**: Run `node scripts/health-check.js` to test storage persistence.

---

## 🧠 Memory & OOM Errors

High-concurrency image processing (via `sharp`) can lead to **Out of Memory (OOM)** crashes on small instances (like `e2-small`).
- **Optimization**: The `p-limit` library is used to restrict the number of concurrent `sharp` operations.
- **GCE Resolution**: If OOM occurs frequently, consider upgrading the instance to `e2-medium` (4GB RAM) via the `deploy-gce.sh` script configuration.

---

## 🛡️ Moderation False Positives

If a legitimate prompt is blocked by `guardHive`:
1. **Locate Event**: Check the `artbot_reports` collection in Firestore for the `matchedTerm`.
2. **Update Blocklist**: Modify `lib/safety-blocklist.js` to refine or remove the offending term.
3. **Deploy**: Restart the bot to apply the new blocklist rules.
