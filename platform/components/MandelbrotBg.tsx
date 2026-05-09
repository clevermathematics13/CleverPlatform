"use client";

import { useEffect, useRef } from "react";

// WebGL fragment shader — animated Julia set, dark purple/crimson palette
const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2  u_res;
uniform float u_time;

const int MAX_ITER = 180;

// Dark purple / crimson palette — maps [0,1] to a deep swirling colour
vec3 palette(float t) {
  // base: very dark indigo
  vec3 a = vec3(0.05, 0.00, 0.12);
  // amplitude: deep crimson to violet
  vec3 b = vec3(0.42, 0.02, 0.28);
  // frequency / phase chosen for slow swirl variety
  vec3 c = vec3(1.0,  0.7,  1.2);
  vec3 d = vec3(0.00, 0.25, 0.50);
  return a + b * cos(6.28318 * (c * t + d));
}

void main() {
  // Normalised coords centred at origin, aspect-corrected
  vec2 uv = (gl_FragCoord.xy / u_res.xy) * 2.0 - 1.0;
  uv.x *= u_res.x / u_res.y;

  // Julia parameter orbits slowly near the boundary of the Mandelbrot set
  // Chosen base point: (-0.7269, 0.1889) — classic swirly Julia
  // We add a tiny slow orbit so it appears to breathe / rotate
  float t = u_time * 0.012;          // very slow time
  vec2 c = vec2(-0.7269 + 0.012 * cos(t * 0.7),
                 0.1889 + 0.012 * sin(t * 1.1));

  // Zoom: gentle inward breathing
  float zoom = 1.35 + 0.15 * sin(t * 0.4);
  vec2 z = uv / zoom;

  float iter = 0.0;
  float len2 = 0.0;
  for (int i = 0; i < MAX_ITER; i++) {
    if (len2 > 4.0) break;
    z = vec2(z.x*z.x - z.y*z.y, 2.0*z.x*z.y) + c;
    len2 = dot(z, z);
    iter += 1.0;
  }

  if (iter >= float(MAX_ITER)) {
    // Inside the set: near-black deep indigo
    gl_FragColor = vec4(0.02, 0.00, 0.06, 1.0);
  } else {
    // Smooth escape + very slow colour cycle
    float smooth_iter = iter - log2(log2(len2)) + 4.0;
    float col = smooth_iter / float(MAX_ITER);
    // Add a very slow global phase drift for the "swirling" feel
    col = fract(col * 3.5 + u_time * 0.004);
    vec3 rgb = palette(col);
    gl_FragColor = vec4(rgb, 1.0);
  }
}
`;

function compileShader(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)!;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  return sh;
}

export function MandelbrotBg({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl", { antialias: false, alpha: false });
    if (!gl) return; // fallback: canvas stays black — acceptable

    const vert = compileShader(gl, gl.VERTEX_SHADER, VERT);
    const frag = compileShader(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram()!;
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    gl.useProgram(prog);

    // Full-screen quad
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const uRes  = gl.getUniformLocation(prog, "u_res");
    const uTime = gl.getUniformLocation(prog, "u_time");

    let raf: number;
    const startMs = performance.now();

    function resize() {
      const w = canvas!.clientWidth  || 256;
      const h = canvas!.clientHeight || 512;
      if (canvas!.width !== w || canvas!.height !== h) {
        canvas!.width  = w;
        canvas!.height = h;
        gl!.viewport(0, 0, w, h);
      }
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    function draw() {
      resize();
      const elapsed = (performance.now() - startMs) / 1000;
      gl!.uniform2f(uRes, canvas!.width, canvas!.height);
      gl!.uniform1f(uTime, elapsed);
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        display: "block",
        pointerEvents: "none",
      }}
    />
  );
}
