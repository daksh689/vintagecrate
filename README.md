# VintageCrate

A responsive, polished agentic music player web application. It features an automated AI suggestion engine that extracts your favorite artists from your listening history, fetches recommendations from YouTube dynamically, tracks play counts, handles custom playlists, and supports single-track repeat looping.

## 🎵 Architecture & Tech Stack

- **Frontend**: React + Vite (Vanilla CSS & Lucide Icons). Hosted on **Vercel**.
- **Backend**: Python FastAPI with SQLite database & `yt-dlp` integration. Hosted on **Render**.
- **Storage**: Audio streams and metadata are indexed dynamically.

---

## 🛠️ Deploying to Render (Backend)

1. Create a new **Web Service** on [Render](https://render.com).
2. Connect your repository.
3. Configure the following settings:
   - **Root Directory**: `backend` (or leave empty if building from root and adjust build/start commands)
   - **Environment/Runtime**: `Python`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
4. **Environment Variables**:
   - `PORT`: `8000` (or Render's automatic port)
5. **Persistent Disk (Important!)**:
   - Since Render's file system is ephemeral, you must attach a **Persistent Disk** if you want your downloads (`music_vault/`) and SQLite DB (`music_system.db`) to persist across redeploys.
   - Mount path: `/var/data`
   - Set environment variables to override paths in your code if you move your SQLite and vault folders inside `/var/data`.

---

## ⚡ Deploying to Vercel (Frontend)

1. Create a new project on [Vercel](https://vercel.com).
2. Connect your repository.
3. Configure the project:
   - **Root Directory**: `frontend`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. **Environment Variables**:
   - Add `VITE_API_URL` set to your Render backend web service URL (e.g., `https://vintagecrate-backend.onrender.com/api`).
