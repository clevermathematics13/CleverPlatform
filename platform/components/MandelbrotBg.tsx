"use client";

import { useEffect, useRef } from "react";

const MAX_ITER = 256;
const CYCLE_SECONDS = 120; // full color cycle takes 120 seconds

// Precompute escape counts into a flat array once, reuse every frame
function buildEscapeCounts(width: number, height: number): Float32Array {
  const counts = new Float32Array(width * height);
  // Mandelbrot viewport: centered around (-0.65, 0), zoomed to show classic shape
  const xMin = -2.4;
  const xMax = 0.85;
  const yMin = -1.25;
  const yMax = 1.25;

  for (let py = 0; py < height; py++) {
    const ci = yMin + (py / height) * (yMax - yMin);
    for (let px = 0; px < width; px++) {
      const cr = xMin + (px / width) * (xMax - xMin);
      let zr = 0, zi = 0;
      let iter = 0;
      while (iter < MAX_ITER && zr * zr + zi * zi <= 4) {
        const tmp = zr * zr - zi * zi + cr;
        zi = 2 * zr * zi + ci;
        zr = tmp;
        iter++;
      }
      // Smooth coloring
      if (iter < MAX_ITER) {
        const log2 = Math.log2(zr * zr + zi * zi);
        counts[py * width + px] = iter + 1 - Math.log2(log2 / 2);
      } else {
        counts[py * width + px] = -1; // inside set
      }
    }
  }
  return counts;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

export function MandelbrotBg({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const W = 256;
    const H = 512;
    canvas.width = W;
    canvas.height = H;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const escapeCounts = buildEscapeCounts(W, H);
    const imageData = ctx.createImageData(W, H);
    const data = imageData.data;

    let animFrame: number;
    let startTime: number | null = null;

    function draw(ts: number) {
      if (startTime === null) startTime = ts;
      const elapsed = (ts - startTime) / 1000; // seconds
      // hue offset: full 360° cycle over CYCLE_SECONDS
      const hueOffset = (elapsed / CYCLE_SECONDS) * 360;

      for (let i = 0; i < escapeCounts.length; i++) {
        const v = escapeCounts[i];
        const idx = i * 4;
        if (v < 0) {
          // Inside set: very dark navy
          data[idx] = 10; data[idx + 1] = 8; data[idx + 2] = 24; data[idx + 3] = 255;
        } else {
          // Map smooth count to hue with slow cycling
          const hue = (hueOffset + (v / MAX_ITER) * 360 * 3) % 360;
          const sat = 75;
          const lit = 35 + ((v % 20) / 20) * 25; // subtle lightness variation
          const [r, g, b] = hslToRgb(hue, sat, lit);
          data[idx] = r; data[idx + 1] = g; data[idx + 2] = b; data[idx + 3] = 255;
        }
      }
      ctx!.putImageData(imageData, 0, 0);
      animFrame = requestAnimationFrame(draw);
    }

    animFrame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animFrame);
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
        objectFit: "cover",
        pointerEvents: "none",
      }}
    />
  );
}
