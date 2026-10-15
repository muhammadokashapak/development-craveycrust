#!/bin/sh
set -e

echo "⏳ Checking database schema and running migrations..."
npx prisma db push --skip-generate || echo "⚠️ Prisma db push warning, continuing..."

echo "🌱 Ensuring initial database seeds..."
node prisma/seed.js || echo "⚠️ Seed skipped or already exists."

echo "🚀 Starting Cravey Bot Server..."
exec node bot.js
