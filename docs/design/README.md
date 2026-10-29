# Design boards, slices and comparisons

- **Boards (not committed here):** `Wellsure_HR_Portal_{Light,Dark,Responsive}.png`.
  They are on `main` as `docs/design/Wellsure HR Portal {Light,Dark,Responsive}.png`;
  copy them here with underscores to re-run the tools. Git-ignored on this branch.
- **`slices/`**: one JPEG per board frame (`light/`, `dark/`, `light-phone/`,
  `dark-phone/`), a labelled `_contact-<section>.jpg` per desktop section, and
  `index.json` (frame id → pixel box on the board).
- **`compare/`**: proof sheets for each step of the UI pass (board frame vs ours).
- **`tools/`**: the Python scripts that made all of the above (PIL + numpy + scipy;
  run from the repo root with `python3 -I`):
  1. `detect_frames.py <board.png> <bg r,g,b> <out.json>` (light bg `234,234,234`,
     dark `8,11,18`, responsive `229,229,229`)
  2. `slice_boards.py <light.json> <responsive.json>` writes `slices/`
  3. `measure_region.py`, `sample_text.py`, `measure_type.py` take a spec file
     (`name mode frame-id x y [tol]` / boxes) and print colours and sizes
  4. `swatches.py` writes `compare/step1-tokens-*.jpg`

The values extracted from all this are in [`../DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md).
