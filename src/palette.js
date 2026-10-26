import { DataTexture, NearestFilter, RGBAFormat, UnsignedByteType } from 'three';

// Colours from an image, in the image's own proportions. Every pixel is read and laid out in a
// ribbon, grouped by colour. A grain takes its colour from where the ribbon is at the moment it is
// born, and the ribbon turns slowly: smoke born together shares one colour, like dye dripped into it,
// and over a full turn every pixel colours its exact share of the smoke.

const MAX_SIDE = 400; // about 160k pixels: every colour region is kept, the work stays instant

export async function readImage(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;

  // Transparent pixels are not part of the picture.
  const pixels = new Uint8Array(width * height * 3);
  let n = 0;
  let luminance = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    pixels[n * 3] = data[i];
    pixels[n * 3 + 1] = data[i + 1];
    pixels[n * 3 + 2] = data[i + 2];
    luminance += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    n++;
  }
  if (!n) throw new Error('This image has no visible pixels.');

  const thumb = new OffscreenCanvas(56, 56);
  const tctx = thumb.getContext('2d');
  const cover = Math.max(56 / bitmap.width, 56 / bitmap.height);
  tctx.drawImage(bitmap, (56 - bitmap.width * cover) / 2, (56 - bitmap.height * cover) / 2, bitmap.width * cover, bitmap.height * cover);
  const thumbnail = URL.createObjectURL(await thumb.convertToBlob({ type: 'image/png' }));
  bitmap.close();

  return {
    name: file.name,
    pixels: pixels.subarray(0, n * 3),
    count: n,
    meanLuminance: luminance / n / 255,
    swatches: swatches(pixels.subarray(0, n * 3), n),
    thumbnail,
  };
}

// The image's main colours and how much of it each covers, for the strip in the panel (k-means).
function swatches(pixels, n, k = 8) {
  const sample = [];
  const step = Math.max(1, Math.floor(n / 6000));
  for (let i = 0; i < n; i += step) sample.push([pixels[i * 3], pixels[i * 3 + 1], pixels[i * 3 + 2]]);
  let centres = Array.from({ length: k }, (_, j) => [...sample[Math.floor(((j + 0.5) / k) * sample.length)]]);
  const nearest = (p) => {
    let best = 0, dist = Infinity;
    centres.forEach((c, j) => {
      const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;
      if (d < dist) { dist = d; best = j; }
    });
    return best;
  };
  for (let it = 0; it < 10; it++) {
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (const p of sample) {
      const s = sums[nearest(p)];
      s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++;
    }
    centres = centres.map((c, j) => (sums[j][3] ? sums[j].slice(0, 3).map((v) => v / sums[j][3]) : c));
  }
  const counts = centres.map(() => 0);
  for (const p of sample) counts[nearest(p)]++;
  return centres
    .map((c, j) => ({ rgb: c, color: `rgb(${c.map(Math.round).join(',')})`, share: counts[j] / sample.length }))
    .filter((s) => s.share > 0.004)
    .sort((a, b) => b.share - a.share);
}

// The ribbon: all pixels, grouped by their main colour (in hue order, greys last by brightness),
// darkest to lightest within each group, packed into a texture row by row.
export function ribbonTexture(image) {
  const n = image.count;
  const px = image.pixels;
  const centres = image.swatches.map((sw) => sw.rgb);
  const hueOf = ([r, g, b]) => {
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max - min < 24) return 10 + (r + g + b) / 765; // greys after every hue, dark to light
    const d = max - min;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return ((h + 6) % 6) / 6;
  };
  const rank = centres.map((c, j) => [hueOf(c), j]).sort((a, b) => a[0] - b[0]).map(([, j]) => j);
  const order = new Map(rank.map((j, i) => [j, i]));
  const keys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = px[i * 3], g = px[i * 3 + 1], b = px[i * 3 + 2];
    let best = 0, dist = Infinity;
    centres.forEach((c, j) => {
      const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
      if (d < dist) { dist = d; best = j; }
    });
    keys[i] = order.get(best) * 1000 + (0.2126 * r + 0.7152 * g + 0.0722 * b);
  }
  const index = new Uint32Array(n);
  for (let i = 0; i < n; i++) index[i] = i;
  index.sort((a, b) => keys[a] - keys[b]);

  const width = Math.min(1024, n);
  const height = Math.ceil(n / width);
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < n; i++) {
    const p = index[i] * 3;
    data[i * 4] = px[p];
    data[i * 4 + 1] = px[p + 1];
    data[i * 4 + 2] = px[p + 2];
    data[i * 4 + 3] = 255;
  }
  // Kept as the image's own values: the smoke's light is graded as display values, like the picture.
  const texture = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
  texture.minFilter = texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  return { texture, width, height, count: n };
}
