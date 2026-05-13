/**
 * Split raw OCR draft into a stem and per-part segments.
 * Splits on top-level part labels like "(a)", "(b)", "(c)" etc.
 * Everything before the first label → stem.
 * The label itself is stripped from each part's content.
 *
 * Exported separately from review-client.tsx so it can be unit-tested
 * without importing React or Next.js browser APIs.
 */
export function splitDraftIntoParts(draft: string, partLabels: string[]): { stem: string; parts: Map<string, string> } {
  const normalizeLabel = (raw: string | null | undefined): string => {
    if (!raw) return "";
    return raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z]/g, "");
  };

  const normalizedTargets = partLabels.map((l) => normalizeLabel(l)).filter(Boolean);
  const getTopLevelLabel = (normalized: string): string => {
    if (!normalized) return "";
    const nested = normalized.match(/^([a-z])(i|ii|iii|iv|v)$/);
    if (nested) return nested[1];
    if (/^[a-z]$/.test(normalized)) return normalized;
    return normalized[0] ?? "";
  };
  const topLevelLabels = new Set<string>();
  const orderedTopLevelLabels: string[] = [];
  normalizedTargets.forEach((target) => {
    const top = getTopLevelLabel(target);
    if (!top) return;
    topLevelLabels.add(top);
    if (!orderedTopLevelLabels.includes(top)) {
      orderedTopLevelLabels.push(top);
    }
  });

  const romanValue = (roman: string): number => {
    const map: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };
    return map[roman] ?? Number.MAX_SAFE_INTEGER;
  };

  const splitByRomanLabels = (text: string): { intro: string; parts: Map<string, string> } => {
    // Only match roman labels at line-start (after ^ or \n) to avoid splitting on
    // inline references like "see part (i) for details".
    const ROMAN_RE = /(^|\n)[ \t]*\((i|ii|iii|iv|v)\)(?=\s)/gi;
    const splits: { label: string; index: number; matchLen: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = ROMAN_RE.exec(text)) !== null) {
      splits.push({
        label: (m[2] ?? "").toLowerCase(),
        index: m.index + m[1].length,
        matchLen: m[0].length - m[1].length,
      });
    }

    const intro = (splits.length > 0 ? text.slice(0, splits[0].index) : text).trim();
    const parts = new Map<string, string>();
    for (let i = 0; i < splits.length; i++) {
      const contentStart = splits[i].index + splits[i].matchLen;
      const content = (i + 1 < splits.length
        ? text.slice(contentStart, splits[i + 1].index)
        : text.slice(contentStart)).trim();
      parts.set(splits[i].label, content);
    }
    return { intro, parts };
  };

  const expandCompositePartLabels = (parts: Map<string, string>): Map<string, string> => {
    const expanded = new Map<string, string>();

    parts.forEach((content, label) => {
      const base = normalizeLabel(label);
      if (!base) return;

      const expectedNested = normalizedTargets
        .filter((target) => target.startsWith(base) && target.length > base.length)
        .map((target) => target.slice(base.length))
        .filter((suffix) => /^(i|ii|iii|iv|v)$/.test(suffix))
        .sort((a, b) => romanValue(a) - romanValue(b));

      if (expectedNested.length === 0) {
        expanded.set(base, content);
        return;
      }

      const split = splitByRomanLabels(content);
      if (split.parts.size === 0) {
        // No visible roman markers: fallback to first expected nested label.
        expanded.set(`${base}${expectedNested[0]}`, content.trim());
        return;
      }

      const firstNested = expectedNested[0];
      let seededIntro = false;
      expectedNested.forEach((suffix) => {
        const nestedContent = split.parts.get(suffix);
        if (!nestedContent) return;
        const key = `${base}${suffix}`;
        if (!seededIntro && split.intro) {
          expanded.set(key, `${split.intro}\n${nestedContent}`.trim());
          seededIntro = true;
        } else {
          expanded.set(key, nestedContent);
        }
      });

      // If intro exists and no nested content matched expected labels, keep intro in first expected slot.
      if (!seededIntro && split.intro) {
        expanded.set(`${base}${firstNested}`, split.intro);
      }
    });

    return expanded;
  };

  const detectLeadingTopLabel = (content: string): string => {
    const m = content.match(/^\s*\(([a-z])\)\s*/i);
    const normalized = normalizeLabel(m?.[1]);
    if (!normalized) return "";
    if (topLevelLabels.size > 0 && !topLevelLabels.has(normalized)) return "";
    return normalized;
  };

  const stripLeadingTopLabel = (content: string, label: string): string => {
    if (!label) return content.trim();
    return content.replace(/^\s*\([a-z]\)\s*/i, "").trim();
  };

  const splitByPlainLabels = (text: string): { stem: string; parts: Map<string, string> } => {
    // Only match top-level labels at line-start (after ^ or \n + optional indent) to
    // avoid treating inline cross-references like "result from part (a) to prove" as
    // part-label boundaries.
    const PLAIN_RE = /(^|\n)[ \t]*\(([a-z])\)(?=\s)/gi;
    const plainSplits: { label: string; index: number; matchLen: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = PLAIN_RE.exec(text)) !== null) {
      const normalized = normalizeLabel(m[2]);
      if (topLevelLabels.size > 0 && !topLevelLabels.has(normalized)) {
        continue;
      }
      plainSplits.push({
        label: normalized,
        index: m.index + m[1].length,
        matchLen: m[0].length - m[1].length,
      });
    }

    const stem = (plainSplits.length > 0 ? text.slice(0, plainSplits[0].index) : text).trim();
    const parts = new Map<string, string>();
    for (let i = 0; i < plainSplits.length; i++) {
      const contentStart = plainSplits[i].index + plainSplits[i].matchLen;
      const content = (i + 1 < plainSplits.length
        ? text.slice(contentStart, plainSplits[i + 1].index)
        : text.slice(contentStart)).trim();
      parts.set(plainSplits[i].label, content);
    }
    return { stem, parts: expandCompositePartLabels(parts) };
  };

  // Strategy 1: split on \begin{IBPart}[letter] or \begin{IBPart}
  // Everything before the first \begin{IBPart} → stem
  // Each block between \begin{IBPart}...\end{IBPart} → one part in order

  const IBPART_OPEN_RE = /\\begin\{IBPart\}(?:\[\s*\(?([a-z]+)\)?\s*\])?/gi;
  const openMatches: { index: number; label: string | null; contentStart: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = IBPART_OPEN_RE.exec(draft)) !== null) {
    openMatches.push({ index: m.index, label: normalizeLabel(m[1]), contentStart: m.index + m[0].length });
  }

  if (openMatches.length > 0) {
    // Has \begin{IBPart} structure
    const leadingStem = draft.slice(0, openMatches[0].index).trim();
    const parts = new Map<string, string>();

    // Common OCR fallback: one unlabeled IBPart that still contains (a)/(b)/(c).
    // In that case, split inside the block by plain labels.
    if (openMatches.length === 1 && !openMatches[0].label) {
      const rawOnlyBlock = draft
        .slice(openMatches[0].contentStart)
        .replace(/\\end\{IBPart\}\s*$/i, "")
        .trim();
      const plain = splitByPlainLabels(rawOnlyBlock);
      if (plain.parts.size > 0) {
        return {
          stem: [leadingStem, plain.stem].filter(Boolean).join("\n\n").trim(),
          parts: expandCompositePartLabels(plain.parts),
        };
      }
      // Secondary fallback: IBPart uses \item (labels auto-generated by \alph*).
      // Split on \item boundaries and assign sequential a, b, c... labels.
      const itemChunks = rawOnlyBlock.split(/(?:^|\n)\s*\\item\b/).map((s) => s.trim()).filter(Boolean);
      if (itemChunks.length > 1) {
        const itemParts = new Map<string, string>();
        itemChunks.forEach((content, i) => {
          // Each chunk may start with an explicit (a) label — strip it if present.
          const labelMatch = content.match(/^\(([a-z])\)\s*/i);
          const label = labelMatch ? labelMatch[1].toLowerCase() : String.fromCharCode(97 + i);
          const body = labelMatch ? content.slice(labelMatch[0].length).trim() : content;
          itemParts.set(label, body);
        });
        return {
          stem: leadingStem,
          parts: expandCompositePartLabels(itemParts),
        };
      }
    }

    for (let i = 0; i < openMatches.length; i++) {
      const rawContent = i + 1 < openMatches.length
        ? draft.slice(openMatches[i].contentStart, openMatches[i + 1].index)
        : draft.slice(openMatches[i].contentStart);
      const content = rawContent.replace(/\\end\{IBPart\}\s*$/i, "").trim();
      const explicitLabel = openMatches[i].label;
      const detectedLabel = explicitLabel ? "" : detectLeadingTopLabel(content);

      // For unlabeled OCR blocks, split internal top-level labels (a/b/c...) first.
      // This handles common cases where one IBPart block contains both (b) and (c).
      if (!explicitLabel) {
        const plainFromBlock = splitByPlainLabels(content);
        if (plainFromBlock.parts.size > 0) {
          const entries = Array.from(plainFromBlock.parts.entries());
          if (plainFromBlock.stem && entries.length > 0) {
            entries[0][1] = `${plainFromBlock.stem}\n${entries[0][1]}`.trim();
          }
          entries.forEach(([lbl, val]) => {
            parts.set(lbl, val);
          });
          continue;
        }
      }

      const indexFallbackLabel = orderedTopLevelLabels[i]
        || getTopLevelLabel(normalizeLabel(partLabels[i]))
        || String.fromCharCode(97 + i);
      // Use explicit label, then detected leading marker from the block, then position fallback.
      const label = explicitLabel || detectedLabel || indexFallbackLabel;
      const normalizedContent = detectedLabel ? stripLeadingTopLabel(content, detectedLabel) : content;
      parts.set(label, normalizedContent);
    }
    return { stem: leadingStem, parts: expandCompositePartLabels(parts) };
  }

  // Strategy 2: plain (a)/(b)/(c) labels at line start
  return splitByPlainLabels(draft);
}
