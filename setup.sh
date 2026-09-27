#!/bin/bash
set -e

cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ is required. Install Node.js, then run this script again."
  exit 1
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js 20+ is required. Current: $(node -v)"
  exit 1
fi

write_env() {
  local key="$1"
  printf 'GEMINI_API_KEY=%s\nGEMINI_MODEL=gemini-3.8-flash\nGEMINI_FALLBACK_MODELS=gemini-3.5-flash-lite\nPORT=3000\n' "$key" > .env
  chmod 600 .env 2>/dev/null || true
}

if [ ! -f .env ] || ! grep -q '^GEMINI_API_KEY=.' .env; then
  if [ -n "${GEMINI_API_KEY:-}" ]; then
    write_env "$GEMINI_API_KEY"
  else
    echo "Paste your existing/current Gemini API key, then press Enter:"
    IFS= read -rs GEMINI_KEY
    echo ""
    if [ -z "$GEMINI_KEY" ]; then
      echo "Gemini key is required. Setup stopped."
      exit 1
    fi
    write_env "$GEMINI_KEY"
  fi
fi

npm install --no-audit --no-fund
npm run check
npm run auth:selftest

echo "Running live Gemini Developer API test through official @google/genai SDK..."
npm run gemini:test

echo "Setup complete. Live Gemini test passed."
echo "Run: npm start"
