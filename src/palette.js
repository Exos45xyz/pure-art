import { DataTexture, NearestFilter, RGBAFormat, UnsignedByteType } from 'three';

// Colours from an image, in the image's own proportions. Every pixel is read and laid out in a
// ribbon, grouped by colour, so neighbouring places on the ribbon are neighbouring colours. Each grain
// carries a place on it like pigment (simulation.js): a region of smoke shares one stretch of the
// ribbon, the flow folds the regions into each other, and over time every pixel colours about its
// share of the smoke.

const MAX_SIDE = 400; // about 160k pixels: every colour region is kept, the work stays instant

// name: what the panel calls it (the file's name, or a bundled palette's).
export async function readImage(file, name = file.name) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height).data;

  // Transparent pixels are not part of the picture, and neither is black: the smoke is light on a
  // black studio, so a black grain would only be a hole in it. The black around a picture is the studio.
  // Anything darker than 8% counts as black, so a black with film grain in it is left out too.
  const pixels = new Uint8Array(width * height * 3);
  let n = 0;
  let luminance = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    const l = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    if (l < 20) continue;
    pixels[n * 3] = data[i];
    pixels[n * 3 + 1] = data[i + 1];
    pixels[n * 3 + 2] = data[i + 2];
    luminance += l;
    n++;
  }
  if (!n) throw new Error('This image has no colours brighter than black.');

  const thumb = new OffscreenCanvas(56, 56);
  const tctx = thumb.getContext('2d');
  const cover = Math.max(56 / bitmap.width, 56 / bitmap.height);
  tctx.drawImage(bitmap, (56 - bitmap.width * cover) / 2, (56 - bitmap.height * cover) / 2, bitmap.width * cover, bitmap.height * cover);
  const thumbnail = URL.createObjectURL(await thumb.convertToBlob({ type: 'image/png' }));
  bitmap.close();

  return {
    name,
    pixels: pixels.subarray(0, n * 3),
    count: n,
    meanLuminance: luminance / n / 255,
    swatches: swatches(pixels.subarray(0, n * 3), n),
    thumbnail,
  };
}

// How far apart two colours look: green counts most, blue least, as the eye sees them.
const distance = (a, b) => 2 * (a[0] - b[0]) ** 2 + 4 * (a[1] - b[1]) ** 2 + 3 * (a[2] - b[2]) ** 2;

// The image's main colours and how much of it each covers (k-means). They group the ribbon's pixels and
// fill the strip in the panel.
function swatches(pixels, n, k = 8) {
  const sample = [];
  const step = Math.max(1, Math.floor(n / 6000));
  for (let i = 0; i < n; i += step) sample.push([pixels[i * 3], pixels[i * 3 + 1], pixels[i * 3 + 2]]);
  // k-means++: each starting colour is picked far from the ones already chosen, so distinct colours
  // start apart and never merge into one muddy average. Seeded, so an image always gives the same strip.
  let seed = 1;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  let centres = [[...sample[Math.floor(random() * sample.length)]]];
  const gaps = sample.map((p) => distance(p, centres[0]));
  while (centres.length < k) {
    const total = gaps.reduce((a, b) => a + b, 0);
    if (total === 0) break;
    let pick = random() * total;
    let i = 0;
    while (pick > gaps[i] && i < gaps.length - 1) pick -= gaps[i++];
    centres.push([...sample[i]]);
    sample.forEach((p, j) => { gaps[j] = Math.min(gaps[j], distance(p, sample[i])); });
  }
  const nearest = (p) => {
    let best = 0, dist = Infinity;
    centres.forEach((c, j) => {
      const d = distance(p, c);
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
      const d = distance([r, g, b], c);
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
