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
