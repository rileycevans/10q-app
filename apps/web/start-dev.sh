#!/bin/bash
# Kill any existing Next.js processes
pkill -9 -f "next dev" 2>/dev/null
pkill -9 -f "node.*next" 2>/dev/null

# Clear ports
lsof -ti:3000,3001 | xargs kill -9 2>/dev/null

# Remove lock files
rm -rf .next/dev/lock .next/dev/*.pid 2>/dev/null

# Start dev server
npm run dev
