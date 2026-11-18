import assert from 'node:assert/strict';
import test from 'node:test';

import { searchAllSources } from '../src/catalog.ts';

test('React requests the combined catalog API and displays results', async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const requestedUrls = [];

  try {
    globalThis.window = { location: { origin: 'https://album-sorter.example' } };
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      requestedUrls.push(url);

      // Check that React requests the combined catalog API
      assert.equal(url.pathname, '/api/search');

      assert.equal(
        url.searchParams.get('term'),
        'Heaven Knows PinkPantheress'
      );

      // Simulate the combined results returned by Cloudflare
      return Response.json({
        albums: [
          {
            id: 1710637196,
            title: 'Heaven Knows',
            artist: 'PinkPantheress',
            artwork: 'https://example.test/600x600bb.jpg',
            source: 'itunes',
          },
          {
            id: 'musicbrainz:rare',
            title: 'Rare Catalog Album',
            artist: 'Test Artist',
            artwork: '',
            source: 'musicbrainz',
          },
        ],
        failedSources: [],
  });
};

    const result = await searchAllSources('Heaven Knows PinkPantheress');
    assert.deepEqual(result.failedSources, []);
    assert.equal(result.albums.length, 2);
    assert.equal(result.albums.filter((album) => album.title.toLowerCase() === 'heaven knows').length, 1);
    assert.equal(result.albums[0].title, 'Heaven Knows');
    assert.equal(result.albums[0].source, 'itunes');
    assert.ok(result.albums.some((album) => album.title === 'Rare Catalog Album'));
    assert.equal(requestedUrls.length, 1);
    assert.equal(
      requestedUrls[0].origin,
      'https://album-sorter.example'
    );
      } finally {
        globalThis.fetch = previousFetch;
        if (previousWindow === undefined) delete globalThis.window;
        else globalThis.window = previousWindow;
      }
});
