(() => {
  "use strict";

  const state = { files: [], rows: [], columns: [] };
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

  const clean = (value) => (value || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
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
    value = clean(value);
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
    return measurements.length >= 2 ? { measurements, multi: true } : null;
  }

  function lowGainPrefix(table) {
    const labels = Array.from(table.ownerDocument.querySelectorAll("td.v9navy"))
      .filter((cell) => cell.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING)
      .map(textOf);
    const section = labels.find((label) => /^low\s+gain\s+measurements$/i.test(label));
    const frequency = labels.find((label) => /^250\s*kHz\s+transmitter\s+frequency$/i.test(label));
    return [section ? "LowGain" : "", frequency ? "250kHz" : ""].filter(Boolean);
  }

  function extractMultiMetricTable(table, parsed, metric, row) {
    if (!metric || !parsed.length || parsed.some((cells) => cells.length <= Math.max(...metric.measurements.map(({ index }) => index)))) return false;
    const prefix = lowGainPrefix(table);
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

  function extractTable(table, row, currentMetric) {
    const rows = Array.from(table.querySelectorAll(":scope > thead > tr, :scope > tbody > tr, :scope > tr"));
    if (!rows.length) return currentMetric;
    const caption = table.querySelector(":scope > caption");
    const prefix = [...headingPath(table), caption ? textOf(caption) : ""].filter(Boolean);
    const rawParsed = rows.map((tr) => rowCells(tr, true)).filter((cells) => cells.length);
    const parsed = rawParsed.map((cells) => cells.filter((value) => value !== ""));
    if (!parsed.length) return currentMetric;
    const header = parsed[0];
    const multiMetric = rawParsed.map(multiMetricHeader).find(Boolean);
    if (multiMetric) return multiMetric;
    if (extractMultiMetricTable(table, rawParsed, currentMetric?.multi ? currentMetric : null, row)) return currentMetric;
    const metric = parsed.map(metricHeader).find(Boolean);
    if (metric?.testMeasurement) {
      extractTestMeasurementTable(parsed, metric, row);
      return currentMetric;
    }
    if (metric) return metric;
    if (extractMetricTable(table, parsed, currentMetric, row)) return currentMetric;
    const looksLikeHeader = header.length > 1 && header.some((cell) => /actual|value|reading|result|limit|unit|status/i.test(cell));
    const start = looksLikeHeader ? 1 : 0;
    for (let index = start; index < parsed.length; index += 1) {
      const cells = parsed[index];
      if (cells.length < 2) continue;
      const label = cells[0].replace(/[:：]$/, "");
      if (!isUseful(label)) continue;
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
    return currentMetric;
  }

  function extractTextPairs(document, row) {
    const body = document.body;
    if (!body) return;
    const clone = body.cloneNode(true);
    clone.querySelectorAll("script, style").forEach((element) => element.remove());
    clone.querySelectorAll("br").forEach((element) => element.replaceWith("\n"));
    const text = clone.textContent || "";
    text.split(/\r?\n/).map(clean).filter(Boolean).forEach((line) => {
      const match = line.match(/^([^:：]{2,80})\s*[:：]\s*(.+)$/);
      if (match && !/[{};]/.test(match[1])) addValue(row, match[1], match[2]);
    });
  }

  function parseHtml(name, html) {
    const document = new DOMParser().parseFromString(html, "text/html");
    const row = { SourceFile: name };
    if (document.querySelector("parsererror")) throw new Error("The browser could not parse this HTML.");
    let currentMetric = null;
    document.querySelectorAll("table").forEach((table) => {
      currentMetric = extractTable(table, row, currentMetric);
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
    state.rows = [];
    const errors = [];
    for (const file of state.files) {
      try {
        const row = parseHtml(file.name, await file.text());
        state.rows.push(row);
      } catch (error) {
        errors.push(`${file.name}: ${error.message}`);
      }
    }
    state.columns = ["SourceFile", ...Array.from(new Set(state.rows.flatMap((row) => Object.keys(row).filter((key) => key !== "SourceFile"))))];
    renderResults();
    if (errors.length) setStatus(`${state.rows.length} report(s) flattened; ${errors.length} skipped. ${errors.join(" ")}`, "error");
    else setStatus(`${state.rows.length} report(s) flattened successfully.`, "success");
  }

  function renderResults() {
    resultsCard.hidden = state.rows.length === 0;
    if (!state.rows.length) return;
    $("result-summary").textContent = `${state.rows.length} rows × ${state.columns.length} columns. Empty cells mean that field was not present in that source report.`;
    $("preview-table").querySelector("thead").innerHTML = `<tr>${state.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>`;
    $("preview-table").querySelector("tbody").innerHTML = state.rows.map((row) => `<tr>${state.columns.map((column) => `<td>${escapeHtml(row[column] ?? "")}</td>`).join("")}</tr>`).join("");
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

  function downloadCsv() {
    const csv = [state.columns.map(csvValue).join(","), ...state.rows.map((row) => state.columns.map((column) => csvValue(row[column] ?? "")).join(","))].join("\r\n");
    const url = URL.createObjectURL(new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `flattenct-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  fileInput.addEventListener("change", (event) => chooseFiles(event.target.files));
  ["dragenter", "dragover"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.add("is-dragging"); }));
  ["dragleave", "drop"].forEach((eventName) => dropZone.addEventListener(eventName, (event) => { event.preventDefault(); dropZone.classList.remove("is-dragging"); }));
  dropZone.addEventListener("drop", (event) => chooseFiles(event.dataTransfer.files));
  processButton.addEventListener("click", processFiles);
  clearButton.addEventListener("click", () => { state.files = []; state.rows = []; state.columns = []; resultsCard.hidden = true; renderFiles(); setStatus("Selection cleared."); });
  downloadButton.addEventListener("click", downloadCsv);
  renderFiles();
})();
