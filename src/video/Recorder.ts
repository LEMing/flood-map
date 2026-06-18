// Records the WebGL canvas to a webm clip. captureStream taps the compositor, so
// it works without `preserveDrawingBuffer`; auto-capture at a fixed fps keeps the
// output duration tied to wall-clock regardless of how fast each frame renders.

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

/** The best supported webm MIME, or null when the browser can't record webm (Safari). */
export function pickVideoMime(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return null;
  }
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

export class Recorder {
  private readonly mime: string;
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private readonly chunks: Blob[] = [];

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly fps = 30,
    private readonly bitsPerSecond = 12_000_000,
  ) {
    const mime = pickVideoMime();
    if (!mime) throw new Error('webm recording unsupported');
    this.mime = mime;
  }

  start(): void {
    this.stream = this.canvas.captureStream(this.fps);
    this.recorder = new MediaRecorder(this.stream, {
      mimeType: this.mime,
      videoBitsPerSecond: this.bitsPerSecond,
    });
    this.recorder.ondataavailable = (e) => { if (e.data.size > 0) this.chunks.push(e.data); };
    this.recorder.start();
  }

  async stop(): Promise<Blob> {
    const rec = this.recorder;
    if (!rec) return new Blob([], { type: this.mime });
    return new Promise<Blob>((resolve) => {
      rec.onstop = () => {
        this.stream?.getTracks().forEach((tr) => tr.stop());
        resolve(new Blob(this.chunks, { type: this.mime }));
      };
      rec.stop();
    });
  }
}
