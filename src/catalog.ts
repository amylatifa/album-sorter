export type CatalogSource = 'itunes' | 'musicbrainz' | 'manual';

export type Album = {
  id: string | number;
  title: string;
  artist: string;
  artwork: string;
  year?: string;
  genre?: string;
  storeUrl?: string;
  source?: CatalogSource;
};

type ItunesSearchResponse = {
  results?: {
    collectionId?: number;
    collectionName?: string;
    artistName?: string;
    artworkUrl100?: string;
    releaseDate?: string;
    primaryGenreName?: string;
    collectionViewUrl?: string;
  }[];
};

type ArtistCredit = string | { name?: string; artist?: { name?: string }; joinphrase?: string };

type MusicBrainzSearchResponse = {
  'release-groups'?: {
    id?: string;
    title?: string;
    'artist-credit'?: ArtistCredit[];
    'first-release-date'?: string;
    'primary-type'?: string;
  }[];
};

export type SearchOutcome = {
  albums: Album[];
  failedSources: Exclude<CatalogSource, 'manual'>[];
};

function biggerArtwork(url: string) {
  return url.replace(/100x100(?=[a-z]*\.)/, '600x600');
}

export function normalizeText(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function matchScore(album: Album, input: string) {
  const query = normalizeText(input);
  const combined = normalizeText(`${album.title} ${album.artist}`);
  const title = normalizeText(album.title);
  const artist = normalizeText(album.artist);
  const tokens = query.split(' ').filter(Boolean);
  if (tokens.length === 0) return 0;
  const matched = tokens.filter((token) => combined.split(' ').some((word) => word.startsWith(token))).length;
  const coverage = matched / tokens.length;
  let result = coverage * 100;
  if (title === query) result += 45;
  else if (title.startsWith(query)) result += 20;
  if (artist === query) result += 15;
  if (album.source === 'itunes') result += 1;
  return result;
}

function uniqueByAlbum(albums: Album[]) {
  const seen = new Set<string>();
  return albums.filter((album) => {
    const key = `${normalizeText(album.title)}|${normalizeText(album.artist)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// MusicBrainz searches titles by default. Search both release titles and artists
// so an input such as "Blonde Frank Ocean" can find an album missing from iTunes.
export function makeMusicBrainzQuery(text: string) {
  const tokens = text.match(/[\p{L}\p{N}]+/gu)?.slice(0, 12) ?? [];
  return [...tokens.map((token) => `(releasegroup:${token} OR artist:${token})`), 'primarytype:album'].join(' AND ');
}

async function searchItunes(term: string): Promise<Album[]> {
  const url = new URL('https://itunes.apple.com/search');
  url.searchParams.set('term', term);
  url.searchParams.set('media', 'music');
  url.searchParams.set('entity', 'album');
  url.searchParams.set('country', 'US');
  url.searchParams.set('limit', '25');
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`iTunes returned ${response.status}`);
  const data = await response.json() as ItunesSearchResponse;
  const seen = new Set<number>();
  return (data.results ?? []).flatMap((item) => {
    if (!item.collectionId || !item.collectionName || !item.artistName || seen.has(item.collectionId)) return [];
    seen.add(item.collectionId);
    return [{
      id: item.collectionId,
      title: item.collectionName,
      artist: item.artistName,
      artwork: item.artworkUrl100 ? biggerArtwork(item.artworkUrl100) : '',
      year: item.releaseDate?.slice(0, 4),
      genre: item.primaryGenreName,
      storeUrl: item.collectionViewUrl,
      source: 'itunes',
    } satisfies Album];
  });
}

let lastMusicBrainzRequest = 0;

async function searchMusicBrainz(term: string): Promise<Album[]> {
  // A second guard in addition to the server's queue, keeping each browser
  // within MusicBrainz's published one-request-per-second application limit.
  const delay = Math.max(0, lastMusicBrainzRequest + 1150 - Date.now());
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  lastMusicBrainzRequest = Date.now();

  const url = new URL('/api/musicbrainz', window.location.origin);
  url.searchParams.set('query', makeMusicBrainzQuery(term));
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`MusicBrainz returned ${response.status}`);
  const data = await response.json() as MusicBrainzSearchResponse;
  return (data['release-groups'] ?? []).flatMap((item) => {
    if (!item.id || !item.title || item['primary-type']?.toLowerCase() !== 'album') return [];
    const artist = (item['artist-credit'] ?? []).map((entry) =>
      typeof entry === 'string' ? entry : `${entry.name ?? entry.artist?.name ?? ''}${entry.joinphrase ?? ''}`,
    ).join('').trim() || 'Unknown artist';
    return [{
      id: `musicbrainz:${item.id}`,
      title: item.title,
      artist,
      artwork: `https://coverartarchive.org/release-group/${item.id}/front-500`,
      year: item['first-release-date']?.slice(0, 4),
      storeUrl: `https://musicbrainz.org/release-group/${item.id}`,
      source: 'musicbrainz',
    } satisfies Album];
  });
}

export async function searchAllSources(term: string): Promise<SearchOutcome> {
  const [itunes, musicbrainz] = await Promise.allSettled([searchItunes(term), searchMusicBrainz(term)]);
  const failedSources: SearchOutcome['failedSources'] = [];
  if (itunes.status === 'rejected') failedSources.push('itunes');
  if (musicbrainz.status === 'rejected') failedSources.push('musicbrainz');

  const all = [
    ...(itunes.status === 'fulfilled' ? itunes.value : []),
    ...(musicbrainz.status === 'fulfilled' ? musicbrainz.value : []),
  ];
  all.sort((a, b) => matchScore(b, term) - matchScore(a, term));

  // Combine the catalogs before returning results, showing each title/artist
  // pair only once regardless of which services include it.
  return { albums: uniqueByAlbum(all), failedSources };
}
