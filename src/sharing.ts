import type { Album } from './catalog';

export type SocialPlatform = 'x' | 'bluesky' | 'whatsapp' | 'reddit';

export function formatRanking(albums: Album[]) {
  return `MY TOP 10 ALBUMS\n\n${albums.map((album, index) => `${index + 1}. ${album.title} — ${album.artist}`).join('\n')}`;
}

function shorten(value: string, maxLength: number) {
  const chars = Array.from(value);
  return chars.length <= maxLength ? value : `${chars.slice(0, maxLength - 1).join('').trimEnd()}…`;
}

export function socialShareUrl(platform: SocialPlatform, albums: Album[]) {
  // Short previews fit microblog character limits; the complete list is
  // available through Copy List, Save Image, and longer-form sharing.
  const preview = `MY TOP ALBUMS\n${albums.slice(0, 3).map((album, index) => `${index + 1}. ${shorten(album.title, 44)} — ${shorten(album.artist, 27)}`).join('\n')}\n\n#AlbumSorter`;
  const shortPost = shorten(preview, 260);
  switch (platform) {
    case 'x':
      return `https://twitter.com/intent/tweet?text=${encodeURIComponent(shortPost)}`;
    case 'bluesky':
      return `https://bsky.app/intent/compose?text=${encodeURIComponent(shortPost)}`;
    case 'whatsapp':
      return `https://wa.me/?text=${encodeURIComponent(formatRanking(albums))}`;
    case 'reddit':
      return `https://www.reddit.com/submit?title=${encodeURIComponent('My Top 10 Albums')}&text=${encodeURIComponent(formatRanking(albums))}`;
  }
}

function loadCover(url: string): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let complete = false;
    const finish = (result: HTMLImageElement | null) => {
      if (complete) return;
      complete = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      resolve(result);
    };
    const timer = setTimeout(() => finish(null), 4500);
    img.onload = () => finish(img.naturalWidth && img.naturalHeight ? img : null);
    img.onerror = () => finish(null);
    img.src = url;
  });
}

function drawFittedText(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, maxWidth: number) {
  if (ctx.measureText(value).width <= maxWidth) {
    ctx.fillText(value, x, y);
    return;
  }
  const characters = Array.from(value);
  while (characters.length && ctx.measureText(`${characters.join('')}…`).width > maxWidth) characters.pop();
  ctx.fillText(`${characters.join('').trimEnd()}…`, x, y);
}

function drawVinyl(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.fillStyle = '#262a2c';
  ctx.beginPath();
  ctx.arc(x, y, 116, 0, Math.PI * 2);
  ctx.fill();
  for (let radius = 42; radius <= 110; radius += 7) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = radius % 2 ? '#465056' : '#3b454b';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.fillStyle = '#14bef7';
  ctx.beginPath();
  ctx.arc(x, y, 41, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1c3544';
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fill();
}

function drawArtwork(ctx: CanvasRenderingContext2D, img: HTMLImageElement | null, x: number, y: number, size: number) {
  if (img) {
    const cropSize = Math.min(img.naturalWidth, img.naturalHeight);
    const cropX = (img.naturalWidth - cropSize) / 2;
    const cropY = (img.naturalHeight - cropSize) / 2;
    try {
      ctx.drawImage(img, cropX, cropY, cropSize, cropSize, x, y, size, size);
      return;
    } catch {
      // A missing or restricted image should never prevent exporting the list.
    }
  }
  ctx.fillStyle = '#d7eaf4';
  ctx.fillRect(x, y, size, size);
  ctx.strokeStyle = '#5883e8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size * .29, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#14bef7';
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size * .08, 0, Math.PI * 2);
  ctx.fill();
}

/** Makes a high-resolution poster entirely in the browser, without an API key. */
export async function renderRankingPng(albums: Album[]): Promise<Blob> {
  if (albums.length !== 10) throw new Error('A complete Top 10 is needed to create the image.');
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1720;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image export is not supported in this browser.');

  if (document.fonts?.ready) await document.fonts.ready;
  const covers = await Promise.all(albums.map((album) => loadCover(album.artwork)));

  ctx.fillStyle = '#f6fbff';
  ctx.fillRect(0, 0, 1200, 1720);
  ctx.fillStyle = '#14bef7';
  ctx.fillRect(0, 0, 1200, 14);
  ctx.fillStyle = '#1c3544';
  ctx.font = '700 28px "Space Grotesk", Arial, sans-serif';
  ctx.fillText('ALBUM / SORTER.', 70, 97);
  ctx.font = '700 80px "Space Grotesk", Arial, sans-serif';
  ctx.fillText('MY TOP 10', 66, 207);
  ctx.fillStyle = '#5883e8';
  ctx.fillText('ALBUMS.', 66, 289);
  drawVinyl(ctx, 1033, 198);

  ctx.fillStyle = '#14bef7';
  ctx.fillRect(67, 321, 1066, 4);

  albums.forEach((album, index) => {
    const y = 341 + index * 121;
    ctx.fillStyle = index % 2 === 0 ? '#ffffff' : '#eaf7ff';
    ctx.fillRect(67, y, 1066, 112);
    ctx.fillStyle = index === 0 ? '#14bef7' : '#5883e8';
    ctx.font = '700 38px "Space Grotesk", Arial, sans-serif';
    ctx.fillText(String(index + 1).padStart(2, '0'), 84, y + 70);

    drawArtwork(ctx, covers[index], 164, y + 11, 90);
    ctx.fillStyle = '#1c3544';
    ctx.font = '700 32px "Space Grotesk", Arial, sans-serif';
    drawFittedText(ctx, album.title, 280, y + 49, 805);
    ctx.fillStyle = '#758692';
    ctx.font = '500 24px "DM Sans", Arial, sans-serif';
    drawFittedText(ctx, album.artist, 280, y + 84, 800);
  });

  ctx.fillStyle = '#d7eaf4';
  ctx.fillRect(67, 1570, 1066, 2);
  ctx.fillStyle = '#607a89';
  ctx.font = '700 22px "Space Grotesk", Arial, sans-serif';
  ctx.fillText('ALBUM / SORTER.', 68, 1634);
  ctx.fillStyle = '#14bef7';
  ctx.fillRect(67, 1673, 1066, 7);

  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Image encoding failed.')), 'image/png');
    } catch (error) {
      reject(error);
    }
  });
}
