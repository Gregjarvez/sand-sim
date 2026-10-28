import type { ExpoWebGLRenderingContext } from 'expo-gl';

export const quadVertexShader = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

export const SCREEN_QUAD = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

// Draws a quad given as a four-corner triangle strip, from attribute location 0.
export function drawQuad(gl: ExpoWebGLRenderingContext, buffer: WebGLBuffer) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// Every program reads quad corners from attribute location 0.
export function createProgram<Name extends string>(
  gl: ExpoWebGLRenderingContext, fragmentSource: string, uniformNames: readonly Name[]
) {
  function compile(type: number, source: string) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(message ?? 'Could not compile a sand shader.');
    }
    return shader;
  }

  const vertex = compile(gl.VERTEX_SHADER, quadVertexShader);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram()!;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, 'position');
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'Could not link a sand shader.');
  }
  const uniforms = Object.fromEntries(
    uniformNames.map((name) => [name, gl.getUniformLocation(program, name)])
  ) as Record<Name, WebGLUniformLocation | null>;
  return { program, uniforms };
}
