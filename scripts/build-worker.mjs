import { readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const dist = path.join(projectRoot, 'dist');
const embedded = {};

function addAsset(file, urlPath, mime) {
  embedded[urlPath] = {
    mime,
    base64: readFileSync(file).toString('base64'),
  };
}

addAsset(path.join(dist, 'index.html'), '/', 'text/html; charset=utf-8');
addAsset(path.join(dist, 'index.html'), '/index.html', 'text/html; charset=utf-8');

for (const file of readdirSync(path.join(dist, 'assets'))) {
  const mime = file.endsWith('.css') ? 'text/css; charset=utf-8'
    : file.endsWith('.js') ? 'text/javascript; charset=utf-8'
      : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
  addAsset(path.join(dist, 'assets', file), `/assets/${file}`, mime);
}

const worker = String.raw`
const EMBEDDED_ASSETS = ${JSON.stringify(embedded)};
const CLIENT_USER_AGENT = 'AlbumSorter/1.2.0 (https://amylatifa.github.io/album-sorter/)';
const ALLOWED_ORIGINS = new Set([
  'https://amylatifa.github.io',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]);
const CACHE_PREFIX = 'albums:v2:';
const CACHE_FRESH_MS = 12 * 60 * 60 * 1000;
const CACHE_PARTIAL_FRESH_MS = 60 * 1000;
const CACHE_RETENTION_SECONDS = 7 * 24 * 60 * 60;

let itunesCooldownUntil = 0;
let musicBrainzCooldownUntil = 0;
let lastUpstreamRequestAt = 0;
let upstreamQueue = Promise.resolve();

function corsHeaders(request) {
  const headers = new Headers({
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });

  const origin = request.headers.get('Origin');

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
  }

  return headers;
}

function encodeResponse(request, data, status = 200) {
  const headers = corsHeaders(request);

  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');

  return new Response(JSON.stringify(data), {
    status,
    headers,
  });
}

function waitForUpstreamTurn(action) {
  const request = upstreamQueue.then(async () => {
    const delay = Math.max(0, lastUpstreamRequestAt + 1150 - Date.now());
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    lastUpstreamRequestAt = Date.now();
    return action();
  });
  upstreamQueue = request.then(() => undefined, () => undefined);
  return request;
}
function retryDelay(response, fallbackMs) {
  const header = response.headers.get('Retry-After');

  if (!header) return fallbackMs;

  const seconds = Number(header);

  const ms = Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1000
    : Date.parse(header) - Date.now();

  return Number.isFinite(ms)
    ? Math.min(
        10 * 60 * 1000,
        Math.max(fallbackMs, ms)
      )
    : fallbackMs;
}

// Only cache successful upstream responses
const upstreamCache = {
  cacheEverything: true,
  cacheTtlByStatus: {
    '200-299': 60 * 60,
    '400-599': 0,
  },
};

async function fetchMusicBrainz(query) {
  // Don't make another request during a cooldown
  if (Date.now() < musicBrainzCooldownUntil) {
    throw new Error(
      'MusicBrainz cooling down after a rate-limit response'
    );
  }

  const upstreamUrl = new URL(
    'https://musicbrainz.org/ws/2/release-group/'
  );

  upstreamUrl.searchParams.set('query', query);
  upstreamUrl.searchParams.set('fmt', 'json');
  upstreamUrl.searchParams.set('limit', '18');

  const upstream = await waitForUpstreamTurn(() => {
    if (Date.now() < musicBrainzCooldownUntil) {
      throw new Error(
        'MusicBrainz cooling down after a rate-limit response'
      );
    }

    return fetch(upstreamUrl, {
      headers: {
        'User-Agent': CLIENT_USER_AGENT,
        Accept: 'application/json',
      },
      cf: upstreamCache,
    });
  });

  // Handle rate limits and temporary unavailability
  if (
    upstream.status === 429 ||
    upstream.status === 503
  ) {
    musicBrainzCooldownUntil =
      Date.now() + retryDelay(upstream, 30 * 1000);
  }

  if (!upstream.ok) {
    throw new Error(
      'MusicBrainz returned ' + upstream.status
    );
  }

  return upstream.json();
}

function normalizeText(text) {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function makeMusicBrainzQuery(text) {
  const tokens = text.match(/[\p{L}\p{N}]+/gu)?.slice(0, 12) ?? [];

  return [
    ...tokens.map((token) =>
      '(releasegroup:' + token + ' OR artist:' + token + ')'
    ),
    'primarytype:album',
  ].join(' AND ');
}

function matchScore(album, input) {
  const query = normalizeText(input);
  const title = normalizeText(album.title);
  const artist = normalizeText(album.artist);
  const combined = normalizeText(album.title + ' ' + album.artist);

  const tokens = query.split(' ').filter(Boolean);

  if (tokens.length === 0) return 0;

  const words = combined.split(' ');

  const matched = tokens.filter((token) =>
    words.some((word) => word.startsWith(token))
  ).length;

  let score = (matched / tokens.length) * 100;

  if (title === query) {
    score += 45;
  } else if (title.startsWith(query)) {
    score += 20;
  }

  if (artist === query) score += 15;
  if (album.source === 'itunes') score += 1;

  return score;
}

function deduplicateAlbums(albums) {
  const seen = new Set();

  return albums.filter((album) => {
    const key =
      normalizeText(album.title) + '|' + normalizeText(album.artist);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}
async function cacheKey(term) {
  const normalized = term
    .normalize('NFKC')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalized)
  );

  const hex = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0')
  ).join('');

  return CACHE_PREFIX + hex;
}
async function readCachedCatalog(env, term) {
  if (!env?.CATALOG_CACHE) {
    return null;
  }

  try {
    const entry = await env.CATALOG_CACHE.get(
      await cacheKey(term),
      'json'
    );

    if (
      !entry ||
      !Array.isArray(entry.albums) ||
      !Number.isFinite(entry.savedAt)
    ) {
      return null;
    }

    return entry;

  } catch (error) {
    console.error('Catalog cache read failed:', error);
    return null;
  }
}

async function saveCachedCatalog(
  env,
  term,
  albums,
  complete
) {
  if (!env?.CATALOG_CACHE) {
    return;
  }

  try {
    await env.CATALOG_CACHE.put(
      await cacheKey(term),

      JSON.stringify({
        albums,
        complete,
        savedAt: Date.now(),
      }),

      {
        expirationTtl: CACHE_RETENTION_SECONDS,
      }
    );

  } catch (error) {
    console.error('Catalog cache write failed:', error);
  }
}

async function fetchItunesAlbums(term) {
  if (Date.now() < itunesCooldownUntil) {
      throw new Error(
        'iTunes cooling down after a rate-limit response'
      );
    }
  const url = new URL('https://itunes.apple.com/search');

  url.searchParams.set('term', term);
  url.searchParams.set('media', 'music');
  url.searchParams.set('entity', 'album');
  url.searchParams.set('country', 'US');
  url.searchParams.set('limit', '25');

  const response = await fetch(url, {
    cf: upstreamCache, 
  });
  if (
    response.status === 429 ||
    response.status === 503
  ) {
    itunesCooldownUntil =
      Date.now() + retryDelay(response, 2 * 60 * 1000);
  }
  if (!response.ok) {
    throw new Error('iTunes returned ' + response.status);
  }

  const data = await response.json();
  const seen = new Set();

  return (Array.isArray(data.results) ? data.results : []).flatMap((album) => {
    if (
      !album.collectionId ||
      !album.collectionName ||
      !album.artistName ||
      seen.has(album.collectionId)
    ) {
      return [];
    }

    seen.add(album.collectionId);

    return [{
      id: album.collectionId,
      title: album.collectionName,
      artist: album.artistName,
      artwork: (album.artworkUrl100 ?? '').replace(
        /100x100(?=[a-z]*\.)/,
        '600x600'
      ),
      year: album.releaseDate?.slice(0, 4),
      genre: album.primaryGenreName,
      storeUrl: album.collectionViewUrl,
      source: 'itunes',
    }];
  });
}
async function fetchMusicBrainzAlbums(term) {
  const data = await fetchMusicBrainz(makeMusicBrainzQuery(term));

  return (
    Array.isArray(data['release-groups'])
      ? data['release-groups']
      : []
  ).flatMap((album) => {
    if (
      !album.id ||
      !album.title ||
      album['primary-type']?.toLowerCase() !== 'album'
    ) {
      return [];
    }

    const artist = (album['artist-credit'] ?? [])
      .map((entry) =>
        typeof entry === 'string'
          ? entry
          : (entry.name ?? entry.artist?.name ?? '') +
            (entry.joinphrase ?? '')
      )
      .join('')
      .trim() || 'Unknown artist';

    return [{
      id: 'musicbrainz:' + album.id,
      title: album.title,
      artist,
      artwork:
        'https://coverartarchive.org/release-group/' +
        album.id +
        '/front-500',
      year: album['first-release-date']?.slice(0, 4),
      storeUrl: 'https://musicbrainz.org/release-group/' + album.id,
      source: 'musicbrainz',
    }];
  });
}

async function searchAllAlbums(request, env) {
  const term = (
    new URL(request.url).searchParams.get('term') ?? ''
  ).trim();

  if (!term || term.length > 120) {
    return encodeResponse(
      request,
      { error: 'Enter a search of 1–120 characters.' },
      400
    );
  }

  // Check for previously saved albums
  const saved = await readCachedCatalog(env, term);

  const freshFor = saved?.complete
    ? CACHE_FRESH_MS
    : CACHE_PARTIAL_FRESH_MS;

  // Return fresh cached results without contacting either API
  if (saved && Date.now() - saved.savedAt < freshFor) {
    return encodeResponse(request, {
      albums: saved.albums,
      failedSources: [],
      cached: true,
    });
  }

  // Search both catalogs
  const [itunes, musicbrainz] = await Promise.allSettled([
    fetchItunesAlbums(term),
    fetchMusicBrainzAlbums(term),
  ]);

  const failedSources = [];

  if (itunes.status === 'rejected') {
    console.error('iTunes search failed:', itunes.reason);
    failedSources.push('itunes');
  }

  if (musicbrainz.status === 'rejected') {
    console.error(
      'MusicBrainz search failed:',
      musicbrainz.reason
    );

    failedSources.push('musicbrainz');
  }

  // Both APIs failed
  if (failedSources.length === 2) {

    // Return previously cached albums if available
    if (saved?.albums.length) {
      return encodeResponse(request, {
        albums: saved.albums,
        failedSources,
        cached: true,
        stale: true,
      });
    }

    return encodeResponse(
      request,
      {
        error: 'Album search is temporarily unavailable.',
        failedSources,
      },
      503
    );
  }

  // Combine current results with older results when needed
  const albums = [
    ...(itunes.status === 'fulfilled'
      ? itunes.value
      : []),

    ...(musicbrainz.status === 'fulfilled'
      ? musicbrainz.value
      : []),

    ...(failedSources.length && saved
      ? saved.albums
      : []),
  ];

  // Sort results by relevance
  albums.sort(
    (a, b) => matchScore(b, term) - matchScore(a, term)
  );

  // Remove duplicate albums
  const merged = deduplicateAlbums(albums);

  // Save successful results
  if (failedSources.length === 0 || !saved) {
    await saveCachedCatalog(
      env,
      term,
      merged,
      failedSources.length === 0
    );
  }

  return encodeResponse(request, {
    albums: merged,
    failedSources,
    cached: Boolean(saved && failedSources.length),
  });
}

async function musicBrainzSearch(request) {
  const url = new URL(request.url);
  const query = url.searchParams.get('query') ?? '';

  if (
    !query.trim() ||
    query.length > 500 ||
    !query.includes('primarytype:album')
  ) {
    return encodeResponse(
      request,
      { error: 'Invalid album query' },
      400
    );
  }

  try {
    return encodeResponse(
      request,
      await fetchMusicBrainz(query)
    );
  } catch {
    return encodeResponse(
      request,
      { error: 'MusicBrainz is temporarily unavailable' },
      503
    );
  }
}

function serveAsset(assetPath) {
  const asset = EMBEDDED_ASSETS[assetPath];
  if (!asset) return null;
  const bytes = Uint8Array.from(atob(asset.base64), (char) => char.charCodeAt(0));
  const immutable = assetPath.startsWith('/assets/');
  return new Response(bytes, {
    headers: {
      'Content-Type': asset.mime,
      'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (
      url.pathname === '/api/search' ||
      url.pathname === '/api/musicbrainz'
    ) {
      // Respond to CORS preflight requests
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: corsHeaders(request),
        });
      }

      // Restrict browser requests to allowed origins
      if (
        request.headers.has('Origin') &&
        !ALLOWED_ORIGINS.has(request.headers.get('Origin'))
      ) {
        return encodeResponse(
          request,
          { error: 'Origin not allowed' },
          403
        );
      }

      if (request.method !== 'GET') {
        return encodeResponse(
          request,
          { error: 'Method not allowed' },
          405
        );
      }

      // Combined iTunes + MusicBrainz search
      if (url.pathname === '/api/search') {
        return searchAllAlbums(request, env);
      }

      return musicBrainzSearch(request);
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405 });
    }

    const asset = serveAsset(url.pathname);

    if (asset) {
      return request.method === 'HEAD'
        ? new Response(null, { headers: asset.headers })
        : asset;
    }

    if (
      !url.pathname.startsWith('/api/') &&
      !url.pathname.includes('.')
    ) {
      return serveAsset('/');
    }

    return new Response('Not found', { status: 404 });
  },
};
`;

mkdirSync(path.join(dist, 'server'), { recursive: true });
writeFileSync(path.join(dist, 'server', 'index.js'), worker);
