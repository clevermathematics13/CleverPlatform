# scan_geometry — scan registration + normalization for the NA pipeline

Why this exists (1 Sep 2026, HANDOFF §5): scanner auto-crop, photocopier
reduction (a ~0.915x cluster covering a third of the cohort) and per-page
offsets silently misaligned bulk-uploaded scans against `na_anchors`
geometry, clipping first lines of answers and leaking neighbouring
questions into crops. The pipeline assumes every split PDF page sits in
canonical A4 template space; these tools make that true again.

## Contents
- `bars.py` — detects each printed answer box's left accent bar per page
  (works on colour and grayscale scans, tolerates translation and mild
  rotation).
- `register.py` — least-squares fit of `y_scan = s*y + dy` from matched
  bar runs, order-preserving, edition-agnostic.
- `normalize.py` — the pipeline: fit every page of every scan against a
  canonical reference, warp out-of-tolerance scans back to canonical
  space (JPEG-based A4 PDF), and VERIFY every warped page re-registers at
  |dy| <= 3pt. Never trusts a single method: run-based fits are primary,
  banner-weighted dark-profile correlation is the fallback (light-profile
  correlation aliases on ruled-line periodicity — do not switch back).
- `build_reference.py` — builds the canonical reference JSON from one or
  more known-good scans (or, for typst_metadata packets, the stored
  master PDF, which is strictly better).
- `a1_reference.json` — the A.1 canonical reference used for the 1 Sep
  normalization (built from the three cleanest 22 Aug scans).

## Usage
```bash
python3 -m scripts.scan_geometry.normalize \
  --reference scripts/scan_geometry/a1_reference.json \
  --manifest scans.json \
  --outdir normalized/
# scans.json: [{"id": "<packet_scan_id>", "local": "<path.pdf>"}, ...]
```
Outputs `transforms.json` (per scan-page s/dy/dx + method + verification)
and `normalized/<id>.pdf` for scans out of tolerance. Uploading the
normalized PDFs and re-running stages 4-5 is deliberately a separate,
human-triggered step (see scripts/normalize-and-reassess.ts).

Run this on EVERY new scan batch before cropping. A batch whose pages all
verify within tolerance needs no normalization and no re-upload.
