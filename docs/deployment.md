# 🚢 Industrial-Grade Deployment & Unified CI/CD (v3.0)

The DreamBees Hive Node is designed for mission-critical reliability on Google Cloud Platform. It utilizes a state-of-the-art **Build-Scan-Deploy** orchestration pipeline that ensures maximum security, performance, and uptime.

---

## 🏗️ Docker Engineering: The "Vault" Pattern

The bot uses a high-efficiency multi-stage `Dockerfile` focused on **Industrial-Grade Isolation**.

- **Base Image**: `node:20-bookworm-slim` (for glibc compatibility with `sharp`).
- **Immutable OS**: The container runs with a **Read-Only Root Filesystem**. This prevents runtime tampering and ensures the highest possible security posture.
- **Walled Garden (tmpfs)**: A writable memory space is mounted at `/tmp` for temporary image processing, buffers, and cache.
- **Minimal Surface Area**: All build tools (`npm`, `make`, `g++`) are stripped from the final production stage.
- **OOM Resilience**: Node.js is hard-coded with `--max-old-space-size=1536` to ensure deterministic garbage collection within GCE `e2-small` RAM limits.

---

## 🚀 Unified Pipeline (v3.0)

We have centralized the entire deployment lifecycle into a single **Cloud Build Manifest (`cloudbuild.yaml`)**.

### 🏗️ Orchestration Steps:
1. **Parallel Pre-checks**: Runs `npm run lint` and `npm run verify` concurrently in the cloud to catch errors before building.
2. **Accelerated Build**: Uses the **Kaniko Executor** for 10x better layer caching for multi-stage Dockerfiles.
3. **Security Gating**: Automatically performs an **On-Demand Vulnerability Scan** of every new image.
4. **Security Checkpoint**: Automatically **fails the build** if High or Critical severity vulnerabilities are detected.
5. **Registry Pruning**: Automatically deletes obsolete images, keeping only the most recent 3 versions to manage costs.
6. **Atomic Deployment**: Updates the GCE instance container with the new image, `tmpfs` mounts, and non-privileged security context.

---

## 🛰️ Infrastructure & DevOps

### 📜 `deploy-gce.sh`
This script serves as the high-level trigger for the Unified Pipeline:
```bash
./scripts/deploy-gce.sh
```
It handles local secret loading (from `.env`), Git version detection, and provides an **Active Smoke Test** that pings the `/healthz` endpoint using the instance's external IP to verify a successful startup.

### 🕵️ Observability & Traceability
- **Correlation IDs**: All logs include a unified `trace_id` for following a single image generation cycle from start to finish.
- **Built-in Versioning**: The bot's current Git Commit SHA is baked into the image and visible in the `/healthz` probe.
- **Failure Forensics**: If a deployment fails, the script automatically pulls the last 50 lines of the VM's serial port output to diagnose the crash immediately.

### 🩺 Health Monitoring
```bash
# Verify the bot is Mission-Ready
curl http://[INSTANCE_IP]:8080/healthz
```
Response includes status (UP/DEGRADED), individual dependency health (Discord, DB, APIs), memory usage, and the current build version.

---

## 📈 Security Hardening Summary
- [x] Read-Only Root Filesystem
- [x] Automated Vulnerability Gating
- [x] Non-Privileged User Execution
- [x] Automated Secret Masking in Logs
- [x] Service-Level Circuit Breaking (Partial Degradation)
