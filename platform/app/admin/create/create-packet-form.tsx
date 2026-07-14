"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Stage = "idle" | "generating" | "building-template" | "error";

export function CreatePacketForm() {
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [requirements, setRequirements] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);

  const loading = stage === "generating" || stage === "building-template";

  const handleGenerate = async () => {
    setStage("generating");
    setError(null);
    try {
      const res = await fetch("/api/generate-packet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, specificRequirements: requirements }),
      });
      const result = await res.json();

      if (!result.success) {
        setStage("error");
        setError("Generation failed: " + result.error);
        return;
      }

      // Packet is safely in nuanced_analyses at this point regardless of what
      // happens next — convert it into an editable Assignment Studio template
      // so it opens in the existing editor with real PDF export.
      setStage("building-template");
      const bridgeRes = await fetch("/api/assignments/from-nuanced-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nuancedAnalysisId: result.packet.id }),
      });
      const bridgeResult = await bridgeRes.json();

      if (!bridgeResult.success) {
        setStage("error");
        setError(
          "Packet generated, but couldn't build an editable template: " +
            bridgeResult.error +
            " (the raw packet is still saved — ask to view it directly if needed).",
        );
        return;
      }

      router.push(`/dashboard/assignments/editor/${bridgeResult.templateId}`);
    } catch (err: any) {
      setStage("error");
      setError(err?.message ?? "Request failed");
    }
  };

  const buttonLabel =
    stage === "generating"
      ? "Forging Curriculum (this takes about 30 seconds)..."
      : stage === "building-template"
        ? "Building editable template..."
        : "Generate & Save to Database";

  return (
    <div className="max-w-2xl mx-auto p-6 mt-10 bg-white shadow-lg rounded-lg">
      <h1 className="text-2xl font-bold mb-6 text-teal-700">CleverPlatform Generator</h1>

      <input
        placeholder="Topic (e.g., Topic 4.2 Presentation of Data)"
        className="w-full p-3 border border-gray-300 rounded mb-4 focus:outline-none focus:border-teal-500"
        value={topic}
        onChange={(e) => setTopic(e.target.value)}
      />

      <textarea
        placeholder="Specific Requirements (e.g., Include a Broken Math Critique about outliers...)"
        className="w-full p-3 border border-gray-300 rounded mb-4 h-40 focus:outline-none focus:border-teal-500"
        value={requirements}
        onChange={(e) => setRequirements(e.target.value)}
      />

      {stage === "error" && error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-3">
          {error}
        </div>
      )}

      <button
        onClick={handleGenerate}
        disabled={loading}
        className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-3 px-4 rounded disabled:opacity-50"
      >
        {buttonLabel}
      </button>
    </div>
  );
}
