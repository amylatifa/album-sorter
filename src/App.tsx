import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCircle2,
  CircleHelp,
  Copy,
  Disc3,
  ImageDown,
  Keyboard,
  LoaderCircle,
  MessageCircle,
  Music2,
  Plus,
  RotateCcw,
  Search,
  Share2,
  Trash2,
  X,
} from 'lucide-react';
import { normalizeText, searchAllSources, type Album, type CatalogSource } from './catalog';
import { formatRanking, renderRankingPng, socialShareUrl, type SocialPlatform } from './sharing';

type Stage = 'collect' | 'compare' | 'results';

type SortState = {
  orderedIds: Album['id'][];
  nextIndex: number;
  low: number;
  high: number;
  comparisons: number;
};

type PersistedSession = {
  albums: Album[];
  stage: Stage;
  sortState: SortState | null;
  history: SortState[];
};

const LIMIT = 10;
const STORAGE_KEY = 'album-sorter-react-v1';

const EMPTY_SESSION: PersistedSession = {
  albums: [],
  stage: 'collect',
  sortState: null,
  history: [],
};

function loadSession(): PersistedSession {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_SESSION;
    const saved = JSON.parse(raw) as PersistedSession;
    if (!Array.isArray(saved.albums) || saved.albums.length > LIMIT ||
        saved.albums.some((album) => !['number', 'string'].includes(typeof album.id) || typeof album.title !== 'string')) {
      return EMPTY_SESSION;
    }
    if (saved.stage !== 'collect' && (!saved.sortState || saved.albums.length !== LIMIT)) {
      return EMPTY_SESSION;
    }
    return {
      albums: saved.albums,
      stage: ['collect', 'compare', 'results'].includes(saved.stage) ? saved.stage : 'collect',
      sortState: saved.sortState ?? null,
      history: Array.isArray(saved.history) ? saved.history : [],
    };
  } catch {
    return EMPTY_SESSION;
  }
}

function AlbumArtwork({ album, className = '' }: { album: Album; className?: string }) {
  const [broken, setBroken] = useState(false);

  return (
    <div className={`album-art ${className}`}>
      {album.artwork && !broken ? (
        <img src={album.artwork} alt={`${album.title} album cover`} loading="lazy" onError={() => setBroken(true)} />
      ) : (
        <div className="art-fallback" aria-label={`No cover art available for ${album.title}`}>
          <Disc3 size={45} strokeWidth={1.1} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

function albumMetadata(album: Album) {
  return [album.year, album.genre].filter(Boolean).join(' · ');
}

function IconButton({ onClick, label, children, disabled = false }: {
  onClick: () => void;
  label: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  return <button className="icon-btn" type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled}>{children}</button>;
}

export default function App() {
  const [initialSession] = useState(loadSession);
  const [albums, setAlbums] = useState<Album[]>(initialSession.albums);
  const [stage, setStage] = useState<Stage>(initialSession.stage);
  const [sortState, setSortState] = useState<SortState | null>(initialSession.sortState);
  const [history, setHistory] = useState<SortState[]>(initialSession.history);
  const [query, setQuery] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<Album[]>([]);
  const [failedSources, setFailedSources] = useState<Exclude<CatalogSource, 'manual'>[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTitle, setManualTitle] = useState('');
  const [manualArtist, setManualArtist] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [posterBlob, setPosterBlob] = useState<Blob | null>(null);
  const [posterError, setPosterError] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ albums, stage, sortState, history }));
    } catch {
      // Sorting still works if browser storage is unavailable.
    }
  }, [albums, stage, sortState, history]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(''), 3000);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const selectedIds = useMemo(() => new Set(albums.map((album) => album.id)), [albums]);
  const selectedNames = useMemo(() => new Set(albums.map((album) => `${normalizeText(album.title)}|${normalizeText(album.artist)}`)), [albums]);
  const byId = useMemo(() => new Map(albums.map((album) => [album.id, album])), [albums]);
  const currentCandidate = sortState && stage === 'compare' ? albums[sortState.nextIndex] : undefined;
  const currentRivalId = sortState && stage === 'compare'
    ? sortState.orderedIds[Math.floor((sortState.low + sortState.high) / 2)]
    : undefined;
  const currentRival = currentRivalId === undefined ? undefined : byId.get(currentRivalId);
  const rankedAlbums = useMemo(
    () => sortState?.orderedIds.map((id) => byId.get(id)).filter((album): album is Album => !!album) ?? [],
    [sortState?.orderedIds, byId],
  );

  useEffect(() => {
    if (stage !== 'results' || rankedAlbums.length !== LIMIT) {
      setPosterBlob(null);
      setPosterError(false);
      return;
    }
    let active = true;
    setPosterBlob(null);
    setPosterError(false);
    void renderRankingPng(rankedAlbums)
      .then((blob) => { if (active) setPosterBlob(blob); })
      .catch(() => { if (active) setPosterError(true); });
    return () => { active = false; };
  }, [stage, rankedAlbums]);

  async function searchCatalog(event?: FormEvent<HTMLFormElement>, example?: string) {
    event?.preventDefault();
    const title = (example ?? query).trim();
    if (!title || searching || albums.length === LIMIT) return;
    setQuery(title);
    setSearchTerm(title);
    setSearching(true);
    setSearchError('');
    setSearchResults([]);
    setFailedSources([]);
    setManualOpen(false);

    try {
      const outcome = await searchAllSources(title);
      setSearchResults(outcome.albums);
      setFailedSources(outcome.failedSources);
      if (outcome.albums.length === 0) {
        setSearchError(outcome.failedSources.length === 2
          ? 'Album search is temporarily unavailable. Try again or add an album manually.'
          : 'No matching albums found. Try another title or add the album manually.');
      }
    } catch {
      setSearchError('Album search is temporarily unavailable. Try again or add the album manually.');
    } finally {
      setSearching(false);
    }
  }

  function addAlbum(album: Album) {
    if (albums.length >= LIMIT || selectedIds.has(album.id) || selectedNames.has(`${normalizeText(album.title)}|${normalizeText(album.artist)}`)) return;
    setAlbums((old) => [...old, album]);
    setSearchResults([]);
    setSearchTerm('');
    setQuery('');
    setSearchError('');
    setFailedSources([]);
    setManualOpen(false);
    setManualTitle('');
    setManualArtist('');
  }

  function addManualAlbum(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!manualTitle.trim() || !manualArtist.trim()) return;
    addAlbum({ id: -Date.now(), title: manualTitle.trim(), artist: manualArtist.trim(), artwork: '', source: 'manual' });
  }

  function startRanking() {
    if (albums.length !== LIMIT) return;
    setSortState({ orderedIds: [albums[0].id], nextIndex: 1, low: 0, high: 1, comparisons: 0 });
    setHistory([]);
    setStage('compare');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const chooseAlbum = useCallback((preferCandidate: boolean) => {
    if (stage !== 'compare' || !sortState || !currentCandidate || !currentRival) return;
    const middle = Math.floor((sortState.low + sortState.high) / 2);
    const nextLow = preferCandidate ? sortState.low : middle + 1;
    const nextHigh = preferCandidate ? middle : sortState.high;
    let next: SortState;

    if (nextLow === nextHigh) {
      const orderedIds = [...sortState.orderedIds];
      orderedIds.splice(nextLow, 0, currentCandidate.id);
      next = {
        orderedIds,
        nextIndex: sortState.nextIndex + 1,
        low: 0,
        high: orderedIds.length,
        comparisons: sortState.comparisons + 1,
      };
    } else {
      next = {
        ...sortState,
        low: nextLow,
        high: nextHigh,
        comparisons: sortState.comparisons + 1,
      };
    }

    setHistory((old) => [...old, sortState]);
    setSortState(next);
    if (next.nextIndex >= LIMIT) {
      setStage('results');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [stage, sortState, currentCandidate, currentRival]);

  const undoChoice = useCallback(() => {
    if (!history.length) return;
    setSortState(history[history.length - 1]);
    setHistory((old) => old.slice(0, -1));
    setStage('compare');
  }, [history]);

  useEffect(() => {
    if (stage !== 'compare' || helpOpen || resetOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      if (event.key === '1' || event.key === 'ArrowLeft') {
        event.preventDefault();
        chooseAlbum(true);
      } else if (event.key === '2' || event.key === 'ArrowRight') {
        event.preventDefault();
        chooseAlbum(false);
      } else if (event.key.toLowerCase() === 'u') {
        undoChoice();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [stage, chooseAlbum, undoChoice, helpOpen, resetOpen]);

  function resetSession() {
    setAlbums([]);
    setStage('collect');
    setSortState(null);
    setHistory([]);
    setQuery('');
    setSearchTerm('');
    setSearchResults([]);
    setSearchError('');
    setFailedSources([]);
    setManualOpen(false);
    setResetOpen(false);
    setShareOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function rankText() {
    return formatRanking(rankedAlbums);
  }

  async function copyRanking() {
    try {
      await navigator.clipboard.writeText(rankText());
      setToast('Ranking copied to clipboard!');
    } catch {
      setToast('Could not copy automatically. Try sharing the image instead.');
    }
  }

  function saveRankingImage() {
    if (!posterBlob) return;
    const href = URL.createObjectURL(posterBlob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = 'my-top-10-albums.png';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    setToast('Your Top 10 image was saved.');
  }

  function shareRankingImage() {
    if (!posterBlob) return;
    const file = new File([posterBlob], 'my-top-10-albums.png', { type: 'image/png' });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      // Call share immediately from the click event to retain user activation.
      void navigator.share({ files: [file], title: 'My Top 10 Albums' })
        .then(() => setShareOpen(false))
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') return;
          setToast('Could not open sharing. Try saving the image instead.');
        });
    } else {
      saveRankingImage();
      setToast('Image saved! Upload it to your favorite social app.');
    }
  }

  return (
    <div className="site-shell">
      <header className="site-header">
        <div className="page-width header-inner">
          <button type="button" className="brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Album Sorter home">
            <span className="brand-icon"><Disc3 size={24} strokeWidth={1.75} /></span>
            <span>ALBUM<span className="brand-muted">/</span>SORTER<span className="brand-dot">.</span></span>
          </button>
          <div className="header-stages" aria-label="Your progress">
            {(['collect', 'compare', 'results'] as Stage[]).map((part, index) => (
              <span key={part} className={`header-stage ${stage === part ? 'is-active' : ''}`}>
                <span className="stage-num">0{index + 1}</span> {part === 'collect' ? 'SELECT ALBUMS' : part === 'compare' ? 'COMPARE' : 'RESULTS'}
              </span>
            ))}
          </div>
          <button className="help-link" type="button" onClick={() => setHelpOpen(true)}><CircleHelp size={18} /> <span>HOW IT WORKS</span></button>
        </div>
      </header>

      <main>
        {stage === 'collect' && (
          <>
            <section className="hero page-width">
              <div className="hero-content">
                <div className="eyebrow"><span className="eyebrow-line" /> ALBUM RANKING TOOL</div>
                <h1>Album<br /><em>Sorter</em></h1>
                <p className="hero-description">Search for albums, choose 10, then compare them to create your ranking.</p>
              </div>
              <div className="hero-graphic" aria-hidden="true">
                <div className="hero-art-back" />
                <div className="hero-record"><div className="record-center"><span>YOUR<br />TOP 10</span><span className="record-micro">33⅓ RPM</span></div></div>
              </div>
            </section>

            <section className="workspace page-width" aria-label="Build your album list">
              <div className="section-heading">
                <div><span className="section-kicker">STEP 01</span><h2>Select 10 albums<span className="accent-period">.</span></h2></div>
              </div>

              <div className="workspace-grid">
                <div className="search-panel panel">
                  <div className="panel-top"><span className="panel-label"><Search size={16} /> ALBUM SEARCH</span></div>
                  <h3>Search albums</h3>
                  <p className="panel-subtitle">Enter an album title, artist, or both.</p>
                  <form className="search-form" onSubmit={(event) => void searchCatalog(event)}>
                    <label className="sr-only" htmlFor="album-search">Album title or artist</label>
                    <div className="search-field"><Search size={19} aria-hidden="true" /><input id="album-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Album title or artist" disabled={albums.length >= LIMIT} /></div>
                    <button className="action-btn search-submit" type="submit" disabled={!query.trim() || searching || albums.length >= LIMIT}>
                      {searching ? <LoaderCircle className="spin" size={18} /> : <ArrowRight size={19} />}<span>{searching ? 'SEARCHING' : 'SEARCH'}</span>
                    </button>
                  </form>

                  {searchResults.length > 0 ? (
                    <div className="search-results" aria-live="polite">
                      <div className="search-list-heading"><span>RESULTS FOR “{searchTerm}”</span><span>{searchResults.length} FOUND</span></div>
                      {failedSources.length > 0 && <p className="catalog-warning">Some results may be unavailable right now. You can still add the albums shown below.</p>}
                      <div className="results-scroll">
                        {searchResults.map((album) => {
                          const added = selectedIds.has(album.id) || selectedNames.has(`${normalizeText(album.title)}|${normalizeText(album.artist)}`);
                          return (
                            <div className="search-item" key={album.id}>
                              <AlbumArtwork album={album} className="search-thumb" />
                              <div className="search-info"><strong title={album.title}>{album.title}</strong><span title={album.artist}>{album.artist}</span>{albumMetadata(album) && <small>{albumMetadata(album)}</small>}</div>
                              {album.storeUrl && <a className="store-link" href={album.storeUrl} target="_blank" rel="noopener noreferrer" title="View album details" aria-label={`View details for ${album.title}`}><ArrowUpRight size={16} /></a>}
                              <button type="button" className={`add-result ${added ? 'already-added' : ''}`} disabled={added} aria-label={added ? `${album.title} already added` : `Add ${album.title}`} onClick={() => addAlbum(album)}>{added ? <Check size={18} /> : <Plus size={18} />}</button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : searching ? (
                    <div className="search-empty"><LoaderCircle className="spin" size={23} /><span>Searching for albums...</span></div>
                  ) : searchError ? (
                    <div className="search-empty error-message"><Music2 size={24} /><span>{searchError}</span></div>
                  ) : (
                    <div className="search-empty">
                      <span className="empty-disc"><Disc3 size={27} strokeWidth={1.35} /></span>
                      <strong>No search results yet</strong>
                      <span>Search above to find an album.</span>
                    </div>
                  )}

                  <div className="manual-entry">
                    <button type="button" className="text-link" onClick={() => setManualOpen(!manualOpen)} aria-expanded={manualOpen}>{manualOpen ? 'Close manual entry' : 'Add an album manually'} <ArrowRight size={14} /></button>
                    {manualOpen && (
                      <form className="manual-form" onSubmit={addManualAlbum}>
                        <label htmlFor="manual-title">ALBUM TITLE</label><input id="manual-title" placeholder="Album title" value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} required />
                        <label htmlFor="manual-artist">ARTIST</label><input id="manual-artist" placeholder="Artist name" value={manualArtist} onChange={(event) => setManualArtist(event.target.value)} required />
                        <button className="manual-add" type="submit" disabled={!manualTitle.trim() || !manualArtist.trim() || albums.length >= LIMIT}><Plus size={16} /> ADD TO SHORTLIST</button>
                      </form>
                    )}
                  </div>
                </div>

                <div className="shortlist-panel panel">
                  <div className="panel-top"><span className="panel-label"><Disc3 size={16} /> SELECTED ALBUMS</span><span className="counter"><strong>{String(albums.length).padStart(2, '0')}</strong> / 10</span></div>
                  <div className="shortlist-progress"><div style={{ width: `${albums.length * 10}%` }} /></div>
                  <div className="shortlist-grid">
                    {Array.from({ length: LIMIT }, (_, index) => {
                      const album = albums[index];
                      return album ? (
                        <div className="shortlist-slot filled" key={album.id}>
                          <AlbumArtwork album={album} className="shortlist-cover" />
                          <div className="slot-count">{String(index + 1).padStart(2, '0')}</div>
                          <IconButton label={`Remove ${album.title}`} onClick={() => setAlbums((old) => old.filter((item) => item.id !== album.id))}><X size={15} /></IconButton>
                          <span className="slot-title" title={album.title}>{album.title}</span>
                          <span className="slot-artist" title={album.artist}>{album.artist}</span>
                        </div>
                      ) : (
                        <div className="shortlist-slot unfilled" key={`empty-${index}`}><div className="empty-cover"><Plus size={22} strokeWidth={1.25} /><span>{String(index + 1).padStart(2, '0')}</span></div><span className="empty-slot-title">EMPTY SLOT</span></div>
                      );
                    })}
                  </div>
                  <div className="shortlist-footer">
                    <span>{albums.length === LIMIT ? <><CheckCircle2 size={17} /> 10 albums selected</> : <>{LIMIT - albums.length} {LIMIT - albums.length === 1 ? 'album' : 'albums'} remaining</>}</span>
                    <button className="action-btn rank-btn" type="button" disabled={albums.length !== LIMIT} onClick={startRanking}>START RANKING <ArrowRight size={18} /></button>
                  </div>
                </div>
              </div>
            </section>
          </>
        )}

        {stage === 'compare' && currentCandidate && currentRival && sortState && (
          <section className="compare-section page-width">
            <div className="compare-topline"><span className="section-kicker">STEP 02 / COMPARE</span><button type="button" className="subtle-link" onClick={() => setResetOpen(true)}><RotateCcw size={15} /> START OVER</button></div>
            <div className="compare-heading"><h1>Compare <em>albums.</em></h1><p>Choose the album you prefer in each comparison.</p></div>
            <div className="compare-progress"><div><span>BUILDING YOUR RANKING</span><strong>{sortState.nextIndex} <span>/ {LIMIT} ALBUMS PLACED</span></strong></div><div className="compare-progress-track"><div style={{ width: `${(sortState.nextIndex / LIMIT) * 100}%` }} /></div></div>

            <div className="duel-layout">
              <button className="duel-card" type="button" onClick={() => chooseAlbum(true)} aria-label={`Choose ${currentCandidate.title} by ${currentCandidate.artist}`}>
                <span className="duel-label">OPTION 01 <span>←</span></span>
                <AlbumArtwork album={currentCandidate} className="duel-art" />
                <div className="duel-info"><h2>{currentCandidate.title}</h2><p>{currentCandidate.artist}</p><small>{albumMetadata(currentCandidate)}</small></div>
                <span className="duel-pick">CHOOSE ALBUM <ArrowRight size={18} /></span>
              </button>
              <div className="vs-badge" aria-hidden="true">VS.</div>
              <button className="duel-card" type="button" onClick={() => chooseAlbum(false)} aria-label={`Choose ${currentRival.title} by ${currentRival.artist}`}>
                <span className="duel-label">OPTION 02 <span>→</span></span>
                <AlbumArtwork album={currentRival} className="duel-art" />
                <div className="duel-info"><h2>{currentRival.title}</h2><p>{currentRival.artist}</p><small>{albumMetadata(currentRival)}</small></div>
                <span className="duel-pick">CHOOSE ALBUM <ArrowRight size={18} /></span>
              </button>
            </div>
            <div className="compare-bottom"><button type="button" className="undo-link" onClick={undoChoice} disabled={!history.length}><ArrowLeft size={17} /> UNDO LAST PICK</button><div><Keyboard size={18} /><span>KEYBOARD SHORTCUTS</span><kbd>1</kbd> OR <kbd>2</kbd><span className="keyboard-extra">· <kbd>U</kbd> TO UNDO</span></div><span>{sortState.comparisons} CHOICES MADE</span></div>
          </section>
        )}

        {stage === 'results' && rankedAlbums.length === LIMIT && (
          <section className="ranking-section page-width">
            <div className="results-intro"><span className="section-kicker">STEP 03 / RESULTS</span><div className="results-title-row"><div><h1>Your <em>ranking.</em></h1><p>Completed in {sortState?.comparisons ?? 0} comparisons.</p></div></div></div>

            <div className="podium" aria-label="Your top three albums">
              {[1, 0, 2].map((position) => {
                const album = rankedAlbums[position];
                return <div className={`podium-item rank-${position + 1}`} key={album.id}><div className="podium-cover-wrap"><AlbumArtwork album={album} className="podium-cover" /><span className="podium-rank">#{position + 1}</span></div><strong>{album.title}</strong><span>{album.artist}</span>{album.storeUrl && <a href={album.storeUrl} target="_blank" rel="noopener noreferrer">VIEW ALBUM <ArrowUpRight size={12} /></a>}</div>;
              })}
            </div>

            <div className="ranking-table-panel"><div className="ranking-list-heading"><h2>RANKED ALBUMS <span>01—10</span></h2></div>
              {rankedAlbums.map((album, index) => <div className="ranking-row" key={album.id}><span className="ranking-number">{String(index + 1).padStart(2, '0')}</span><AlbumArtwork album={album} className="ranking-cover" /><div className="ranking-album-info"><strong>{album.title}</strong><span>{album.artist}</span></div><span className="ranking-year">{album.year ?? '—'}</span>{album.storeUrl ? <a className="ranking-visit" href={album.storeUrl} target="_blank" rel="noopener noreferrer" aria-label={`View details for ${album.title}`}><ArrowUpRight size={19} /></a> : <span className="ranking-visit-placeholder" />}</div>)}
            </div>
            <div className="results-actions">
              <div><span>SHARE YOUR RANKING</span>{posterError && <p>Image export isn't available in this browser.</p>}</div>
              <div className="results-buttons">
                <button className="outline-btn" type="button" onClick={() => void copyRanking()}><Copy size={17} /> COPY LIST</button>
                <button className="outline-btn" type="button" onClick={saveRankingImage} disabled={!posterBlob}>
                  {posterBlob || posterError ? <ImageDown size={17} /> : <LoaderCircle className="spin" size={17} />} {posterError ? 'IMAGE UNAVAILABLE' : posterBlob ? 'SAVE IMAGE' : 'PREPARING IMAGE'}
                </button>
                <button className="action-btn" type="button" onClick={() => setShareOpen(true)}><Share2 size={17} /> SHARE</button>
                <button className="outline-btn" type="button" onClick={() => setResetOpen(true)}>START OVER <RotateCcw size={17} /></button>
              </div>
            </div>
            <button className="results-undo" type="button" onClick={undoChoice} disabled={!history.length}><ArrowLeft size={16} /> Change your last choice</button>
          </section>
        )}
      </main>

      <footer className="site-footer"><div className="page-width footer-inner"><div className="footer-brand"><Disc3 size={22} /><span>ALBUM/SORTER.</span></div></div></footer>

      {helpOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setHelpOpen(false); }}><div className="modal" role="dialog" aria-modal="true" aria-labelledby="how-title"><IconButton label="Close help" onClick={() => setHelpOpen(false)}><X size={20} /></IconButton><span className="section-kicker">INSTRUCTIONS</span><h2 id="how-title">How it works</h2><div className="how-step"><span>01</span><div><h3>Select ten albums</h3><p>Search for albums, then add exactly ten albums. Manual entry is available when a release is missing.</p></div></div><div className="how-step"><span>02</span><div><h3>Compare albums</h3><p>Select the album you prefer. You can also press 1 or 2, and undo a comparison.</p></div></div><div className="how-step"><span>03</span><div><h3>View results</h3><p>See your ranking, share it, or save it as an image.</p></div></div><button className="action-btn modal-action" type="button" onClick={() => setHelpOpen(false)}>CLOSE <X size={17} /></button></div></div>}

      {shareOpen && stage === 'results' && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setShareOpen(false); }}>
        <div className="modal share-modal" role="dialog" aria-modal="true" aria-labelledby="share-title">
          <IconButton label="Close sharing" onClick={() => setShareOpen(false)}><X size={20} /></IconButton>
          <span className="section-kicker">YOUR TOP 10</span>
          <h2 id="share-title">Share your ranking.</h2>
          <p className="share-description">Share your ranking as an image, or post a text version.</p>
          <button className="action-btn share-image-action" type="button" onClick={shareRankingImage} disabled={!posterBlob}>
            {posterBlob || posterError ? <Share2 size={18} /> : <LoaderCircle className="spin" size={18} />}
            {posterError ? 'IMAGE UNAVAILABLE' : posterBlob ? 'SHARE IMAGE' : 'PREPARING IMAGE'}
          </button>
          <p className="share-hint">Uses your device's share menu where available. Otherwise, the PNG is saved for you.</p>
          <div className="share-section-label">SHARE AS TEXT</div>
          <div className="social-grid">
            {(['x', 'bluesky', 'whatsapp', 'reddit'] as SocialPlatform[]).map((platform) => (
              <a className="social-option" key={platform} href={socialShareUrl(platform, rankedAlbums)} target="_blank" rel="noopener noreferrer" onClick={() => setShareOpen(false)}>
                <MessageCircle size={18} /> {platform === 'x' ? 'X' : platform === 'bluesky' ? 'Bluesky' : platform === 'whatsapp' ? 'WhatsApp' : 'Reddit'} <ArrowUpRight size={15} />
              </a>
            ))}
          </div>
          <button className="outline-btn share-copy" type="button" onClick={() => { void copyRanking(); setShareOpen(false); }}><Copy size={16} /> COPY FULL TOP 10</button>
          <p className="share-hint">X and Bluesky use a short preview. Save the image to post all ten albums on Instagram, Stories, or any other app.</p>
        </div>
      </div>}

      {resetOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setResetOpen(false); }}><div className="modal confirm-modal" role="dialog" aria-modal="true" aria-labelledby="reset-title"><IconButton label="Close dialog" onClick={() => setResetOpen(false)}><X size={20} /></IconButton><span className="section-kicker">START OVER</span><h2 id="reset-title">Start a new list?</h2><p>This clears your selected albums and current ranking.</p><div className="modal-buttons"><button className="outline-btn" type="button" onClick={() => setResetOpen(false)}>CANCEL</button><button className="action-btn" type="button" onClick={resetSession}><Trash2 size={16} /> START OVER</button></div></div></div>}

      {toast && <div className="toast" role="status"><CheckCircle2 size={17} /> {toast}</div>}
    </div>
  );
}
