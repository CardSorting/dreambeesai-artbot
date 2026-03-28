#!/bin/bash
# 🐝 DreamBees Hive Node: GCE Deployment Script (v1.3)
set -e

# --- FLAGS ---
SKIP_LINT=false
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --skip-lint) SKIP_LINT=true ;;
    esac
    shift
done

# --- CONFIGURATION ---
PROJECT_ID="dreambees-alchemist"
ZONE="us-central1-a"
REGION="us-central1"
INSTANCE_NAME="dreambees-hive-node" # Persistent "Always On" instance name
SERVICE_NAME="dreambees-discord-bot"
REPO_NAME="dreambees-bot-repo"
IMAGE_NAME="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}:latest"

# --- MACHINE SPECIFICATIONS ---
MACHINE_TYPE="e2-small" # 2 vCPU, 2GB RAM (Balanced for Sharp image processing)
DISK_SIZE="20GB"

# --- SECRETS & ENVIRONMENT ---
if [ -f .env ]; then
    echo "🔑 Loading secrets from local .env..."
    # Exporting to shell so they can be passed as env-vars to gcloud
    export $(grep -v '^#' .env | xargs)
else
    echo "❌ Error: .env file not found. Deployment requires valid credentials."
    exit 1
fi

# --- ENVIRONMENT CONSOLIDATION ---
# Shared environment string for both 'create' and 'update' commands
# This ensures that both new and existing instances receive the same mission-critical configuration.
ENV_VARS="NODE_ENV=production,DREAMBEES_API_URL=${DREAMBEES_API_URL},DREAMBEES_API_KEY=${DREAMBEES_API_KEY},DISCORD_TOKEN=${DISCORD_TOKEN},DISCORD_CLIENT_ID=${DISCORD_CLIENT_ID},FIREBASE_API_KEY=${FIREBASE_API_KEY},FIREBASE_AUTH_DOMAIN=${FIREBASE_AUTH_DOMAIN},FIREBASE_AUTH_EMAIL=${FIREBASE_AUTH_EMAIL},FIREBASE_AUTH_PASSWORD=${FIREBASE_AUTH_PASSWORD},B2_ENDPOINT=${B2_ENDPOINT},B2_REGION=${B2_REGION},B2_BUCKET=${B2_BUCKET},B2_KEY_ID=${B2_KEY_ID},B2_APP_KEY=${B2_APP_KEY},B2_PUBLIC_URL=${B2_PUBLIC_URL},OPENROUTER_API_KEY=${OPENROUTER_API_KEY},CLOUDFLARE_ACCOUNT_ID=${CLOUDFLARE_ACCOUNT_ID},CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN},GOOGLE_API_KEY=${GOOGLE_API_KEY},WEBAPP_URL=${WEBAPP_URL},DREAMBEES_GUILD_ID=${DREAMBEES_GUILD_ID},GCLOUD_PROJECT=${PROJECT_ID},CLOUD_TASKS_LOCATION=${CLOUD_TASKS_LOCATION},CLOUD_TASKS_QUEUE=${CLOUD_TASKS_QUEUE},CLOUD_TASKS_SA_EMAIL=${CLOUD_TASKS_SA_EMAIL},TASK_WEBHOOK_URL=${TASK_WEBHOOK_URL},PORT=8080"

# --- PRE-DEPLOYMENT VALIDATION ---
echo "🧐 Verifying local configuration before build..."
if ! npm run verify; then
    echo "❌ Error: Configuration verification failed. Fix your .env or configuration before pushing to production."
    exit 1
fi

if [ "$SKIP_LINT" = false ]; then
    echo "🧹 Running lint check..."
    if ! npm run lint; then
        echo "❌ Error: Linting failed. Fix your code style or use --skip-lint to bypass (hotfixes only)."
        exit 1
    fi
fi

echo "🚀 Starting ALWAYS-ON Deployment for ${INSTANCE_NAME} to ${ZONE}..."

# 1. Project Alignment
echo "🛰️ Aligning project to ${PROJECT_ID}..."
gcloud config set project ${PROJECT_ID}

# 2. Firewall Automation (Active Verification)
echo "🛡️ Ensuring Hive firewall is open on Port 8080..."
if ! gcloud compute firewall-rules describe allow-hive-8080 &>/dev/null; then
    gcloud compute firewall-rules create allow-hive-8080 \
        --allow=tcp:8080 \
        --target-tags=http-server \
        --description="Allow Hive Node health checks and Cloud Task webhooks"
fi

# 3. API Enablement
echo "📡 Verifying Google Cloud APIs..."
gcloud services enable \
    compute.googleapis.com \
    artifactregistry.googleapis.com \
    cloudbuild.googleapis.com

# 4. Artifact Registry Management
echo "📦 Optimizing Artifact Registry..."
if ! gcloud artifacts repositories describe ${REPO_NAME} --location=${REGION} &>/dev/null; then
    echo "Creating repository ${REPO_NAME}..."
    gcloud artifacts repositories create ${REPO_NAME} \
        --repository-format=docker \
        --location=${REGION} \
        --description="Docker repository for DreamBees Discord Bot"
fi

# 5. High-Performance Build via Cloud Build
echo "🏗️ Building container image via Cloud Build..."
gcloud builds submit --tag ${IMAGE_NAME} .

# 6. GCE Deployment (Create or Update)
echo "🚢 Deploying to Compute Engine (${MACHINE_TYPE} @ ${ZONE})..."

# Check if instance already exists
if gcloud compute instances describe ${INSTANCE_NAME} --zone=${ZONE} &>/dev/null; then
    echo "🔄 Instance exists. Updating container image..."
    gcloud compute instances update-container ${INSTANCE_NAME} \
        --zone=${ZONE} \
        --container-image=${IMAGE_NAME} \
        --remove-container-env=NODE_ENV,FIREBASE_SERVICE_ACCOUNT_JSON \
        --container-env=${ENV_VARS}
else
    echo "🆕 Creating new 'Always-On' instance..."
    gcloud compute instances create-with-container ${INSTANCE_NAME} \
        --zone=${ZONE} \
        --machine-type=${MACHINE_TYPE} \
        --boot-disk-size=${DISK_SIZE} \
        --boot-disk-type=pd-balanced \
        --container-image=${IMAGE_NAME} \
        --container-restart-policy=always \
        --tags=http-server,https-server \
        --labels=managed-by=antigravity,env=production,app=dreambees \
        --container-env=${ENV_VARS}
fi

# --- ACTIVE VERIFICATION (SMOKE TEST) ---
echo "🩺 Verifying deployment success..."
EXTERNAL_IP=$(gcloud compute instances describe ${INSTANCE_NAME} --zone=${ZONE} --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

if [ -z "$EXTERNAL_IP" ]; then
    echo "⚠️ Warning: Failed to fetch external IP. Skipping smoke test."
else
    echo "🔗 Instance IP: ${EXTERNAL_IP}. Waiting for container startup (30s)..."
    sleep 30

    ATTEMPTS=0
    MAX_ATTEMPTS=3
    HEALTH_CHECK_URL="http://${EXTERNAL_IP}:8080/healthz"

    while [ $ATTEMPTS -lt $MAX_ATTEMPTS ]; do
        echo "📡 Pinging Health Probe: ${HEALTH_CHECK_URL} (Attempt $((ATTEMPTS+1))/$MAX_ATTEMPTS)..."
        HTTP_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_CHECK_URL" || echo "000")
        
        if [ "$HTTP_RESPONSE" == "200" ]; then
            echo "✅ SMOKE TEST PASSED: Hive Node reports UP and Mission-Ready!"
            break
        else
            echo "⏳ Still initializing (Status: $HTTP_RESPONSE)..."
            ATTEMPTS=$((ATTEMPTS+1))
            [ $ATTEMPTS -lt $MAX_ATTEMPTS ] && sleep 15
        fi
    done

    if [ "$HTTP_RESPONSE" != "200" ]; then
        echo "❌ SMOKE TEST FAILED: Hive Node did not report UP in time."
        echo "🧐 Initiating Failure Forensics..."
        echo "--------------------------------------------------------"
        gcloud compute instances get-serial-port-output ${INSTANCE_NAME} --zone=${ZONE} --start=0 | tail -n 50
        echo "--------------------------------------------------------"
        echo "⚠️ Check the logs above for runtime errors or missing configuration."
        exit 1
    fi
fi

echo "✅ HIVE NODE DEPLOYED: The DreamBees Discord Bot is now 'Always-On'!"
echo "📡 Diagnostics: gcloud compute instances get-serial-port-output ${INSTANCE_NAME} --zone=${ZONE}"
echo "📝 Cloud Logging: https://console.cloud.google.com/logs/query;query=resource.type%3D%22gce_instance%22%0Aresource.labels.instance_id%3D%22${INSTANCE_NAME}%22?project=${PROJECT_ID}"
