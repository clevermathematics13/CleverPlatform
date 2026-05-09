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
    const startedAt = Date.now();
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
    const scriptExists = fs.existsSync(scriptPath);

    // Write input payload to avoid shell escaping/argv-size issues with large base64 strings
    fs.writeFileSync(inputFile, JSON.stringify({ image: b64Image }), "utf-8");

    // Prefer configured env python, then known absolute paths, then command names.
    const absoluteCandidates = [
      process.env.GRAPH_LAB_CV_PYTHON,
      process.env.PYTHON,
      process.env.VIRTUAL_ENV ? path.join(process.env.VIRTUAL_ENV, "bin/python") : undefined,
      process.env.VIRTUAL_ENV ? path.join(process.env.VIRTUAL_ENV, "bin/python3") : undefined,
      "/home/codespace/.python/current/bin/python3",
      "/home/codespace/.python/current/bin/python",
      "/usr/bin/python3",
      "/usr/local/bin/python3",
    ].filter((value): value is string => Boolean(value));

    const commandCandidates = ["python3", "python"];
    const pythonCandidates = [...absoluteCandidates, ...commandCandidates];

    const canRun = (candidate: string): { runnable: boolean; reason?: string } => {
      if (candidate.includes("/")) {
        return fs.existsSync(candidate)
          ? { runnable: true }
          : { runnable: false, reason: "path does not exist" };
      }
      const probe = spawnSync(candidate, ["--version"], {
        env: process.env,
        encoding: "utf-8",
        timeout: 2000,
      });
      if (probe.error) {
        return { runnable: false, reason: probe.error.message };
      }
      return { runnable: true };
    };

    const candidateResolution = pythonCandidates.map((candidate) => {
      const probe = canRun(candidate);
      return {
        candidate,
        kind: candidate.includes("/") ? "absolute" : "command",
        runnable: probe.runnable,
        reason: probe.reason,
      };
    });

    const pythonExec =
      candidateResolution.find((candidate) => candidate.runnable)?.candidate ||
      "python3";

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
    const durationMs = Date.now() - startedAt;

    const stderrText = (proc.stderr || "").toString().trim();
    const stdoutText = (proc.stdout || "").toString().trim();

    const debugMetadata = {
      runtime: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      request: {
        receivedAt: new Date(startedAt).toISOString(),
        imageCount: images.length,
        firstImageBase64Chars: b64Image.length,
        mediaType: body.mediaType ?? null,
      },
      execution: {
        cwd: process.cwd(),
        pathPreview: (process.env.PATH || "").split(":").slice(0, 12),
        tmpDir,
        scriptPath,
        scriptExists,
        pythonSelected: pythonExec,
        pythonCandidates: candidateResolution,
        args,
        durationMs,
      },
      processResult: {
        exitCode: proc.status,
        signal: proc.signal,
        spawnError: proc.error?.message ?? null,
        stderrPreview: stderrText ? stderrText.slice(0, 1500) : null,
        stdoutPreview: stdoutText ? stdoutText.slice(0, 700) : null,
        stderrBytes: stderrText.length,
        stdoutBytes: stdoutText.length,
      },
    };

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
          metadata: debugMetadata,
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
          metadata: {
            ...(result.metadata || {}),
            debug: debugMetadata,
          },
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
      metadata: {
        ...(result.metadata || {}),
        debug: debugMetadata,
      },
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
