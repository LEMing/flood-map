// Records the WebGL canvas to a downloadable clip. captureStream taps the
// compositor, so it works without `preserveDrawingBuffer`. We capture in MANUAL
// mode (captureStream(0)): the caller renders each frame and calls requestFrame(),
// so every video frame is a fully-rendered scrub position — no auto-sampler dropping
// or duplicating frames when the render rate wobbles. Pacing the requestFrame() calls
// at 1/fps gives a smooth, fixed-duration clip.
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

const STOP_WATCHDOG_MS = 4000; // some browsers never fire onstop — don't hang the flow

export class Recorder {
  readonly mimeType: string;
  private recorder?: MediaRecorder;
  private stream?: MediaStream;
  private track?: CanvasCaptureMediaStreamTrack;
  private readonly chunks: Blob[] = [];
  private errored = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
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
    this.stream = this.canvas.captureStream(0); // 0 = manual: frames only on requestFrame()
    this.track = this.stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack;
    this.recorder = new MediaRecorder(this.stream, {
      mimeType: this.mimeType,
      videoBitsPerSecond: this.bitsPerSecond,
    });
    this.recorder.ondataavailable = (e) => { if (e.data.size > 0) this.chunks.push(e.data); };
    this.recorder.onerror = () => { this.errored = true; };
    this.recorder.start();
  }

  /** Push the canvas's current contents as one video frame (manual pacing). */
  requestFrame(): void {
    this.track?.requestFrame();
  }

  async stop(): Promise<Blob> {
    const rec = this.recorder;
    if (!rec) return new Blob([], { type: this.mimeType });
    const blob = await new Promise<Blob>((resolve) => {
      let settled = false;
      let timer = 0;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        this.stream?.getTracks().forEach((tr) => tr.stop());
        resolve(new Blob(this.chunks, { type: this.mimeType }));
      };
      rec.onstop = finish;
      timer = window.setTimeout(finish, STOP_WATCHDOG_MS);
      try {
        rec.stop();
      } catch {
        this.errored = true;
        finish();
      }
    });
    if (this.errored) throw new Error('recording failed');
    return blob;
  }
}
