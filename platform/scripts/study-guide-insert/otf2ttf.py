"""OTF (CFF outlines) -> TTF (quadratic glyf), so Chromium embeds the font as a
real Type0/FontFile2 instead of falling back to Type3 glyph procedures.

    python3 otf2ttf.py fonts/*.otf

Needs fonttools and cu2qu. Each <name>.otf is written back as <name>.ttf."""
import sys
from fontTools.ttLib import TTFont, newTable
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

MAX_ERR = 1.0  # in units-per-em/1000 terms; 1.0 is visually exact at print sizes


def convert(src, dst):
    font = TTFont(src)
    glyph_set = font.getGlyphSet()
    glyf, hmtx = newTable("glyf"), font["hmtx"]
    glyf.glyphOrder = font.getGlyphOrder()
    glyf.glyphs = {}
    for name in font.getGlyphOrder():
        pen = TTGlyphPen(glyph_set)
        glyph_set[name].draw(Cu2QuPen(pen, MAX_ERR, reverse_direction=True))
        glyf[name] = pen.glyph()
    font["glyf"] = glyf
    font["loca"] = newTable("loca")
    del font["CFF "]
    if "VORG" in font:
        del font["VORG"]
    font["maxp"].tableVersion = 0x00010000
    for attr, value in (
        ("maxZones", 1), ("maxTwilightPoints", 0), ("maxStorage", 0),
        ("maxFunctionDefs", 0), ("maxInstructionDefs", 0), ("maxStackElements", 0),
        ("maxSizeOfInstructions", 0), ("maxComponentElements", max(
            (len(g.components) if g.isComposite() else 0) for g in glyf.glyphs.values())),
    ):
        setattr(font["maxp"], attr, value)
    font["head"].indexToLocFormat = 0
    font["head"].glyphDataFormat = 0
    font.sfntVersion = "\000\001\000\000"
    font.save(dst)
    print("  ", dst)


if __name__ == "__main__":
    for path in sys.argv[1:]:
        convert(path, path[:-4] + ".ttf")
