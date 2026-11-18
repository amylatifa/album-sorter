import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../dist/server/index.js';

test('MusicBrainz searches work when the default Worker cache is unavailable', async () => {
  const previousFetch = globalThis.fetch;
  const previousCacheDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'caches');
  let requestedUpstream = null;

  try {
    // The production hosting environment throws when caches.default is read.
    Object.defineProperty(globalThis, 'caches', {
      configurable: true,
      get() { throw new Error('This Worker is not permitted to access the default cache.'); },
    });
    globalThis.fetch = async (url) => {
      requestedUpstream = new URL(url);
      return Response.json({
        'release-groups': [{
          id: '278c-verified-test-id',
          title: 'Heaven Knows',
          'primary-type': 'Album',
          'artist-credit': [{ name: 'PinkPantheress' }],
        }],
      });
    };

    const query = '(releasegroup:heaven OR artist:heaven) AND (releasegroup:knows OR artist:knows) AND (releasegroup:pinkpantheress OR artist:pinkpantheress) AND primarytype:album';
    const url = new URL('https://example.test/api/musicbrainz');
    url.searchParams.set('query', query);
    const response = await worker.fetch(new Request(url));
    const data = await response.json();

    assert.equal(response.status, 200);
    assert.equal(requestedUpstream.hostname, 'musicbrainz.org');
    assert.equal(requestedUpstream.pathname, '/ws/2/release-group/');
    assert.equal(requestedUpstream.searchParams.get('query'), query);
    assert.equal(requestedUpstream.searchParams.get('fmt'), 'json');
    assert.equal(data['release-groups'][0].title, 'Heaven Knows');
    assert.equal(data['release-groups'][0]['artist-credit'][0].name, 'PinkPantheress');
  } finally {
    globalThis.fetch = previousFetch;
    if (previousCacheDescriptor) Object.defineProperty(globalThis, 'caches', previousCacheDescriptor);
    else delete globalThis.caches;
  }
});

test('the combined API merges catalogs, removes duplicates, and permits the GitHub Pages origin', async () => {
  const previousFetch = globalThis.fetch;
  const upstreamHosts = [];
  try {
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      upstreamHosts.push(url.hostname);
      if (url.hostname === 'itunes.apple.com') {
        assert.equal(url.searchParams.get('entity'), 'album');
        return Response.json({ results: [{
          collectionId: 1710637196,
          collectionName: 'Heaven Knows',
          artistName: 'PinkPantheress',
          artworkUrl100: 'https://example.test/100x100bb.jpg',
          releaseDate: '2023-11-10T00:00:00Z',
        }] });
      }
      assert.equal(url.hostname, 'musicbrainz.org');
      assert.match(url.searchParams.get('query'), /primarytype:album/);
      return Response.json({ 'release-groups': [
        { id: 'mb-duplicate', title: 'heaven knows', 'primary-type': 'Album', 'artist-credit': [{ name: 'PinkPantheress' }] },
        { id: 'mb-rare', title: 'Rare Catalog Album', 'primary-type': 'Album', 'artist-credit': [{ name: 'Another Artist' }] },
        { id: 'mb-single', title: 'Ignore This Single', 'primary-type': 'Single', 'artist-credit': [{ name: 'Another Artist' }] },
      ] });
    };

    const url = new URL('https://album-sorter-api.example/api/search');
    url.searchParams.set('term', 'Heaven Knows PinkPantheress');
    const response = await worker.fetch(new Request(url, { headers: { Origin: 'https://amylatifa.github.io' } }));
    const results = await response.json();

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://amylatifa.github.io');
    assert.deepEqual(results.failedSources, []);
    assert.equal(results.albums.length, 2);
    assert.equal(results.albums[0].source, 'itunes');
    assert.equal(results.albums[0].artwork, 'https://example.test/600x600bb.jpg');
    assert.ok(results.albums.some((album) => album.title === 'Rare Catalog Album'));
    assert.deepEqual(new Set(upstreamHosts), new Set(['itunes.apple.com', 'musicbrainz.org']));
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('search still returns iTunes albums if MusicBrainz fails', async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      if (url.hostname === 'itunes.apple.com') {
        return Response.json({ results: [{ collectionId: 123, collectionName: 'Example Album', artistName: 'Example Artist' }] });
      }
      throw new Error('MusicBrainz unavailable');
    };
    const response = await worker.fetch(new Request('https://album-sorter-api.example/api/search?term=Example'));
    const result = await response.json();
    assert.equal(response.status, 200);
    assert.equal(result.albums[0].title, 'Example Album');
    assert.deepEqual(result.failedSources, ['musicbrainz']);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('search returns a service error if both catalogs fail', async () => {
  const previousFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error('Upstream unavailable'); };
    const response = await worker.fetch(new Request('https://album-sorter-api.example/api/search?term=Example'));
    const result = await response.json();
    assert.equal(response.status, 503);
    assert.deepEqual(result.failedSources, ['itunes', 'musicbrainz']);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('the API responds to browser CORS preflight checks', async () => {
  const response = await worker.fetch(new Request('https://album-sorter-api.example/api/search', {
    method: 'OPTIONS',
    headers: { Origin: 'https://amylatifa.github.io', 'Access-Control-Request-Method': 'GET' },
  }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), 'https://amylatifa.github.io');
  assert.match(response.headers.get('Access-Control-Allow-Methods'), /GET/);
});

test('a successful search is cached in KV and reused without new upstream requests', async () => {
  const previousFetch = globalThis.fetch;
  const stored = new Map();
  const env = {
    CATALOG_CACHE: {
      async get(key, type) {
        assert.equal(type, 'json');
        return stored.has(key) ? JSON.parse(stored.get(key)) : null;
      },
      async put(key, value, options) {
        assert.ok(options.expirationTtl >= 60);
        stored.set(key, value);
      },
    },
  };
  let upstreamRequests = 0;
  try {
    globalThis.fetch = async (input) => {
      upstreamRequests += 1;
      const host = new URL(input).hostname;
      if (host === 'itunes.apple.com') {
        return Response.json({ results: [{ collectionId: 21, collectionName: 'Cache Album', artistName: 'Cache Artist' }] });
      }
      return Response.json({ 'release-groups': [{
        id: 'another-cached-album', title: 'Another Cache Album', 'primary-type': 'Album',
        'artist-credit': [{ name: 'Cache Artist' }],
      }] });
    };

    const url = 'https://album-sorter-api.example/api/search?term=Cache%20Artist';
    const first = await worker.fetch(new Request(url), env);
    const firstResult = await first.json();
    assert.equal(first.status, 200);
    assert.equal(firstResult.albums.length, 2);
    assert.equal(upstreamRequests, 2);
    assert.equal(stored.size, 1);

    const second = await worker.fetch(new Request(url), env);
    const secondResult = await second.json();
    assert.equal(second.status, 200);
    assert.equal(secondResult.cached, true);
    assert.deepEqual(secondResult.albums, firstResult.albums);
    assert.equal(upstreamRequests, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('a stale cached catalog is returned when both upstream services reject requests', async () => {
  const previousFetch = globalThis.fetch;
  const previousConsoleError = console.error;
  const existing = [{ id: 'known-album', title: 'Previously Found Album', artist: 'Saved Artist', artwork: '' }];
  let upstreamCalls = 0;
  const env = {
    CATALOG_CACHE: {
      async get() { return { albums: existing, savedAt: Date.now() - 24 * 60 * 60 * 1000, complete: true }; },
      async put() { throw new Error('Stale fallback should not overwrite the existing cache'); },
    },
  };
  try {
    console.error = () => {};
    globalThis.fetch = async (input) => {
      upstreamCalls += 1;
      return new Response('Rate limited', {
        status: new URL(input).hostname === 'itunes.apple.com' ? 429 : 503,
        headers: { 'Retry-After': '120' },
      });
    };

    const url = 'https://album-sorter-api.example/api/search?term=Saved%20Artist';
    const response = await worker.fetch(new Request(url), env);
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.cached, true);
    assert.equal(data.stale, true);
    assert.deepEqual(data.failedSources, ['itunes', 'musicbrainz']);
    assert.deepEqual(data.albums, existing);
    assert.equal(upstreamCalls, 2);

    // A new uncached term should not immediately hammer either rate-limited API.
    const uncached = await worker.fetch(new Request('https://album-sorter-api.example/api/search?term=Different%20New%20Album'));
    assert.equal(uncached.status, 503);
    assert.equal(upstreamCalls, 2);
  } finally {
    globalThis.fetch = previousFetch;
    console.error = previousConsoleError;
  }
});