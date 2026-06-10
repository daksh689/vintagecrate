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
    search_youtube_only,
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
def debug_info(query: str = None):
    import shutil, subprocess
    import yt_dlp
    
    node_path = shutil.which("node")
    ffmpeg_path = shutil.which("ffmpeg")
    node_version = None
    if node_path:
        try:
            node_version = subprocess.check_output([node_path, "--version"], timeout=5).decode().strip()
        except Exception as e:
            node_version = f"error: {e}"
    
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    
    debug_data = {
        "node_path": node_path,
        "node_version": node_version,
        "ffmpeg_path": ffmpeg_path,
    }

    if query:
        from ytmusicapi import YTMusic
        import yt_dlp
        
        # Test ytmusicapi
        try:
            ytmusic = YTMusic()
            search_results = ytmusic.search(query, filter="songs")
            debug_data["ytmusic_test"] = f"Found {len(search_results)} results"
            debug_data["ytmusic_first_result"] = search_results[0] if search_results else None
            
            if search_results:
                video_id = search_results[0].get('videoId')
                # Test yt-dlp with the video_id
                ydl_opts = {
                    'quiet': False,
                    'extract_flat': True,
                    'socket_timeout': 10,
                    'extractor_args': {'youtube': ['player_client=android,ios']},
                }
                try:
                    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                        results = ydl.extract_info(f"https://music.youtube.com/watch?v={video_id}", download=False)
                        debug_data["yt_dlp_extract_test"] = "Success"
                except Exception as e:
                    debug_data["yt_dlp_extract_error"] = str(e)
                    
        except Exception as e:
            debug_data["ytmusic_error"] = str(e)
            
    return debug_data

class SuggestRequest(BaseModel):
    queue_ids: List[int] = []
    track_titles: List[str] = []
    liked_titles: List[str] = []
    liked_tracks: List[dict] = []

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

    # 2. Try downloading from YouTube (may fail on datacenter IPs)
    try:
        track_id = download_and_index(req.query)
        if track_id:
            track = get_track_by_id(track_id)
            if track:
                track["from_library"] = False
                return track
    except Exception as e:
        print(f"[search] Download failed: {e}, falling back to YouTube streaming")

    # 3. Fallback: return YouTube video ID for client-side playback
    yt_info = search_youtube_only(req.query)
    if yt_info:
        return yt_info

    raise HTTPException(status_code=404, detail="Could not find the track.")

@app.post("/api/suggest")
def suggest_tracks(req: SuggestRequest):
    suggestions = generate_suggestions(req.queue_ids, req.track_titles, req.liked_titles, req.liked_tracks)
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
