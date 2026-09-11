# FlattenCT

FlattenCT is a dependency-free, client-side HTML-to-CSV converter for confidence-test reports. Open `index.html` directly or publish the folder with GitHub Pages, then choose or drag in one or more `.html`/`.htm` files.

The parser reads table rows, report metadata, headings/captions, and visible `Name: value` lines. It creates one row per source file and the union of every discovered field as columns. When the same field is encountered more than once, distinct values are joined in source order with ` | `; later blank values never erase a populated value. Heading and caption context is joined to parameter names with underscores.

Confidence-test tables with `Units`, `Low Limit`, `Actual Reading`, and `High Limit` columns export only the actual reading. A category heading and parameter are combined with the unit, for example `2MHz_ReceiverTemperature (C)`. The focused regression page at `tests/parser-regression.html` validates this behavior against the included EWR-SOLAR report.

DDSR self-test parameter tables with a `Test Meas.*` column export only that measurement; `Low Limit`, `High Limit`, and `Failed Limit` are excluded. Colon-separated result lines such as `FRAM Test: PASS` are exported as their own fields. The focused regression page at `tests/ddsr-regression.html` validates this behavior against the included DDSR-HCIM report.

Nested ECMB diagnostics tables are matched to their outer `Actual Reading` header, so only actual measurements are exported. Colon-separated metadata fields are retained as columns even when their value is blank. The focused regression page at `tests/ecmb-regression.html` validates this layout.

Nested M5 diagnostics tables use the same outer-header matching and tolerate parameters with blank units. Their actual readings, including status suffixes such as `H`, `L`, and `NaN Failed`, are retained without exporting limits. The focused regression page at `tests/m5-regression.html` validates this layout.

M5 Low Gain tables with two measurements in one row split each row into separate fields, such as `LowGain_250kHz_8-inch LT_Phase Shift(deg)` and `LowGain_250kHz_8-inch LT_Attenuation(dB)`.

No files leave the browser. The included `.nojekyll` marker makes the site compatible with static GitHub Pages hosting.

## CSV safety

Before serialization, values beginning with `=`, `+`, `@`, or a non-numeric `-` (including after leading whitespace or a BOM) are prefixed with an apostrophe. This makes Excel treat them as literal text instead of formulas or commands. Valid negative numeric values are preserved, and standard RFC-compatible CSV quoting is applied afterward.
