/**
 * Re-derives extracted_text exactly as POST /api/source-materials does, so the
 * stored text is what a fresh upload of the same file would have produced --
 * same parser, same newline collapsing, same trim.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PDFParse } from "pdf-parse";

for (const path of process.argv.slice(2)) {
  const bytes = readFileSync(path);
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  const parsed = await parser.getText();
  const text = (parsed.text ?? "").replace(/\n{3,}/g, "\n\n").trim();
  await parser.destroy?.();
  writeFileSync(`${path}.txt`, text);
  console.log(JSON.stringify({ path, pages: parsed.total, chars: text.length, bytes: bytes.length }));
}
