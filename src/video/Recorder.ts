// Records the WebGL canvas to a downloadable clip. captureStream taps the
// compositor, so it works without `preserveDrawingBuffer`; auto-capture at a
// fixed fps keeps the output duration tied to wall-clock.
//
// Format: prefer MP4 / H.264 — it opens natively in QuickTime / Preview, whereas
// a .webm trips macOS Gatekeeper ("Apple could not verify … is free of malware").
// Modern Chrome MediaRecorder can mux fragmented MP4; we fall back to webm only
// where it can't (older Chrome, Firefox).
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.640028', // H.264 High
  'video/mp4;codecs=avc1.42E01E', // H.264 Baseline
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/** The best supported recording MIME, or null when the browser can't record. */
export function pickVideoMime(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return null;
  }
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

/** File extension matching a recording MIME ('mp4' for QuickTime-friendly output). */
export function videoExt(mime: string): string {
  return mime.startsWith('video/mp4') ? 'mp4' : 'webm';
}

export class Recorder {
  readonly mimeType: string;
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private readonly chunks: Blob[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly fps = 30,
    private readonly bitsPerSecond = 12_000_000,
  ) {
    const mime = pickVideoMime();
    if (!mime) throw new Error('video recording unsupported');
    this.mimeType = mime;
  }

  /** 'mp4' or 'webm' — the container actually produced. */
  get fileExt(): string {
    return videoExt(this.mimeType);
  }

  start(): void {
    this.stream = this.canvas.captureStream(this.fps);
    this.recorder = new MediaRecorder(this.stream, {
      mimeType: this.mimeType,
      videoBitsPerSecond: this.bitsPerSecond,
    });
    this.recorder.ondataavailable = (e) => { if (e.data.size > 0) this.chunks.push(e.data); };
    this.recorder.start();
  }

  async stop(): Promise<Blob> {
    const rec = this.recorder;
    if (!rec) return new Blob([], { type: this.mimeType });
    return new Promise<Blob>((resolve) => {
      rec.onstop = () => {
        this.stream?.getTracks().forEach((tr) => tr.stop());
        resolve(new Blob(this.chunks, { type: this.mimeType }));
      };
      rec.stop();
    });
  }
}
