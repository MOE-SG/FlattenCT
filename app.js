(() => {
  "use strict";

  const state = { files: [], rows: [], columns: [], templateColumns: null };
  const $ = (id) => document.getElementById(id);
  const fileInput = $("file-input");
  const dropZone = $("drop-zone");
  const fileList = $("file-list");
  const processButton = $("process-button");
  const clearButton = $("clear-button");
  const downloadButton = $("download-button");
  const status = $("status");
  const statusText = $("status-text");
  const resultsCard = $("results-card");
  const filenameOverlay = $("filename-modal-overlay");
  const filenameInput = $("filename-input");
  const filenameCancel = $("filename-cancel");
  const filenameConfirm = $("filename-confirm");
  const templateInput = $("template-input");
  const templateClear = $("template-clear");
  const templateStatus = $("template-status");
  const transposeToggle = $("transpose-toggle");

  const clean = (value) => (value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  // Many confidence-test reports flag an out-of-range reading by appending a
  // bare "L" (low) or "H" (high) directly after the number, with or without a
  // space - e.g. "1.70 L", "-0.5H", "0L". That's a range-status marker, not
  // part of the value itself, so strip it before the value is ever stored.
  // Anchored to the whole value so it only matches a number with nothing else
  // around it - never a legitimate unit or word that happens to end in L/H.
  const limitFlagPattern = /^([+-]?(?:\d+\.?\d*|\.\d+))\s?[LH]$/i;
  const stripLimitFlag = (value) => {
    const match = limitFlagPattern.exec(value);
    return match ? match[1] : value;
  };
  const keyPart = (value) => clean(value).replace(/[:：]+$/, "").replace(/[\\/]+/g, "_").replace(/\s+/g, " ").replace(/\s*([|])\s*/g, "$1");
  const pathKey = (parts) => parts.map(keyPart).filter(Boolean).join("_");
  const textOf = (element) => clean(element ? element.textContent : "");
  const isUseful = (value) => value && !/^[:：-]+$/.test(value);

  function setStatus(message, type) {
    status.className = `status${type ? ` ${type}` : ""}`;
    statusText.textContent = message;
  }

  function addValue(row, key, value) {
    key = pathKey([key]);
    value = stripLimitFlag(clean(value));
    if (!key || !isUseful(value)) return;
    if (!row[key]) row[key] = value;
    else if (row[key] !== value && !row[key].split(" | ").includes(value)) row[key] += ` | ${value}`;
  }

  function addField(row, key, value) {
    key = pathKey([key]);
    if (!key) return;
    if (!(key in row)) row[key] = "";
    if (isUseful(value)) addValue(row, key, value);
  }

  function headingPath(element) {
    const headings = [];
    let current = element;
    while (current) {
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (/^H[1-6]$/.test(sibling.tagName) && textOf(sibling)) {
          headings.unshift(textOf(sibling));
          break;
        }
        if (sibling.tagName === "TABLE" || sibling.tagName === "HR") break;
        sibling = sibling.previousElementSibling;
      }
      current = current.parentElement;
    }
    return headings.slice(-3);
  }

  function rowCells(tr, preserveEmpty = false) {
    return Array.from(tr.children)
      .filter((cell) => /^(TD|TH)$/i.test(cell.tagName))
      .map(textOf)
      .filter((value) => preserveEmpty || value !== "");
  }

  function metricHeader(cells) {
    if (cells.length < 2) return null;
    const actualIndex = cells.findIndex((cell) => /^actual\s+reading$/i.test(cell));
    const testMeasurementIndex = cells.findIndex((cell) => /^test\s*meas(?:\.|\b)/i.test(cell));
    const unitsIndex = cells.findIndex((cell) => /^units?$/i.test(cell));
    if (actualIndex > 0 && unitsIndex >= 0) {
      const leadingParameterCell = !/^units?$/i.test(cells[0]);
      const offset = leadingParameterCell ? 0 : 1;
      return { actualIndex: actualIndex + offset, unitsIndex: unitsIndex + offset };
    }
    return testMeasurementIndex > 0 ? { actualIndex: testMeasurementIndex, testMeasurement: true } : null;
  }

  function multiMetricHeader(cells) {
    const measurements = cells
      .map((cell, index) => ({ index, cell }))
      .filter(({ cell }) => /^(?:phase\s+shift|attenuation|ut\s+ps|ut\s+atten|lt\s+ps|lt\s+atten)/i.test(cell));
    return measurements.length >= 2 ? { measurements, multi: true, airHang: measurements.some(({ cell }) => /^ut\s+ps|^lt\s+ps/i.test(cell)) } : null;
  }

  function measurementPrefix(table, metric) {
    const labels = Array.from(table.ownerDocument.querySelectorAll("td, th"))
      .filter((cell) => cell.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING)
      .map(textOf);
    const section = labels.slice().reverse().find((label) => /^(low|high)\s+gain\s+measurements$/i.test(label));
    const frequencyValue = labels.slice().reverse().find((label) => /^(?:250|500)\s*kHz\s+transmitter\s+frequency$|^2\s*MHz\s+transmitter\s+frequency$/i.test(label));
    const sectionName = section ? section.replace(/\s+measurements$/i, "").replace(/\s+/g, "") : "";
    const prefix = [metric.airHang ? "AirHang" : "", sectionName, frequencyValue ? frequencyValue.replace(/\s+transmitter\s+frequency$/i, "").replace(/\s+/g, "") : ""];
    return prefix.filter(Boolean);
  }

  function extractMultiMetricTable(table, parsed, metric, row) {
    if (!metric || !parsed.length || parsed.some((cells) => cells.length <= Math.max(...metric.measurements.map(({ index }) => index)))) return false;
    const prefix = measurementPrefix(table, metric);
    for (const cells of parsed) {
      const label = cells[0].replace(/[:：]$/, "");
      if (!isUseful(label)) continue;
      for (const measurement of metric.measurements) {
        const value = cells[measurement.index] || "";
        if (isUseful(value)) addValue(row, pathKey([...prefix, label, measurement.cell]), value);
      }
    }
    return true;
  }

  function precedingMetricCategory(table) {
    const categories = Array.from(table.ownerDocument.querySelectorAll("td.v9navy"))
      .filter((cell) => cell.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING)
      .map(textOf)
      .filter((value) => value && !/^(units?|low limit|actual reading|high limit)$/i.test(value));
    return categories[categories.length - 1] || "";
  }

  function extractMetricTable(table, parsed, metric, row) {
    if (!metric || !parsed.length || parsed.some((cells) => cells.length < 4)) return false;
    const category = precedingMetricCategory(table);
    for (const cells of parsed) {
      const label = cells[0].replace(/[:：]$/, "");
      const missingUnit = cells.length === metric.actualIndex + 1;
      const unit = missingUnit ? "" : cells[metric.unitsIndex] || "";
      const actual = cells[missingUnit ? metric.actualIndex - 1 : metric.actualIndex] || "";
      if (!isUseful(label) || !isUseful(actual)) continue;
      const parameter = keyPart(label).replace(/\s+/g, "");
      const key = `${pathKey([category, parameter])}${unit ? ` (${keyPart(unit)})` : ""}`;
      addValue(row, key, actual);
    }
    return true;
  }

  function extractTestMeasurementTable(parsed, metric, row) {
    for (const cells of parsed.slice(1)) {
      const label = cells[0].replace(/[:：]$/, "");
      const actual = cells[metric.actualIndex] || "";
      if (isUseful(label) && isUseful(actual)) addValue(row, label, actual);
    }
  }

  function extractTable(table, row, currentMetric, context) {
    // A pending "generic" header carry-over (see below) should only be dropped
    // once we hit a table that clearly has content of its own; an empty or
    // totally uninformative table shouldn't end it, since malformed markup can
    // put an inert wrapper table between a header table and its real data.
    const rows = Array.from(table.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tr"));
    if (!rows.length) return currentMetric;
    const caption = table.querySelector(":scope > caption");
    const prefix = [...headingPath(table), caption ? textOf(caption) : ""].filter(Boolean);
    const rawParsed = rows.map((tr) => rowCells(tr, true)).filter((cells) => cells.length);
    const parsed = rawParsed.map((cells) => cells.filter((value) => value !== ""));
    if (!parsed.length) return currentMetric;
    const header = parsed[0];
    const clearedMetric = currentMetric?.generic ? null : currentMetric;
    const multiMetric = rawParsed.map(multiMetricHeader).find(Boolean);
    if (multiMetric) return multiMetric;
    if (extractMultiMetricTable(table, rawParsed, currentMetric?.multi ? currentMetric : null, row)) return clearedMetric;
    const metric = parsed.map(metricHeader).find(Boolean);
    if (metric?.testMeasurement) {
      extractTestMeasurementTable(parsed, metric, row);
      return clearedMetric;
    }
    if (metric) return metric;
    if (extractMetricTable(table, parsed, clearedMetric, row)) return clearedMetric;
    // Many reports lead with a block of "Label : Value" rows (the value cell is
    // often blank). Filtering out blank cells elsewhere in this function makes
    // those rows inconsistent in length (2 cells when blank, 3 when not), which
    // can otherwise look like a multi-column data table. Detect this shape from
    // the *raw*, unfiltered cells - where the pattern is always uniform - and
    // handle it directly: label becomes the field name, value (blank or not)
    // becomes the field's data.
    if (rawParsed.length && rawParsed.every((cells) => cells.length >= 2 && /^[:：]$/.test(cells[1]))) {
      for (const cells of rawParsed) {
        const label = cells[0].replace(/[:：]$/, "");
        if (!isUseful(label)) continue;
        addField(row, pathKey([...prefix, label]), cells.slice(2).join(" "));
      }
      return clearedMetric;
    }
    // Many sensor/instrument reports give each parameter its own row of
    // [Label, Units, Value] with no shared header row at all - e.g.
    // "Mud Resistivity | ohm-meter | 0.00" followed by "Voltage | % | 0.00".
    // A row with no unit for that parameter often renders as just 2 cells
    // (or 3 with a blank middle cell), so - as with the colon-list block above
    // - detect this from the *raw* cells and cap it at 3 columns: real
    // multi-column data tables in these reports need more columns than that,
    // so this only catches the label/units/value shape, never a genuine
    // shared-header table.
    const maxRawCells = rawParsed.reduce((max, cells) => Math.max(max, cells.length), 0);
    if (maxRawCells >= 2 && maxRawCells <= 3 && rawParsed.some((cells) => cells.length >= 2)) {
      for (const cells of rawParsed) {
        if (cells.length < 2) continue;
        const label = cells[0].replace(/[:：]$/, "");
        if (!isUseful(label)) continue;
        const units = cells.length >= 3 ? cells[1] : "";
        const value = cells[cells.length - 1];
        const key = isUseful(units) ? `${label} (${units})` : label;
        addValue(row, pathKey([...prefix, key]), value);
      }
      return clearedMetric;
    }
    // Column-header keyword sniffing only makes sense for genuinely multi-column
    // tables (3+ columns). For a plain 2-column table, row 0 is virtually always
    // just another "Label, Value" row, not a shared header - and a very common
    // label like "Status" would otherwise falsely match the keyword check below
    // (e.g. "Status" / "Pass" followed by "FlashTest" / "TEST PASSED" rows would
    // get read as a header, causing "Status" to be skipped entirely and the next
    // row to come out as "FlashTest_Pass" instead of "FlashTest").
    const looksLikeHeader = header.length > 2 && header.some((cell) => /actual|value|reading|result|limit|unit|status/i.test(cell));
    // Some reports render a header row and its data rows as two separate <table>
    // elements that only *look* like one continuous table. If the previous table
    // was a lone header row we couldn't otherwise place (see below), and this
    // was a lone header row we couldn't otherwise place (see below), and this
    // table has no header of its own but the same column count, treat it as that
    // header's data section instead of misreading its first data row as a header.
    if (currentMetric?.generic && !looksLikeHeader && header.length === currentMetric.header.length) {
      handleAmbiguousTable(row, currentMetric.prefix, [currentMetric.header, ...parsed], currentMetric.header, context);
      return null;
    }
    // A lone header row with no data rows of its own: don't guess yet - carry it
    // forward in case a later table supplies the matching data rows.
    if (parsed.length === 1 && header.length > 2 && !looksLikeHeader) {
      return { generic: true, header: header.slice(), prefix: prefix.slice() };
    }
    if (!looksLikeHeader) {
      // Some report tables lead with a single-cell colspan caption row, so the
      // real multi-column header can be a few rows down rather than at parsed[0].
      // Find the first row with 3+ cells: that's the genuine ambiguous section
      // (we can't confidently tell whether every column is independent data or
      // something else), so hand it to the user instead of silently squashing
      // every extra column into one joined string. Rows before it are simple
      // label:value pairs and are handled exactly as before.
      const dataHeaderIndex = parsed.findIndex((cells) => cells.length > 2);
      if (dataHeaderIndex >= 0) {
        for (let index = 0; index < dataHeaderIndex; index += 1) {
          const cells = parsed[index];
          if (cells.length < 2) continue;
          const label = cells[0].replace(/[:：]$/, "");
          if (!isUseful(label)) continue;
          if (/^[:：]$/.test(cells[1])) {
            addField(row, pathKey([...prefix, label]), cells.slice(2).join(" "));
          } else {
            addValue(row, pathKey([...prefix, label]), cells.slice(1).join(" "));
          }
        }
        const ambiguousSection = parsed.slice(dataHeaderIndex);
        handleAmbiguousTable(row, prefix, ambiguousSection, ambiguousSection[0], context);
        return clearedMetric;
      }
    }
    const start = looksLikeHeader ? 1 : 0;
    let addedAnything = false;
    for (let index = start; index < parsed.length; index += 1) {
      const cells = parsed[index];
      if (cells.length < 2) continue;
      const label = cells[0].replace(/[:：]$/, "");
      if (!isUseful(label)) continue;
      addedAnything = true;
      if (looksLikeHeader) {
        for (let column = 1; column < cells.length; column += 1) {
          const suffix = header[column] || `Value${column}`;
          addValue(row, pathKey([...prefix, label, suffix]), cells[column]);
        }
      } else if (cells.length >= 2 && /^[:：]$/.test(cells[1])) {
        addField(row, pathKey([...prefix, label]), cells.slice(2).join(" "));
      } else {
        addValue(row, pathKey([...prefix, label]), cells.slice(1).join(" "));
      }
    }
    // If this table turned out to be empty/uninformative (e.g. a wrapper
    // artifact from malformed markup), preserve any pending generic header
    // untouched rather than dropping it, so a later table can still consume it.
    return addedAnything ? clearedMetric : currentMetric;
  }

  // --- Ambiguous (unrecognized) tables: consult the user instead of guessing ----
  function tableSignature(prefix, header) {
    return `${prefix.join(" > ")}::${header.join("|")}`;
  }

  function applyAmbiguousAsJoinedValue(row, prefix, parsed) {
    for (const cells of parsed) {
      if (cells.length < 2) continue;
      const label = cells[0].replace(/[:：]$/, "");
      if (!isUseful(label)) continue;
      if (/^[:：]$/.test(cells[1])) {
        addField(row, pathKey([...prefix, label]), cells.slice(2).join(" "));
      } else {
        addValue(row, pathKey([...prefix, label]), cells.slice(1).join(" "));
      }
    }
  }

  function applyAmbiguousAsColumns(row, prefix, parsed, header, selectedColumns) {
    for (const cells of parsed.slice(1)) {
      if (cells.length < 2) continue;
      const label = cells[0].replace(/[:：]$/, "");
      if (!isUseful(label)) continue;
      for (let column = 1; column < cells.length; column += 1) {
        if (selectedColumns && !selectedColumns.includes(column)) continue;
        const suffix = header[column] || `Value${column}`;
        addValue(row, pathKey([...prefix, label, suffix]), cells[column]);
      }
      if (selectedColumns && selectedColumns.includes(0)) {
        addValue(row, pathKey([...prefix, header[0] || "Value0"]), cells[0]);
      }
    }
  }

  function recordUnknownTable(collector, signature, prefix, header, parsed, fileName) {
    if (!collector.has(signature)) {
      collector.set(signature, { prefix: prefix.slice(), header: header.slice(), sampleRows: parsed.slice(0, 6), files: new Set() });
    }
    collector.get(signature).files.add(fileName);
  }

  // Given a previously-verified template's column list, work out which column(s)
  // of an ambiguous table actually feed one of those template columns, so the
  // decision the user would have made in the review modal can be inferred
  // automatically instead of asked for again.
  function inferColumnsFromTemplate(prefix, parsed, header, templateColumnSet) {
    const selected = [];
    if (templateColumnSet.has(pathKey([...prefix, header[0] || "Value0"]))) selected.push(0);
    for (let column = 1; column < header.length; column += 1) {
      const suffix = header[column] || `Value${column}`;
      const matches = parsed.slice(1).some((cells) => {
        const label = (cells[0] || "").replace(/[:：]$/, "");
        return isUseful(label) && templateColumnSet.has(pathKey([...prefix, label, suffix]));
      });
      if (matches) selected.push(column);
    }
    return selected;
  }

  function handleAmbiguousTable(row, prefix, parsed, header, context) {
    if (!context) {
      // Called without the app's review flow (e.g. directly via FlattenCT.parseHtml) -
      // preserve the original fallback behavior: join extra columns into one value.
      applyAmbiguousAsJoinedValue(row, prefix, parsed);
      return;
    }
    const signature = tableSignature(prefix, header);
    if (context.mode === "collect") {
      recordUnknownTable(context.collector, signature, prefix, header, parsed, context.fileName);
      return;
    }
    if (context.templateColumns) {
      // A verified template is loaded: infer which columns matter from it directly
      // instead of asking. Anything the template doesn't reference is left out.
      const columns = inferColumnsFromTemplate(prefix, parsed, header, context.templateColumns);
      if (columns.length) applyAmbiguousAsColumns(row, prefix, parsed, header, columns);
      return;
    }
    const decision = context.decisions && context.decisions.get(signature);
    if (!decision || decision.type === "all") {
      applyAmbiguousAsColumns(row, prefix, parsed, header, null);
    } else if (decision.type === "columns") {
      applyAmbiguousAsColumns(row, prefix, parsed, header, decision.columns);
    }
    // decision.type === "skip" -> intentionally add nothing from this table
  }

  function extractTextPairs(document, row) {
    const body = document.body;
    if (!body) return;
    const clone = body.cloneNode(true);
    // Table content is already handled structurally, row by row, by extractTable.
    // Re-scanning it here as plain text is redundant, and actively harmful when a
    // table has no <br> between rows: the browser's textContent then collapses an
    // entire table into one line, and the regex below would grab everything after
    // the first colon in that line as a single field's value.
    clone.querySelectorAll("script, style, table").forEach((element) => element.remove());
    clone.querySelectorAll("br").forEach((element) => element.replaceWith("\n"));
    const text = clone.textContent || "";
    text.split(/\r?\n/).map(clean).filter(Boolean).forEach((line) => {
      const match = line.match(/^([^:：]{2,80})\s*[:：]\s*(.+)$/);
      if (match && !/[{};]/.test(match[1])) addValue(row, match[1], match[2]);
    });
  }

  const agrSections = [
    { match: /^DSP RPM Data$/i, headers: ["PIC", "Min", "Avg", "Max", "StickSlip"] },
    { match: /^DDS2 Base Correction Data$/i, headers: ["Accel", "25G (Cnts)", "200G (Cnts)"] },
    { match: /^DDS2 Instantaneous Vibration Measurement$/i, headers: ["Accel", "25G (Cnts)", "200G (Cnts)"] },
    { match: /^DDS2 Vibration Data: 25 G Sensor$/i, headers: ["Accel", "Average (g)", "Shock (g)", "Peak (g)"] },
    { match: /^DDS2 Vibration Data: 200 G Sensor$/i, headers: ["Accel", "Average (g)", "Shock (g)", "Peak (g)"] },
    { match: /^DDS2 Burst Header$/i, headers: ["Version", "Peak Th(g)", "Shock Th(g)", "Avg Th(g)", "Ang Th", "Channels Enabled"] },
    { match: /^Trigger Source$/i, headers: ["Trigger Source", "Max Peak(g)", "Max Shock(g)", "Max Avg(g)", "Max Ang(g)"], labelField: true },
    { match: /^Scale Factors$/i, headers: ["XL", "XH", "YL", "YH", "ZL", "ZH"] },
    { match: /^DDS2 Normalization Factors:\s*25 G Sensor$/i, headers: ["Accel", "Average (g)", "Shock (g)", "Peak (g)"] },
    { match: /^DDS2 Normalization Factors:\s*200 G Sensor$/i, headers: ["Accel", "Average (g)", "Shock (g)", "Peak (g)"] }
  ];

  function agrSection(table) {
    return agrSections.find((section) => Array.from(table.querySelectorAll("td, th"))
      .some((cell) => section.match.test(textOf(cell)))) || null;
  }

  function agrDataRows(table, width) {
    return [table, ...Array.from(table.querySelectorAll("table"))]
      .flatMap((nested) => Array.from(nested.querySelectorAll(":scope > tbody > tr, :scope > tr")))
      .map((tr) => rowCells(tr, true))
      .filter((cells) => cells.length >= width && cells.some(isUseful));
  }

  function extractAgrMatrix(table, section, sectionName, row) {
    const rows = agrDataRows(table, section.headers.length)
      .filter((cells) => {
        const values = cells.slice(1);
        // Tolerate a trailing " L"/"H" range-status flag here too (see
        // stripLimitFlag) - otherwise a row with multiple flagged readings
        // could be undercounted as "not numeric enough" and dropped entirely.
        const numericValues = values.filter((value) => /^[-+]?(?:\d+(?:\.\d*)?|\.\d+)\s?[LH]?$/i.test(value)).length;
        return numericValues >= Math.max(1, section.headers.length - 2);
      });
    if (!rows.length) return false;
    for (const cells of rows) {
      if (section.labelField) {
        // headers[0] identifies which specific parameter this reading came
        // from (e.g. "Trigger Source" is whatever actually triggered the max
        // reading - it varies report to report), so it must be stored as its
        // own value rather than used as a key prefix: otherwise the other
        // columns' key names would shift depending on that value, and the
        // same field would end up under a different column name in every file.
        if (isUseful(cells[0])) addValue(row, pathKey([sectionName, section.headers[0]]), cells[0]);
        section.headers.slice(1).forEach((header, index) => {
          const value = cells[index + 1] || "";
          if (isUseful(value)) addValue(row, pathKey([sectionName, header]), value);
        });
        continue;
      }
      const hasLabel = section.headers.length > 1 && !/^-?\d+(?:\.\d+)?$/.test(cells[0]);
      const label = hasLabel ? cells[0] : "";
      const values = hasLabel ? cells.slice(1) : cells;
      section.headers.slice(hasLabel ? 1 : 0).forEach((header, index) => {
        const value = values[index] || "";
        if (!isUseful(value)) return;
        const rowHeader = hasLabel && /^Accel$/i.test(section.headers[0]) ? section.headers[0] : "";
        const key = pathKey([sectionName, rowHeader, label, header]);
        addValue(row, key, value);
      });
    }
    return true;
  }

  function extractAgrCalibration(table, row) {
    const rows = Array.from(table.querySelectorAll("tr"))
      .filter((tr) => tr.closest("table") === table)
      .map((tr) => rowCells(tr, true))
      .filter((cells) => cells.length >= 2);
    for (const cells of rows) {
      const label = cells[0];
      if (!/^Gamma Calibration Factors$|^High Voltage Setting$/i.test(label)) continue;
      cells.slice(1).forEach((cell) => {
        const match = cell.match(/^([^:：]+)\s*[:：]\s*(.+)$/);
        if (!match) return;
        const value = label === "High Voltage Setting" ? match[2].replace(/\s+V$/i, "") : match[2];
        addValue(row, pathKey([label, match[1]]), value);
      });
    }
    return rows.some((cells) => /^Gamma Calibration Factors$|^High Voltage Setting$/i.test(cells[0]));
  }

  function extractAgrTopTable(table, row) {
    const rows = Array.from(table.rows || [])
      .map((tr) => rowCells(tr, true))
      .filter((cells) => cells.length >= 2);
    for (const cells of rows) {
      if (cells[1] === ":" || cells[1] === "：") {
        addField(row, cells[0], cells.slice(2).join(" "));
      } else if (cells.length === 2 && isUseful(cells[0]) && isUseful(cells[1])) {
        addValue(row, cells[0], cells[1]);
      }
    }
    for (let index = 0; index + 1 < rows.length; index += 1) {
      const headers = rows[index];
      const values = rows[index + 1];
      if (headers.length < 2 || values.length !== headers.length || values.every((value) => !isUseful(value))) continue;
      headers.forEach((header, column) => {
        if (isUseful(header) && isUseful(values[column])) addValue(row, header, values[column]);
      });
    }
  }

  function extractAgrTopFields(document, row) {
    const labels = /^(Customer|Rig Name|Well ID|Well Name|Deck #|Description|Field|Job No|RLL Tool String ID #|PM\/Pulser Tool String ID #|Grease Gun Float Pressure\(psi\)|Grease Gun Seat Pressure|Comments|Engineer|Release Core Version|Release Core Build|Release Insite Version|Release Insite Build|Start Time|End Time|Calibration Time|Name|Location|Blanket Tech ID|Blanket API Value)$/i;
    const cells = Array.from(document.querySelectorAll("td, th"))
      .filter((cell) => !cell.querySelector("td, th"))
      .map(textOf);
    for (let index = 0; index < cells.length; index += 1) {
      if (!labels.test(cells[index])) continue;
      if (cells[index + 1] === ":" || cells[index + 1] === "：") {
        addField(row, cells[index], cells[index + 2] || "");
      } else if (isUseful(cells[index + 1]) && !labels.test(cells[index + 1])) {
        addValue(row, cells[index], cells[index + 1]);
      }
    }
  }

  function extractAgr(document, row) {
    if (!/AGR\/DDS2 Confidence Test/i.test(textOf(document.body))) return false;
    extractAgrTopFields(document, row);
    const matrixRows = ["X", "Y", "Z"];
    agrSections.forEach((section) => {
      const sectionName = section.match.source
        .replace(/\\s\*/g, " ")
        .replace(/^\^|\$$/g, "")
        .replace(/\\/g, "")
      const rows = /^Accel$/i.test(section.headers[0]) ? matrixRows : [""];
      rows.forEach((label) => {
        section.headers.slice(/^Accel$/i.test(section.headers[0]) ? 1 : 0).forEach((header) => {
          addField(row, pathKey([sectionName, /^Accel$/i.test(section.headers[0]) ? "Accel" : "", label, header]), "");
        });
      });
    });
    let pendingSection = null;
    const tables = Array.from(document.querySelectorAll("table"));
    tables.forEach((table) => {
      if (extractAgrCalibration(table, row)) return;
      const section = agrSection(table);
      if (section) pendingSection = { section, name: textOf(Array.from(table.querySelectorAll("td, th")).find((cell) => section.match.test(textOf(cell)))) };
      if (pendingSection && extractAgrMatrix(table, pendingSection.section, pendingSection.name, row)) pendingSection = null;
    });
    return true;
  }

  function parseHtml(name, html, context) {
    const document = new DOMParser().parseFromString(html, "text/html");
    const row = { SourceFile: name };
    if (document.querySelector("parsererror")) throw new Error("The browser could not parse this HTML.");
    if (extractAgr(document, row)) {
      const title = clean(document.title);
      if (title) addValue(row, "ReportTitle", title);
      if (Object.keys(row).length === 1) throw new Error("No readable fields were found.");
      return row;
    }
    const tableContext = context ? Object.assign({}, context, { fileName: name }) : undefined;
    let currentMetric = null;
    document.querySelectorAll("table").forEach((table) => {
      currentMetric = extractTable(table, row, currentMetric, tableContext);
    });
    extractTextPairs(document, row);
    const title = clean(document.title);
    if (title) addValue(row, "ReportTitle", title);
    if (Object.keys(row).length === 1) throw new Error("No readable fields were found.");
    return row;
  }

  window.FlattenCT = { parseHtml };

  function renderFiles() {
    $("file-count").textContent = `${state.files.length} file${state.files.length === 1 ? "" : "s"}`;
    processButton.disabled = state.files.length === 0;
    clearButton.disabled = state.files.length === 0;
    fileList.innerHTML = state.files.length
      ? state.files.map((file) => `<div class="file-item"><span>${escapeHtml(file.name)}</span><span class="file-size">${formatBytes(file.size)}</span></div>`).join("")
      : '<p class="empty-state">No files selected yet.</p>';
  }

  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function chooseFiles(files) {
    const htmlFiles = Array.from(files).filter((file) => /\.html?$/i.test(file.name) || file.type === "text/html");
    const existing = new Set(state.files.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
    state.files = state.files.concat(htmlFiles.filter((file) => !existing.has(`${file.name}:${file.size}:${file.lastModified}`)));
    renderFiles();
    if (htmlFiles.length !== files.length) setStatus("Only .html and .htm files were added.", "error");
    else setStatus("Ready to flatten the selected reports.");
  }

  async function processFiles() {
    processButton.disabled = true;
    if (state.templateColumns) {
      // A verified template is loaded: skip the manual review step entirely and
      // resolve every ambiguous table straight from the template's column list.
      setStatus("Flattening reports against the loaded template…");
      await finalizeProcessing(null, new Set(state.templateColumns));
      return;
    }
    setStatus("Scanning reports for table layouts…");
    const collector = new Map();
    for (const file of state.files) {
      try {
        parseHtml(file.name, await file.text(), { mode: "collect", collector });
      } catch (error) {
        // Real parse errors are surfaced during the flattening pass below.
      }
    }
    processButton.disabled = state.files.length === 0;
    if (collector.size > 0) {
      setStatus(`Found ${collector.size} unrecognized table layout${collector.size === 1 ? "" : "s"}. Choose what to extract before flattening.`);
      openTableReviewModal(collector, (decisions) => finalizeProcessing(decisions, null));
      return;
    }
    await finalizeProcessing(new Map(), null);
  }

  async function finalizeProcessing(decisions, templateColumnSet) {
    processButton.disabled = true;
    state.rows = [];
    const errors = [];
    for (const file of state.files) {
      try {
        const context = templateColumnSet ? { mode: "apply", templateColumns: templateColumnSet } : { mode: "apply", decisions };
        const row = parseHtml(file.name, await file.text(), context);
        state.rows.push(row);
      } catch (error) {
        errors.push(`${file.name}: ${error.message}`);
      }
    }
    processButton.disabled = state.files.length === 0;
    const discoveredColumns = Array.from(new Set(state.rows.flatMap((row) => Object.keys(row))));
    if (state.templateColumns) {
      state.columns = state.templateColumns.slice();
      const extraCount = discoveredColumns.filter((key) => !state.columns.includes(key)).length;
      const extraNote = extraCount ? ` ${extraCount} field${extraCount === 1 ? "" : "s"} found in the reports were outside the template and excluded.` : "";
      renderResults();
      if (errors.length) setStatus(`${state.rows.length} report(s) flattened against the template; ${errors.length} skipped.${extraNote} ${errors.join(" ")}`, "error");
      else setStatus(`${state.rows.length} report(s) flattened against the loaded template.${extraNote}`, "success");
      return;
    }
    state.columns = ["SourceFile", ...discoveredColumns.filter((key) => key !== "SourceFile")];
    renderResults();
    if (errors.length) setStatus(`${state.rows.length} report(s) flattened; ${errors.length} skipped. ${errors.join(" ")}`, "error");
    else setStatus(`${state.rows.length} report(s) flattened successfully.`, "success");
  }

  // --- Table review modal: let the user choose how to handle unrecognized tables ----
  const tableReviewOverlay = $("table-review-overlay");
  const tableReviewList = $("table-review-list");
  const tableReviewContinue = $("table-review-continue");
  const tableReviewCancel = $("table-review-cancel");

  function renderTableReview(collector) {
    const items = Array.from(collector.entries());
    tableReviewList.innerHTML = items.map(([signature, info], index) => {
      const columnLabels = info.header.map((label, i) => label || `Column ${i + 1}`);
      const [headRow, ...bodyRows] = info.sampleRows;
      const theadHtml = headRow ? `<tr>${columnLabels.map((_, i) => `<th>${escapeHtml(headRow[i] ?? "")}</th>`).join("")}</tr>` : "";
      const tbodyHtml = bodyRows.map((cells) => `<tr>${columnLabels.map((_, i) => `<td>${escapeHtml(cells[i] ?? "")}</td>`).join("")}</tr>`).join("");
      const columnChecks = columnLabels.map((label, i) => `<label><input type="checkbox" class="table-review-col" data-index="${i}" checked> ${escapeHtml(label)}</label>`).join("");
      const heading = info.prefix.length ? info.prefix.join(" › ") : "Untitled table";
      return `
        <div class="table-review-item" data-signature="${escapeHtml(signature)}">
          <h4>${escapeHtml(heading)}</h4>
          <p class="table-review-meta">${columnLabels.length} columns · found in ${info.files.size} file${info.files.size === 1 ? "" : "s"}</p>
          <div class="table-review-preview"><table><thead>${theadHtml}</thead><tbody>${tbodyHtml}</tbody></table></div>
          <div class="table-review-options">
            <label><input type="radio" name="table-review-mode-${index}" value="all" checked> Flatten all columns</label>
            <label><input type="radio" name="table-review-mode-${index}" value="columns"> Extract specific column(s) only</label>
            <div class="table-review-columns" hidden>${columnChecks}</div>
            <label><input type="radio" name="table-review-mode-${index}" value="skip"> Skip this table</label>
          </div>
        </div>`;
    }).join("");
    tableReviewList.querySelectorAll(".table-review-item").forEach((item) => {
      const columnsBox = item.querySelector(".table-review-columns");
      item.querySelectorAll('input[type="radio"]').forEach((radio) => {
        radio.addEventListener("change", () => { columnsBox.hidden = radio.value !== "columns"; });
      });
    });
  }

  function collectTableDecisions() {
    const decisions = new Map();
    tableReviewList.querySelectorAll(".table-review-item").forEach((item) => {
      const signature = item.dataset.signature;
      const mode = item.querySelector('input[type="radio"]:checked').value;
      if (mode === "skip") decisions.set(signature, { type: "skip" });
      else if (mode === "columns") {
        const columns = Array.from(item.querySelectorAll(".table-review-col:checked")).map((box) => Number(box.dataset.index));
        decisions.set(signature, { type: "columns", columns });
      } else {
        decisions.set(signature, { type: "all" });
      }
    });
    return decisions;
  }

  function openTableReviewModal(collector, onContinue) {
    renderTableReview(collector);
    tableReviewOverlay.hidden = false;
    tableReviewContinue.onclick = () => {
      const decisions = collectTableDecisions();
      tableReviewOverlay.hidden = true;
      onContinue(decisions);
    };
    tableReviewCancel.onclick = () => {
      tableReviewOverlay.hidden = true;
      setStatus("Flattening canceled.");
    };
  }

  function renderResults() {
    resultsCard.hidden = state.rows.length === 0;
    if (!state.rows.length) return;
    $("result-summary").textContent = `${state.rows.length} rows × ${state.columns.length} columns. Empty cells mean that field was not present in that source report.`;
    const thead = $("preview-table").querySelector("thead");
    const tbody = $("preview-table").querySelector("tbody");
    if (transposeToggle.checked) {
      // Fields as rows, files as columns - easier to scan when there are many
      // fields but only a handful of files. SourceFile itself becomes the
      // column header, so it's skipped as a field row to avoid repeating it.
      const fileLabels = state.rows.map((row, index) => row.SourceFile || `File ${index + 1}`);
      thead.innerHTML = `<tr><th>Field</th>${fileLabels.map((label) => `<th>${escapeHtml(label)}</th>`).join("")}</tr>`;
      tbody.innerHTML = state.columns.filter((column) => column !== "SourceFile")
        .map((column) => `<tr><td>${escapeHtml(column)}</td>${state.rows.map((row) => `<td>${escapeHtml(row[column] ?? "")}</td>`).join("")}</tr>`)
        .join("");
    } else {
      thead.innerHTML = `<tr>${state.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>`;
      tbody.innerHTML = state.rows.map((row) => `<tr>${state.columns.map((column) => `<td>${escapeHtml(row[column] ?? "")}</td>`).join("")}</tr>`).join("");
    }
  }

  const numericNegative = /^\s*-(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?\s*$/;

  function excelSafeText(value) {
    const text = value == null ? "" : String(value);
    const dangerous = text.match(/^[\s\uFEFF]*([=+@-])/);
    if (!dangerous) return text;
    if (dangerous[1] === "-" && numericNegative.test(text)) return text;
    return `'${text}`;
  }

  function csvValue(value) {
    const text = excelSafeText(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  // --- Output filename: yymmdd-hhmmss-key-productname-flattenCT.csv ---------
  // Key and product name are detected from the uploaded report filenames.
  // Product codes are matched as whole filename *tokens* (split on underscore/space/dot,
  // keeping internal hyphens) so a standalone "HCIM" token is never confused with the
  // distinct compound "DDSR-HCIM" token, and vice versa.
  const PRODUCT_CODES = [
    "DDSR-HCIM", "EWR-SOLAR", "EWR-SP4", "EWR-M5", "EWR-P4",
    "ECMB", "HCIM", "XBAT", "AGR", "PWD", "PCG", "PCM"
  ];
  const PRODUCT_CODE_LOOKUP = new Map(PRODUCT_CODES.map((code) => [code.toUpperCase(), code]));

  function extractKeyFromName(name) {
    const match = (name || "").match(/(\d{8})/);
    return match ? match[1] : "";
  }

  function extractProductFromName(name) {
    const base = (name || "").replace(/\.[^./\\]+$/, "");
    const tokens = base.split(/[^A-Za-z0-9-]+/).filter(Boolean);
    for (const token of tokens) {
      const match = PRODUCT_CODE_LOOKUP.get(token.toUpperCase());
      if (match) return match;
    }
    return "";
  }

  function detectKeyAndProduct() {
    let key = "";
    let product = "";
    for (const file of state.files) {
      if (!key) key = extractKeyFromName(file.name);
      if (!product) product = extractProductFromName(file.name);
      if (key && product) break;
    }
    return { key, product };
  }

  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function timestampParts(date) {
    return {
      date: `${pad(date.getFullYear() % 100)}${pad(date.getMonth() + 1)}${pad(date.getDate())}`,
      time: `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
    };
  }

  function suggestedFilename() {
    const { key, product } = detectKeyAndProduct();
    const { date, time } = timestampParts(new Date());
    return `${date}-${time}-${key || "KEY"}-${product || "PRODUCT"}-flattenCT.csv`;
  }

  function sanitizeFilename(value) {
    const trimmed = (value || "").trim().replace(/[\\/:*?"<>|]+/g, "_");
    if (!trimmed) return "flattenCT.csv";
    return /\.csv$/i.test(trimmed) ? trimmed : `${trimmed}.csv`;
  }

  // --- Template CSV: lock the output to a previously-verified column set ------
  // Minimal RFC4180-ish CSV parser (handles quotes, escaped "" quotes, CRLF/LF,
  // and embedded commas/newlines) - only the header row is actually used.
  function parseCsv(text) {
    const rows = [];
    let field = "";
    let row = [];
    let inQuotes = false;
    const source = text.replace(/^\ufeff/, "");
    for (let i = 0; i < source.length; i += 1) {
      const char = source[i];
      if (inQuotes) {
        if (char === '"') {
          if (source[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
        } else {
          field += char;
        }
        continue;
      }
      if (char === '"') { inQuotes = true; continue; }
      if (char === ",") { row.push(field); field = ""; continue; }
      if (char === "\r") continue;
      if (char === "\n") { row.push(field); rows.push(row); field = ""; row = []; continue; }
      field += char;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  function parseCsvHeader(text) {
    const rows = parseCsv(text);
    return rows.length ? rows[0].map((value) => value.trim()).filter((value) => value !== "") : [];
  }

  async function loadTemplate(file) {
    try {
      const columns = parseCsvHeader(await file.text());
      if (!columns.length) throw new Error("no header row found");
      state.templateColumns = columns.includes("SourceFile") ? columns : ["SourceFile", ...columns];
      templateStatus.textContent = `Template loaded from "${file.name}": ${state.templateColumns.length} column${state.templateColumns.length === 1 ? "" : "s"} will be extracted; anything else found is skipped.`;
      templateClear.hidden = false;
    } catch (error) {
      setStatus(`Could not read that template CSV (${error.message}).`, "error");
    }
  }

  function buildCsv() {
    if (transposeToggle.checked) {
      const fileLabels = state.rows.map((row, index) => row.SourceFile || `File ${index + 1}`);
      const header = ["Field", ...fileLabels].map(csvValue).join(",");
      const lines = state.columns.filter((column) => column !== "SourceFile")
        .map((column) => [column, ...state.rows.map((row) => row[column] ?? "")].map(csvValue).join(","));
      return [header, ...lines].join("\r\n");
    }
    return [state.columns.map(csvValue).join(","), ...state.rows.map((row) => state.columns.map((column) => csvValue(row[column] ?? "")).join(","))].join("\r\n");
  }

  function triggerDownload(filename) {
    const url = URL.createObjectURL(new Blob(["\ufeff", buildCsv()], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function openFilenameModal() {
    filenameInput.value = suggestedFilename();
    filenameOverlay.hidden = false;
    filenameInput.focus();
    filenameInput.select();
  }

  function closeFilenameModal() {
    filenameOverlay.hidden = true;
  }

  fileInput.addEventListener("change", (event) => chooseFiles(event.target.files));
  ["dragenter", "dragover"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add("is-dragging"); }));
  ["dragleave", "drop"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.remove("is-dragging"); }));
  dropZone.addEventListener("drop", (event) => chooseFiles(event.dataTransfer.files));
  processButton.addEventListener("click", processFiles);
  clearButton.addEventListener("click", () => { state.files = []; state.rows = []; state.columns = []; resultsCard.hidden = true; renderFiles(); setStatus("Selection cleared."); });
  transposeToggle.addEventListener("change", renderResults);
  templateInput.addEventListener("change", (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (file) loadTemplate(file);
  });
  templateClear.addEventListener("click", () => {
    state.templateColumns = null;
    templateStatus.textContent = "No template loaded — output columns will include every field found.";
    templateClear.hidden = true;
  });
  downloadButton.addEventListener("click", openFilenameModal);
  filenameCancel.addEventListener("click", closeFilenameModal);
  filenameConfirm.addEventListener("click", () => {
    const filename = sanitizeFilename(filenameInput.value);
    closeFilenameModal();
    triggerDownload(filename);
  });
  filenameOverlay.addEventListener("click", (event) => { if (event.target === filenameOverlay) closeFilenameModal(); });
  filenameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); filenameConfirm.click(); }
    else if (event.key === "Escape") { event.preventDefault(); closeFilenameModal(); }
  });
  renderFiles();
})();
