// app/excelExport.js — "Export to Excel": writes a deal into the Altus multifamily UW template
// (templates/Altus_Multifamily_UW_Template.xlsx) and downloads it. One-way: nothing in the
// workbook is read back into the dashboard.
//
// The template's sheet XML is edited cell by cell (JSZip), so every format, formula, array
// formula and the occupancy chart stay exactly as built; Excel recalculates on open. Only the
// template's input cells are written, the same ones the multifamily-uw skill populates:
//   Property Info C3:C6, C9, C14:C16, K4:K7, K11:K12, K17:K27, Q31 · Pro Forma D5:F5, E6, E7, C38
//   Unit Mix B4:B23 (types) + Q4:W623 (standardized roll) · T12 Summary B49:G (categorized lines)
//   Raw T12 / Raw Rent Roll (the original uploaded files, pasted verbatim when they are Excel/CSV)
// Financing, closing costs and the waterfall stay at the template's defaults.
(function () {
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const XML_NS = 'http://www.w3.org/XML/1998/namespace';
  const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
  const TYPE0 = 4, TYPE_MAX = 23, ROLL0 = 4, ROLL_MAX = 623, CAT0 = 49, SUMIF_END = 92;
  const REV_CATS = ['Rental Revenue', 'Loss to Lease', 'Physical Vacancy', 'Concessions', 'Bad Debt', 'RUBs', 'Other Income'];
  const EXP_CATS = ['General & Admin', 'Maintenance & Repairs', 'Management', 'Payroll / Payroll Taxes', 'Marketing', 'Contract Services', 'Taxes', 'Insurance', 'Utilities', 'Other'];
  // dashboard expense line → template Property Info row (column K, per unit)
  const OPEX_ROW = { ga: 17, mr: 18, mgmt: 19, payroll: 20, marketing: 21, contract: 22, taxes: 23, insurance: 24, utilities: 25, other: 26, reserves: 27 };
  const OPEX_CAT = { ga: 'General & Admin', mr: 'Maintenance & Repairs', mgmt: 'Management', payroll: 'Payroll / Payroll Taxes', marketing: 'Marketing',
    contract: 'Contract Services', taxes: 'Taxes', insurance: 'Insurance', utilities: 'Utilities', other: 'Other' };

  const num = (v) => (v == null || v === '' || isNaN(Number(v)) ? 0 : Number(v));
  const has = (v) => v != null && v !== '' && !isNaN(Number(v));

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => res(); s.onerror = () => rej(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }
  async function ensureLibs() {
    if (!window.JSZip) await loadScript(JSZIP_URL);
    if (!window.ALTUS_UW_TEMPLATE_B64) await loadScript('app/uwTemplate.js');
    if (!window.JSZip || !window.ALTUS_UW_TEMPLATE_B64) throw new Error('The Excel template could not be loaded.');
  }

  /* ── minimal cell editor over one worksheet's XML ── */
  const colNum = (L) => L.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const colName = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const splitRef = (ref) => { const m = String(ref).match(/^([A-Z]+)(\d+)$/); return [m[1], Number(m[2])]; };
  const excelDate = (d) => (d.getTime() - Date.UTC(1899, 11, 30)) / 86400000;

  class Sheet {
    constructor(xml) {
      this.doc = new DOMParser().parseFromString(xml, 'application/xml');
      this.data = this.doc.getElementsByTagNameNS(NS, 'sheetData')[0];
      this.rows = new Map();
      Array.from(this.data.children).forEach((r) => this.rows.set(Number(r.getAttribute('r')), r));
    }
    row(n, create) {
      let r = this.rows.get(n);
      if (!r && create) {
        r = this.doc.createElementNS(NS, 'row');
        r.setAttribute('r', String(n));
        let next = null, nextN = Infinity;
        this.rows.forEach((el, k) => { if (k > n && k < nextN) { next = el; nextN = k; } });
        this.data.insertBefore(r, next);
        this.rows.set(n, r);
      }
      return r || null;
    }
    cell(ref, create) {
      const [c, n] = splitRef(ref);
      const r = this.row(n, create);
      if (!r) return null;
      const cn = colNum(c);
      let before = null;
      for (const el of Array.from(r.children)) {
        const ec = colNum(String(el.getAttribute('r')).match(/^[A-Z]+/)[0]);
        if (ec === cn) return el;
        if (ec > cn) { before = el; break; }
      }
      if (!create) return null;
      const el = this.doc.createElementNS(NS, 'c');
      el.setAttribute('r', ref);
      r.insertBefore(el, before);
      r.removeAttribute('spans');
      return el;
    }
    styleOf(ref) { const el = this.cell(ref, false); return el ? el.getAttribute('s') : null; }
    set(ref, v, style) {
      const el = this.cell(ref, true);
      while (el.firstChild) el.removeChild(el.firstChild);
      el.removeAttribute('t');
      if (style != null) el.setAttribute('s', style);
      if (v == null || v === '') return;
      const add = (tag, text) => { const x = this.doc.createElementNS(NS, tag); if (text != null) x.textContent = text; el.appendChild(x); return x; };
      if (v instanceof Date) { if (!isNaN(v)) add('v', String(excelDate(v))); return; }
      if (typeof v === 'object' && v.f) { add('f', v.f); return; }
      if (typeof v === 'number') { if (isFinite(v)) add('v', String(v)); return; }
      el.setAttribute('t', 'inlineStr');
      const is = add('is');
      const t = this.doc.createElementNS(NS, 't');
      t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
      t.textContent = String(v);
      is.appendChild(t);
    }
    clear(test) {
      this.rows.forEach((r, n) => Array.from(r.children).forEach((c) => {
        if (test && !test(String(c.getAttribute('r')), n)) return;
        while (c.firstChild) c.removeChild(c.firstChild);
        c.removeAttribute('t');
      }));
    }
    toString() { return new XMLSerializer().serializeToString(this.doc); }
  }

  /* ── original uploads from the Document Vault, as grids ── */
  async function docBlob(doc) {
    if (doc.local || /^local:/.test(doc.path || '')) return window.vaultLocalGet ? window.vaultLocalGet(doc) : null;
    const cloud = window.AltusCloud;
    if (!cloud || !cloud.signedDocUrl) return null;
    const url = await cloud.signedDocUrl(doc.path, 600);
    const r = await fetch(url);
    return r.ok ? r.blob() : null;
  }
  async function gridFromVault(deal, category) {
    const docs = (Array.isArray(deal.documents) ? deal.documents : []).filter((d) => d.category === category && /^(xlsx|xls|xlsm|csv)$/i.test(d.ext || ''));
    if (!docs.length || !window.XLSX) return null;
    const doc = docs.slice().sort((a, b) => String(a.uploadedAt || '').localeCompare(String(b.uploadedAt || ''))).pop();
    try {
      const blob = await docBlob(doc);
      if (!blob) return null;
      const wb = window.XLSX.read(await blob.arrayBuffer(), { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const grid = window.XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
      return { name: doc.name, grid: grid.slice(0, 3000).map((r) => (r || []).slice(0, 60)) };
    } catch (e) { return null; }
  }

  /* ── what the deal sends ── */
  function rollUnits(deal) {
    const pr = window.rentRollPricing ? window.rentRollPricing(deal) : null;
    const units = deal.rentRoll && Array.isArray(deal.rentRoll.units) ? deal.rentRoll.units : [];
    if (pr && units.length) {
      // Market = the underwritten market rent for the type (rent roll market, an override or the
      // GPR basis), so the template's market rents and GPR match the dashboard.
      const mk = {};
      pr.types.forEach((t) => { mk[t.type] = Math.round(t.market * 100) / 100; });
      return { synthetic: false, units: units.map((u) => ({ type: u.type || 'All units', sf: u.sf || null, market: mk[u.type || 'All units'] != null ? mk[u.type || 'All units'] : u.market,
        rent: u.occ && u.rent ? u.rent : 0, occ: !!u.occ, id: u.id, leaseStart: u.leaseStart || null })) };
    }
    // No rent roll: one "All units" type sized to the deal so the template's unit count and GPR hold.
    const n = Math.max(0, Math.round(num(deal.units)));
    if (!n) return { synthetic: true, units: [] };
    const gpr = num(deal.gprAnnual), mkt = gpr ? gpr / n / 12 : 0;
    const vacUnits = gpr ? Math.round(n * num(deal.physVacLoss) / gpr) : 0;
    const occ = Math.max(0, n - vacUnits);
    const inPlace = occ ? Math.max(0, (gpr - num(deal.physVacLoss) - num(deal.lossToLease)) / 12 / occ) : 0;
    const out = [];
    for (let i = 0; i < n; i++) out.push({ type: 'All units', sf: null, market: Math.round(mkt), rent: i < occ ? Math.round(inPlace) : 0, occ: i < occ, id: String(i + 1), leaseStart: null });
    return { synthetic: true, units: out };
  }

  function t12Lines(deal) {
    const lines = [];
    const src = deal.t12Lines && Array.isArray(deal.t12Lines.lines) ? deal.t12Lines.lines : null;
    const byCat = {};
    if (src) src.forEach((l) => { lines.push({ name: l.name, category: l.category, total: num(l.total) }); byCat[l.category] = (byCat[l.category] || 0) + num(l.total); });
    else if (num(deal.gprAnnual)) {
      lines.push({ name: 'Gross potential rent', category: 'Rental Revenue', total: num(deal.gprAnnual) });
      if (num(deal.physVacLoss)) lines.push({ name: 'Physical vacancy', category: 'Physical Vacancy', total: -num(deal.physVacLoss) });
      if (num(deal.lossToLease)) lines.push({ name: 'Loss to lease', category: 'Loss to Lease', total: -num(deal.lossToLease) });
    }
    // Where a figure was edited on the dashboard after the T-12 was read, add the difference as its
    // own line so the template's T-12 ties to what the dashboard shows.
    const adj = (cat, target, label) => { const d = Math.round(target - (byCat[cat] || 0)); if (Math.abs(d) >= 1) lines.push({ name: label, category: cat, total: d }); };
    adj('RUBs', num(deal.curRubs), src ? 'RUBS (dashboard adjustment)' : 'RUBS');
    adj('Other Income', num(deal.otherIncome) - num(deal.curRubs), src ? 'Other income (dashboard adjustment)' : 'Other income');
    const conc = num(deal.concessions) + num(deal.badDebt);
    const t12conc = -((byCat['Concessions'] || 0) + (byCat['Bad Debt'] || 0));
    if (Math.abs(conc - t12conc) >= 1) lines.push({ name: src ? 'Concessions & bad debt (dashboard adjustment)' : 'Concessions & bad debt', category: 'Concessions', total: -Math.round(conc - t12conc) });
    const t12o = deal.t12Opex || null;
    const hasLines = t12o && Object.keys(OPEX_CAT).some((k) => num(t12o[k]));
    if (hasLines) Object.keys(OPEX_CAT).forEach((k) => adj(OPEX_CAT[k], num(t12o[k]), src ? OPEX_CAT[k] + ' (dashboard adjustment)' : OPEX_CAT[k]));
    else if (!src && num(deal.currentOpexTotal)) lines.push({ name: 'Operating expenses (T-12 total, no line detail)', category: 'Other', total: num(deal.currentOpexTotal) });
    return lines.filter((l) => REV_CATS.includes(l.category) || EXP_CATS.includes(l.category));
  }

  function fileName(deal) {
    const d = (window.ALTUS_TODAY || new Date().toISOString().slice(0, 10)).replace(/-/g, '').slice(2);
    const clean = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    return d + '_' + clean(deal.name || 'Deal') + (deal.market ? ' - ' + clean(deal.market) : '') + '.xlsx';
  }

  async function saveFile(blob, filename) {
    if (window.ALTUS_CONFIG && window.ALTUS_CONFIG.SANDBOX && window.claude && typeof window.claude.use === 'function') {
      const dl = await window.claude.use('downloads');
      if (dl) { await dl.save({ filename, data: blob }); return; }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function exportDealToExcel(deal) {
    await ensureLibs();
    const zip = await window.JSZip.loadAsync(window.ALTUS_UW_TEMPLATE_B64, { base64: true });
    // sheet name → part path
    const wbXml = await zip.file('xl/workbook.xml').async('string');
    const relXml = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    const rid = {};
    relXml.replace(/<Relationship\b[^>]*>/g, (tag) => { const id = (tag.match(/Id="([^"]+)"/) || [])[1]; const t = (tag.match(/Target="([^"]+)"/) || [])[1]; if (id && t) rid[id] = t.replace(/^\/?xl\//, ''); return tag; });
    const part = {};
    wbXml.replace(/<sheet\b[^>]*>/g, (tag) => {
      const name = (tag.match(/name="([^"]+)"/) || [])[1]; const id = (tag.match(/r:id="([^"]+)"/) || [])[1];
      if (name && id && rid[id]) part[name.replace(/&amp;/g, '&').replace(/&gt;/g, '>')] = 'xl/' + rid[id];
      return tag;
    });
    const sheets = {};
    const open = async (name) => { if (!sheets[name]) { if (!part[name]) throw new Error('Template is missing the "' + name + '" sheet.'); sheets[name] = new Sheet(await zip.file(part[name]).async('string')); } return sheets[name]; };
    const P = await open('Property Info & Assumptions');
    const PF = await open('Pro Forma');
    const UM = await open('Unit Mix Summary');
    const T = await open('T12 Summary');
    const notes = [];

    const uw = window.computeUW ? window.computeUW(deal) : null;
    const units = Math.max(1, num(deal.units));

    // identity + forecasting
    P.set('C3', deal.name || '', P.styleOf('C3'));
    P.set('C4', deal.market || '', P.styleOf('C4'));
    if (has(deal.vintage)) P.set('C5', Number(deal.vintage), P.styleOf('C5'));
    if (has(deal.purchasePrice)) P.set('C6', num(deal.purchasePrice), P.styleOf('C6'));
    if (has(deal.askPrice)) P.set('C9', num(deal.askPrice), P.styleOf('C9'));
    P.set('C14', (has(deal.exitCap) ? num(deal.exitCap) : 6) / 100, P.styleOf('C14'));
    P.set('C15', (has(deal.sellingPct) ? num(deal.sellingPct) : 4) / 100, P.styleOf('C15'));
    if (uw) P.set('C16', uw.hold, P.styleOf('C16'));
    if (has(deal.capex)) P.set('Q31', num(deal.capex) / units, P.styleOf('Q31'));

    // stabilized assumptions (Pro Forma (Stabilized) column K)
    if (uw) {
      P.set('K4', Math.round(uw.stabVac * 10000) / 10000, P.styleOf('K4'));
      ['K5', 'K6', 'K7'].forEach((c) => P.set(c, 0, P.styleOf(c)));
      const uo = deal.uwOtherIncome && deal.uwOtherIncome.mode === 'lines' ? deal.uwOtherIncome : null;
      const rubsPU = uo ? num(uo.rubsPUPM) * (uo.rubsPct == null ? 100 : num(uo.rubsPct)) / 100 : num(deal.curRubs) / units / 12;
      const otherPU = uo ? num(uo.otherPUPM) : Math.max(0, num(uw.otherIncomeStab) / units / 12 - rubsPU);
      P.set('K11', Math.round(rubsPU * 100) / 100, P.styleOf('K11'));
      P.set('K12', Math.round(otherPU * 100) / 100, P.styleOf('K12'));
      const ux = deal.uwOpex && deal.uwOpex.mode === 'lines' ? deal.uwOpex : null;
      if (ux) {
        Object.keys(OPEX_ROW).forEach((k) => {
          const ref = 'K' + OPEX_ROW[k];
          P.set(ref, k === 'mgmt' ? num(ux.mgmtPct) / 100 : Math.round(num((ux.lines || {})[k]) / units), P.styleOf(ref));
        });
      } else {
        // a single OpEx / unit: carried in "Other" so the total ties; split it on the dashboard to carry lines
        Object.keys(OPEX_ROW).forEach((k) => { const ref = 'K' + OPEX_ROW[k]; P.set(ref, k === 'other' ? num(deal.marketOpexPerUnit) : 0, P.styleOf(ref)); });
        notes.push('Expenses: the deal uses a single OpEx/unit, written to "Other" in the stabilized column.');
      }
      // Pro Forma growth, vacancy path (years 1-3; later years follow year 3) and AM fee
      if (uw.rows[1]) PF.set('D5', Math.round(uw.rows[1].vac * 10000) / 10000, PF.styleOf('D5'));
      if (uw.rows[2]) PF.set('E5', Math.round(uw.rows[2].vac * 10000) / 10000, PF.styleOf('E5'));
      if (uw.rows[3]) PF.set('F5', Math.round(uw.rows[3].vac * 10000) / 10000, PF.styleOf('F5'));
      PF.set('E6', (has(deal.gprGrowth) ? num(deal.gprGrowth) : 3) / 100, PF.styleOf('E6'));
      PF.set('E7', (has(deal.opexGrowth) ? num(deal.opexGrowth) : 2.5) / 100, PF.styleOf('E7'));
      PF.set('C38', (has(deal.amFeePct) ? num(deal.amFeePct) : 2) / 100, PF.styleOf('C38'));
    }

    // rent roll → Unit Mix (type labels + standardized roll)
    const roll = rollUnits(deal);
    const types = [];
    roll.units.forEach((u) => { if (!types.includes(u.type)) types.push(u.type); });
    if (types.length > TYPE_MAX - TYPE0 + 1) notes.push('Only the first ' + (TYPE_MAX - TYPE0 + 1) + ' unit types fit the template.');
    if (roll.units.length > ROLL_MAX - ROLL0 + 1) notes.push('Only the first ' + (ROLL_MAX - ROLL0 + 1) + ' units fit the template.');
    UM.clear((ref, n) => n >= ROLL0 && n <= ROLL_MAX && /^[Q-W]/.test(ref));
    for (let i = 0; i <= TYPE_MAX - TYPE0; i++) UM.set('B' + (TYPE0 + i), types[i] || null, UM.styleOf('B' + (TYPE0 + i)));
    roll.units.slice(0, ROLL_MAX - ROLL0 + 1).forEach((u, i) => {
      const r = ROLL0 + i;
      const put = (c, v) => UM.set(c + r, v, UM.styleOf(c + r) || UM.styleOf(c + ROLL0));
      put('Q', u.type); put('R', u.sf); put('S', u.market); put('T', u.rent); put('U', u.occ ? 1 : 0); put('V', u.id || null);
      put('W', u.leaseStart ? new Date(u.leaseStart + 'T00:00:00Z') : null);
    });
    if (roll.synthetic && roll.units.length) notes.push('No rent roll on the deal: Unit Mix uses one "All units" type built from the deal\'s GPR and vacancy.');

    // T-12 → categorization block (revenue then expenses), extending the summary SUMIFs if needed
    const lines = t12Lines(deal);
    T.clear((ref, n) => n >= CAT0 && n <= 200 && /^[B-G]/.test(ref));
    const hdrS = ['B', 'C', 'D', 'E', 'F', 'G'].map((c) => T.styleOf(c + CAT0));
    const lineS = ['B', 'C', 'D', 'E', 'F', 'G'].map((c) => T.styleOf(c + (CAT0 + 1)));
    let r = CAT0;
    const header = (label) => { ['B', 'C', 'D', 'E', 'F', 'G'].forEach((c, i) => T.set(c + r, i ? null : label, hdrS[i])); r++; };
    const line = (l) => { const v = Math.round(l.total); ['B', 'C', 'D', 'E', 'F', 'G'].forEach((c, i) => T.set(c + r, i === 0 ? l.name : i === 1 ? l.category : v, lineS[i])); r++; };
    header('Revenue'); lines.filter((l) => REV_CATS.includes(l.category)).forEach(line);
    header('Expenses'); lines.filter((l) => EXP_CATS.includes(l.category)).forEach(line);
    const last = r - 1;
    if (last > SUMIF_END) {
      Array.from(T.doc.getElementsByTagNameNS(NS, 'f')).forEach((f) => {
        const rowN = Number(String(f.parentNode.getAttribute('r')).replace(/^[A-Z]+/, ''));
        if (rowN < CAT0 - 2) f.textContent = f.textContent.replace(/([A-Z]+\$)92(?!\d)/g, '$1' + last);
      });
    }
    if (lines.length) notes.push('T-12: annual totals by line (T-6, T-3 and T-1 equal the T-12; there is no monthly detail on the dashboard).');

    // original uploads → raw tabs
    const rawT12 = await gridFromVault(deal, 'T-12');
    const rawRR = await gridFromVault(deal, 'Rent Roll');
    for (const [name, raw] of [['Raw T12', rawT12], ['Raw Rent Roll', rawRR]]) {
      if (!raw) continue;
      const S = await open(name);
      S.clear();
      raw.grid.forEach((row, i) => row.forEach((v, j) => { if (v != null && v !== '') S.set(colName(j + 1) + (i + 1), v instanceof Date ? v : typeof v === 'number' ? v : String(v)); }));
    }

    // write back; drop the calc chain and have Excel recalculate on open
    for (const name of Object.keys(sheets)) zip.file(part[name], sheets[name].toString());
    if (zip.file('xl/calcChain.xml')) {
      zip.remove('xl/calcChain.xml');
      const ct = await zip.file('[Content_Types].xml').async('string');
      zip.file('[Content_Types].xml', ct.replace(/<Override[^>]*PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ''));
      zip.file('xl/_rels/workbook.xml.rels', relXml.replace(/<Relationship[^>]*Target="[^"]*calcChain\.xml"[^>]*\/>/, ''));
    }
    let wbOut = wbXml;
    if (/<calcPr\b/.test(wbOut)) wbOut = wbOut.replace(/<calcPr\b([^>]*?)\/?>/, (m, a) => '<calcPr' + a.replace(/\s*fullCalcOnLoad="[^"]*"/, '') + ' fullCalcOnLoad="1"/>');
    else wbOut = wbOut.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
    zip.file('xl/workbook.xml', wbOut);

    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' });
    const filename = fileName(deal);
    await saveFile(blob, filename);
    return { filename, notes, raw: { t12: rawT12 ? rawT12.name : null, rentRoll: rawRR ? rawRR.name : null }, units: roll.units.length, lines: lines.length };
  }

  window.exportDealToExcel = exportDealToExcel;
})();
