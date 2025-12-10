#!/bin/bash

# Function to handle cleanup
cleanup() {
    echo "Stopping background processes..."
    kill $(jobs -p) 2>/dev/null
    exit
}

# Trap SIGINT (Ctrl+C) and EXIT signals
trap cleanup SIGINT EXIT

echo "Starting Backend (Rust)..."
cd backend
cargo run &
BACKEND_PID=$!
cd ..

# Wait a moment for backend to initialize (optional, but helpful logs)
sleep 2

echo "Starting Frontend (Vite)..."
npm run dev &
FRONTEND_PID=$!

echo "Local Dev Environment Running..."
echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"
echo "Press Ctrl+C to stop."

# Wait for both processes
wait $BACKEND_PID $FRONTEND_PID
