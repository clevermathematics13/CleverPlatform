"""Append a one-page insert to a study guide, then prove nothing else moved.

Writes the merged file only if every original page still extracts the same text
it did before -- a silent rewrite of a document students are holding is the one
failure mode that must not reach Drive.
"""
import sys
import pdfplumber
from pypdf import PdfReader, PdfWriter


def page_texts(path):
    with pdfplumber.open(path) as pdf:
        return [(p.extract_text() or "") for p in pdf.pages]


def main(source, insert, out):
    writer = PdfWriter()
    for page in PdfReader(source).pages:
        writer.add_page(page)
    insert_pages = PdfReader(insert).pages
    if len(insert_pages) != 1:
        raise SystemExit(f"expected a one-page insert, got {len(insert_pages)}")
    writer.add_page(insert_pages[0])
    with open(out, "wb") as fh:
        writer.write(fh)

    before, after = page_texts(source), page_texts(out)
    if len(after) != len(before) + 1:
        raise SystemExit(f"page count {len(after)}, expected {len(before) + 1}")
    for i, (a, b) in enumerate(zip(before, after)):
        if a != b:
            raise SystemExit(f"page {i + 1} changed during the merge")
    print(f"   {out}: {len(before)} pages kept verbatim + 1 insert")


if __name__ == "__main__":
    main(*sys.argv[1:4])
