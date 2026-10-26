// Save a 4K still, or record the canvas to a video file.

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function stamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function setRatio({ renderer, composer, width, height }, ratio) {
  renderer.setPixelRatio(ratio);
  renderer.setSize(width, height, false);
  composer.setPixelRatio(ratio);
  composer.setSize(width, height);
}

// The long side becomes 3840 px. The frame is drawn once more at that size, read, then the
// canvas goes back to screen size before the next frame.
export function saveImage(ctx) {
  const { renderer, render, width, height } = ctx;
  const screen = renderer.getPixelRatio();
  const ratio = 3840 / Math.max(width, height);
  setRatio(ctx, ratio);
  render(0);
  return new Promise((resolve, reject) => {
    renderer.domElement.toBlob((blob) => {
      if (!blob) return reject(new Error('Could not read the image.'));
      download(blob, `pure-smoke-${stamp()}.png`);
      resolve(`${Math.round(width * ratio)} × ${Math.round(height * ratio)}`);
    }, 'image/png');
    setRatio(ctx, screen);
  });
}

const types = ['video/mp4;codecs=avc1.640033', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Records what the canvas shows, at up to 1920 px on the long side (the size X plays).
export async function recordVideo(ctx) {
  const { renderer, canvas, width, height, onProgress, seconds } = ctx;
  const type = types.find((t) => window.MediaRecorder?.isTypeSupported(t));
  if (!type) throw new Error('This browser cannot record video.');

  // Give the cube time to glide back to the centre before the first frame.
  await wait(450);
  const screen = renderer.getPixelRatio();
  setRatio(ctx, Math.min(screen, 1920 / Math.max(width, height)));

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
  setRatio(ctx, screen);

  const extension = type.startsWith('video/mp4') ? 'mp4' : 'webm';
  download(new Blob(chunks, { type: type.split(';')[0] }), `pure-smoke-${stamp()}.${extension}`);
  return extension;
}
