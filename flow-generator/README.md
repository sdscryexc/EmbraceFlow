# $FLOW — Become the Current (Full Project)

## Step-by-step (Local)

### 1) Backend
1. Copy your seal video into:
   - `backend/assets/seal.mp4`
2. Run:
```bash
cd backend
npm install
npm start
```
Backend URL: http://localhost:8080

### 2) Frontend
1. Run:
```bash
cd frontend
npm install
npm run dev
```
Open: http://localhost:5173

### 3) Use it
Upload an image → choose mantra → generate → download MP4.

## Deploy
- Backend: Render.com (root dir `backend`, start `npm start`)
- Frontend: Netlify (base dir `frontend`, build `npm run build`, publish `dist`)
- Netlify env var: `VITE_RENDER_URL` = your Render backend URL

## Tune tracking
Edit `backend/server.js` KEYFRAMES (x,y,s,r).

Note: This is a stylized overlay generator (safe). Not a face swap.
