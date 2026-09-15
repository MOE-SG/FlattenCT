# FlattenCT

FlattenCT is a dependency-free, client-side HTML-to-CSV converter for confidence-test reports. Open `index.html` directly or publish the folder with GitHub Pages, then choose or drag in one or more `.html`/`.htm` files.

The parser reads table rows, report metadata, headings/captions, and visible `Name: value` lines. It creates one row per source file and the union of every discovered field as columns. When the same field is encountered more than once, distinct values are joined in source order with ` | `; later blank values never erase a populated value. Heading and caption context is joined to parameter names with underscores.

"Label : Value" header blocks (a common lead-in section, `Customer`, `Rig Name`, `Well ID`, etc., often with many blank values) are detected from every row sharing that exact three-cell shape and exported field-by-field, blank values included — this is checked from the table's raw cell structure specifically so a mix of blank and populated values in the same block can't be mistaken for a multi-column data table. Table content is excluded from the separate `Name: value` free-text scan, since it's already handled row by row here; this also avoids that scan misreading an entire table as one line of text when a report has no `<br>` between rows.

Some reports render a header row and its data rows as two separate `<table>` elements that only look like one continuous table on screen (sometimes with an inert, empty wrapper table in between, from malformed nested-table markup). A lone header row with no data rows of its own is carried forward and combined with the next table that supplies matching data instead of being read as its own empty table or misreading the data's first row as a header — so a `Receivers` / `Ring 1`...`Ring 6` header followed by `Bank A`...`Bank D` data rows correctly produces columns like `Bank A_Ring 1` rather than being split apart.

A plain 2-column table (label on the left, value on the right, no shared header) is always read as a list of independent fields, even when a row's label happens to match a word like `Status` that would otherwise be mistaken for a column-header keyword — a common cause of a field going missing while an unrelated later field's name absorbs its value instead. Column-header keyword sniffing only applies to genuinely multi-column (3+) tables.

Sensor/instrument-style tables that give each parameter its own row of `Label | Units | Value` (with no shared header row at all — e.g. `Mud Resistivity | ohm-meter | 0.00`, `Voltage | % | 0.00`) are detected directly from that row shape and exported as `Label (Units)`, e.g. `Mud Resistivity (ohm-meter)` = `0.00`; a row with no unit for that parameter (blank middle cell, or only 2 cells) is exported with no unit suffix. This is capped at 3 raw columns specifically so it only ever matches this label/units/value shape, never a genuine multi-column data table.

Confidence-test tables with `Units`, `Low Limit`, `Actual Reading`, and `High Limit` columns export only the actual reading. A category heading and parameter are combined with the unit, for example `2MHz_ReceiverTemperature (C)`. The focused regression page at `tests/parser-regression.html` validates this behavior against the included EWR-SOLAR report.

DDSR self-test parameter tables with a `Test Meas.*` column export only that measurement; `Low Limit`, `High Limit`, and `Failed Limit` are excluded. Colon-separated result lines such as `FRAM Test: PASS` are exported as their own fields. The focused regression page at `tests/ddsr-regression.html` validates this behavior against the included DDSR-HCIM report.

Nested ECMB diagnostics tables are matched to their outer `Actual Reading` header, so only actual measurements are exported. Colon-separated metadata fields are retained as columns even when their value is blank. The focused regression page at `tests/ecmb-regression.html` validates this layout.

Nested M5 diagnostics tables use the same outer-header matching and tolerate parameters with blank units. Their actual readings, including status suffixes such as `H`, `L`, and `NaN Failed`, are retained without exporting limits. The focused regression page at `tests/m5-regression.html` validates this layout.

M5 Low Gain tables with two measurements in one row split each row into separate fields, such as `LowGain_250kHz_8-inch LT_Phase Shift(deg)` and `LowGain_250kHz_8-inch LT_Attenuation(dB)`.

For the full M5 layout, the six Low/High Gain tables flatten to 204 Phase/Attenuation fields (17 spacing/type rows × 2 measurements × 6 tables). The six corresponding Air-Hang tables flatten to 168 UT/LT Phase/Attenuation fields (7 spacings × 4 measurements × 6 tables).

AGR/DDS2 reports use section-aware matrix parsing. Calibration A/B values, DSP RPM fields, DDS2 axis/frequency or statistical measurements, trigger/scale factors, and normalization factors become individual columns. The fixed AGR field set is initialized as empty before extraction, so a missing section remains an empty CSV field rather than removing the column. `DDS2 Burst Header_Channels Enabled` remains one field containing values such as `XL XH YL YH ZL ZH Ang`. The focused regression page at `tests/agr-regression.html` validates this layout.

Tables with three or more columns that don't match any of the layouts above trigger a review step before flattening: for each distinct unrecognized table layout (grouped by its heading context and column headers, across all selected files), you're asked to flatten all columns, extract only specific column(s), or skip that table. This replaces the old behavior of silently joining every extra column into one string. Tables with two or fewer columns, and tables whose header row matches a known keyword (`Actual`, `Value`, `Reading`, `Result`, `Limit`, `Unit`, `Status`), are unambiguous and are still flattened automatically without a prompt.

## Locking the output to a verified format

Once you've confirmed a CSV export is correct for a given product, you can upload that CSV back into FlattenCT (the "Lock columns to a verified CSV" control) to fix the output format going forward: the template's column list becomes the exact, fixed set and order of output columns. Any field a report doesn't contain is simply left blank, and any field a report contains that isn't part of the template is silently excluded. Loading a template also skips the manual table-review step entirely — column selections for any unrecognized tables are inferred directly by matching the table's possible fields against the template's column names, so a verified format never has to be re-confirmed by hand. The template stays loaded across multiple flatten runs in the same browser tab until you clear it or reload the page.

No files leave the browser. The included `.nojekyll` marker makes the site compatible with static GitHub Pages hosting.

## CSV safety

Before serialization, values beginning with `=`, `+`, `@`, or a non-numeric `-` (including after leading whitespace or a BOM) are prefixed with an apostrophe. This makes Excel treat them as literal text instead of formulas or commands. Valid negative numeric values are preserved, and standard RFC-compatible CSV quoting is applied afterward.
