# 🚢 Deployment & DevOps Guide

DreamBees is designed to be highly portable and resilient, supporting "Always-On" deployment via containerization.

---

## 🏗️ Dockerization

The bot is containerized using a `Dockerfile` based on the official Node.js Alpine image for a minimal footprint.

- **Base Image**: `node:20.18.3-alpine`
- **Native Dependencies**: Includes `vips-dev`, `fftw-dev`, and `build-base` for high-performance image processing with `sharp`.
- **Optimization**: Uses a multi-layered build to minimize final image size.

### Building Locally
```bash
docker build -t dreambees-bot .
docker run --env-file .env dreambees-bot
```

---

## ☁️ Google Compute Engine (GCE)

For production, the bot is typically deployed as a "Managed Container" instance on GCE using the provided automation script.

### 📜 `deploy-gce.sh`
This script orchestrates the entire deployment lifecycle:
1. **API Enablement**: Ensures Compute Engine and Artifact Registry APIs are active.
2. **Cloud Build**: Offloads the image build process to Google Cloud Build for speed and reliability.
3. **Artifact Registry**: Pushes the resulting image to a private repository.
4. **Instance Provisioning**: Creates or updates a GCE instance with the following specifications:
   - **Machine Type**: `e2-small` (2 vCPU, 2GB RAM).
   - **Restart Policy**: `always` (the bot automatically restarts if it crashes or the VM reboots).
   - **Env Injection**: Automatically maps local `.env` variables to the GCE container environment.

### Deployment Command
```bash
./scripts/deploy-gce.sh
```

---

## 🛰️ Infrastructure Requirements

To ensure a successful deployment, the following services must be configured:

- **Firebase Service Account**: Provided via `FIREBASE_SERVICE_ACCOUNT_JSON` or a path to a `.json` file.
- **Backblaze B2/S3 Credentials**: Required for asset persistence.
- **Discord Bot Token**: The identity of the bot on the Discord platform.
- **Modal AI Endpoints**: Access to the GPU inference cluster.

---

## 📈 Monitoring & Reliability

- **Health Probes**: The bot exposes a simple health check (if configured) or relies on Docker's internal restart logic.
- **Logging**: Production logs are sent to the console and can be monitored via GCE Serial Port Output or Cloud Logging:
  ```bash
  gcloud compute instances get-serial-port-output dreambees-hive-node --zone=us-central1-a
  ```
- **Circuit Breaker**: The `isCircuitOpen()` check in `lib/api/dreambees.js` prevents the bot from flooding failing endpoints during an outage.
