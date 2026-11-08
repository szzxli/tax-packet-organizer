#!/usr/bin/env bash
# 从仓库部署 Worker（唯一部署入口）。
# 前置：npx wrangler login（OAuth），或在环境里提供 CLOUDFLARE_API_TOKEN。
set -euo pipefail
cd "$(dirname "$0")/worker"
npx --yes wrangler deploy
echo "--- 部署后核对：下面应为 7 条（PACKET_KEY/STRIPE_*/RESEND_API_KEY/FRONTEND_ORIGIN/EMAIL_*)"
npx --yes wrangler secret list
