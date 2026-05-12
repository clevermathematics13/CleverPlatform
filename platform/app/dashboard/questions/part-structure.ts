export function hasExplicitTopLevelPartStructure(text: string): boolean {
  if (!text.trim()) return false;
  const hasLabelledIBPart = /\\begin\{IBPart\}\s*\[\s*\(?[a-z](?:i|ii|iii|iv|v)?\)?\s*\]/i.test(text);
  const hasLabelledItem = /\\item\s*\[\s*\(?[a-z](?:i|ii|iii|iv|v)?\)?\s*\]/i.test(text);
  const hasLineStartTopLabel = /(?:^|\n)\s*\(([a-z])\)\s+/i.test(text);
  return hasLabelledIBPart || hasLabelledItem || hasLineStartTopLabel;
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function shouldBlockPartAutoSave(params: {
  expectedLabels: string[];
  splitQuestion: Map<string, string>;
  splitMarkscheme: Map<string, string>;
}): { block: boolean; reason: string | null } {
  const expected = new Set(
    params.expectedLabels
      .map(normalizeLabel)
      .filter(Boolean),
  );

  // Only gate multipart questions; single-part/whole-question flows are handled elsewhere.
  if (expected.size <= 1) {
    return { block: false, reason: null };
  }

  const mergedLabels = new Set<string>([
    ...params.splitQuestion.keys(),
    ...params.splitMarkscheme.keys(),
  ]);

  const populated = new Set<string>();
  for (const rawLabel of mergedLabels) {
    const q = (params.splitQuestion.get(rawLabel) ?? "").trim();
    const ms = (params.splitMarkscheme.get(rawLabel) ?? "").trim();
    if (!q && !ms) continue;
    const normalized = normalizeLabel(rawLabel);
    if (normalized) populated.add(normalized);
  }

  if (populated.size < expected.size) {
    return {
      block: true,
      reason: `extracted ${populated.size} populated part(s) but expected ${expected.size}`,
    };
  }

  const unexpected = Array.from(populated).filter((l) => !expected.has(l));
  if (unexpected.length > 0) {
    return {
      block: true,
      reason: `extracted unexpected part label(s): ${unexpected.join(", ")}`,
    };
  }

  return { block: false, reason: null };
}

export function shouldTrustMultipartWithoutExplicit(params: {
  claudeLabelsCount: number;
  splitProbePartsCount: number;
}): boolean {
  return params.claudeLabelsCount >= 2 && params.splitProbePartsCount >= 2;
}