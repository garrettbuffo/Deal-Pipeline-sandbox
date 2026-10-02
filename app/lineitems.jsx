// app/lineitems.jsx — the expense breakout under Full UW's Income & Economic Vacancy box.
// Laid out like the Altus Excel template's Property Info & Assumptions "Expenses" block:
// each line's T-12 total and per unit next to our stabilized total and per unit, management
// as % of EGI, then total expenses, expense ratio, NOI, cap rate and yield on cost. The T-12
// side links to Current Operating Expenses and the stabilized side to OpEx / Unit. "Altus
// playbook" ports the multifamily-uw skill's opex_model.py rules.
const { useState: useStateL, useEffect: useEffectL } = React;

const OPEX_LINES = [
  { key: 'ga',         label: 'General & Admin',         cat: 'General & Admin' },
  { key: 'mr',         label: 'Maintenance & Repairs',   cat: 'Maintenance & Repairs' },
  { key: 'mgmt',       label: 'Management',              cat: 'Management', pct: true },
  { key: 'payroll',    label: 'Payroll / Payroll Taxes', cat: 'Payroll / Payroll Taxes' },
  { key: 'marketing',  label: 'Marketing',               cat: 'Marketing' },
  { key: 'contract',   label: 'Contract Services',       cat: 'Contract Services' },
  { key: 'taxes',      label: 'Taxes',                   cat: 'Taxes' },
  { key: 'insurance',  label: 'Insurance',               cat: 'Insurance' },
  { key: 'utilities',  label: 'Utilities',               cat: 'Utilities' },
  { key: 'other',      label: 'Other',                   cat: 'Other' },
  { key: 'reserves',   label: 'Reserves & Replacements', cat: null },
];
const REVENUE_CATS = ['Rental Revenue', 'Loss to Lease', 'Physical Vacancy', 'Concessions', 'Bad Debt', 'RUBs', 'Other Income'];
const EXPENSE_CATS = OPEX_LINES.filter((l) => l.cat).map((l) => l.cat);
const lMoney = (v) => (v == null || isNaN(v)) ? '—' : (v < 0 ? '−' : '') + '$' + Math.round(Math.abs(v)).toLocaleString('en-US');
const lPct = (v, d = 1) => (v == null || isNaN(v)) ? '—' : (v * 100).toFixed(d) + '%';
const lNum = (v) => (v == null || v === '' || isNaN(Number(v)) ? 0 : Number(v));

/* T-12 category totals from the parsed line items (native signs; expenses positive). */
function t12ByCategory(deal) {
  const t = deal.t12Lines;
  if (!t || !Array.isArray(t.lines) || !t.lines.length) return null;
  const out = {};
  t.lines.forEach((l) => { out[l.category] = (out[l.category] || 0) + lNum(l.total); });
  return out;
}

/* ── Altus playbook (multifamily-uw opex_model.py, calibrated v2) ── */
const round25 = (x) => Math.round(x / 25) * 25;
const round50 = (x) => Math.round(x / 50) * 50;
const clampL = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function altusPlaybook({ t12pu, units, vintage, egi, price, tier, taxMethod, taxRate, vacancyElevated }) {
  const y = Number(vintage) || 1985;
  const has = (k) => t12pu && t12pu[k] != null && t12pu[k] > 0;
  const t = (k) => (has(k) ? t12pu[k] : null);
  const per = {}, notes = {};
  // G&A — T-12 x 0.85 when elevated, else $225 target (folds in Other); $200-400
  const ga = t('ga');
  per.ga = clampL(round25(ga == null || ga <= 500 ? 225 : ga * 0.85), 200, 400);
  notes.ga = ga == null || ga <= 500 ? '$225 target (folds in Other)' : 'T-12 × 0.85 (elevated, assumed reducible)';
  // M&R — vintage floor vs T-12, never below $500
  const floor = y <= 1969 ? 800 : y <= 1979 ? 750 : y <= 1989 ? 700 : y <= 1999 ? 650 : y <= 2010 ? 600 : 550;
  const mr = t('mr');
  per.mr = Math.max(500, round50(Math.max(floor, mr || 0)));
  notes.mr = 'max(vintage floor $' + floor + ', T-12)' + (mr && mr > 1.5 * floor ? ' · T-12 elevated: add upfront CapEx' : '');
  // Management — 4% under 150 units, else 3.5%
  const mgmtPct = units < 150 ? 4.0 : 3.5;
  notes.mgmt = mgmtPct + '% of EGI (' + (units < 150 ? 'under' : '150+') + ' 150 units)';
  // Payroll — max(T-12, tier default), floor $1,200
  const tierPay = { tertiary: 1400, secondary: 1550, strong_secondary: 1750 }[tier] || 1550;
  const pay = t('payroll');
  per.payroll = Math.max(1200, round50(pay == null ? tierPay : pay));
  notes.payroll = pay == null ? 'no T-12 · ' + tier.replace('_', ' ') + ' default $' + tierPay : 'hold T-12 (floor $1,200)';
  // Marketing — T-12 or vintage baseline, floor $125
  const mkBase = y <= 1999 ? 125 : y <= 2010 ? 225 : 325;
  per.marketing = Math.max(125, round25(t('marketing') == null ? mkBase : t('marketing')));
  notes.marketing = t('marketing') == null ? 'vintage baseline' : 'T-12 (floor $125)';
  // Contract services — T-12 +5%, $150-500
  const cs = t('contract');
  per.contract = clampL(cs == null ? 150 : round25(cs * 1.05), 150, 500);
  notes.contract = cs == null ? '$150 default' : 'T-12 +5% ($150-500)';
  // Taxes — reassessed to price, or preliminary T-12 +15%
  const tx = t('taxes');
  if (taxMethod === 'reassess' && Number(taxRate) > 0 && price > 0) { per.taxes = round25(price * Number(taxRate) / 100 / units); notes.taxes = 'reassessed to price at ' + taxRate + '% · confirm with tax advisor'; }
  else if (tx != null) { per.taxes = round25(tx * 1.15); notes.taxes = 'preliminary: T-12 +15% · confirm with tax advisor'; }
  else if (Number(taxRate) > 0 && price > 0) { per.taxes = round25(price * Number(taxRate) / 100 / units); notes.taxes = 'no T-12 tax · reassessed at ' + taxRate + '%'; }
  else if (price > 0) { per.taxes = round25(price * 0.015 / units); notes.taxes = 'placeholder 1.5% of price · CONFIRM county rate or upload T-12'; }
  else { per.taxes = 0; notes.taxes = 'NO TAX BASIS · supply a county rate or T-12'; }
  // Insurance — T-12 +15% (min $600), $700 placeholder, +$150 pre-1980, cap $1,200
  const ins = t('insurance');
  let iv = ins == null || ins < 300 ? 700 : Math.max(600, round25(ins * 1.15));
  if (y < 1980) iv = Math.min(1200, iv + 150);
  per.insurance = Math.min(1200, iv);
  notes.insurance = (ins == null || ins < 300 ? '$700 placeholder' : 'T-12 +15%') + (y < 1980 ? ' · +$150 pre-1980' : '') + ' · CONFIRM broker quote';
  // Utilities — hold T-12 ($700 default), bumped to $800 in lease-up
  let ut = t('utilities') == null ? 700 : t('utilities');
  if (t('utilities') != null && vacancyElevated) ut = Math.max(ut, 800);
  per.utilities = round25(ut);
  notes.utilities = (t('utilities') == null ? '$700 default' : 'hold T-12') + (vacancyElevated ? ' · lease-up bump' : '') + ' · RUBS recovery ~70% of water/sewer/trash';
  // Other folds into G&A; reserves by vintage
  per.other = 0; notes.other = 'folds into G&A';
  per.reserves = y < 1985 ? 400 : y <= 2010 ? 350 : 275;
  notes.reserves = 'by vintage · confirm lender floor';
  const lines = {};
  Object.keys(per).forEach((k) => { lines[k] = per[k] * units; });
  return { lines, mgmtPct, notes, egi };
}

function useOpenState(key, dflt) {
  const [open, setOpen] = useStateL(() => { try { const v = localStorage.getItem(key); return v == null ? dflt : v === '1'; } catch (e) { return dflt; } });
  useEffectL(() => { try { localStorage.setItem(key, open ? '1' : '0'); } catch (e) {} }, [open]);
  return [open, setOpen];
}

const L_HEAD = { fontSize: 9.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)' };
const L_BTN = { border: '1px solid var(--line-2)', background: 'var(--panel)', color: 'var(--slate)', borderRadius: 7, padding: '5px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' };

/* two-click confirm button (the artifact viewer has no confirm dialog) */
function ConfirmBtn({ label, confirmLabel, onConfirm, style }) {
  const [armed, setArmed] = useStateL(false);
  useEffectL(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3500); return () => clearTimeout(t); }, [armed]);
  return <button type="button" style={{ ...style, ...(armed ? { borderColor: 'var(--warn)', color: 'var(--warn)', background: 'var(--warn-soft)' } : {}) }}
    onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>{armed ? confirmLabel : label}</button>;
}

// T-12 expense by line as stored on the deal (deal.t12Opex), else null when none entered.
function t12OpexLines(deal) {
  const t = deal.t12Opex;
  if (!t || !OPEX_LINES.some((l) => lNum(t[l.key]))) return null;
  return t;
}
// Stabilized OpEx for a given EGI: fixed lines + management % of EGI, or the single $/unit.
function stabOpexFor(deal, egi) {
  const ux = deal.uwOpex && deal.uwOpex.mode === 'lines' ? deal.uwOpex : null;
  if (!ux) return lNum(deal.marketOpexPerUnit) * (deal.units || 1);
  return OPEX_LINES.filter((l) => !l.pct).reduce((s, l) => s + lNum((ux.lines || {})[l.key]), 0) + lNum(ux.mgmtPct) / 100 * egi;
}

function ExpenseBreakout({ deal, set, inPlaceEGI, stabEGI, onT12Upload, t12Data }) {
  const units = deal.units || 1;
  const ux = deal.uwOpex || {};
  const active = ux.mode === 'lines';
  const t12 = t12OpexLines(deal);
  const t12v = deal.t12Opex || {};
  const src = deal.t12Lines && Array.isArray(deal.t12Lines.lines) ? deal.t12Lines.lines : [];
  const price = lNum(deal.purchasePrice), basis = price + lNum(deal.capex);

  const t12Total = t12 ? OPEX_LINES.reduce((s, l) => s + lNum(t12v[l.key]), 0) : lNum(deal.currentOpexTotal);
  const stabTotal = stabOpexFor(deal, stabEGI);
  const setT12 = (key, v) => {
    const next = { ...t12v, [key]: v === '' ? 0 : v };
    set({ t12Opex: next, currentOpexTotal: Math.round(OPEX_LINES.reduce((s, l) => s + lNum(next[l.key]), 0)) });
  };
  const commit = (next) => {
    const fixed = OPEX_LINES.filter((l) => !l.pct).reduce((s, l) => s + lNum((next.lines || {})[l.key]), 0);
    set({ uwOpex: next, marketOpexPerUnit: Math.round((fixed + lNum(next.mgmtPct) / 100 * stabEGI) / units) });
  };
  // the first stabilized edit seeds the other lines from the T-12 (or zero) so the total stays whole
  const seedLines = () => (active ? (ux.lines || {}) : OPEX_LINES.reduce((o, l) => { if (!l.pct) o[l.key] = t12 ? Math.round(lNum(t12v[l.key])) : 0; return o; }, {}));
  const seedMgmt = () => (active ? ux.mgmtPct : (t12 && inPlaceEGI > 0 ? Math.round(lNum(t12v.mgmt) / inPlaceEGI * 1000) / 10 : 3.5));
  const setLine = (key, v) => commit({ ...ux, mode: 'lines', mgmtPct: seedMgmt(), lines: { ...seedLines(), [key]: v === '' ? 0 : v } });
  const setMgmt = (v) => commit({ ...ux, mode: 'lines', lines: seedLines(), mgmtPct: v });
  const playbook = () => {
    const t12pu = t12 ? OPEX_LINES.reduce((o, l) => { if (!l.pct) o[l.key] = lNum(t12v[l.key]) / units; return o; }, {}) : null;
    const r = altusPlaybook({ t12pu, units, vintage: deal.vintage, egi: stabEGI, price, tier: 'secondary', taxMethod: 'prelim', taxRate: '',
      vacancyElevated: inPlaceEGI > 0 && lNum(deal.gprAnnual) > 0 && 1 - inPlaceEGI / lNum(deal.gprAnnual) > 0.15 });
    commit({ ...ux, mode: 'lines', lines: r.lines, mgmtPct: r.mgmtPct, notes: r.notes, source: 'playbook' });
  };
  const copyT12 = () => commit({ ...ux, mode: 'lines', notes: {}, source: 't12',
    lines: OPEX_LINES.reduce((o, l) => { if (!l.pct) o[l.key] = Math.round(lNum(t12v[l.key])); return o; }, {}),
    mgmtPct: inPlaceEGI > 0 ? Math.round(lNum(t12v.mgmt) / inPlaceEGI * 1000) / 10 : 3.5 });

  const fileRef = React.useRef(null);
  const t12Status = t12Data && t12Data.status;
  const grid = 'minmax(170px,1fr) 132px 92px 132px 104px';
  const cell = { padding: '4px 8px', fontSize: 12.5, display: 'flex', alignItems: 'center', minHeight: 36 };
  const numCell = { ...cell, justifyContent: 'flex-end', fontVariantNumeric: 'tabular-nums' };
  const flag = (n) => n && /CONFIRM|NO TAX|placeholder/.test(n);
  const sumRow = (label, a, b, opts = {}) => (
    <div style={{ display: 'grid', gridTemplateColumns: grid, borderTop: opts.top ? '2px solid var(--line-2)' : '1px solid var(--line)', background: opts.shade ? 'var(--panel-2)' : undefined }}>
      <div style={{ ...cell, fontWeight: opts.strong ? 700 : 500, color: 'var(--ink)' }}>{label}</div>
      <div style={{ ...numCell, gridColumn: opts.pu ? undefined : 'span 2', fontWeight: opts.strong ? 700 : 500 }}>{a}</div>
      {opts.pu && <div style={{ ...numCell, color: 'var(--muted)' }}>{opts.pu[0]}</div>}
      <div style={{ ...numCell, gridColumn: opts.pu ? undefined : 'span 2', fontWeight: opts.strong ? 700 : 500, color: opts.accent || 'var(--ink)' }}>{b}</div>
      {opts.pu && <div style={{ ...numCell, color: 'var(--muted)' }}>{opts.pu[1]}</div>}
    </div>);
  const t12NOI = inPlaceEGI - t12Total, stabNOI = stabEGI - stabTotal;

  return (
    <div style={{ marginTop: 10, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', maxWidth: 860 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', background: 'var(--panel-2)', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--slate)', marginRight: 'auto' }}>
          {t12Status === 'parsing' ? 'Reading the T-12…'
            : t12Status === 'error' ? 'Could not read that T-12: ' + String(t12Data.error || '').slice(0, 100)
            : deal.t12Lines ? <span title="Hover a T-12 figure to see the line items behind it">T-12: <b>{deal.t12Lines.period || deal.t12Lines.fileName || 'upload'}</b></span>
            : 'Enter T-12 expenses by line or upload the T-12.'}
        </span>
        {onT12Upload && <>
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.pdf,.txt" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) onT12Upload(deal.id, f); e.target.value = ''; }} />
          <button type="button" style={L_BTN} onClick={() => fileRef.current && fileRef.current.click()} disabled={t12Status === 'parsing'}>{deal.t12Lines ? 'Replace T-12' : 'Upload T-12'}</button>
        </>}
        {active
          ? <ConfirmBtn label="Altus playbook" confirmLabel="Overwrite stabilized? Click again" onConfirm={playbook} style={L_BTN} />
          : <button type="button" style={L_BTN} onClick={playbook}>Altus playbook</button>}
        {t12 && <ConfirmBtn label="Copy T-12" confirmLabel="Overwrite stabilized? Click again" onConfirm={copyT12} style={L_BTN} />}
        {active && <button type="button" style={L_BTN} onClick={() => set('uwOpex', { ...ux, mode: 'single' })} title="Go back to a single stabilized OpEx / unit">Clear</button>}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: 600 }}>
          <div style={{ display: 'grid', gridTemplateColumns: grid, background: 'var(--panel-3)' }}>
            <div style={{ ...L_HEAD, padding: '7px 8px' }}>Expenses</div>
            <div style={{ ...L_HEAD, padding: '7px 8px', gridColumn: 'span 2', textAlign: 'center', borderLeft: '1px solid var(--line)' }}>Current · T-12</div>
            <div style={{ ...L_HEAD, padding: '7px 8px', gridColumn: 'span 2', textAlign: 'center', borderLeft: '1px solid var(--line)', color: 'var(--accent-2)' }}>Stabilized · Our Assumptions</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: grid }}>
            {['', 'Total', 'Per Unit', 'Total', 'Per Unit'].map((h, i) => <div key={i} style={{ ...L_HEAD, fontSize: 9, padding: '5px 8px', textAlign: i ? 'right' : 'left' }}>{h}</div>)}
          </div>
          {OPEX_LINES.map((l) => {
            const tv = lNum(t12v[l.key]);
            const lines = l.cat ? src.filter((x) => x.category === l.cat) : [];
            const tip = lines.length ? lines.map((x) => x.name + ': $' + Math.round(x.total).toLocaleString()).join('\n') : undefined;
            const note = (ux.notes || {})[l.key];
            const uv = l.pct ? lNum(ux.mgmtPct) / 100 * stabEGI : lNum((ux.lines || {})[l.key]);
            return (
              <div key={l.key} style={{ display: 'grid', gridTemplateColumns: grid, borderTop: '1px solid var(--line)' }}>
                <div style={{ ...cell, gap: 6 }} title={note || undefined}>
                  <span style={{ color: 'var(--ink)' }}>{l.label}</span>
                  {flag(note) && <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.05em', color: 'var(--warn)', background: 'var(--warn-soft)', borderRadius: 4, padding: '1px 5px' }}>CONFIRM</span>}
                </div>
                <div style={numCell} title={tip}><FieldInput value={t12v[l.key] == null ? '' : Math.round(tv)} onChange={(v) => setT12(l.key, v)} prefix="$" /></div>
                <div style={{ ...numCell, color: 'var(--muted)' }}>{l.pct ? (inPlaceEGI > 0 && tv ? lPct(tv / inPlaceEGI) + ' EGI' : '—') : (tv ? lMoney(tv / units) : '—')}</div>
                <div style={numCell}>{l.pct
                  ? <span className="num" style={{ color: active ? 'var(--ink)' : 'var(--faint)' }}>{active ? lMoney(uv) : '—'}</span>
                  : <FieldInput value={active ? Math.round(uv) : ''} onChange={(v) => setLine(l.key, v)} prefix="$" />}</div>
                <div style={numCell}>{l.pct
                  ? <FieldInput value={active ? ux.mgmtPct : ''} placeholder={String(seedMgmt() || '')} onChange={(v) => setMgmt(v)} suffix="%" align="left" />
                  : <FieldInput value={active ? Math.round(uv / units) : ''} onChange={(v) => setLine(l.key, (v === '' ? 0 : v) * units)} prefix="$" />}</div>
              </div>);
          })}
          {sumRow('Total Expenses', lMoney(t12Total), lMoney(stabTotal), { top: true, strong: true, shade: true, accent: 'var(--accent)', pu: [lMoney(t12Total / units), lMoney(stabTotal / units)] })}
          {sumRow('Expense Ratio', inPlaceEGI > 0 ? lPct(t12Total / inPlaceEGI) : '—', stabEGI > 0 ? lPct(stabTotal / stabEGI) : '—')}
          {sumRow('Net Operating Income', lMoney(t12NOI), lMoney(stabNOI), { strong: true, accent: 'var(--pos)' })}
          {sumRow('Cap Rate', price > 0 ? lPct(t12NOI / price, 2) : '—', price > 0 ? lPct(stabNOI / price, 2) : '—')}
          {sumRow('Yield on Cost', basis > 0 ? lPct(t12NOI / basis, 2) : '—', basis > 0 ? lPct(stabNOI / basis, 2) : '—')}
        </div>
      </div>
      {!active && <div style={{ fontSize: 11.5, color: 'var(--muted)', padding: '8px 12px', borderTop: '1px solid var(--line)' }}>
        Stabilized is using the single OpEx / unit above. Enter any line, run the Altus playbook or copy the T-12 to underwrite by line.</div>}
    </div>);
}

// Folder import: fill a new deal's stabilized expense lines from the Altus playbook using its
// T-12 per unit (when one was read). Needs units and GPR; otherwise the deal is left as is.
function applyImportPlaybook(d) {
  const units = lNum(d.units);
  if (!units || !(lNum(d.gprAnnual) > 0) || (d.uwOpex && d.uwOpex.mode === 'lines')) return d;
  const t12 = t12OpexLines(d);
  const t12pu = t12 ? OPEX_LINES.reduce((o, l) => { if (!l.pct) o[l.key] = lNum(t12[l.key]) / units; return o; }, {}) : null;
  const uw = window.computeUW ? window.computeUW(d) : null;
  const egi = uw && uw.rows[1] ? uw.rows[1].egi : 0;
  const r = altusPlaybook({ t12pu, units, vintage: d.vintage, egi, price: lNum(d.purchasePrice), tier: 'secondary', taxMethod: 'prelim', taxRate: '',
    vacancyElevated: uw ? uw.inPlaceEconVac > 0.15 : false });
  const fixed = Object.keys(r.lines).reduce((s, k) => s + lNum(r.lines[k]), 0);
  return { ...d, uwOpex: { mode: 'lines', lines: r.lines, mgmtPct: r.mgmtPct, notes: r.notes, source: 'playbook' },
    marketOpexPerUnit: Math.round((fixed + r.mgmtPct / 100 * egi) / units) };
}

Object.assign(window, { applyImportPlaybook, ExpenseBreakout, altusPlaybook, t12ByCategory, t12OpexLines, stabOpexFor, OPEX_LINES, useOpenState });
