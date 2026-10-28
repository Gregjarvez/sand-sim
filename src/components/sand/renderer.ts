import type { ExpoWebGLRenderingContext } from 'expo-gl';

import { rakeOffset } from './geometry';
import { createHeightField } from './height-field';
import { SCREEN_QUAD, createProgram, drawQuad } from './program';
import { fragmentShader } from './shaders';

// Small slips finish in a fraction of a second; keep simulating briefly after
// the rake stops so abandoned heaps can collapse, then leave the sand at rest.
const SETTLE_SECONDS = 1.5;

// Twelve-toothed rake arms, or a flat blade on each arm.
export type RakeTool = 'teeth' | 'blade';

export type SandState = {
  tool: RakeTool;
  angle: number;
  direction: number;
  resetId: number;
  playing: boolean;
  speed: number;
};

export function turnRake(state: SandState, delta: number) {
  if (delta !== 0) state.direction = Math.sign(delta);
  state.angle += delta;
}

export function createRenderer(gl: ExpoWebGLRenderingContext, state: SandState) {
  const buffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, SCREEN_QUAD, gl.STATIC_DRAW);
  const field = createHeightField(gl);
  const scene = createProgram(gl, fragmentShader, ['resolution', 'angle', 'rakeOffset', 'direction', 'blade', 'sand'] as const);
  gl.useProgram(scene.program);
  gl.uniform1i(scene.uniforms.sand, 0);
  field.reset();
  let simulatedAngle = state.angle;
  let resetId = state.resetId;
  let quiet = 0;

  return {
    // Returns whether the sand changed.
    advance(dt: number) {
      if (state.resetId !== resetId) {
        resetId = state.resetId;
        field.reset();
        simulatedAngle = state.angle;
        quiet = 0;
      }
      quiet = state.angle === simulatedAngle ? quiet + dt : 0;
      if (quiet > SETTLE_SECONDS) return false;
      field.move(simulatedAngle, state.angle, dt, state.direction, state.tool === 'blade');
      simulatedAngle = state.angle;
      return true;
    },
    draw() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.useProgram(scene.program);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, field.texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.uniform2f(scene.uniforms.resolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.uniform1f(scene.uniforms.angle, state.angle);
      gl.uniform1f(scene.uniforms.rakeOffset, rakeOffset(state.angle));
      gl.uniform1f(scene.uniforms.direction, state.direction);
      gl.uniform1f(scene.uniforms.blade, state.tool === 'blade' ? 1 : 0);
      drawQuad(gl, buffer);
      gl.flush();
      gl.endFrameEXP();
    },
    dispose() {
      field.dispose();
      gl.deleteBuffer(buffer);
      gl.deleteProgram(scene.program);
    },
  };
}
