import { describe, it, expect } from 'vitest';
import { videoCaptureSupported } from './Recorder';

describe('videoCaptureSupported', () => {
  it('is false where WebCodecs is absent (e.g. the Node test env)', () => {
    expect(videoCaptureSupported()).toBe(false);
  });
});
