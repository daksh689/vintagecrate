import { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Pause, SkipForward, SkipBack, Search, Music, Loader2,
         Volume2, VolumeX, CheckCircle, ChevronRight, ChevronLeft, Plus, PanelLeftClose, Heart, Sun, Moon, Sparkles, Repeat } from 'lucide-react';
import './index.css';

const API = import.meta.env.VITE_API_URL || 'https://vintagecrate.onrender.com/api';

const clean = (t) => t
  .replace(/\[.*?\]/g, '').replace(/\(.*?\)/g, '')
  .replace(/\b(official|video|audio|lyrical|full song|hd|4k|music video)\b/gi, '')
  .replace(/[|｜]/g, '·').replace(/\s+/g, ' ').trim();

const getArtist = (t) => {
  if (!t) return '';
  const m = t.match(/^(.+?)\s[-–~]\s/);
  if (m) return m[1].replace(/\[.*?\]/g,'').trim();
  const p = t.search(/[|｜]/);
  if (p > 0) return t.slice(0, p).trim();
  return '';
};

const getSong = (t) => {
  if (!t) return 'Unknown Title';
  const c = clean(t);
  const m = c.match(/^.+?\s[–~-]\s(.+)/);
  return (m ? m[1] : c).trim();
};

const fmt = (s) => {
  if (!s || isNaN(s)) return '0:00';
  return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
};

const isHindi = (s) => /[\u0900-\u097F]/.test(s);

const trackKey = (t) => t ? (t.id || t.youtube_id) : null;

export default function App() {
  const [tracks, setTracks]       = useState([]);
  const [current, setCurrent]     = useState(null);
  const [playing, setPlaying]     = useState(false);
  const [buffering, setBuffering] = useState(false);
  const [immersive, setImmersive] = useState(false);
  const [currentView, setCurrentView] = useState('home');
  const [vol, setVol]             = useState(0.8);
  const [progress, setProgress]   = useState(0);
  const [dur, setDur]             = useState(0);
  const [query, setQuery]         = useState('');
  const [searching, setSearching] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [toast, setToast]         = useState(null);
  const [upNext, setUpNext]       = useState([]);
  const [ctxMenu, setCtxMenu]     = useState(null);
  const [liked, setLiked]         = useState(() => {
    try {
      const saved = localStorage.getItem('vintagecrate_liked');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [playlists, setPlaylists] = useState(() => {
    try {
      const saved = localStorage.getItem('vintagecrate_playlists');
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
  const [activeTab, setActiveTab] = useState('library'); // 'library' | 'liked' | 'pl:NAME'
  const [isLightMode, setIsLightMode] = useState(false);
  const [isRepeat, setIsRepeat]   = useState(false);
  const audioRef = useRef(null);
  const playIdRef = useRef(0);
  const ytPlayerRef = useRef(null);
  const ytReadyRef = useRef(false);
  const ytIntervalRef = useRef(null);
  const nextRef = useRef(null);

  // Load YouTube IFrame API
  useEffect(() => {
    if (window.YT) { ytReadyRef.current = true; return; }
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => { ytReadyRef.current = true; };
  }, []);

  useEffect(() => { loadTracks(); }, []);
  useEffect(() => {
    try { localStorage.setItem('vintagecrate_liked', JSON.stringify(liked)); } catch {}
  }, [liked]);
  useEffect(() => {
    try { localStorage.setItem('vintagecrate_playlists', JSON.stringify(playlists)); } catch {}
  }, [playlists]);
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = vol;
    if (ytPlayerRef.current && typeof ytPlayerRef.current.setVolume === 'function') {
      ytPlayerRef.current.setVolume(vol * 100);
    }
  }, [vol]);
  useEffect(() => {
    if (isLightMode) { document.body.classList.add('light-mode'); }
    else { document.body.classList.remove('light-mode'); }
  }, [isLightMode]);

  const loadTracks = async () => {
    try {
      const r = await fetch(`${API}/tracks`);
      const data = await r.json();
      
      const unique = [];
      const seen = new Set();
      for (const t of data) {
        const cleanTitle = getSong(t.title).toLowerCase();
        if (!seen.has(cleanTitle)) {
          seen.add(cleanTitle);
          unique.push(t);
        }
      }
      setTracks(unique);
    } catch {}
  };

  const sorted = [...tracks].sort((a, b) => {
    const ha = isHindi(a.title), hb = isHindi(b.title);
    if (ha && !hb) return -1; if (!ha && hb) return 1;
    return getSong(a.title).localeCompare(getSong(b.title));
  });

  const activeList = activeTab === 'liked' ? liked : activeTab.startsWith('pl:') ? (playlists[activeTab.slice(3)] || []) : sorted;

  const stopYtInterval = useCallback(() => {
    if (ytIntervalRef.current) { clearInterval(ytIntervalRef.current); ytIntervalRef.current = null; }
  }, []);

  const playTrack = useCallback(async (track) => {
    const playId = ++playIdRef.current;
    
    // Lift tonearm and mechanically wait for it to return (600ms transition)
    setPlaying(false);
    stopYtInterval();
    await new Promise(r => setTimeout(r, 600));
    
    // If user clicked another track while waiting, abort this one
    if (playId !== playIdRef.current) return;

    setCurrent(track);
    setBuffering(true);
    setImmersive(true);

    // --- YouTube track ---
    if (track.is_youtube && track.youtube_id) {
      const a = audioRef.current;
      if (a) { a.pause(); a.src = ''; }

      const startYt = (videoId) => {
        if (ytPlayerRef.current) {
          ytPlayerRef.current.destroy();
          ytPlayerRef.current = null;
        }
        ytPlayerRef.current = new window.YT.Player('yt-player-hidden', {
          height: '1', width: '1',
          videoId: videoId,
          playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, modestbranding: 1, rel: 0 },
          events: {
            onReady: (ev) => {
              ev.target.setVolume(vol * 100);
              ev.target.playVideo();
            },
            onStateChange: (ev) => {
              if (playId !== playIdRef.current) return;
              if (ev.data === window.YT.PlayerState.PLAYING) {
                setBuffering(false); setPlaying(true);
                stopYtInterval();
                ytIntervalRef.current = setInterval(() => {
                  if (ytPlayerRef.current && typeof ytPlayerRef.current.getCurrentTime === 'function') {
                    setProgress(ytPlayerRef.current.getCurrentTime());
                    setDur(ytPlayerRef.current.getDuration() || 0);
                  }
                }, 500);
              } else if (ev.data === window.YT.PlayerState.ENDED) {
                stopYtInterval();
                if (nextRef.current) nextRef.current();
              } else if (ev.data === window.YT.PlayerState.BUFFERING) {
                setBuffering(true);
              }
            },
            onError: () => {
              if (playId === playIdRef.current) { setBuffering(false); setPlaying(false); }
            },
          },
        });
      };

      // Wait for YouTube API to be ready
      if (ytReadyRef.current) {
        startYt(track.youtube_id);
      } else {
        const check = setInterval(() => {
          if (ytReadyRef.current) { clearInterval(check); startYt(track.youtube_id); }
        }, 200);
        setTimeout(() => clearInterval(check), 10000);
      }
      return;
    }

    // --- Server-hosted track ---
    if (ytPlayerRef.current) { ytPlayerRef.current.destroy(); ytPlayerRef.current = null; }
    stopYtInterval();

    const a = audioRef.current;
    if (!a) return;
    a.pause();
    a.src = `${API}/stream/${track.id}?_=${Date.now()}`;
    a.play()
      .then(() => { 
        if (playId === playIdRef.current) {
          setBuffering(false); 
          setPlaying(true); 
        }
      })
      .catch((e) => { 
        if (playId === playIdRef.current) {
          console.error('play error', e); 
          setBuffering(false); 
          setPlaying(false); 
        }
      });
  }, [vol, stopYtInterval]);

  const toggle = useCallback(() => {
    if (!current) return;
    // YouTube track
    if (current.is_youtube && ytPlayerRef.current) {
      if (playing) {
        ytPlayerRef.current.pauseVideo();
        setPlaying(false); setImmersive(false);
      } else {
        ytPlayerRef.current.playVideo();
        setPlaying(true); setImmersive(true);
      }
      return;
    }
    // Server track
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
      setImmersive(false);
    } else {
      a.play().then(() => { setPlaying(true); setImmersive(true); }).catch(() => {});
    }
  }, [current, playing]);

  const next = useCallback(() => {
    if (isRepeat && current) {
      playTrack(current);
      return;
    }
    if (upNext.length > 0) {
      const nextTrack = upNext[0];
      setUpNext(prev => prev.slice(1));
      playTrack(nextTrack);
      return;
    }
    if (!activeList.length) return;
    const idx = current ? activeList.findIndex(t => trackKey(t) === trackKey(current)) : -1;
    playTrack(activeList[(idx + 1) % activeList.length]);
  }, [activeList, current, playTrack, upNext, isRepeat]);

  useEffect(() => { nextRef.current = next; }, [next]);

  const prev = useCallback(() => {
    if (!activeList.length) return;
    const idx = current ? activeList.findIndex(t => trackKey(t) === trackKey(current)) : 0;
    playTrack(activeList[(idx - 1 + activeList.length) % activeList.length]);
  }, [activeList, current, playTrack]);

  const performSearch = async (action, searchVal = null) => {
    const q = (searchVal !== null ? searchVal : query).trim();
    if (!q || searching) return;
    setSearching(true);
    try {
      const r = await fetch(`${API}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q })
      });
      if (r.ok) {
        const track = await r.json();
        setTracks(prev => prev.find(t => trackKey(t) === trackKey(track)) ? prev : [track, ...prev]);
        setQuery('');
        if (action === 'queue' && current) {
          setUpNext(prev => [...prev, track]);
          setToast({...track, _msg: 'Added to queue'});
          setTimeout(() => setToast(null), 7000);
        } else {
          setToast({...track, _msg: track.from_library ? 'Found in Library' : 'Downloaded'});
          setTimeout(() => setToast(null), 7000);
          playTrack(track);
        }
      }
    } catch {}
    finally { setSearching(false); }
  };

  const handleCtxAction = (action, pNameArg) => {
    if (!ctxMenu) return;
    if (action === 'play') {
      playTrack(ctxMenu.track);
    } else if (action === 'queue') {
      setUpNext(prev => [...prev, ctxMenu.track]);
      setToast({ ...ctxMenu.track, _msg: 'Added to queue' });
      setTimeout(() => setToast(null), 7000);
    } else if (action === 'like') {
      if (!liked.find(t => trackKey(t) === trackKey(ctxMenu.track))) {
        setLiked(prev => [...prev, ctxMenu.track]);
        setToast({ ...ctxMenu.track, _msg: 'Added to Liked Songs' });
      } else {
        setToast({ ...ctxMenu.track, _msg: 'Already in Liked Songs' });
      }
      setTimeout(() => setToast(null), 7000);
    } else if (action === 'playlist') {
      let pName = pNameArg;
      if (pNameArg === '__new__') {
        const name = window.prompt('Enter playlist name:');
        if (!name || !name.trim()) {
          setCtxMenu(null);
          return;
        }
        pName = name.trim();
      }
      
      setPlaylists(prev => {
        const list = prev[pName] || [];
        if (!list.find(t => trackKey(t) === trackKey(ctxMenu.track))) {
          setToast({ ...ctxMenu.track, _msg: `Added to ${pName}` });
          return { ...prev, [pName]: [...list, ctxMenu.track] };
        }
        setToast({ ...ctxMenu.track, _msg: `Already in ${pName}` });
        return prev;
      });
      setTimeout(() => setToast(null), 7000);
    } else if (action === 'remove') {
      setTracks(prev => prev.filter(t => t.id !== ctxMenu.track.id));
      setToast({ ...ctxMenu.track, _msg: 'Removed from library' });
      setTimeout(() => setToast(null), 7000);
    }
    setCtxMenu(null);
  };

  const playSuggested = async () => {
    try {
      setToast({ _msg: '🎵 Finding your perfect mix...' });
      const r = await fetch(`${API}/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          queue_ids: [],
          track_titles: tracks.map(t => t.title),
          liked_titles: liked.map(t => t.title),
        })
      });
      setToast(null);
      if (r.ok) {
        const suggested = await r.json();
        if (suggested && suggested.length > 0) {
          // Reload library so newly downloaded tracks appear
          const fresh = await fetch(`${API}/tracks`);
          if (fresh.ok) setTracks(await fresh.json());
          setCurrentView('player');
          playTrack(suggested[0]);
          setUpNext(suggested.slice(1));
        }
      }
    } catch (e) { console.error(e); setToast(null); }
  };

  const handleSeek = (e) => {
    if (!dur) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const seekTo = ((e.clientX - rect.left) / rect.width) * dur;
    // YouTube track
    if (current && current.is_youtube && ytPlayerRef.current && typeof ytPlayerRef.current.seekTo === 'function') {
      ytPlayerRef.current.seekTo(seekTo, true);
      setProgress(seekTo);
      return;
    }
    // Server track
    const a = audioRef.current;
    if (a) a.currentTime = seekTo;
  };

  const pct = dur ? (progress / dur) * 100 : 0;
  const songName   = current ? getSong(current.title)   : null;
  const artistName = current ? getArtist(current.title) : null;

  return (
    <>
      <div className={`home-view ${currentView === 'home' ? 'active' : 'hidden'}`}>
        <div className="home-main">
            <header className="home-header">
              <div className="home-subhead">
                <span className="dot"></span> VINTAGE AUDIO
              </div>
              <button
                className="home-mode-btn"
                onClick={() => setIsLightMode(!isLightMode)}
                title="Toggle Theme"
              >
                {isLightMode ? <Moon size={16} /> : <Sun size={16} />}
              </button>
            </header>
            
            <div className="home-content">
              <div className="collection-label">COLLECTION</div>
              <h1 className="home-title">Your Library</h1>
              
              <div className="home-cards">
                {/* Liked Songs Card */}
                <div className="liked-card" style={{ cursor: 'pointer' }} onClick={() => { setActiveTab('liked'); setCurrentView('player'); }}>
                  <div className="icon-stack">
                    <div className="icon-stack-layer layer-3" />
                    <div className="icon-stack-layer layer-2" />
                    <div className="icon-stack-main" style={{ background: '#0f2038' }}>
                      <Heart size={36} fill="white" color="white" />
                    </div>
                  </div>
                  <h2>Liked Songs</h2>
                  <p>{liked.length} tracks saved from the golden era of analog soul.</p>
                  <button className="suggest-btn" onClick={(e) => { e.stopPropagation(); playSuggested(); }}>
                    <Play size={14} fill="currentColor" /> SUGGEST TRACKS
                  </button>
                </div>

                {/* My Library Card */}
                <div className="liked-card" onClick={() => setCurrentView('player')} style={{ cursor: 'pointer' }}>
                  <div className="icon-stack">
                    <div className="icon-stack-layer layer-3" style={{ background: 'rgba(61,43,31,0.25)' }} />
                    <div className="icon-stack-layer layer-2" style={{ background: 'rgba(61,43,31,0.5)' }} />
                    <div className="icon-stack-main" style={{ background: '#3d2b1f' }}>
                      <Music size={36} color="white" />
                    </div>
                  </div>
                  <h2>My Library</h2>
                  <p>{tracks.length} tracks ready to play in your collection.</p>
                  <button className="suggest-btn" style={{ background: '#3d2b1f' }} onClick={(e) => { e.stopPropagation(); setCurrentView('player'); }}>
                    <Play size={14} fill="currentColor" /> OPEN LIBRARY
                  </button>
                </div>

                {/* Playlists Card */}
                <div className="liked-card" style={{ cursor: 'pointer' }} onClick={() => {
                  const plNames = Object.keys(playlists);
                  if (plNames.length > 0) { setActiveTab(`pl:${plNames[0]}`); }
                  else { setActiveTab('library'); }
                  setCurrentView('player');
                }}>
                  <div className="icon-stack">
                    <div className="icon-stack-layer layer-3" style={{ background: 'rgba(180,100,60,0.18)' }} />
                    <div className="icon-stack-layer layer-2" style={{ background: 'rgba(180,100,60,0.4)' }} />
                    <div className="icon-stack-main" style={{ background: 'linear-gradient(135deg, #C87C5B 0%, #a34e2c 100%)' }}>
                      <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                    </div>
                  </div>
                  <h2>Playlists</h2>
                  <p>{Object.keys(playlists).length} custom playlists curated by you.</p>
                  <button className="suggest-btn" style={{ background: 'linear-gradient(135deg, #C87C5B 0%, #a34e2c 100%)' }} onClick={(e) => {
                    e.stopPropagation();
                    const name = window.prompt('Name your playlist:');
                    if (name && name.trim()) { setPlaylists(prev => ({ ...prev, [name.trim()]: prev[name.trim()] || [] })); setActiveTab(`pl:${name.trim()}`); setCurrentView('player'); }
                  }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5v14M5 12h14"/></svg> CREATE PLAYLIST
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

      <div className={`app${immersive ? ' immersive' : ''} ${currentView === 'player' ? 'active' : 'hidden'}`}>
      <audio
        ref={audioRef}
        preload="none"
        onTimeUpdate={() => {
          const a = audioRef.current;
          if (a) { setProgress(a.currentTime); setDur(a.duration || 0); }
        }}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => { setBuffering(false); setPlaying(true); }}
        onCanPlay={() => setBuffering(false)}
        onEnded={next}
        onError={(e) => { setBuffering(false); console.error('audio err', e.nativeEvent); }}
      />
      {/* Hidden YouTube player for streaming YouTube tracks */}
      <div id="yt-player-hidden" style={{ position: 'fixed', top: '-9999px', left: '-9999px', width: '1px', height: '1px', opacity: 0, pointerEvents: 'none' }} />

      {/* ── SIDEBAR ── */}
      <aside className="sidebar">
        <div className="sidebar-inner">
          <div className="sidebar-header">
            <div className="brand">
              <div className="brand-icon"><Plus size={13} color="white" /></div>
              <span className="brand-name">VintageCrate</span>
              <button className="home-btn" onClick={() => setIsLightMode(!isLightMode)} title="Toggle Theme" style={{ marginRight: '6px' }}>
                {isLightMode ? <Moon size={14} /> : <Sun size={14} />}
              </button>
              <button className="home-btn" onClick={() => setCurrentView('home')} title="Go to Home">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
              </button>
            </div>
            <form className="search-form-row" onSubmit={(e) => { e.preventDefault(); performSearch('play'); }}>
              <div className="search-wrap">
                <Search size={12} color="var(--sidebar-muted)" />
                <input
                  placeholder="Search or paste YouTube link…"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  disabled={searching}
                />
              </div>
              <button className="go-btn" type="submit" disabled={searching || !query.trim()}>
                {searching ? <Loader2 size={11} className="spin" /> : 'Go'}
              </button>
            </form>
          </div>

          <div className="lib-header">
            <div className="lib-header-top">
              <button className="hide-lib-btn" onClick={() => setImmersive(true)} title="Hide Library">
                <PanelLeftClose size={15} color="var(--sidebar-muted)" />
              </button>
            </div>
            <div className="lib-tabs">
              <span className={`lib-tab ${activeTab === 'library' ? 'active' : ''}`} onClick={() => setActiveTab('library')}>LIBRARY <span className="tab-count">{tracks.length}</span></span>
              <span className={`lib-tab ${activeTab === 'liked' ? 'active' : ''}`} onClick={() => setActiveTab('liked')}><Heart size={10} style={{marginRight: '6px'}}/> LIKED <span className="tab-count">{liked.length}</span></span>
              {Object.entries(playlists).map(([pName, pTracks]) => (
                <span key={pName} className={`lib-tab ${activeTab === `pl:${pName}` ? 'active' : ''}`} onClick={() => setActiveTab(`pl:${pName}`)}>
                  {pName.toUpperCase()} <span className="tab-count">{pTracks.length}</span>
                </span>
              ))}
            </div>
          </div>

          <div className="track-list">
            {activeList.map((t, i) => {
              const isActive = current && trackKey(current) === trackKey(t);
              return (
                <div
                  key={trackKey(t) || i}
                  className={`track-row${isActive ? ' active' : ''}`}
                  onClick={() => playTrack(t)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    let y = e.clientY;
                    if (window.innerHeight - y < 250) y = window.innerHeight - 250;
                    setCtxMenu({ x: e.clientX, y, track: t });
                  }}
                >
                  {isActive ? (
                    <div className={`eq-bars${!playing ? ' paused' : ''}`}>
                      <div className="eq-bar" />
                      <div className="eq-bar" />
                      <div className="eq-bar" />
                      <div className="eq-bar" />
                    </div>
                  ) : (
                    <span className="t-num">{String(i + 1).padStart(2, '0')}</span>
                  )}
                  <div className="t-info">
                    <div className="t-name">{getSong(t.title)}</div>
                    {getArtist(t.title) && <div className="t-artist">{getArtist(t.title)}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      {/* ── CANVAS ── */}
      <main className="canvas">
        {/* Ambient color glows */}
        <div className="canvas-orb" />
        <div className="canvas-glow canvas-glow-orange" />
        <div className="canvas-glow canvas-glow-teal" />
        <div className="canvas-glow canvas-glow-purple" />

        {/* Peek / toggle sidebar button */}
        <button className="peek-btn" onClick={() => setImmersive(prev => !prev)} title="Toggle library">
          {immersive ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>

        {/* Immersive search panel (visible when playing) */}
        <form className={`immersive-search-new ${searchExpanded ? 'expanded' : ''}`} onSubmit={(e) => { e.preventDefault(); performSearch('play'); setSearchExpanded(false); }}>
          {!searchExpanded ? (
            <div className="search-collapsed-view" onClick={() => setSearchExpanded(true)}>
               {searching ? <Loader2 size={16} color="white" className="spin" /> : <Music size={16} color="white" />}
               <span>Search Track</span>
            </div>
          ) : (
            <div className="search-expanded-view">
               <div className="search-expanded-header">
                 <span className="search-label">QUICK FIND</span>
                 <button type="button" className="close-btn" onClick={(e) => { e.stopPropagation(); setSearchExpanded(false); }}>✕</button>
               </div>
               <div className="search-input-box">
                 <Search size={14} color="var(--ink-muted)" />
                 <input autoFocus placeholder="Find a song..." value={query} onChange={e=>setQuery(e.target.value)} disabled={searching} />
               </div>
               <div className="search-actions">
                 <button type="submit" disabled={searching || !query.trim()}>{searching ? 'Searching...' : 'Play Now'}</button>
                 {current && <button type="button" onClick={() => { performSearch('queue'); setSearchExpanded(false); }}>+ Queue</button>}
               </div>
            </div>
          )}
        </form>

        {/* Queue panel (visible when a track is loaded) */}
        {current && (
          <div className="queue-panel">
            <div className="queue-header">Up Next</div>
            <div className="queue-list">
              {upNext.length === 0 && <div className="queue-empty">Queue is empty</div>}
              {upNext.map((t, idx) => (
                <div key={`${trackKey(t)}-${idx}`} className="queue-item">
                  <span className="q-num">{idx + 1}</span>
                  <div className="q-info">
                    <div className="q-name">{getSong(t.title)}</div>
                    <div className="q-artist">{getArtist(t.title)}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}



        {/* Vinyl */}
        <div className={`vinyl-wrap${playing ? ' playing' : ''}`}>
          <div className={`vinyl${playing && !buffering ? ' spinning' : ' paused'}`}>
            <div className="vinyl-label">
              <div className="vinyl-label-inner">
                <div className="vinyl-center-hole" />
              </div>
            </div>
          </div>
          {/* Tonearm */}
          <div className="arm-wrap">
            <div className="arm-pivot" />
            <div className="arm-shaft" />
            <div className="arm-head" />
          </div>
        </div>

        {/* Now playing card */}
        <div className={`np-card${current ? ' visible' : ''}`}>
          <div className="np-card-header">
            <div className="np-art">
              {buffering
                ? <Loader2 size={22} className="spin" color="var(--accent)" />
                : <Music size={22} color="white" />}
            </div>
            <div className="np-meta" style={{ flex: 1 }}>
              <div className="np-song">{songName ?? '—'}</div>
              <div className="np-by" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {artistName || 'Unknown Artist'}
                {playing && !buffering && current && (
                  <div className="eq-bars" style={{ marginBottom: '2px' }}>
                    <div className="eq-bar"></div><div className="eq-bar"></div>
                    <div className="eq-bar"></div><div className="eq-bar"></div>
                  </div>
                )}
              </div>
            </div>
            {current && (
              <button 
                className="like-btn-np" 
                onClick={() => {
                  if (liked.some(t => trackKey(t) === trackKey(current))) {
                    setLiked(prev => prev.filter(t => trackKey(t) !== trackKey(current)));
                    setToast({ ...current, _msg: 'Removed from Liked' });
                    setTimeout(() => setToast(null), 7000);
                  } else {
                    setLiked(prev => [...prev, current]);
                    setToast({ ...current, _msg: 'Saved to Liked Songs' });
                    setTimeout(() => setToast(null), 7000);
                  }
                }}
                style={{
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  color: liked.some(t => trackKey(t) === trackKey(current)) ? '#e63946' : 'var(--glass-text-muted)',
                  transition: 'all 0.3s ease', padding: '0.5rem',
                  display: 'flex', alignItems: 'center'
                }}
                title={liked.some(t => trackKey(t) === trackKey(current)) ? "Remove from Liked" : "Add to Liked Songs"}
              >
                <Heart size={20} fill={liked.some(t => trackKey(t) === trackKey(current)) ? '#e63946' : 'none'} />
              </button>
            )}
          </div>

          <div className="np-seek-section">
            <div className="seek-row">
              <span className="ts">{fmt(progress)}</span>
              <div className="seek-bar" onClick={handleSeek}>
                <div className="seek-fill" style={{ width: `${pct}%` }} />
              </div>
              <span className="ts r">{fmt(dur)}</span>
            </div>
          </div>

          <div className="np-controls-section">
            <div className="ctrl-row">
              <button 
                className="ctrl" 
                onClick={playSuggested} 
                title="Suggest Tracks"
                style={{ color: 'var(--accent)' }}
              >
                <Sparkles size={16} />
              </button>
              <button className="ctrl" onClick={prev} disabled={!current}>
                <SkipBack size={18} />
              </button>
              <button className="ctrl-play" onClick={toggle} disabled={!current}>
                {buffering
                  ? <Loader2 size={16} className="spin" />
                  : playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" style={{ marginLeft: '2px' }} />}
              </button>
              <button className="ctrl" onClick={next} disabled={!current}>
                <SkipForward size={18} />
              </button>
              <button 
                className="ctrl" 
                onClick={() => {
                  setIsRepeat(!isRepeat);
                  setToast({ _msg: !isRepeat ? 'Repeat Enabled' : 'Repeat Disabled' });
                  setTimeout(() => setToast(null), 3000);
                }} 
                disabled={!current}
                title="Repeat Song"
                style={{ color: isRepeat ? 'var(--accent)' : 'var(--glass-text)' }}
              >
                <Repeat size={16} />
              </button>
              <div className="volume-container">
                {vol === 0
                  ? <VolumeX size={14} onClick={() => setVol(0.8)} style={{ cursor: 'pointer', color: 'var(--glass-text-muted)', flexShrink: 0 }} />
                  : <Volume2 size={14} onClick={() => setVol(0)}    style={{ cursor: 'pointer', color: 'var(--glass-text-muted)', flexShrink: 0 }} />}
                <input
                  type="range" min="0" max="1" step="0.01"
                  value={vol}
                  onChange={(e) => setVol(+e.target.value)}
                  className="volume-slider"
                  style={{ '--vol-pct': `${vol * 100}%` }}
                />
              </div>
            </div>
          </div>

          {playing && !buffering && (
            <div className="now-playing-badge">
              <div className="npb-dot" /> Now Playing
            </div>
          )}
          {buffering && (
            <div className="now-playing-badge" style={{ color: 'rgba(255,255,255,0.4)' }}>
              Loading…
            </div>
          )}
        </div>
        </main>
      </div>

      {/* Toast */}
      {toast && (
        <div className="toast" onClick={() => { if (toast._msg !== 'Added to queue') playTrack(toast); setToast(null); }}>
          <CheckCircle size={13} /> {toast._msg} {toast.title && `· ${getSong(toast.title)}`} {toast.title && toast._msg !== 'Added to queue' ? '— tap to play' : ''}
        </div>
      )}

      {/* Context Menu */}
      {ctxMenu && (
        <>
          <div className="ctx-backdrop" onClick={() => setCtxMenu(null)} onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }} />
          <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <div className="ctx-item" onClick={() => handleCtxAction('play')}>Play Now</div>
            <div className="ctx-item" onClick={() => handleCtxAction('queue')}>Add to Queue</div>
            <div className="ctx-item" onClick={() => handleCtxAction('like')}>Add to Liked Songs</div>
            <div className="ctx-item has-submenu">
              Add to Playlist...
              <div className="ctx-submenu">
                {Object.keys(playlists).map(pName => (
                  <div key={pName} className="ctx-item" onClick={() => handleCtxAction('playlist', pName)}>
                    {pName}
                  </div>
                ))}
                <div className="ctx-item" onClick={() => handleCtxAction('playlist', '__new__')}>
                  + New Playlist
                </div>
              </div>
            </div>
            <div className="ctx-item danger" onClick={() => handleCtxAction('remove')}>Remove from Library</div>
          </div>
        </>
      )}
    </>
  );
}

