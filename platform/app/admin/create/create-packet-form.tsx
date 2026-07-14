"use client";
import { useState } from "react";

export function CreatePacketForm() {
  const [topic, setTopic] = useState("");
  const [requirements, setRequirements] = useState("");
  const [loading, setLoading] = useState(false);

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/generate-packet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, specificRequirements: requirements }),
      });
      const result = await res.json();

      if (result.success) {
        alert("Packet successfully generated and saved to Supabase!");
      } else {
        alert("Error: " + result.error);
      }
    } catch (err: any) {
      alert("Error: " + (err?.message ?? "Request failed"));
    } finally {
      setLoading(false);
    }
  };

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

      <button
        onClick={handleGenerate}
        disabled={loading}
        className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-3 px-4 rounded disabled:opacity-50"
      >
        {loading ? "Forging Curriculum (This takes about 30 seconds)..." : "Generate & Save to Database"}
      </button>
    </div>
  );
}
