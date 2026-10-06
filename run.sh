#!/usr/bin/env bash
set -e

echo "===================================================="
echo " Starting CareBridge Production-Grade Healthcare System"
echo "===================================================="

# Check Python and Node
if ! command -v python3 &> /dev/null; then
    echo "Error: python3 is required but not installed."
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "Error: node/npm is required but not installed."
    exit 1
fi

# Setup backend venv if not exists
cd "$(dirname "$0")/backend"
if [ ! -d "venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv venv
fi

echo "Installing backend dependencies..."
./venv/bin/pip install --quiet --upgrade pip
./venv/bin/pip install --quiet -r requirements.txt

# Start backend in background
echo "Starting FastAPI backend on 0.0.0.0:8000..."
./venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# Setup frontend
cd ../frontend
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install --silent
fi

echo "Starting Vite frontend on 0.0.0.0:5173..."
npm run dev -- --host 0.0.0.0 &
FRONTEND_PID=$!

echo "===================================================="
echo " CareBridge is running successfully!"
echo "----------------------------------------------------"
echo " Doctor Dashboard (Login: doctor / carebridge2026):"
echo "   http://localhost:5173/#doctor"
echo " Patient Portal:"
echo "   http://localhost:5173/#patient"
echo " Live Anonymous Queue:"
echo "   http://localhost:5173/#queue"
echo "===================================================="
echo "Press Ctrl+C to stop both servers."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" EXIT
wait
