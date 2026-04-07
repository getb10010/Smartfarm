#!/bin/bash
# ============================================================================
# SmartFarmer v3 — Phala Cloud Deployment Script
# 
# Документ: "развертывание Docker-контейнера одной CLI-командой через Phala Cloud"
# ============================================================================

set -e

echo "🌾 SmartFarmer v3 — Deploying AI Oracle to Phala TEE"
echo "======================================================"

# ── Prerequisites check ──
echo ""
echo "📋 Checking prerequisites..."

if ! command -v docker &> /dev/null; then
    echo "❌ Docker not found. Install: https://docs.docker.com/get-docker/"
    exit 1
fi
echo "   ✅ Docker: $(docker --version | head -1)"

if ! command -v npx &> /dev/null; then
    echo "❌ npx not found. Install Node.js: https://nodejs.org/"
    exit 1
fi
echo "   ✅ Node.js: $(node --version)"

# Check for dstack CLI
if command -v dstack &> /dev/null; then
    echo "   ✅ dstack CLI: $(dstack --version 2>/dev/null || echo 'installed')"
    DSTACK_AVAILABLE=true
else
    echo "   ⚠️ dstack CLI not found. Install: npm i -g @aspect-build/dstack"
    echo "      Will build Docker image only."
    DSTACK_AVAILABLE=false
fi

# ── Build Docker image ──
echo ""
echo "📦 Building TEE Docker image..."
docker build -f deployment/Dockerfile.tee -t smartfarmer-oracle:latest .

echo "   ✅ Image built: smartfarmer-oracle:latest"
echo "   Size: $(docker image inspect smartfarmer-oracle:latest --format='{{.Size}}' | numfmt --to=iec 2>/dev/null || echo 'check with docker images')"

# ── Tag for Phala registry ──
echo ""
echo "🏷️  Tagging image..."
docker tag smartfarmer-oracle:latest phala/smartfarmer-oracle:latest
echo "   ✅ Tagged: phala/smartfarmer-oracle:latest"

# ── Deploy to Phala Cloud ──
if [ "$DSTACK_AVAILABLE" = true ]; then
    echo ""
    echo "🚀 Deploying to Phala Cloud..."
    
    # Inject secrets from environment or .env file
    DEPLOY_ARGS="--config deployment/phala-config.yaml --image smartfarmer-oracle:latest"
    
    if [ -n "$HELIUS_API_KEY" ]; then
        DEPLOY_ARGS="$DEPLOY_ARGS --secret HELIUS_API_KEY=$HELIUS_API_KEY"
    fi
    if [ -n "$METGIS_API_KEY" ]; then
        DEPLOY_ARGS="$DEPLOY_ARGS --secret METGIS_API_KEY=$METGIS_API_KEY"
    fi
    if [ -n "$EOSDA_API_KEY" ]; then
        DEPLOY_ARGS="$DEPLOY_ARGS --secret EOSDA_API_KEY=$EOSDA_API_KEY"
    fi

    npx dstack deploy $DEPLOY_ARGS

    echo ""
    echo "✅ Deployment initiated!"
else
    echo ""
    echo "ℹ️  Docker image built successfully."
    echo "    To deploy to Phala Cloud, install dstack CLI and run:"
    echo "    npx dstack deploy --config deployment/phala-config.yaml --image smartfarmer-oracle:latest"
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "   Deployment Summary"
echo "═══════════════════════════════════════════════════════"
echo "   - TEE Enclave: Intel SGX (DCAP attestation)"
echo "   - Remote Attestation: Enabled"
echo "   - Private Key: Generated inside enclave (non-extractable)"
echo "   - TEE Hash: SHA-256 per report (verifiable)"
echo "   - Dialect Notifications: Enabled"
echo ""
echo "📋 Post-deployment steps:"
echo "   1. Verify TEE attestation: phala attestation verify <deployment-id>"
echo "   2. Get TEE-generated public key from deployment logs"
echo "   3. Update smart contract oracle_authority:"
echo "      anchor idl update-authority --new-authority <TEE_PUBKEY>"
echo "   4. Fund oracle account with SOL for transaction fees:"
echo "      solana transfer <TEE_PUBKEY> 1 --url devnet"
echo "   5. Configure TukTuk/Gelato automation:"
echo "      npx tsx automation/tuktuk/setup-queue.ts"
echo "   6. Monitor agent logs:"
echo "      dstack logs smartfarmer-oracle --follow"
