# Fog Chess - Deployment Guide

## Project Structure
```
fog-chess/
├── server/          ← Deploy to Railway or Render
│   ├── index.js
│   ├── chessLogic.js
│   └── package.json
└── client/          ← Deploy to Vercel
    ├── src/
    ├── public/
    └── package.json
```

---

## Step 1: Deploy the Server (Railway - recommended)

1. Push the entire `fog-chess` folder to a GitHub repo
2. Go to https://railway.app and sign in with GitHub
3. Click **New Project → Deploy from GitHub repo**
4. Select your repo, set the **root directory** to `server`
5. Railway auto-detects Node.js and runs `npm start`
6. Once deployed, copy your Railway URL (e.g. `https://fog-chess-server.up.railway.app`)

### Alternative: Render
1. Go to https://render.com → New → Web Service
2. Connect your GitHub repo, set root to `server`
3. Build command: `npm install`
4. Start command: `node index.js`

---

## Step 2: Deploy the Client (Vercel)

1. Go to https://vercel.com → New Project → Import from GitHub
2. Set root directory to `client`
3. Add environment variable:
   - Key: `REACT_APP_SERVER_URL`
   - Value: your Railway/Render server URL (from Step 1)
4. Deploy — Vercel handles the React build automatically
5. Share the Vercel URL with your friend

---

## Step 3: Play

1. Player 1 opens the Vercel URL → clicks **Create Game** → copies the Game ID
2. Player 2 opens the same URL → pastes the Game ID → clicks **Join**
3. Both players select their true king in secret
4. Game begins — white moves first

---

## Local Development

### Terminal 1 - Server:
```bash
cd fog-chess/server
npm install
npm run dev    # requires: npm install -g nodemon
# or: node index.js
```

### Terminal 2 - Client:
```bash
cd fog-chess/client
npm install
npm start
```

Open http://localhost:3000 in two browser windows to test locally.
The client proxies API calls to localhost:3001 automatically.
