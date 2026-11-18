import assert from 'node:assert/strict';
import test from 'node:test';

import { formatRanking, renderRankingPng, socialShareUrl } from '../src/sharing.ts';

const albums = Array.from({ length: 10 }, (_, index) => ({
  id: index + 1,
  title: `Album ${index + 1}`,
  artist: `Artist ${index + 1}`,
  artwork: '',
}));

test('share links contain album names, not a private site link', () => {
  const full = formatRanking(albums);
  assert.match(full, /10\. Album 10 — Artist 10/);
  for (const platform of ['x', 'bluesky', 'whatsapp', 'reddit']) {
    const url = new URL(socialShareUrl(platform, albums));
    assert.equal(url.protocol, 'https:');
    const text = url.searchParams.get('text');
    assert.ok(text?.includes('Album 1'));
    assert.ok(!text.includes('chatgpt.site'));
    if (platform === 'x' || platform === 'bluesky') assert.ok(text.length <= 260);
    else assert.match(text, /Album 10/);
  }
});

test('PNG poster renders even when none of the album covers are available', async () => {
  const previousDocument = globalThis.document;
  const textCalls = [];
  const canvas = {
    getContext() {
      return {
        beginPath() {}, arc() {}, fill() {}, fillRect() {}, stroke() {},
        fillText(value) { textCalls.push(value); },
        measureText(value) { return { width: value.length * 14 }; },
      };
    },
    toBlob(callback) { callback(new Blob(['test-image'], { type: 'image/png' })); },
  };
  globalThis.document = { fonts: { ready: Promise.resolve() }, createElement: (tag) => {
    assert.equal(tag, 'canvas');
    return canvas;
  } };
  try {
    const image = await renderRankingPng(albums);
    assert.equal(image.type, 'image/png');
    assert.equal(canvas.width, 1200);
    assert.equal(canvas.height, 1720);
    assert.ok(textCalls.includes('Album 10'));
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
