#!/usr/bin/env bash
# One-time setup on a fresh AWS Lightsail Ubuntu 24.04 instance (2 GB RAM or more: Chromium + Claude CLI).
# Usage (on the instance):  curl -fsSL <raw url> | bash   or   bash deploy/lightsail-setup.sh
set -euo pipefail

# Docker Engine + compose plugin
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

# 2 GB swap: PDF rendering + builds on small instances
if ! swapon --show | grep -q /swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

# Unattended security updates
sudo apt-get update -y && sudo apt-get install -y unattended-upgrades git sqlite3
echo "Listo. Cierra sesión y vuelve a entrar (grupo docker), luego: cd ~/crm && cp deploy/env.example .env && nano .env && docker compose up -d --build"
