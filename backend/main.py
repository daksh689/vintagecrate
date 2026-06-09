from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
import os

# Resolve BASE_DIR as the project root (one level up from backend/)
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

# Prepend local bin folder AND portable Node.js directory to PATH
# so yt-dlp finds the node binary for YouTube signature solving
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
bin_path = os.path.join(BACKEND_DIR, "bin")

# Also look for the full node directory (node-v*-linux-x64/bin)
node_bin_paths = []
if os.path.exists(bin_path):
    node_bin_paths.append(bin_path)
for entry in os.listdir(BACKEND_DIR):
    node_dir_bin = os.path.join(BACKEND_DIR, entry, "bin")
    if entry.startswith("node-") and os.path.isdir(node_dir_bin):
        node_bin_paths.append(node_dir_bin)

if node_bin_paths:
    os.environ["PATH"] = os.pathsep.join(node_bin_paths) + os.pathsep + os.environ.get("PATH", "")
    print(f"[startup] Added to PATH: {node_bin_paths}")

# Verify node is accessible
import shutil
node_location = shutil.which("node")
print(f"[startup] Node.js found at: {node_location}" if node_location else "[startup] WARNING: Node.js NOT found in PATH!")

def resolve_file_path(fp: str) -> str:
    """Handle both absolute and relative file paths from the DB."""
    if os.path.isabs(fp):
        return fp
    # Relative path - resolve from project root
    return os.path.join(BASE_DIR, fp)

from music_manager import (
    get_all_tracks,
    get_track_by_id,
    download_and_index,
    generate_suggestions,
    increment_play_count,
    delete_track,
    search_local_db,
    init_db
)

app = FastAPI(title="AI Music System API")

# Ensure SQLite database is initialized
init_db()

# Allow CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class SearchRequest(BaseModel):
    query: str

@app.get("/api/debug")
def debug_info():
    import shutil, subprocess
    node_path = shutil.which("node")
    ffmpeg_path = shutil.which("ffmpeg")
    node_version = None
    if node_path:
        try:
            node_version = subprocess.check_output([node_path, "--version"], timeout=5).decode().strip()
        except Exception as e:
            node_version = f"error: {e}"
    
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    dir_contents = os.listdir(backend_dir)
    bin_contents = os.listdir(os.path.join(backend_dir, "bin")) if os.path.exists(os.path.join(backend_dir, "bin")) else []
    
    return {
        "node_path": node_path,
        "node_version": node_version,
        "ffmpeg_path": ffmpeg_path,
        "PATH": os.environ.get("PATH", ""),
        "backend_dir": backend_dir,
        "dir_contents": dir_contents,
        "bin_contents": bin_contents,
        "cwd": os.getcwd(),
    }

class SuggestRequest(BaseModel):
    queue_ids: List[int] = []
    track_titles: List[str] = []
    liked_titles: List[str] = []

@app.get("/api/tracks")
def list_tracks():
    return get_all_tracks()

@app.get("/api/tracks/{track_id}")
def get_track(track_id: int):
    track = get_track_by_id(track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return track

@app.post("/api/search")
def search_and_download(req: SearchRequest):
    # 1. Check local library first
    local = search_local_db(req.query)
    if local:
        local["from_library"] = True
        return local

    # 2. Not found locally — download from YouTube
    try:
        track_id = download_and_index(req.query)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Download engine error: {str(e)}")
    if not track_id:
        raise HTTPException(status_code=404, detail="Could not find or download the track. YouTube may be blocking this server's IP.")
    track = get_track_by_id(track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track indexed but not found in DB.")
    track["from_library"] = False
    return track

@app.post("/api/suggest")
def suggest_tracks(req: SuggestRequest):
    suggestions = generate_suggestions(req.queue_ids, req.track_titles, req.liked_titles)
    return suggestions

@app.get("/api/stream/{track_id}")
def stream_audio(track_id: int, request: Request):
    track = get_track_by_id(track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    
    # Resolve path (DB may store relative OR absolute paths)
    file_path = resolve_file_path(track["file_path"])
    
    # Fallback for the double .mp3 bug
    if not os.path.exists(file_path) and os.path.exists(file_path + ".mp3"):
        file_path = file_path + ".mp3"
        
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail=f"Audio file missing from disk: {file_path}")
    
    increment_play_count(track_id)
    return FileResponse(file_path, media_type="audio/mpeg", headers={"Accept-Ranges": "bytes"})

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
