/**
 * Pulling a Google Doc's images into the PPQ bank: the question Doc and the
 * mark-scheme Doc each ib_questions row links to. Shared by the per-question
 * Extract (app/api/questions/extract-images) and Extract all images
 * (app/api/questions/extract-all-images), which used to carry a copy each.
 */

import { google, type docs_v1 } from "googleapis";
import { OAuth2Client } from "google-auth-library";

export function getAuthedClient(token: Record<string, unknown>): OAuth2Client {
  const oauth2 = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2.setCredentials(token);
  return oauth2;
}

export interface DocImage {
  objectId: string;
  contentUri: string;
  width: number;
  height: number;
}

/**
 * A Doc's inline-object ids in the order they appear on the page: paragraphs
 * top to bottom, tables row by row and cell by cell (tables inside tables
 * too), tables of contents. doc.inlineObjects is a map keyed by object id,
 * and its order has nothing to do with the page: a mark scheme pulled in
 * that order came out with part (c) first. Objects the body never refers to
 * go last, in the map's own order.
 */
export function inlineObjectIdsInDocumentOrder(
  body: docs_v1.Schema$Body | null | undefined,
  inlineObjectIds: readonly string[]
): string[] {
  const known = new Set(inlineObjectIds);
  const seen = new Set<string>();
  const ordered: string[] = [];
  const walk = (content: docs_v1.Schema$StructuralElement[] | null | undefined) => {
    for (const element of content ?? []) {
      for (const part of element.paragraph?.elements ?? []) {
        const id = part.inlineObjectElement?.inlineObjectId;
        if (id && known.has(id) && !seen.has(id)) {
          seen.add(id);
          ordered.push(id);
        }
      }
      for (const row of element.table?.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) walk(cell.content);
      }
      walk(element.tableOfContents?.content);
    }
  };
  walk(body?.content);
  for (const id of inlineObjectIds) if (!seen.has(id)) ordered.push(id);
  return ordered;
}

/** Every inline image of a Doc, in document order. */
export async function getDocImages(auth: OAuth2Client, docId: string): Promise<DocImage[]> {
  const docs = google.docs({ version: "v1", auth });
  const { data: doc } = await docs.documents.get({ documentId: docId });
  const objects = doc.inlineObjects ?? {};
  const images: DocImage[] = [];
  for (const objectId of inlineObjectIdsInDocumentOrder(doc.body, Object.keys(objects))) {
    const embedded = objects[objectId]?.inlineObjectProperties?.embeddedObject;
    if (!embedded?.imageProperties?.contentUri) continue;
    images.push({
      objectId,
      contentUri: embedded.imageProperties.contentUri,
      width: embedded.size?.width?.magnitude ?? 0,
      height: embedded.size?.height?.magnitude ?? 0,
    });
  }
  return images;
}

/** Download an image from a URI using the authenticated client. */
export async function downloadImage(auth: OAuth2Client, uri: string): Promise<{ buffer: Buffer; contentType: string }> {
  const accessToken = (await auth.getAccessToken()).token;
  const res = await fetch(uri, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Failed to download image: ${res.status} ${res.statusText}`);
  const contentType = res.headers.get("content-type") ?? "image/png";
  return { buffer: Buffer.from(await res.arrayBuffer()), contentType };
}

export function extensionForType(contentType: string): string {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("svg")) return "svg";
  return "png";
}

export function isDriveFileNotFound(err: unknown): boolean {
  const status =
    (err as { code?: number; response?: { status?: number } } | null)?.code ??
    (err as { response?: { status?: number } } | null)?.response?.status;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return status === 404 || /file not found|requested entity was not found/i.test(msg);
}

/**
 * Whether a file under <code>/question/ or <code>/markscheme/ is one a Doc
 * extraction wrote: "01.png" (Extract all images) or "01-<stamp>.png" (a
 * per-question Extract). Anything else there -- a scheme cropped from a
 * past-paper PDF, an image uploaded by hand -- is not the extraction's to
 * clean up.
 */
export function isDocExtractionFileName(name: string): boolean {
  return /^\d{2}(?:-[a-z0-9-]+)?\.(?:png|jpg|gif|webp|svg)$/.test(name);
}
