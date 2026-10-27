// Save a still or record a video, at the size the format asks for.

// Image: 4K on the long side. Video: what X and Instagram play (1080 wide, or 1920 long for screen).
const sizes = {
  '16:9': { image: [3840, 2160], video: [1920, 1080] },
  '9:16': { image: [2160, 3840], video: [1080, 1920] },
  '4:5': { image: [3072, 3840], video: [1080, 1350] },
  '1:1': { image: [3840, 3840], video: [1080, 1080] },
};

const even = (n) => Math.round(n / 2) * 2;

export function formatSize(format, kind, screenWidth, screenHeight) {
  if (sizes[format]) {
    const [width, height] = sizes[format][kind];
    return { width, height };
  }
  const long = kind === 'image' ? 3840 : 1920;
  const scale = long / Math.max(screenWidth, screenHeight);
  return { width: even(screenWidth * scale), height: even(screenHeight * scale) };
}

export function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// Draws one frame at the export size and reads it in the same task, before the browser clears it.
export function saveImage({ canvas, render, width, height }) {
  render(0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Could not read the image.'));
      download(blob, `pure-smoke-${width}x${height}-${stamp()}.png`);
      resolve(`${width} × ${height}`);
    }, 'image/png');
  });
}

const types = ['video/mp4;codecs=avc1.640033', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

// Records what the canvas draws while the render loop keeps running at the export size.
export async function recordVideo(ctx) {
  const { canvas, onProgress, seconds } = ctx;
  const type = types.find((t) => window.MediaRecorder?.isTypeSupported(t));
  if (!type) throw new Error('This browser cannot record video.');

  const stream = canvas.captureStream(60);
  const recorder = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 24_000_000 });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });

  recorder.start(250);
  const start = performance.now();
  await new Promise((resolve) => {
    const step = () => {
      const t = (performance.now() - start) / 1000;
      onProgress?.(Math.min(t / seconds, 1));
      if (t >= seconds || ctx.cancelled) return resolve();
      requestAnimationFrame(step);
    };
    step();
  });
  recorder.stop();
  await stopped;
  stream.getTracks().forEach((track) => track.stop());

  const extension = type.startsWith('video/mp4') ? 'mp4' : 'webm';
  download(new Blob(chunks, { type: type.split(';')[0] }), `pure-smoke-${canvas.width}x${canvas.height}-${stamp()}.${extension}`);
  return extension;
}
