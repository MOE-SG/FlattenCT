/* FlattenCT · LLM records export · Soe Moe (soe.moe@halliburton.com) · Built with Claude Opus 5.5 */
/* serial-detect.js — tool serial number detection with typo tolerance
 *
 * Valid formats (consecutive digits):
 *   Family "1"  : 1 + 7 digits  = 8 digits   e.g. 10442001
 *   Family "50" : 50 + 8 digits = 10 digits  e.g. 5000123456
 * Typo tolerance: one extra or one missing digit is reported as "suspect",
 * never silently corrected.
 *
 * Usage (browser): load serial-detect.js with a script tag -> window.SerialDetect
 * Usage (node)   : const SD = require('./serial-detect.js')
 */
(function (root) {
  'use strict';

  const FAMILIES = [
    { name: '1',  prefix: '1',  len: 8 },
    { name: '50', prefix: '50', len: 10 },
  ];

  /** Classify one digit string. */
  function classify(d) {
    for (const f of FAMILIES) {
      if (!d.startsWith(f.prefix)) continue;
      if (d.length === f.len) return { serial: d, status: 'valid', family: f.name, note: '' };
      if (d.length === f.len + 1) return { serial: d, status: 'suspect', family: f.name,
        note: `${d.length} digits, expected ${f.len} (one extra digit?)` };
      if (d.length === f.len - 1) return { serial: d, status: 'suspect', family: f.name,
        note: `${d.length} digits, expected ${f.len} (one missing digit?)` };
    }
    return null;
  }

  /** All runs of consecutive digits that are not part of a decimal number. */
  function digitRuns(text) {
    const out = [];
    const re = /\d+/g;
    let m;
    while ((m = re.exec(text))) {
      const before = text.slice(Math.max(0, m.index - 2), m.index);
      const after = text.slice(re.lastIndex, re.lastIndex + 2);
      if (/\d\.$/.test(before) || /^\.\d/.test(after)) continue; // 12.345678 or 1234567.8
      out.push({ digits: m[0], index: m.index });
    }
    return out;
  }

  const RANK = { valid: 2, suspect: 1 };

  /** Candidates in any text, best first. */
  function findCandidates(text) {
    const seen = new Set();
    const list = [];
    for (const r of digitRuns(String(text || ''))) {
      const c = classify(r.digits);
      if (c && !seen.has(c.serial)) { seen.add(c.serial); list.push({ ...c, index: r.index }); }
    }
    return list.sort((a, b) => RANK[b.status] - RANK[a.status] || a.index - b.index);
  }

  // Label, then any mix of spaces, colons, commas, tabs etc. (covers "Serial No:,10442001" from CSV cells)
  const LABEL = /(?:serial\s*(?:no\.?|number|#)?|s\/n|\bsn\b|tool\s*id|tool\s*s\/?n)[\s:#=\-,;|]*(\d{6,12})(?![\d.])/gi;

  /** Search file content: values right after a Serial/S/N/SN/Tool ID label win over loose numbers. */
  function fromContent(text) {
    text = String(text || '');
    const labelled = [];
    const re = new RegExp(LABEL.source, 'gi');
    let m;
    while ((m = re.exec(text))) {
      const c = classify(m[1]);
      if (c) labelled.push({ ...c, how: 'label' });
    }
    // also catch "SN10442001" with no separator
    const glued = /\b(?:s\/?n|serial)(\d{7,11})\b/gi;
    while ((m = glued.exec(text))) {
      const c = classify(m[1]);
      if (c) labelled.push({ ...c, how: 'label' });
    }
    if (labelled.length) return pick(labelled);
    return pick(findCandidates(text).map(c => ({ ...c, how: 'pattern' })));
  }

  /** Search a filename (extension removed). */
  function fromFilename(name) {
    const base = String(name || '').split(/[\\/]/).pop().replace(/\.[A-Za-z0-9]{1,5}$/, '');
    return pick(findCandidates(base).map(c => ({ ...c, how: 'filename' })));
  }

  /** Best candidate; flag when several different valid serials compete. */
  function pick(list) {
    if (!list.length) return null;
    const uniq = [...new Map(list.map(c => [c.serial, c])).values()]
      .sort((a, b) => RANK[b.status] - RANK[a.status]);
    const best = { ...uniq[0], others: uniq.slice(1).map(c => c.serial) };
    if (best.status === 'valid' && uniq.filter(c => c.status === 'valid').length > 1)
      best.note = 'several valid serials found: ' + uniq.filter(c => c.status === 'valid').map(c => c.serial).join(', ');
    return best;
  }

  /** Damerau–Levenshtein distance (insert, delete, substitute, swap neighbours). */
  function distance(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 0; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
          d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    return d[a.length][b.length];
  }

  /**
   * Resolve one file. Priority: content, then filename, then manual.
   * Returns { serial, source, status, flag, message, content, filename }
   *   flag: 'ok' | 'check' | 'mismatch' | 'missing'
   */
  function resolve({ filename = '', content = '' } = {}) {
    const c = fromContent(content);
    const f = fromFilename(filename);
    const res = (serial, source, status, flag, message) =>
      ({ serial, source, status, flag, message, content: c, filename: f });

    if (!c && !f) return res('', 'manual', 'none', 'missing', 'No serial found in file or filename. Enter it manually.');

    if (c && f) {
      if (c.serial === f.serial)
        return res(c.serial, 'file + filename', c.status, c.status === 'valid' ? 'ok' : 'check',
          c.status === 'valid' ? 'File and filename agree.' : 'File and filename agree, but ' + c.note);
      const dist = distance(c.serial, f.serial);
      if (dist === 1) {
        // one-digit typo: prefer whichever matches the valid format
        const good = c.status === 'valid' ? c : f.status === 'valid' ? f : c;
        const bad = good === c ? f : c;
        return res(good.serial, good === c ? 'file' : 'filename', good.status, 'check',
          `Likely typo: ${good === c ? 'file' : 'filename'} has ${good.serial}, ${good === c ? 'filename' : 'file'} has ${bad.serial}. Using ${good.serial}; please confirm.`);
      }
      return res(c.serial, 'file', c.status, 'mismatch',
        `Different serials: file ${c.serial}, filename ${f.serial}. Choose the correct one.`);
    }

    const one = c || f;
    const src = c ? 'file' : 'filename';
    if (one.status === 'valid')
      return res(one.serial, src, 'valid', one.others.length ? 'check' : 'ok',
        one.others.length ? one.note || `Other numbers also found: ${one.others.join(', ')}` : `Found in ${src}.`);
    return res(one.serial, src, 'suspect', 'check', `Found in ${src}, but ${one.note}. Please confirm.`);
  }

  const api = { classify, findCandidates, fromContent, fromFilename, resolve, distance, FAMILIES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SerialDetect = api;
})(typeof window !== 'undefined' ? window : globalThis);

/* LLM Records export kit — serial review dialog + Markdown/text record writer.
 * Needs SerialDetect (serial-detect.js) loaded first. Exposes window.LLMKit.
 *
 * LLMKit.open({
 *   title: 'Export LLM records',
 *   items: [{ key, label, filename, content }],      // one per file / sheet
 *   defaultName: 'records',                          // without extension
 *   docTitle: 'Airhang reports',
 *   build: (serialByKey) => [record, ...]            // record: { title, fields:[[k,v]], table?:{head,rows}, note? }
 * })
 */
(function () {
  'use strict';
  const SD = window.SerialDetect;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const CSS = `
  .llmk-ov{position:fixed;inset:0;background:rgba(20,28,40,.45);display:flex;align-items:center;justify-content:center;padding:16px;z-index:9999;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:#18202c}
  .llmk-box{background:#fff;border-radius:10px;width:100%;max-width:820px;max-height:92vh;display:flex;flex-direction:column;box-shadow:0 14px 44px rgba(0,0,0,.25)}
  .llmk-hd{padding:18px 20px 10px;border-bottom:1px solid #e3e7ee}
  .llmk-hd h3{margin:0 0 4px;font-size:17px}
  .llmk-hd p{margin:0;color:#5a6577;font-size:13px}
  .llmk-body{padding:12px 20px;overflow:auto;flex:1;min-height:0}
  .llmk-tbl{width:100%;border-collapse:collapse;font-size:13px}
  .llmk-tbl th{text-align:left;font-weight:600;color:#5a6577;font-size:12px;padding:6px 8px;border-bottom:1px solid #e3e7ee;position:sticky;top:0;background:#fff}
  .llmk-tbl td{padding:7px 8px;border-bottom:1px solid #eef1f5;vertical-align:top}
  .llmk-tbl td.f{max-width:260px;word-break:break-all}
  .llmk-tbl input{font:inherit;font-family:ui-monospace,Consolas,monospace;width:13ch;padding:5px 7px;border:1px solid #c5cdda;border-radius:5px}
  .llmk-tbl input:focus{outline:2px solid #1769e0;outline-offset:1px}
  .llmk-pill{display:inline-block;font-size:11px;font-weight:700;padding:2px 8px;border-radius:20px;margin-bottom:3px;white-space:nowrap}
  .llmk-ok{background:#dcf2e4;color:#17643a}.llmk-check{background:#fdf0d5;color:#8a5a00}.llmk-mismatch,.llmk-missing{background:#fbdcdc;color:#a01818}.llmk-edited{background:#e0ebfb;color:#1d4f9a}
  .llmk-msg{font-size:12px;color:#5a6577}
  .llmk-alt{font:inherit;font-size:12px;border:1px solid #c5cdda;background:#f5f7fa;color:#18202c;border-radius:4px;padding:1px 6px;margin:3px 4px 0 0;cursor:pointer;font-family:ui-monospace,Consolas,monospace}
  .llmk-ft{padding:12px 20px 16px;border-top:1px solid #e3e7ee;display:flex;flex-wrap:wrap;gap:10px 16px;align-items:center}
  .llmk-ft label{font-size:13px;display:flex;gap:5px;align-items:center}
  .llmk-ft input[type=text]{font:inherit;padding:6px 8px;border:1px solid #c5cdda;border-radius:5px;min-width:0;width:22ch}
  .llmk-sp{flex:1}
  .llmk-btn{font:inherit;font-weight:600;border:0;border-radius:6px;padding:8px 14px;cursor:pointer;background:#e4e9f2;color:#18202c}
  .llmk-btn.p{background:#1769e0;color:#fff}
  .llmk-sum{font-size:12.5px;color:#5a6577;width:100%}
  @media (max-width:600px){.llmk-tbl td.f{max-width:140px}}`;

  function pillFor(flag) {
    return { ok: ['OK', 'llmk-ok'], check: ['Check', 'llmk-check'], mismatch: ['Mismatch', 'llmk-mismatch'],
      missing: ['Missing', 'llmk-missing'], edited: ['Edited', 'llmk-edited'] }[flag] || ['?', 'llmk-check'];
  }

  function fieldLine(k, v, fmt) {
    v = String(v ?? '').replace(/\s*\r?\n\s*/g, ' ');
    return fmt === 'md' ? `- **${k}:** ${v}` : `${k}: ${v}`;
  }

  function renderRecord(rec, fmt) {
    const out = [fmt === 'md' ? `## ${rec.title}` : rec.title];
    (rec.fields || []).forEach(([k, v]) => { if (v !== '' && v != null) out.push(fieldLine(k, v, fmt)); });
    if (rec.table && rec.table.rows.length) {
      const { head, rows } = rec.table;
      out.push('');
      if (fmt === 'md') {
        const cell = v => String(v ?? '').replace(/\|/g, '/');
        out.push('| ' + head.map(cell).join(' | ') + ' |');
        out.push('|' + head.map(() => '---').join('|') + '|');
        rows.forEach(r => out.push('| ' + r.map(cell).join(' | ') + ' |'));
      } else {
        rows.forEach(r => out.push(r[0] + ' — ' + head.slice(1).map((h, i) => `${h}: ${r[i + 1] ?? ''}`).join('; ')));
      }
    }
    if (rec.note) { out.push(''); out.push(rec.note); }
    return out.join('\n');
  }

  function renderDoc(records, fmt, docTitle, tool) {
    const head = [
      fmt === 'md' ? `# ${docTitle}` : docTitle,
      `Generated by ${tool} on ${new Date().toISOString().slice(0, 10)} · ${records.length} records.`,
      'Each record is self-contained: it repeats the serial number and test identity, so it can be read on its own.',
      '',
    ];
    return head.join('\n') + '\n' + records.map(r => renderRecord(r, fmt)).join(fmt === 'md' ? '\n\n' : '\n\n---\n\n') + '\n';
  }

  function download(text, name) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function open(opts) {
    if (!document.getElementById('llmk-css')) {
      const st = document.createElement('style'); st.id = 'llmk-css'; st.textContent = CSS; document.head.appendChild(st);
    }
    const items = opts.items.map(it => ({ ...it, r: SD.resolve({ filename: it.filename, content: it.content }) }));
    const ov = document.createElement('div');
    ov.className = 'llmk-ov';
    ov.innerHTML = `<div class="llmk-box" role="dialog" aria-modal="true" aria-labelledby="llmk-t">
      <div class="llmk-hd"><h3 id="llmk-t">${esc(opts.title || 'Export LLM records')}</h3>
        <p>Check the serial number for each file. Serials are 1 + 7 digits or 50 + 8 digits; anything else is flagged. Edit a value to correct it.</p></div>
      <div class="llmk-body"><table class="llmk-tbl"><thead><tr><th>File</th><th>Serial</th><th>Status</th></tr></thead><tbody>
      ${items.map((it, i) => {
        const [t, c] = pillFor(it.r.flag);
        const alts = [it.r.content, it.r.filename].filter(x => x && x.serial !== it.r.serial).map(x => x.serial);
        return `<tr><td class="f">${esc(it.label)}</td>
          <td><input id="llmk-s-${i}" data-i="${i}" value="${esc(it.r.serial)}" spellcheck="false" inputmode="numeric" aria-label="Serial for ${esc(it.label)}"></td>
          <td><span class="llmk-pill ${c}" id="llmk-p-${i}">${t}</span><div class="llmk-msg" id="llmk-m-${i}">${esc(it.r.message)}</div>
          ${[...new Set(alts)].map(a => `<button type="button" class="llmk-alt" data-i="${i}" data-v="${esc(a)}">Use ${esc(a)}</button>`).join('')}</td></tr>`;
      }).join('')}
      </tbody></table></div>
      <div class="llmk-ft">
        <span class="llmk-sum" id="llmk-sum"></span>
        <label><input type="radio" name="llmk-fmt" value="md" checked> Markdown</label>
        <label><input type="radio" name="llmk-fmt" value="txt"> Plain text</label>
        <label>File name <input type="text" id="llmk-name" value="${esc(opts.defaultName || 'records')}" spellcheck="false"></label>
        <span class="llmk-sp"></span>
        <button type="button" class="llmk-btn" id="llmk-cancel">Cancel</button>
        <button type="button" class="llmk-btn p" id="llmk-go">Download records</button>
      </div></div>`;
    document.body.appendChild(ov);

    const q = id => ov.querySelector('#' + id);
    function summary() {
      const vals = items.map((_, i) => q('llmk-s-' + i).value.trim());
      const missing = vals.filter(v => !v).length;
      const flagged = items.filter((it, i) => ['check', 'mismatch'].includes(it.r.flag) && !it.touched).length;
      q('llmk-sum').textContent = `${items.length} file(s).` + (flagged ? ` ${flagged} need checking.` : '') +
        (missing ? ` ${missing} without a serial will be exported as "unknown".` : '');
    }
    function setPill(i, flag, msg) {
      const [t, c] = pillFor(flag);
      const p = q('llmk-p-' + i); p.textContent = t; p.className = 'llmk-pill ' + c;
      q('llmk-m-' + i).textContent = msg;
    }
    function onEdit(i, v) {
      items[i].touched = true;
      v = v.trim();
      if (!v) setPill(i, 'missing', 'No serial. It will be exported as "unknown".');
      else {
        const c = /^\d+$/.test(v) && SD.classify(v);
        if (c && c.status === 'valid') setPill(i, 'edited', 'Set by you.');
        else if (c) setPill(i, 'check', 'Set by you, but ' + c.note + '.');
        else setPill(i, 'check', 'Set by you. Does not match the 1xxxxxxx or 50xxxxxxxx format.');
      }
      summary();
    }
    ov.addEventListener('input', e => { if (e.target.dataset.i) onEdit(+e.target.dataset.i, e.target.value); });
    ov.addEventListener('click', e => {
      const b = e.target.closest('.llmk-alt');
      if (b) { const i = +b.dataset.i; q('llmk-s-' + i).value = b.dataset.v; onEdit(i, b.dataset.v); }
    });
    const close = () => { ov.remove(); document.removeEventListener('keydown', onKey); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    q('llmk-cancel').addEventListener('click', close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    q('llmk-go').addEventListener('click', () => {
      const serials = {};
      items.forEach((it, i) => {
        const v = q('llmk-s-' + i).value.trim();
        const src = it.touched ? 'entered manually' : it.r.source === 'manual' ? 'none' : it.r.source;
        serials[it.key] = { serial: v || 'unknown', source: v ? src : 'none' };
      });
      const fmt = ov.querySelector('input[name=llmk-fmt]:checked').value;
      let name = q('llmk-name').value.trim() || 'records';
      name = name.replace(/\.(md|txt)$/i, '') + '.' + fmt;
      const records = opts.build(serials);
      download(renderDoc(records, fmt, opts.docTitle || 'Test records', opts.tool || 'export'), name);
      close();
    });
    summary();
    const first = items.findIndex(it => it.r.flag !== 'ok');
    (q('llmk-s-' + (first >= 0 ? first : 0)) || q('llmk-go')).focus();
  }

  window.LLMKit = { open, renderRecord, renderDoc };
})();
