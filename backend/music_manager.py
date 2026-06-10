import os
import sqlite3
import yt_dlp
import re
import random
import threading
from collections import Counter

# Configuration
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_NAME = os.path.join(BASE_DIR, "music_system.db")
SAVE_DIR = os.path.join(BASE_DIR, "music_vault")

if not os.path.exists(SAVE_DIR):
    os.makedirs(SAVE_DIR)

db_lock = threading.Lock()

def get_db_connection():
    conn = sqlite3.connect(DB_NAME, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with db_lock:
        conn = get_db_connection()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS tracks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT UNIQUE,
                file_path TEXT,
                play_count INTEGER DEFAULT 0
            )
        """)
        conn.commit()
        conn.close()

def search_local_db(query: str):
    with db_lock:
        conn = get_db_connection()
        # Exact match first
        match = conn.execute("SELECT id FROM tracks WHERE LOWER(title) = ?", (query.lower(),)).fetchone()
        if not match:
            # Partial match
            match = conn.execute("SELECT id FROM tracks WHERE LOWER(title) LIKE ? ORDER BY length(title) ASC LIMIT 1", ('%' + query.lower() + '%',)).fetchone()
        conn.close()
    if match:
        return get_track_by_id(match["id"])
    return None

import re

def clean_title(title):
    t = re.sub(r'\[.*?\]|\(.*?\)', '', title)
    t = re.sub(r'\b(official|video|audio|lyrical|full song|hd|4k|music video)\b', '', t, flags=re.IGNORECASE)
    t = re.sub(r'[|｜-]', ' ', t)
    return ' '.join(t.split()).lower().strip()

def download_and_index(search_query: str):
    init_db()

    # 1. Search using ytmusicapi (fast and avoids bot detection blocks on Render)
    from ytmusicapi import YTMusic
    ytmusic = YTMusic()
    try:
        search_results = ytmusic.search(search_query, filter="songs")
    except Exception as e:
        print(f"[ytmusicapi] Search error: {e}")
        return None

    if not search_results:
        print(f"[ytmusicapi] No results found for '{search_query}'")
        return None

    # Find the best valid result (typically the first one)
    target_video_id = None
    target_title = None
    for result in search_results:
        duration_seconds = result.get('duration_seconds', 0)
        if duration_seconds and duration_seconds > 360:
            continue
        
        target_video_id = result.get('videoId')
        if not target_video_id:
            continue
            
        target_title = result.get('title', '')
        break
        
    if not target_video_id:
        print(f"[ytmusicapi] No valid tracks found under 6 minutes for '{search_query}'")
        return None

    c_title = clean_title(target_title)

    # 2. Check if we already have this specific video downloaded
    with db_lock:
        conn = get_db_connection()
        row = conn.execute("SELECT id FROM tracks WHERE file_path LIKE ?", (f"%{target_video_id}%",)).fetchone()
        all_tracks = conn.execute("SELECT id, title FROM tracks").fetchall()
        conn.close()

    if row:
        return row[0]
        
    found_dup_id = None
    if c_title and len(c_title) > 2:
        for t_id, t_title in all_tracks:
            if c_title == clean_title(t_title):
                found_dup_id = t_id
                break
    
    if found_dup_id:
        return found_dup_id

    # 3. Download using Piped API (bypasses YouTube datacenter IP blocks)
    video_id = target_video_id
    safe_title = yt_dlp.utils.sanitize_filename(target_title)
    filename_base = f"{safe_title} [{video_id}]"
    file_path_base = os.path.abspath(os.path.join(SAVE_DIR, filename_base))
    final_file_path = f"{file_path_base}.mp3"

    import requests
    import subprocess

    PIPED_INSTANCES = [
        "https://pipedapi.kavin.rocks",
        "https://pipedapi.adminforge.de",
        "https://api.piped.yt",
    ]

    downloaded = False

    # --- Method 1: Piped API ---
    for piped_url in PIPED_INSTANCES:
        try:
            print(f"[piped] Trying {piped_url} for {video_id}...")
            resp = requests.get(f"{piped_url}/streams/{video_id}", timeout=15)
            if resp.status_code != 200:
                print(f"[piped] {piped_url} returned status {resp.status_code}")
                continue

            data = resp.json()
            audio_streams = data.get("audioStreams", [])
            if not audio_streams:
                print(f"[piped] No audio streams from {piped_url}")
                continue

            # Pick the best audio stream (highest bitrate)
            audio_streams.sort(key=lambda s: s.get("bitrate", 0), reverse=True)
            best_stream = audio_streams[0]
            stream_url = best_stream.get("url")

            if not stream_url:
                continue

            print(f"[piped] Downloading audio ({best_stream.get('bitrate', '?')} bps, {best_stream.get('mimeType', '?')})...")

            # Download the audio stream
            temp_file = f"{file_path_base}.tmp_audio"
            audio_resp = requests.get(stream_url, timeout=120, stream=True)
            audio_resp.raise_for_status()

            with open(temp_file, 'wb') as f:
                for chunk in audio_resp.iter_content(chunk_size=8192):
                    f.write(chunk)

            # Convert to MP3 using ffmpeg
            print(f"[ffmpeg] Converting to MP3...")
            result = subprocess.run(
                ["ffmpeg", "-y", "-i", temp_file, "-vn", "-acodec", "libmp3lame", "-q:a", "2", final_file_path],
                capture_output=True, text=True, timeout=120
            )

            # Clean up temp file
            if os.path.exists(temp_file):
                os.remove(temp_file)

            if result.returncode == 0 and os.path.exists(final_file_path):
                print(f"[piped] Successfully downloaded and converted: {safe_title}")
                downloaded = True
                break
            else:
                print(f"[ffmpeg] Conversion failed: {result.stderr[:200]}")

        except Exception as e:
            print(f"[piped] Error with {piped_url}: {e}")
            continue

    # --- Method 2: yt-dlp fallback ---
    if not downloaded:
        print(f"[yt-dlp] Piped failed, trying yt-dlp as fallback...")
        ydl_opts_down = {
            'format': 'bestaudio/best',
            'outtmpl': f"{file_path_base}.%(ext)s",
            'postprocessors': [{'key': 'FFmpegExtractAudio', 'preferredcodec': 'mp3', 'preferredquality': '192'}],
            'extractor_args': {'youtube': ['player_client=web_creator,mweb']},
            'geo_bypass': True,
            'socket_timeout': 30,
            'retries': 3,
            'http_headers': {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
            },
        }
        cookies_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cookies.txt")
        if not os.path.exists(cookies_path):
            cookies_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "www.youtube.com_cookies.txt")
        if os.path.exists(cookies_path):
            ydl_opts_down['cookiefile'] = cookies_path

        try:
            with yt_dlp.YoutubeDL(ydl_opts_down) as ydl_down:
                download_url = f"https://music.youtube.com/watch?v={video_id}"
                print(f"[yt-dlp] Downloading from: {download_url}")
                ydl_down.download([download_url])
                downloaded = True
        except Exception as e:
            print(f"[yt-dlp] Fallback also failed: {e}")

    if not downloaded:
        raise Exception(f"All download methods failed for video {video_id}")

    # 4. Index in database
    with db_lock:
        conn = get_db_connection()
        cursor = conn.cursor()
        try:
            cursor.execute("INSERT INTO tracks (title, file_path, play_count) VALUES (?, ?, 0)", (safe_title, final_file_path))
            conn.commit()
            new_id = cursor.lastrowid
        except sqlite3.IntegrityError:
            new_id = None
            print(f"Track already exists in DB: {safe_title}")
        conn.close()
        
    if new_id:
        return new_id
    return None

def search_youtube_only(search_query: str):
    """Search YouTube Music and return video info without downloading.
    Used as fallback when server-side download fails."""
    from ytmusicapi import YTMusic
    ytmusic = YTMusic()
    try:
        search_results = ytmusic.search(search_query, filter="songs")
    except Exception as e:
        print(f"[ytmusicapi] Search error: {e}")
        return None

    if not search_results:
        return None

    for result in search_results:
        duration_seconds = result.get('duration_seconds', 0)
        if duration_seconds and duration_seconds > 360:
            continue
        video_id = result.get('videoId')
        if not video_id:
            continue
        title = result.get('title', search_query)
        artists = result.get('artists', [])
        artist = artists[0].get('name', '') if artists else ''
        return {
            "youtube_id": video_id,
            "title": f"{artist} - {title}" if artist else title,
            "is_youtube": True,
        }
    return None

def get_all_tracks():
    init_db()
    with db_lock:
        conn = get_db_connection()
        tracks = conn.execute("SELECT id, title, play_count FROM tracks ORDER BY id DESC").fetchall()
        conn.close()
    return [{"id": t["id"], "title": t["title"], "play_count": t["play_count"]} for t in tracks]

def get_track_by_id(track_id: int):
    with db_lock:
        conn = get_db_connection()
        track = conn.execute("SELECT id, title, file_path, play_count FROM tracks WHERE id = ?", (track_id,)).fetchone()
        conn.close()
    if track:
        return {"id": track["id"], "title": track["title"], "file_path": track["file_path"], "play_count": track["play_count"]}
    return None

def increment_play_count(track_id: int):
    with db_lock:
        conn = get_db_connection()
        conn.execute("UPDATE tracks SET play_count = play_count + 1 WHERE id = ?", (track_id,))
        conn.commit()
        conn.close()

def delete_track(track_id: int):
    track = get_track_by_id(track_id)
    if track:
        with db_lock:
            conn = get_db_connection()
            conn.execute("DELETE FROM tracks WHERE id = ?", (track_id,))
            conn.commit()
            conn.close()
        # Optionally remove file
        if os.path.exists(track["file_path"]):
            try:
                os.remove(track["file_path"])
            except:
                pass
        return True
    return False

def extract_artist_from_title(title: str) -> str:
    """Extract artist name from track title using the same logic as frontend."""
    import re
    # Match "Artist - Song" or "Artist – Song"
    m = re.match(r'^(.+?)\s[-–~]\s', title)
    if m:
        return re.sub(r'\[.*?\]', '', m.group(1)).strip()
    # Match "Artist | Song"
    p = title.find('|')
    if p > 0:
        return title[:p].strip()
    return ''

def get_favorite_artist(track_titles: list, liked_titles: list) -> str:
    """Find the most frequent artist across liked songs (weighted 3x) + library."""
    from collections import Counter
    artist_counts = Counter()
    
    # Liked songs count 3x more
    for title in liked_titles:
        artist = extract_artist_from_title(title)
        if artist:
            artist_counts[artist] += 3
    
    # Library tracks count 1x
    for title in track_titles:
        artist = extract_artist_from_title(title)
        if artist:
            artist_counts[artist] += 1
    
    if not artist_counts:
        return ''
    
    return artist_counts.most_common(1)[0][0]

RANDOM_SEARCHES = [
    "Michael Jackson official music video",
    "Aditya Rikhari official music video",
    "Sunidhi Chauhan official music video",
    "Prateek Kuhad official music video",
    "Karan Aujla official music video",
    "Diljit Dosanjh official music video",
    "King official music video",
    "Seedhe Maut official music video",
    "Talwiinder official music video",
    "The Weeknd official music video",
    "Post Malone official music video",
    "Bruno Mars official music video",
    "Anuv Jain official music video",
    "Mitraz official music video",
    "Zaeden official music video",
    "Raftaar official music video",
    "Mohit Chauhan official music video",
    "Shreya Ghoshal official music video",
    "Krsna official music video",
    "Divine official music video",
    "Daas official music video",
    "Dua Lipa official music video",
    "Coldplay official music video",
]

def generate_suggestions(current_queue_ids: list, track_titles: list = [], liked_titles: list = []):
    """
    Returns 10 suggested tracks:
    - 5 from local library (weighted by play_count)
    - 2 from favorite artist (fetched from YouTube)
    - 3 random popular songs (fetched from YouTube)
    """
    all_tracks = get_all_tracks()
    suggestions = []

    # ── Part 1: 5 from library ──
    if all_tracks:
        available_pool = [t for t in all_tracks if t["id"] not in current_queue_ids]
        if not available_pool:
            available_pool = all_tracks

        weighted_pool = [t for t in available_pool for _ in range(t["play_count"] + 1)]
        random.shuffle(weighted_pool)
        seen = set()
        for track in weighted_pool:
            if track["id"] not in seen:
                seen.add(track["id"])
                suggestions.append(track)
            if len(suggestions) >= 5:
                break

    # ── Part 2: 2 from favorite artist (YouTube) ──
    fav_artist = get_favorite_artist(track_titles, liked_titles)
    if fav_artist:
        artist_queries = [
            f"{fav_artist} latest song",
            f"{fav_artist} best hits",
            f"{fav_artist} new song 2024",
        ]
        fetched_artist = 0
        for query in artist_queries:
            if fetched_artist >= 2:
                break
            try:
                track_id = download_and_index(query)
                if track_id:
                    track = get_track_by_id(track_id)
                    if track and track["id"] not in [t["id"] for t in suggestions]:
                        suggestions.append(track)
                        fetched_artist += 1
            except Exception as e:
                print(f"Artist fetch error: {e}")

    # ── Part 3: 3 random popular songs (YouTube) ──
    random_queries = random.sample(RANDOM_SEARCHES, min(5, len(RANDOM_SEARCHES)))
    fetched_random = 0
    for query in random_queries:
        if fetched_random >= 3:
            break
        try:
            track_id = download_and_index(query)
            if track_id:
                track = get_track_by_id(track_id)
                if track and track["id"] not in [t["id"] for t in suggestions]:
                    suggestions.append(track)
                    fetched_random += 1
        except Exception as e:
            print(f"Random fetch error: {e}")

    return suggestions
