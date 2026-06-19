import { describe, it, expect } from 'vitest';
import { videoExt } from './Recorder';

describe('videoExt — container extension from MIME', () => {
  it('maps every mp4 MIME to .mp4 (QuickTime-friendly)', () => {
    expect(videoExt('video/mp4;codecs=avc1.640028')).toBe('mp4');
    expect(videoExt('video/mp4')).toBe('mp4');
  });

  it('maps webm MIMEs to .webm', () => {
    expect(videoExt('video/webm;codecs=vp9')).toBe('webm');
    expect(videoExt('video/webm')).toBe('webm');
  });
});
