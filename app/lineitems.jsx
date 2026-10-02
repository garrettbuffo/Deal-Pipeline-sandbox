// app/lineitems.jsx — Full UW "Operating Expense & Other Income Detail" panel.
// Puts the T-12 by line item next to our underwriting, the way the Altus Excel template's
// Property Info & Assumptions sheet does: each OpEx line as an annual total and $/unit,
// management as % of EGI, and other income split into RUBS vs other income. The
// "Altus playbook" button ports the multifamily-uw skill's opex_model.py rules.
const { useState: useStateL, useEffect: useEffectL } = React;

const OPEX_LINES = [
  { key: 'ga',         label: 'General & Admin',         cat: 'General & Admin' },
  { key: 'mr',         label: 'Maintenance & Repairs',   cat: 'Maintenance & Repairs' },
  { key: 'mgmt',       label: 'Management',              cat: 'Management', pct: true },
  { key: 'payroll',    label: 'Payroll / Payroll Taxes', cat: 'Payroll / Payroll Taxes' },
  { key: 'marketing',  label: 'Marketing',               cat: 'Marketing' },
  { key: 'contract',   label: 'Contract Services',       cat: 'Contract Services' },
  { key: 'taxes',      label: 'Real Estate Taxes',       cat: 'Taxes' },
  { key: 'insurance',  label: 'Insurance',               cat: 'Insurance' },
  { key: 'utilities',  label: 'Utilities',               cat: 'Utilities' },
  { key: 'other',      label: 'Other',                   cat: 'Other' },
  { key: 'reserves',   label: 'Replacement Reserves',    cat: null },
];
const REVENUE_CATS = ['Rental Revenue', 'Loss to Lease', 'Physical Vacancy', 'Concessions', 'Bad Debt', 'RUBs', 'Other Income'];
const EXPENSE_CATS = OPEX_LINES.filter((l) => l.cat).map((l) => l.cat);
// Seeded effective multifamily tax rates on purchase price (multifamily-uw county_tax_rates.py).
const COUNTY_TAX = [
  ['TX', 'Dallas', 2.4], ['TX', 'Tarrant', 2.4], ['TX', 'Bexar', 2.5], ['TX', 'Travis', 2.0], ['TX', 'Lubbock', 2.1],
  ['TX', 'Ector', 2.4], ['OK', 'Oklahoma', 1.2], ['OK', 'Tulsa', 1.25], ['SC', 'Greenville', 1.9], ['SC', 'Spartanburg', 1.9],
];

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
const L_BTN = { border: '1px solid var(--line-2)', background: 'var(--panel)', color: 'var(--slate)', borderRadius: 7, padding: '6px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' };
const L_PRIMARY = { ...L_BTN, border: 'none', background: 'var(--accent)', color: '#fff' };
const L_SELECT = { border: '1px solid var(--line-2)', borderRadius: 7, padding: '5px 8px', background: 'var(--panel)', fontSize: 12, color: 'var(--ink)', fontFamily: 'var(--font)', cursor: 'pointer', height: 30 };

/* two-click confirm button (the artifact viewer has no confirm dialog) */
function ConfirmBtn({ label, confirmLabel, onConfirm, style }) {
  const [armed, setArmed] = useStateL(false);
  useEffectL(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3500); return () => clearTimeout(t); }, [armed]);
  return <button type="button" style={{ ...style, ...(armed ? { borderColor: 'var(--warn)', color: 'var(--warn)', background: 'var(--warn-soft)' } : {}) }}
    onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>{armed ? confirmLabel : label}</button>;
}

function LineItemsSection({ deal, set, uw, onT12Upload, t12Data }) {
  const [open, setOpen] = useOpenState('altus_lineitems_open', true);
  const units = deal.units || 1;
  const cat = t12ByCategory(deal);
  const ux = deal.uwOpex || {};
  const active = ux.mode === 'lines';
  const uo = deal.uwOtherIncome || {};
  const activeO = uo.mode === 'lines';
  const egi1 = uw && uw.rows && uw.rows[1] ? uw.rows[1].egi : 0;
  const t12Egi = cat ? REVENUE_CATS.reduce((s, c) => s + (cat[c] || 0), 0) : (uw && uw.rows[0] ? uw.rows[0].egi : 0);
  const pb = ux.playbook || { tier: 'secondary', taxMethod: 'prelim', taxRate: '' };

  const t12Total = (l) => (cat && l.cat ? (cat[l.cat] || 0) : null);
  const t12pu = cat ? OPEX_LINES.reduce((o, l) => { if (l.cat) o[l.key] = (cat[l.cat] || 0) / units; return o; }, {}) : null;
  const uwTotal = (l) => (l.pct ? lNum(ux.mgmtPct) / 100 * egi1 : lNum((ux.lines || {})[l.key]));
  const fixedTotal = OPEX_LINES.filter((l) => !l.pct).reduce((s, l) => s + lNum((ux.lines || {})[l.key]), 0);
  const uwOpexY1 = fixedTotal + lNum(ux.mgmtPct) / 100 * egi1;
  const t12OpexTotal = cat ? EXPENSE_CATS.reduce((s, c) => s + (cat[c] || 0), 0) : lNum(deal.currentOpexTotal);

  // Keep the single OpEx/unit field in step (Quick UW caps and other views read it).
  const commit = (next) => {
    const fixed = OPEX_LINES.filter((l) => !l.pct).reduce((s, l) => s + lNum((next.lines || {})[l.key]), 0);
    const y1 = fixed + lNum(next.mgmtPct) / 100 * egi1;
    set({ uwOpex: next, marketOpexPerUnit: Math.round(y1 / units) });
  };
  const setLine = (key, v) => commit({ ...ux, mode: 'lines', lines: { ...(ux.lines || {}), [key]: v === '' ? 0 : v } });
  const setPb = (k, v) => set('uwOpex', { ...ux, playbook: { ...pb, [k]: v } });
  const applyPlaybook = () => {
    const r = altusPlaybook({ t12pu, units, vintage: deal.vintage, egi: egi1, price: lNum(deal.purchasePrice), tier: pb.tier, taxMethod: pb.taxMethod, taxRate: pb.taxRate,
      vacancyElevated: uw && uw.inPlaceEconVac > 0.15 });
    commit({ ...ux, mode: 'lines', lines: r.lines, mgmtPct: r.mgmtPct, notes: r.notes, playbook: pb, source: 'playbook' });
  };
  const fromT12 = () => {
    const lines = {};
    OPEX_LINES.forEach((l) => { if (!l.pct) lines[l.key] = l.cat ? Math.round(t12Total(l) || 0) : Math.round(lNum((ux.lines || {}).reserves) || 0); });
    const mgmtPct = t12Egi > 0 ? Math.round(((cat && cat.Management) || 0) / t12Egi * 1000) / 10 : 3.5;
    commit({ ...ux, mode: 'lines', lines, mgmtPct, notes: {}, source: 't12' });
  };

  // other income
  const t12Rubs = cat ? (cat.RUBs || 0) : null, t12Other = cat ? (cat['Other Income'] || 0) : null;
  const startOther = () => set('uwOtherIncome', { mode: 'lines',
    rubsPUPM: Math.round((t12Rubs != null ? t12Rubs : 0) / units / 12), rubsPct: 100,
    otherPUPM: Math.round((t12Other != null ? t12Other : lNum(deal.otherIncome)) / units / 12) });
  const setO = (k, v) => set('uwOtherIncome', { ...uo, mode: 'lines', [k]: v });
  const rubsAnnual = activeO ? units * 12 * lNum(uo.rubsPUPM) * lNum(uo.rubsPct == null ? 100 : uo.rubsPct) / 100 : null;
  const otherAnnual = activeO ? units * 12 * lNum(uo.otherPUPM) : null;

  const fileRef = React.useRef(null);
  const t12Status = t12Data && t12Data.status;

  const grid = 'minmax(170px,1.3fr) 112px 92px 132px 116px minmax(150px,1.6fr)';
  const cell = { padding: '7px 10px', fontSize: 12.5, borderTop: '1px solid var(--line)', display: 'flex', alignItems: 'center' };
  const numCell = { ...cell, justifyContent: 'flex-end', fontVariantNumeric: 'tabular-nums' };

  const summary = (
    <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)' }}>
      <span>UW OpEx <b className="num" style={{ color: 'var(--ink)' }}>{active ? lMoney(uwOpexY1 / units) : lMoney(lNum(deal.marketOpexPerUnit))}</b>/unit</span>
      <span>Expense ratio <b className="num" style={{ color: 'var(--ink)' }}>{egi1 > 0 ? lPct((active ? uwOpexY1 : lNum(deal.marketOpexPerUnit) * units) / egi1) : '—'}</b></span>
      <span style={{ padding: '2px 8px', borderRadius: 999, background: active ? 'var(--accent-soft)' : 'var(--panel-3)', color: active ? 'var(--accent-2)' : 'var(--slate)', fontWeight: 600 }}>
        {active ? 'Underwriting by line item' : 'Single $/unit'}</span>
    </div>);

  return (
    <Card>
      <SectionHead icon="table" title="Operating Expense & Other Income Detail"
        desc="T-12 by line item next to our underwriting. Enter any line as an annual total or $ per unit."
        right={<button type="button" style={L_BTN} onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'Hide detail' : 'Show detail'}</button>} />
      <div style={{ marginTop: 10 }}>{summary}</div>
      {open && (<>
        {/* source row: T-12 status + upload */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, padding: '9px 12px', borderRadius: 8, background: 'var(--panel-2)', flexWrap: 'wrap' }}>
          <Icon name="doc" size={14} style={{ color: 'var(--muted)' }} />
          <span style={{ fontSize: 12.5, color: 'var(--slate)' }}>
            {t12Status === 'parsing' ? 'Reading the T-12…'
              : t12Status === 'error' ? 'Could not read that T-12: ' + String(t12Data.error || '').slice(0, 120)
              : deal.t12Lines ? <span>T-12 line items from <b>{deal.t12Lines.fileName || 'upload'}</b> · {deal.t12Lines.lines.length} lines</span>
              : 'No T-12 line items yet. Upload a T-12 to see actuals by line.'}
          </span>
          {onT12Upload && <>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.pdf,.txt" style={{ display: 'none' }}
              onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) onT12Upload(deal.id, f); e.target.value = ''; }} />
            <button type="button" style={{ ...L_BTN, marginLeft: 'auto' }} onClick={() => fileRef.current && fileRef.current.click()} disabled={t12Status === 'parsing'}>
              {deal.t12Lines ? 'Replace T-12' : 'Upload T-12'}</button>
          </>}
        </div>

        {/* OTHER INCOME */}
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>Other Income</span>
            {activeO
              ? <button type="button" style={L_BTN} onClick={() => set('uwOtherIncome', { ...uo, mode: 'off' })}>Use single other-income figure</button>
              : <button type="button" style={L_PRIMARY} onClick={startOther}>Underwrite RUBS and other income separately</button>}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 720 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(170px,1.3fr) 112px 104px 132px 116px 132px', padding: '0 0 4px' }}>
                {['', 'T-12 Total', 'T-12 /Unit/Mo', 'UW /Unit/Mo', '% Units Billed', 'UW Annual'].map((h, i) => <span key={i} style={{ ...L_HEAD, textAlign: i ? 'right' : 'left', padding: '0 10px' }}>{h}</span>)}
              </div>
              {[
                { k: 'rubs', label: 'RUBS / Utility Reimbursement', t12: t12Rubs, pupm: 'rubsPUPM', billed: true, annual: rubsAnnual },
                { k: 'other', label: 'Other Income', t12: t12Other == null ? (cat ? 0 : lNum(deal.otherIncome)) : t12Other, pupm: 'otherPUPM', annual: otherAnnual, note: cat ? null : 'trailing total' },
              ].map((r) => (
                <div key={r.k} style={{ display: 'grid', gridTemplateColumns: 'minmax(170px,1.3fr) 112px 104px 132px 116px 132px' }}>
                  <div style={cell}><span>{r.label}</span>{r.note && <span style={{ fontSize: 10.5, color: 'var(--faint)', marginLeft: 6 }}>{r.note}</span>}</div>
                  <div style={numCell}>{r.t12 == null ? '—' : lMoney(r.t12)}</div>
                  <div style={numCell}>{r.t12 == null ? '—' : lMoney(r.t12 / units / 12)}</div>
                  <div style={{ ...numCell, padding: '4px 6px' }}>{activeO ? <FieldInput value={uo[r.pupm]} onChange={(v) => setO(r.pupm, v)} prefix="$" /> : <span style={{ color: 'var(--faint)' }}>—</span>}</div>
                  <div style={{ ...numCell, padding: '4px 6px' }}>{r.billed ? (activeO ? <FieldInput value={uo.rubsPct == null ? 100 : uo.rubsPct} onChange={(v) => setO('rubsPct', v)} suffix="%" align="left" /> : <span style={{ color: 'var(--faint)' }}>—</span>) : null}</div>
                  <div style={{ ...numCell, fontWeight: 600 }}>{r.annual == null ? '—' : lMoney(r.annual)}</div>
                </div>
              ))}
              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(170px,1.3fr) 112px 104px 132px 116px 132px', background: 'var(--panel-2)' }}>
                <div style={{ ...cell, fontWeight: 700 }}>Total Other Income</div>
                <div style={{ ...numCell, fontWeight: 700 }}>{lMoney(cat ? (t12Rubs || 0) + (t12Other || 0) : lNum(deal.otherIncome))}</div>
                <div style={numCell}>{lMoney((cat ? (t12Rubs || 0) + (t12Other || 0) : lNum(deal.otherIncome)) / units / 12)}</div>
                <div style={numCell}>{activeO ? lMoney(lNum(uo.rubsPUPM) * lNum(uo.rubsPct == null ? 100 : uo.rubsPct) / 100 + lNum(uo.otherPUPM)) : ''}</div>
                <div style={numCell} />
                <div style={{ ...numCell, fontWeight: 700, color: 'var(--accent)' }}>{activeO ? lMoney(rubsAnnual + otherAnnual) : lMoney(uw ? uw.otherIncomeStab : 0)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* OPERATING EXPENSES */}
        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)', marginRight: 'auto' }}>Operating Expenses</span>
            <select value={pb.tier} onChange={(e) => setPb('tier', e.target.value)} style={L_SELECT} aria-label="Market tier">
              <option value="tertiary">Tertiary market</option><option value="secondary">Secondary market</option><option value="strong_secondary">Strong secondary</option>
            </select>
            <select value={pb.taxMethod} onChange={(e) => setPb('taxMethod', e.target.value)} style={L_SELECT} aria-label="Tax method">
              <option value="prelim">Taxes: T-12 +15%</option><option value="reassess">Taxes: reassess to price</option>
            </select>
            {pb.taxMethod === 'reassess' && <>
              <select value="" onChange={(e) => e.target.value && setPb('taxRate', Number(e.target.value))} style={L_SELECT} aria-label="County rate">
                <option value="">County rate…</option>
                {COUNTY_TAX.map(([st, c, r]) => <option key={st + c} value={r}>{c}, {st} · {r}%</option>)}
              </select>
              <FieldInput value={pb.taxRate} onChange={(v) => setPb('taxRate', v)} suffix="%" align="left" width={88} />
            </>}
            {active
              ? <ConfirmBtn label="Re-apply Altus playbook" confirmLabel="Overwrite lines? Click again" onConfirm={applyPlaybook} style={L_BTN} />
              : <button type="button" style={L_PRIMARY} onClick={applyPlaybook}>Apply Altus playbook</button>}
            {cat && (active
              ? <ConfirmBtn label="Reset to T-12" confirmLabel="Overwrite lines? Click again" onConfirm={fromT12} style={L_BTN} />
              : <button type="button" style={L_BTN} onClick={fromT12}>Start from T-12 actuals</button>)}
            {active && <button type="button" style={L_BTN} onClick={() => set('uwOpex', { ...ux, mode: 'single' })}>Use single $/unit</button>}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 820 }}>
              <div style={{ display: 'grid', gridTemplateColumns: grid, padding: '0 0 4px' }}>
                {['Line Item', 'T-12 Total', 'T-12 /Unit', 'UW Total', 'UW /Unit', 'Basis'].map((h, i) => <span key={i} style={{ ...L_HEAD, textAlign: i && i < 5 ? 'right' : 'left', padding: '0 10px' }}>{h}</span>)}
              </div>
              {OPEX_LINES.map((l) => {
                const tt = t12Total(l);
                const ut = uwTotal(l);
                const note = (ux.notes || {})[l.key] || (l.pct ? '% of EGI · grows with income' : l.key === 'reserves' ? 'UW only · above NOI' : '');
                return (
                  <div key={l.key} style={{ display: 'grid', gridTemplateColumns: grid }}>
                    <div style={cell}>{l.label}</div>
                    <div style={numCell}>{tt == null ? '—' : lMoney(tt)}</div>
                    <div style={numCell}>{tt == null ? '—' : (l.pct ? (t12Egi > 0 ? lPct(tt / t12Egi) + ' EGI' : '—') : lMoney(tt / units))}</div>
                    <div style={{ ...numCell, padding: '4px 6px' }}>
                      {!active ? <span style={{ color: 'var(--faint)' }}>—</span>
                        : l.pct ? <span className="num">{lMoney(ut)}</span>
                        : <FieldInput value={Math.round(lNum((ux.lines || {})[l.key]))} onChange={(v) => setLine(l.key, v)} prefix="$" />}
                    </div>
                    <div style={{ ...numCell, padding: '4px 6px' }}>
                      {!active ? <span style={{ color: 'var(--faint)' }}>—</span>
                        : l.pct ? <FieldInput value={ux.mgmtPct} onChange={(v) => commit({ ...ux, mode: 'lines', mgmtPct: v })} suffix="%" align="left" />
                        : <FieldInput value={Math.round(lNum((ux.lines || {})[l.key]) / units)} onChange={(v) => setLine(l.key, (v === '' ? 0 : v) * units)} prefix="$" />}
                    </div>
                    <div style={{ ...cell, fontSize: 11, color: /CONFIRM|NO TAX|elevated/.test(note) ? 'var(--warn)' : 'var(--faint)', lineHeight: 1.35 }}>{note}</div>
                  </div>);
              })}
              <div style={{ display: 'grid', gridTemplateColumns: grid, background: 'var(--panel-2)' }}>
                <div style={{ ...cell, fontWeight: 700 }}>Total Operating Expenses</div>
                <div style={{ ...numCell, fontWeight: 700 }}>{lMoney(t12OpexTotal)}</div>
                <div style={{ ...numCell, fontWeight: 700 }}>{lMoney(t12OpexTotal / units)}</div>
                <div style={{ ...numCell, fontWeight: 700, color: 'var(--accent)' }}>{active ? lMoney(uwOpexY1) : lMoney(lNum(deal.marketOpexPerUnit) * units)}</div>
                <div style={{ ...numCell, fontWeight: 700, color: 'var(--accent)' }}>{active ? lMoney(uwOpexY1 / units) : lMoney(lNum(deal.marketOpexPerUnit))}</div>
                <div style={{ ...cell, fontSize: 11.5, color: 'var(--muted)' }}>
                  Expense ratio: T-12 {t12Egi > 0 ? lPct(t12OpexTotal / t12Egi) : '—'} · UW {egi1 > 0 ? lPct((active ? uwOpexY1 : lNum(deal.marketOpexPerUnit) * units) / egi1) : '—'}
                </div>
              </div>
            </div>
          </div>
          {!active && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 8 }}>
            The model is using the single OpEx/unit figure above. Apply the playbook or start from the T-12 to underwrite each line.</div>}
        </div>
      </>)}
    </Card>);
}

Object.assign(window, { LineItemsSection, altusPlaybook, t12ByCategory, OPEX_LINES });
