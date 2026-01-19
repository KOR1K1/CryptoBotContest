# 🚀 Quick Start Guide

## Prerequisites

- ✅ **Node.js >= 18.0.0** - [Download](https://nodejs.org/)
- ✅ **Docker Desktop** - [Download](https://www.docker.com/products/docker-desktop/)
  - **Windows**: Docker Desktop for Windows (includes Docker Compose)
  - **Mac**: Docker Desktop for Mac (includes Docker Compose)
  - **Linux**: Docker Engine + Docker Compose plugin
- ✅ **Git** (optional, if cloning from repository)

> 💡 **Windows Users**: Docker Desktop for Windows fully supports Docker Compose. This project uses standard Docker Compose configuration that works on Windows, Mac, and Linux.

## One-Command Setup

```bash
# 0. Make sure Docker Desktop is running!
#    - Windows: Check system tray for Docker icon (🐳)
#    - Mac: Check menu bar for Docker icon
#    - Linux: Make sure Docker daemon is running: sudo systemctl start docker

# 1. Install dependencies
npm install

# 2. Start everything (MongoDB + App + UI)
docker-compose up --build
```

That's it! 🎉

The first run will:
- Download MongoDB image (~200MB)
- Build the backend and frontend applications
- Initialize MongoDB replica set
- Start the backend API on port 3000
- Start the React frontend on port 3001

**Wait for:** 
- Backend: `Application is running on: http://localhost:3000`
- Frontend: `Local: http://localhost:3001`

## Access the Application

- **Frontend UI (React)**: http://localhost:3001
- **Backend API Health**: http://localhost:3000/health
- **Backend API Base**: http://localhost:3000

## First Steps in the UI

1. **Create a User:**
   - Click "New User" button
   - Enter username (e.g., "alice")
   - Click "Create"

2. **Create a Gift** (via API or seed script):
```bash
curl -X POST http://localhost:3000/gifts \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Golden Gift",
    "description": "A special gift",
    "imageUrl": "https://example.com/gift.jpg",
    "basePrice": 1000,
    "totalSupply": 10
  }'
```

3. **Create an Auction:**
```bash
curl -X POST http://localhost:3000/auctions \
  -H "Content-Type: application/json" \
  -d '{
    "giftId": "<gift-id-from-step-2>",
    "totalGifts": 2,
    "totalRounds": 2,
    "roundDurationMs": 60000,
    "minBid": 100
  }'
```

4. **Start the Auction:**
```bash
curl -X POST http://localhost:3000/auctions/<auction-id>/start
```

5. **Use the UI:**
   - Refresh the auctions page
   - Click on the auction to see details
   - Place bids using the UI

## Environment Variables

The `.env` file is already created from `.env.example` with sensible defaults:

```env
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://localhost:27017/auction_db
LOG_LEVEL=info
```

**You don't need to change anything** for local development!

## Troubleshooting

### MongoDB Connection Issues

If you see connection errors:
1. Make sure Docker Desktop is running (Windows/Mac) or Docker daemon is running (Linux)
2. Check if MongoDB container is healthy: `docker ps`
3. Restart: `docker-compose down && docker-compose up`

### Windows-Specific Notes

- **Docker Desktop MUST be running** before running `docker-compose up`
  - Check system tray (bottom-right) for Docker Desktop icon 🐳
  - If not running: Start Docker Desktop from Start Menu
  - Wait until icon shows "Docker Desktop is running"
- Use **PowerShell** or **Command Prompt** - both work fine
- Paths in `docker-compose.yml` use relative paths (work on Windows)
- If you see permission errors, run PowerShell/CMD as Administrator (usually not needed)
- Line endings in `.sh` files are handled automatically by Docker on Windows

### Common Docker Desktop Issues

**Error: `open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`**
- **Solution**: Docker Desktop is not running. Start Docker Desktop and wait for it to fully initialize (check system tray icon).

### Port 3000 Already in Use

Change the port in `.env`:
```env
PORT=3001
```
Then access UI at: http://localhost:3001

### MongoDB Replica Set Not Initialized

This should happen automatically, but if you see transaction errors:
```bash
docker-compose exec mongo mongosh --eval "rs.initiate({_id:'rs0',members:[{_id:0,host:'mongo:27017'}]})"
```

## Stop the Application

```bash
# Stop containers (keeps data)
docker-compose stop

# Stop and remove containers (keeps data)
docker-compose down

# Stop and remove everything including data
docker-compose down -v
```

## Development Mode (without Docker)

If you have MongoDB installed locally:

```bash
# 1. Start MongoDB with replica set
mongod --replSet rs0 --dbpath /path/to/data

# 2. In another terminal, initialize replica set
mongosh
rs.initiate({_id: "rs0", members: [{_id: 0, host: "localhost:27017"}]})

# 3. Start the app
npm run start:dev
```

**Note:** Docker Compose is recommended for easier setup and consistency.

## Need Help?

- Check `README.md` for detailed documentation
- Review `docs/SPEC.md` for product specification
- See `docs/ASSUMPTIONS.md` for implementation details
