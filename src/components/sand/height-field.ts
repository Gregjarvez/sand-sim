import type { ExpoWebGLRenderingContext } from 'expo-gl';

import { CELL, CELLS, planPasses, rakeOffset } from './geometry';
import { SCREEN_QUAD, createProgram, drawQuad } from './program';
import { simInitShader, simStepShader } from './sim-shaders';

// A blade's berm is far larger than a tooth's heap, and its face avalanches
// much faster than the blade advances. Extra passes confined to a band around
// the bar let it reach its natural slope. They draw only a strip over the band,
// so cells outside it keep their values; with an even number of passes the
// final texture is complete again.
const BERM_PASSES = 6;
const BERM_BAND = 0.08;

// The sand surface lives on the GPU in two RGBA8 textures used in turn: each
// pass reads one and writes the other. Byte textures are renderable on every
// WebGL device, unlike float targets.
export function createHeightField(gl: ExpoWebGLRenderingContext) {
  const init = createProgram(gl, simInitShader, []);
  const step = createProgram(gl, simStepShader,
    ['state', 'barFrom', 'barTo', 'offsetFrom', 'offsetTo', 'direction', 'sweep', 'blade', 'band'] as const);
  gl.useProgram(step.program);
  gl.uniform1i(step.uniforms.state, 0);
  const screen = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, screen);
  gl.bufferData(gl.ARRAY_BUFFER, SCREEN_QUAD, gl.STATIC_DRAW);
  const strip = gl.createBuffer()!;
  const stripCorners = new Float32Array(8);
  gl.bindBuffer(gl.ARRAY_BUFFER, strip);
  gl.bufferData(gl.ARRAY_BUFFER, stripCorners, gl.DYNAMIC_DRAW);

  const targets = [0, 1].map(() => {
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, CELLS, CELLS, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const framebuffer = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('The sand height field cannot be rendered on this device.');
    }
    return { texture, framebuffer };
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  let current = 0;

  function drawInto(target: number, buffer: WebGLBuffer) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, targets[target].framebuffer);
    gl.viewport(0, 0, CELLS, CELLS);
    drawQuad(gl, buffer);
  }

  // Covers the band along the bar, with a margin, from edge to edge of the field.
  function setStrip(angle: number) {
    const ux = Math.cos(angle) * 1.5, uy = Math.sin(angle) * 1.5;
    const nx = -Math.sin(angle) * (BERM_BAND + 2 * CELL), ny = Math.cos(angle) * (BERM_BAND + 2 * CELL);
    stripCorners.set([-ux - nx, -uy - ny, ux - nx, uy - ny, -ux + nx, -uy + ny, ux + nx, uy + ny]);
    gl.bindBuffer(gl.ARRAY_BUFFER, strip);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, stripCorners);
  }

  // Moves the tool from one angle to the next and lets the sand respond.
  function pass(fromAngle: number, toAngle: number, direction: number, blade: boolean, band: number) {
    gl.useProgram(step.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, targets[current].texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.uniform2f(step.uniforms.barFrom, Math.cos(fromAngle), Math.sin(fromAngle));
    gl.uniform2f(step.uniforms.barTo, Math.cos(toAngle), Math.sin(toAngle));
    gl.uniform1f(step.uniforms.offsetFrom, rakeOffset(fromAngle));
    gl.uniform1f(step.uniforms.offsetTo, rakeOffset(toAngle));
    gl.uniform1f(step.uniforms.direction, direction);
    gl.uniform1f(step.uniforms.sweep, Math.abs(toAngle - fromAngle));
    gl.uniform1f(step.uniforms.blade, blade ? 1 : 0);
    gl.uniform1f(step.uniforms.band, band);
    drawInto(1 - current, band > 0 ? strip : screen);
    current = 1 - current;
  }

  return {
    get texture() {
      return targets[current].texture;
    },
    reset() {
      gl.useProgram(init.program);
      drawInto(current, screen);
    },
    // Turns the tool from one angle to the next over dt seconds.
    move(fromAngle: number, toAngle: number, dt: number, direction: number, blade: boolean) {
      const passes = planPasses(fromAngle, toAngle, dt);
      for (let i = 1; i <= passes; i++) {
        const to = fromAngle + (toAngle - fromAngle) * i / passes;
        pass(fromAngle + (toAngle - fromAngle) * (i - 1) / passes, to, direction, blade, 0);
        if (!blade) continue;
        setStrip(to);
        for (let k = 0; k < BERM_PASSES; k++) pass(to, to, direction, true, BERM_BAND);
      }
    },
    // Raw cell bytes, for diagnostics and tests.
    read() {
      const pixels = new Uint8Array(CELLS * CELLS * 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, targets[current].framebuffer);
      gl.readPixels(0, 0, CELLS, CELLS, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return pixels;
    },
    dispose() {
      for (const { texture, framebuffer } of targets) {
        gl.deleteFramebuffer(framebuffer);
        gl.deleteTexture(texture);
      }
      gl.deleteBuffer(screen);
      gl.deleteBuffer(strip);
      gl.deleteProgram(init.program);
      gl.deleteProgram(step.program);
    },
  };
}
