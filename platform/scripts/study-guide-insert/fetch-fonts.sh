#!/usr/bin/env bash
# Fetches the two display faces the Key Assessment guide's insert page needs,
# and converts them to TrueType.
#
# That guide is set in TeX Gyre Schola and TeX Gyre Heros, which CTAN serves
# and the agent network policy blocks. Both TeX Gyre faces are themselves
# extensions of URW's base-35 clones -- Schola of C059 (Century Schoolbook),
# Heros of Nimbus Sans (Helvetica) -- so the URW originals carry the same
# metrics for everything on this page and come from a host that is reachable.
#
# The Formative guide needs nothing here: it is set in Liberation Sans, which
# is already installed on any machine with fonts-liberation.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dir="${1:-$here/fonts}"
base="https://raw.githubusercontent.com/ArtifexSoftware/urw-base35-fonts/master/fonts"

mkdir -p "$dir"
for f in C059-Roman C059-Bold C059-Italic NimbusSans-Regular NimbusSans-Bold; do
  curl -sSLf -o "$dir/$f.otf" "$base/$f.otf"
done

# Chromium writes a CFF/OTF web font into a PDF as unembeddable Type3 glyph
# procedures; the same outlines as TrueType embed as a normal Type0.
"${SG_PYTHON:-python3}" "$here/otf2ttf.py" "$dir"/*.otf
echo "fonts ready in $dir"
