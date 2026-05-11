const CODE_RE = /^\d{2}[MN]\.\d\.[A-Z]+\.TZ\d[A-Z]?\.\w+_\d+$/;
const CODE_TOKEN_RE = /(\d{2}[MN]\.\d\.[A-Z]+\.TZ\d[A-Z]?\.\w+_\d+)/;

export type DriveDoc = { id: string; name: string; parents?: string[]; webViewLink?: string };

export function extractCodeToken(name: string): string | null {
  const trimmed = name.trim();
  if (CODE_RE.test(trimmed)) return trimmed;
  const match = trimmed.match(CODE_TOKEN_RE);
  return match ? match[1] : null;
}

export function pickBestCandidate(code: string, candidates: DriveDoc[], avoidId?: string): DriveDoc | undefined {
  if (candidates.length === 0) return undefined;

  const unique: DriveDoc[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue;
    seen.add(candidate.id);
    unique.push(candidate);
  }

  const exact = unique.filter((candidate) => candidate.name.trim() === code);
  const pool = exact.length > 0 ? exact : unique;

  if (avoidId && pool.length > 1) {
    const alternative = pool.find((candidate) => candidate.id !== avoidId);
    if (alternative) return alternative;
  }

  return pool[0];
}

export function isInExcludedFolderTree(doc: Pick<DriveDoc, "parents">, excludedFolderIds: Set<string>): boolean {
  if (excludedFolderIds.size === 0) return false;
  return doc.parents?.some((parentId) => excludedFolderIds.has(parentId)) ?? false;
}

export function filterDocsOutsideFolderTree(docs: DriveDoc[], excludedFolderIds: Set<string>): DriveDoc[] {
  if (excludedFolderIds.size === 0) return docs;
  return docs.filter((doc) => !isInExcludedFolderTree(doc, excludedFolderIds));
}