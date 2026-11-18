import assert from 'node:assert/strict';
import test from 'node:test';

import { searchAllSources } from '../src/catalog.ts';

test('a search merges both catalogs and shows duplicate albums only once', async () => {
  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const requestedHosts = [];

  try {
    globalThis.window = { location: { origin: 'https://album-sorter.example' } };
    globalThis.fetch = async (input) => {
      const url = new URL(input);
      requestedHosts.push(url.host);
      if (url.host === 'itunes.apple.com') {
        return Response.json({ results: [{
          collectionId: 1710637196,
          collectionName: 'Heaven Knows',
          artistName: 'PinkPantheress',
          artworkUrl100: 'https://example.test/100x100bb.jpg',
          releaseDate: '2023-11-10T00:00:00Z',
        }] });
      }
      if (url.pathname === '/api/musicbrainz') {
        return Response.json({ 'release-groups': [
          { id: 'ee2d901b-5a23-4d45-82ce-4e245a5a3ac1', title: 'heaven knows', 'primary-type': 'Album', 'artist-credit': [{ name: 'PinkPantheress' }] },
          { id: 'an-extra-test-album', title: 'Rare Catalog Album', 'primary-type': 'Album', 'artist-credit': [{ name: 'Test Artist' }] },
        ] });
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    const result = await searchAllSources('Heaven Knows PinkPantheress');
    assert.deepEqual(result.failedSources, []);
    assert.equal(result.albums.length, 2);
    assert.equal(result.albums.filter((album) => album.title.toLowerCase() === 'heaven knows').length, 1);
    assert.equal(result.albums[0].title, 'Heaven Knows');
    assert.equal(result.albums[0].source, 'itunes');
    assert.ok(result.albums.some((album) => album.title === 'Rare Catalog Album'));
    assert.ok(requestedHosts.includes('itunes.apple.com'));
    assert.ok(requestedHosts.includes('album-sorter.example'));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
