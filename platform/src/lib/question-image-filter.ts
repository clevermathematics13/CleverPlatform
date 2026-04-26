import { createHash } from "crypto";
import questionImageBlocklist from "./question-image-blocklist.json";

const blockedImageHashes = new Set(
  ((questionImageBlocklist.sha256 ?? []) as string[]).map((hash) =>
    hash.toLowerCase()
  )
);

export function sha256Hex(buffer: Buffer | Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function isBlockedQuestionImage(buffer: Buffer | Uint8Array): boolean {
  return blockedImageHashes.has(sha256Hex(buffer));
}

export function getBlockedQuestionImageHashes(): string[] {
  return [...blockedImageHashes];
}