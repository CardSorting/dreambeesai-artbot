#!/bin/bash
# 🐝 DreamBees Hive Node: Unified Pipeline Trigger (v1.7)
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
INSTANCE_NAME="dreambees-hive-node"
SERVICE_NAME="dreambees-discord-bot"
REPO_NAME="dreambees-bot-repo"
IMAGE_NAME="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}:latest"

# --- SECRETS & ENVIRONMENT ---
if [ -f .env ]; then
    echo "🔑 Loading mission-critical secrets..."
    export $(grep -v '^#' .env | xargs)
else
    echo "❌ Error: .env file not found."
    exit 1
fi

# Consolidate env vars for injection into Cloud Build
ENV_VARS="NODE_ENV=production,DREAMBEES_API_URL=${DREAMBEES_API_URL},DREAMBEES_API_KEY=${DREAMBEES_API_KEY},DISCORD_TOKEN=${DISCORD_TOKEN},DISCORD_CLIENT_ID=${DISCORD_CLIENT_ID},FIREBASE_API_KEY=${FIREBASE_API_KEY},FIREBASE_AUTH_DOMAIN=${FIREBASE_AUTH_DOMAIN},FIREBASE_AUTH_EMAIL=${FIREBASE_AUTH_EMAIL},FIREBASE_AUTH_PASSWORD=${FIREBASE_AUTH_PASSWORD},B2_ENDPOINT=${B2_ENDPOINT},B2_REGION=${B2_REGION},B2_BUCKET=${B2_BUCKET},B2_KEY_ID=${B2_KEY_ID},B2_APP_KEY=${B2_APP_KEY},B2_PUBLIC_URL=${B2_PUBLIC_URL},OPENROUTER_API_KEY=${OPENROUTER_API_KEY},CLOUDFLARE_ACCOUNT_ID=${CLOUDFLARE_ACCOUNT_ID},CLOUDFLARE_API_TOKEN=${CLOUDFLARE_API_TOKEN},GOOGLE_API_KEY=${GOOGLE_API_KEY},WEBAPP_URL=${WEBAPP_URL},DREAMBEES_GUILD_ID=${DREAMBEES_GUILD_ID},GCLOUD_PROJECT=${PROJECT_ID},CLOUD_TASKS_LOCATION=${CLOUD_TASKS_LOCATION},CLOUD_TASKS_QUEUE=${CLOUD_TASKS_QUEUE},CLOUD_TASKS_SA_EMAIL=${CLOUD_TASKS_SA_EMAIL},TASK_WEBHOOK_URL=${TASK_WEBHOOK_URL},PORT=8080"

echo "🚀 Triggering UNIFIED PIPELINE (v1.7) for ${INSTANCE_NAME}..."

# 1. Project Alignment
gcloud config set project ${PROJECT_ID} &>/dev/null

# 2. Trigger Cloud Build Orchestration
# The build manifest now handles: Parallel Pre-checks, Kaniko Build, 
# Security Scanning, Pruning, and Final GCE Deployment.
GIT_SHA=$(git rev-parse --short HEAD || echo "uncommitted")

gcloud builds submit --config=cloudbuild.yaml \
    --substitutions="_IMAGE_NAME=${IMAGE_NAME},_VERSION=${GIT_SHA},_ENV_VARS=${ENV_VARS},_INSTANCE_NAME=${INSTANCE_NAME},_ZONE=${ZONE},_DREAMBEES_API_URL=${DREAMBEES_API_URL},_DREAMBEES_API_KEY=${DREAMBEES_API_KEY},_DISCORD_TOKEN=${DISCORD_TOKEN},_FIREBASE_API_KEY=${FIREBASE_API_KEY}"

# --- ACTIVE VERIFICATION (SMOKE TEST) ---
# We keep the smoke test in the shell script to verify the Node entrypoint 
# successfully settled after the Cloud Build finished.
echo "🩺 Initiating post-pipeline Smoke Test..."
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
            echo "✅ SMOKE TEST PASSED: Hive Node v${GIT_SHA} is mission-ready!"
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
        gcloud compute instances get-serial-port-output ${INSTANCE_NAME} --zone=${ZONE} --start=0 | tail -n 50
        exit 1
    fi
fi

echo "✅ HIVE NODE DEPLOYED: Unified Lifecycle complete."
echo "📝 Cloud Logging: https://console.cloud.google.com/logs/query;query=resource.type%3D%22gce_instance%22%0Aresource.labels.instance_id%3D%22${INSTANCE_NAME}%22?project=${PROJECT_ID}"
