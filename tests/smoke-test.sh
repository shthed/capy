#!/bin/bash
##
# Capy Smoke Test
# Quick and easy test that runs the game and captures screenshots
##

set -e

echo "🚀 Starting Capy smoke test..."
echo ""

# Create artifacts directory
mkdir -p artifacts

# Start http-server in the background
echo "🌐 Starting web server..."
npx http-server -p 8000 -s &
SERVER_PID=$!

# Wait for server to start
sleep 2

# Cleanup function
cleanup() {
  echo ""
  echo "🧹 Cleaning up..."
  kill $SERVER_PID 2>/dev/null || true
}
trap cleanup EXIT

# Function to take screenshot
take_screenshot() {
  local url=$1
  local output=$2
  local width=$3
  local height=$4
  local name=$5
  
  echo "📸 Capturing $name screenshot..."
  
  google-chrome --headless --disable-gpu \
    --window-size=$width,$height \
    --screenshot=$output \
    --hide-scrollbars \
    $url 2>/dev/null
  
  if [ -f "$output" ]; then
    echo "  ✅ Screenshot saved: $output"
  else
    echo "  ❌ Failed to capture screenshot"
    exit 1
  fi
}

# Test 1: Desktop view
echo ""
echo "📱 Testing desktop view (1920x1080)..."
take_screenshot \
  "http://localhost:8000/" \
  "artifacts/game-loaded-desktop.png" \
  "1920" \
  "1080" \
  "desktop"

# Wait a moment
sleep 1

# Test 2: Mobile view
echo ""
echo "📱 Testing mobile view (375x667)..."
take_screenshot \
  "http://localhost:8000/" \
  "artifacts/game-loaded-mobile.png" \
  "375" \
  "667" \
  "mobile"

echo ""
echo "✨ All tests passed! Game loaded successfully."
echo ""
echo "Screenshots captured:"
echo "  • artifacts/game-loaded-desktop.png"
echo "  • artifacts/game-loaded-mobile.png"
echo ""
