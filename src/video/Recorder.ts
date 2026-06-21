// Records the WebGL canvas to a smooth, fixed-duration mp4 using WebCodecs. Each rendered
// frame is encoded with an EXPLICIT timestamp (index / fps), so the clip is mathematically
// even — no MediaRecorder wall-clock jitter, no dropped or duplicated frames. H.264 in an mp4
// container opens natively in QuickTime / Preview. The whole clip is built in memory and
// returned as a Blob. (Reading frames off the canvas relies on preserveDrawingBuffer.)
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

/** True when the browser can encode frame-accurate video (WebCodecs + canvas VideoFrame). */
export function videoCaptureSupported(): boolean {
  return typeof VideoEncoder === 'function' && typeof VideoFrame === 'function';
}

const KEYFRAME_EVERY_SEC = 2;
const MAX_LONG_SIDE = 1920; // 1080p-class: within H.264 level 4.0, universally playable, small file

export class Recorder {
  readonly fileExt = 'mp4';
  private muxer?: Muxer<ArrayBufferTarget>;
  private encoder?: VideoEncoder;
  private errored = false;
  // Encoded dimensions: the canvas downscaled to <=1080p and made even (a hi-DPI canvas can be
  // 4K-wide, which exceeds H.264 level 4.0 and would fail to configure). Frames are drawn through
  // a scratch 2D canvas at this size before encoding.
  readonly width: number;
  readonly height: number;
  private readonly scratch: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly frameDurUs: number;
  private readonly keyEvery: number;

  constructor(
    canvasW: number,
    canvasH: number,
    private readonly fps = 30,
    private readonly bitrate = 10_000_000,
  ) {
    const scale = Math.min(1, MAX_LONG_SIDE / Math.max(canvasW, canvasH));
    this.width = Math.max(2, Math.round(canvasW * scale)) & ~1;
    this.height = Math.max(2, Math.round(canvasH * scale)) & ~1;
    this.scratch = document.createElement('canvas');
    this.scratch.width = this.width;
    this.scratch.height = this.height;
    const ctx = this.scratch.getContext('2d');
    if (!ctx) throw new Error('2D context unavailable for video scaling');
    this.ctx = ctx;
    this.frameDurUs = Math.round(1e6 / fps);
    this.keyEvery = Math.max(1, Math.round(KEYFRAME_EVERY_SEC * fps));
  }

  start(): void {
    this.muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: 'avc', width: this.width, height: this.height },
      fastStart: 'in-memory',
    });
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => this.muxer?.addVideoChunk(chunk, meta),
      error: () => { this.errored = true; },
    });
    this.encoder.configure({
      codec: 'avc1.640028', // H.264 High
      width: this.width,
      height: this.height,
      bitrate: this.bitrate,
      framerate: this.fps,
    });
  }

  /** Encode one freshly-rendered frame at its exact even slot (index 0..N-1). */
  async addFrame(source: CanvasImageSource, index: number): Promise<void> {
    const enc = this.encoder;
    if (!enc) return;
    this.ctx.drawImage(source, 0, 0, this.width, this.height); // downscale to the encode size
    const frame = new VideoFrame(this.scratch, {
      timestamp: index * this.frameDurUs,
      duration: this.frameDurUs,
    });
    enc.encode(frame, { keyFrame: index % this.keyEvery === 0 });
    frame.close();
    while (enc.encodeQueueSize > 4) await delay(2); // backpressure: don't outrun the encoder
  }

  async finish(): Promise<Blob> {
    if (!this.encoder || !this.muxer) return new Blob([], { type: 'video/mp4' });
    await this.encoder.flush();
    this.muxer.finalize();
    if (this.errored) throw new Error('recording failed');
    return new Blob([this.muxer.target.buffer as ArrayBuffer], { type: 'video/mp4' });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
