# 🎧 VintageCrate

VintageCrate is a stunning, AI-powered music streaming application. It features a rich, analog-inspired interface combined with modern web technologies. 

With VintageCrate, you can search for any song, play it instantly, and let the smart suggestion engine curate the perfect queue based on your listening habits and liked tracks.

![VintageCrate Preview](https://vintagecrate.vercel.app/favicon.svg)

## ✨ Features

- **Hybrid Streaming Engine**: Streams audio directly from the backend server or falls back to seamless YouTube IFrame API streaming to bypass datacenter IP blocks.
- **Smart AI Suggestions**: Analyzes your current queue, play history, and liked songs to automatically suggest and queue related tracks.
- **Analog Aesthetics**: A highly polished UI featuring a spinning vinyl record, dynamic equalizers, glassmorphism, and a sleek dark/light mode toggle.
- **Persistent Library**: Save your favorite tracks to your "Liked Songs" or create custom playlists. All user data is instantly persisted using `localStorage`.
- **Responsive Design**: Carefully crafted to look beautiful on both desktop and mobile screens.

## 🎵 Architecture & Tech Stack

- **Frontend**: React + Vite (Vanilla CSS & Lucide Icons). Hosted on **Vercel**.
- **Backend**: Python FastAPI with SQLite database & `yt-dlp` / `ytmusicapi` integration. Hosted on **Render**.
- **Storage**: Audio streams and metadata are indexed dynamically.

## 🚀 Running Locally

Want to run VintageCrate on your own machine? It's split into a Python backend and a React frontend.

### 1. Backend Setup
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows use `venv\Scripts\activate`
pip install -r requirements.txt

# Run the FastAPI server (starts on http://localhost:8000)
uvicorn main:app --reload
```

### 2. Frontend Setup
```bash
cd frontend
npm install

# Create a .env file and point it to your local backend
echo "VITE_API_URL=http://localhost:8000/api" > .env

# Run the Vite development server
npm run dev
```

## 📜 License

MIT License. Feel free to use, modify, and distribute as you see fit!
