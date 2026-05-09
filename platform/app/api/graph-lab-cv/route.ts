/**
 * POST /api/graph-lab-cv
 *
 * Deterministic CV-based graph extraction endpoint.
 * Spawns the cv_graph_extract.py script and returns results.
 *
 * Body:
 *   {
 *     images: string[];          // base64-encoded images
 *     mediaType?: string;        // "image/png" | "image/jpeg"
 *   }
 *
 * Returns:
 *   { graphSpec, graphMeta, metadata, warnings }
 */

import { NextRequest, NextResponse } from "next/server";
import { spawnSync } from "child_process";
import path from "path";
import os from "os";
import fs from "fs";

export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    images: string[];
    mediaType?: string;
  };

  const { images } = body;

  if (!images?.length) {
    return NextResponse.json(
      { error: "At least one image is required" },
      { status: 400 }
    );
  }

  try {
    // Use the first image for extraction
    const b64Image = images[0];

    // Prepare temp file for output
    const tmpDir = os.tmpdir();
    const inputFile = path.join(tmpDir, `cv-extract-input-${Date.now()}.json`);
    const outputFile = path.join(tmpDir, `cv-extract-${Date.now()}.json`);

    // Call the Python script via subprocess
    const scriptPath = path.join(
      process.cwd(),
      "scripts/cv_graph_extract.py"
    );

    // Write input payload to avoid shell escaping/argv-size issues with large base64 strings
    fs.writeFileSync(inputFile, JSON.stringify({ image: b64Image }), "utf-8");

    // Prefer configured env python, then explicit codespace python, then python3
    const pythonCandidates = [
      process.env.GRAPH_LAB_CV_PYTHON,
      process.env.PYTHON,
      "/home/codespace/.python/current/bin/python",
      "python3",
    ].filter((value): value is string => Boolean(value));

    const pythonExec =
      pythonCandidates.find((candidate) =>
        candidate.includes("/") ? fs.existsSync(candidate) : true
      ) || "python3";

    const args = [
      scriptPath,
      "--input-file",
      inputFile,
      "--output",
      outputFile,
    ];

    const env = { ...process.env, PYTHONUNBUFFERED: "1" };

    const proc = spawnSync(pythonExec, args, {
      env,
      encoding: "utf-8",
      timeout: 25000, // Leave 5s buffer for response time
      maxBuffer: 50 * 1024 * 1024, // 50MB for large results
    });

    const stderrText = (proc.stderr || "").toString().trim();

    // Read and parse output
    if (!fs.existsSync(outputFile)) {
      try { fs.unlinkSync(inputFile); } catch { /* ignore */ }

      // Surface Python stderr so it appears in the debug packet warnings
      const debugWarnings: string[] = [];
      if (stderrText) debugWarnings.push(`Python stderr: ${stderrText}`);
      if (proc.status !== null && proc.status !== 0)
        debugWarnings.push(`Exit code: ${proc.status}`);
      if (proc.signal) debugWarnings.push(`Killed by signal: ${proc.signal}`);
      if (proc.error) debugWarnings.push(`Spawn error: ${proc.error.message}`);
      debugWarnings.push(`Python exec: ${pythonExec}`);

      return NextResponse.json(
        {
          error: "CV extraction script did not produce output",
          warnings: debugWarnings,
          feedback: [],
          metadata: { exitCode: proc.status, signal: proc.signal, pythonExec },
        },
        { status: 500 }
      );
    }

    const resultText = fs.readFileSync(outputFile, "utf-8");
    const result = JSON.parse(resultText);

    // Clean up
    try {
      fs.unlinkSync(outputFile);
    } catch {
      // Ignore cleanup errors
    }
    try {
      fs.unlinkSync(inputFile);
    } catch {
      // Ignore cleanup errors
    }

    if (result.error) {
      return NextResponse.json(
        {
          error: result.error,
          graphSpec: result.graphSpec,
          graphMeta: result.graphMeta,
          metadata: result.metadata || {},
          warnings: result.metadata?.warnings || [],
          feedback: result.feedback || ["Manual review required before accepting extraction output."],
        },
        { status: 422 }
      );
    }

    // Success: return in standard format
    return NextResponse.json({
      graphSpec: result.graphSpec,
      graphMeta: result.graphMeta,
      warnings: result.metadata?.warnings || [],
      feedback: [
        "CV extraction is deterministic and based on actual image data.",
        "Review the selected curve family, confidence, and domain bounds.",
        "Fallback piecewise output is used only when family-fit confidence is insufficient.",
      ],
      metadata: result.metadata,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: "CV extraction failed: " + message,
        warnings: ["Subprocess error or Python environment issue"],
      },
      { status: 500 }
    );
  }
}
