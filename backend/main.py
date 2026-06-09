from fastapi import FastAPI, HTTPException, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
import os

# Resolve BASE_DIR as the project root (one level up from backend/)
BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

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
    search_local_db
)

app = FastAPI(title="AI Music System API")

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
    track_id = download_and_index(req.query)
    if not track_id:
        raise HTTPException(status_code=404, detail="Could not find or download the track.")
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
