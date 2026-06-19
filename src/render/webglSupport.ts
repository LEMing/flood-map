// Capability probe for the float-render-target flood sim. WebGL2 is required
// (three r184's WebGLRenderer throws in its constructor without it) and the
// EXT_color_buffer_float extension is required for the FloatType simulation
// render targets (GPUComputationRenderer in FloodSimulation.ts). Without the
// extension those targets go framebuffer-incomplete and the water silently never
// renders, so we probe once up front and fail soft with a clear message instead.

export interface WebGLSupport {
  ok: boolean;
  reason: 'ok' | 'no-webgl2' | 'no-float-rt';
}

let cached: WebGLSupport | undefined;

export function detectWebGLSupport(): WebGLSupport {
  cached ??= probe();
  return cached;
}

function probe(): WebGLSupport {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return { ok: false, reason: 'no-webgl2' };
    const hasFloatRT = !!gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('WEBGL_lose_context')?.loseContext(); // free the probe context immediately
    return hasFloatRT ? { ok: true, reason: 'ok' } : { ok: false, reason: 'no-float-rt' };
  } catch {
    return { ok: false, reason: 'no-webgl2' };
  }
}
