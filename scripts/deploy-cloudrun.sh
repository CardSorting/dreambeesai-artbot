#!/bin/bash
set -e

# --- CONFIGURATION ---
PROJECT_ID="dreambees-alchemist"
REGION="us-central1"
SERVICE_NAME="dreambees-discord-bot"
REPO_NAME="dreambees-bot-repo"
IMAGE_NAME="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}/${SERVICE_NAME}:latest"

# --- ENTERPRISE HARDENING RESOURCE ENVELOPE (v2) ---
CPU="1"
MEMORY="2Gi"
MAX_INSTANCES="1"
MIN_INSTANCES="1"
CONCURRENCY="80"
TIMEOUT="60s"

# --- LOAD SECRETS FROM .ENV ---
if [ -f .env ]; then
    echo "🔑 Loading secrets from local .env for embedding..."
    export $(grep -v '^#' .env | xargs)
else
    echo "❌ Error: .env file not found. Enterprise hardening requires a valid .env."
    exit 1
fi

echo "🚀 Starting ENTERPRISE HARDENED v2 Deployment for ${SERVICE_NAME} to ${REGION}..."

# 1. Project Alignment
echo "🛰️ Aligning project to ${PROJECT_ID}..."
gcloud config set project ${PROJECT_ID}

# 2. API Enablement
echo "📡 Verifying Google Cloud APIs..."
gcloud services enable \
    run.googleapis.com \
    artifactregistry.googleapis.com \
    cloudbuild.googleapis.com

# 3. Artifact Registry Management
echo "📦 Optimizing Artifact Registry..."
if ! gcloud artifacts repositories describe ${REPO_NAME} --location=${REGION} &>/dev/null; then
    echo "Creating repository ${REPO_NAME}..."
    gcloud artifacts repositories create ${REPO_NAME} \
        --repository-format=docker \
        --location=${REGION} \
        --description="Enterprise Docker repository for DreamBees Discord Bot"
fi

# 4. High-Performance Build via Cloud Build
echo "🏗️ Building hardened image via Cloud Build..."
gcloud builds submit --tag ${IMAGE_NAME} .

# 5. ENTERPRISE v2 Deployment Orchestration
# - execution-environment gen2: Full Linux kernel for deep image task performance
# - startup-probe: Verify Discord Ready before making revision active
# - liveness-probe: Auto-restart if Discord connection drops
# - cpu-boost: Faster cold-starts
# - labels: Professional metadata for cost tracking
echo "🚢 Deploying ENTERPRISE v2 service architecture..."
gcloud run deploy ${SERVICE_NAME} \
    --image ${IMAGE_NAME} \
    --region ${REGION} \
    --platform managed \
    --min-instances ${MIN_INSTANCES} \
    --max-instances ${MAX_INSTANCES} \
    --no-cpu-throttling \
    --cpu ${CPU} \
    --memory ${MEMORY} \
    --concurrency ${CONCURRENCY} \
    --timeout ${TIMEOUT} \
    --execution-environment gen2 \
    --cpu-boost \
    --startup-probe-type=http \
    --startup-probe-path=/ \
    --startup-probe-period=10s \
    --startup-probe-failure-threshold=3 \
    --liveness-probe-type=http \
    --liveness-probe-path=/ \
    --liveness-probe-period=30s \
    --liveness-probe-failure-threshold=3 \
    --labels=managed-by=antigravity,env=production,app=dreambees \
    --allow-unauthenticated \
    --set-env-vars NODE_ENV=production,DREAMBEES_API_URL="${DREAMBEES_API_URL}",DREAMBEES_API_KEY="${DREAMBEES_API_KEY}",DISCORD_TOKEN="${DISCORD_TOKEN}",DISCORD_CLIENT_ID="${DISCORD_CLIENT_ID}",FIREBASE_API_KEY="${FIREBASE_API_KEY}",FIREBASE_AUTH_DOMAIN="${FIREBASE_AUTH_DOMAIN}",FIREBASE_AUTH_EMAIL="${FIREBASE_AUTH_EMAIL}",FIREBASE_AUTH_PASSWORD="${FIREBASE_AUTH_PASSWORD}",B2_ENDPOINT="${B2_ENDPOINT}",B2_REGION="${B2_REGION}",B2_BUCKET="${B2_BUCKET}",B2_KEY_ID="${B2_KEY_ID}",B2_APP_KEY="${B2_APP_KEY}",B2_PUBLIC_URL="${B2_PUBLIC_URL}",OPENROUTER_API_KEY="${OPENROUTER_API_KEY}",CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID}",CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN}",GOOGLE_API_KEY="${GOOGLE_API_KEY}",WEBAPP_URL="${WEBAPP_URL}",DREAMBEES_GUILD_ID="${DREAMBEES_GUILD_ID}",GCLOUD_PROJECT="${PROJECT_ID}"

echo "✅ ENTERPRISE SUCCESS: v2 Deployment Complete!"
echo "📡 Service Endpoint: $(gcloud run services describe ${SERVICE_NAME} --region ${REGION} --format='value(status.url)')"
echo "🛠️ Probes Integrated: Startup and Liveness checks are now active."
