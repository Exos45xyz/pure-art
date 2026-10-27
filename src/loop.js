// Encodes what the canvas draws into an MP4 (H.264), one frame at a time at an exact rate, so a
// render never depends on how fast the computer is. Loaded only when a loop is recorded.
import { ArrayBufferTarget, Muxer } from 'mp4-muxer';

export async function createEncoder(canvas, fps) {
  const { width, height } = canvas;
  const config = { codec: 'avc1.640033', width, height, bitrate: 24_000_000, framerate: fps, avc: { format: 'avc' } };
  if (!(await VideoEncoder.isConfigSupported(config)).supported) throw new Error('This browser cannot encode this video.');

  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width, height, frameRate: fps }, fastStart: 'in-memory' });
  let failure = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { failure = e; },
  });
  encoder.configure(config);
  let index = 0;

  return {
    // Adds what the canvas holds now as the next frame. Call it right after drawing, in the same task.
    async add() {
      if (failure) throw failure;
      const frame = new VideoFrame(canvas, { timestamp: Math.round((index * 1e6) / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: index % (fps * 2) === 0 });
      frame.close();
      index++;
      // Let the encoder keep up rather than queue hundreds of frames.
      while (encoder.encodeQueueSize > 4) await new Promise((resolve) => setTimeout(resolve, 2));
    },
    async finish() {
      await encoder.flush();
      if (failure) throw failure;
      muxer.finalize();
      encoder.close();
      return new Blob([muxer.target.buffer], { type: 'video/mp4' });
    },
    cancel() {
      if (encoder.state !== 'closed') encoder.close();
    },
  };
}
