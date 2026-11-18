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

export type SearchOutcome = {
  albums: Album[];
  failedSources: Exclude<CatalogSource, 'manual'>[];
};

export function normalizeText(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export async function searchAllSources(
  term: string
): Promise<SearchOutcome> {

  // Get the deployed Cloudflare Worker URL
  const workerBase =
    import.meta.env?.VITE_CATALOG_API_BASE_URL?.trim();

  // Create the search request
  const url = new URL(
    '/api/search',
    workerBase || window.location.origin
  );

  url.searchParams.set('term', term);

  // Request combined album results
  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(
      `Catalog API returned ${response.status}`
    );
  }

  const data = await response.json() as Partial<SearchOutcome>;

  // Validate the response
  if (!Array.isArray(data.albums)) {
    throw new Error('Invalid catalog API response');
  }

  // Return the combined results
  return {
    albums: data.albums,
    failedSources: Array.isArray(data.failedSources)
      ? data.failedSources
      : [],
  };
}
