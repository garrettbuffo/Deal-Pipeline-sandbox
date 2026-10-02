// app/rentroll.jsx — Deal detail "Rent Roll" tab: the unit-mix matrix from the Altus Excel
// template's Unit Mix Summary (multifamily-uw skill). Groups the standardized rent roll by unit
// type and shows occupancy, in-place vs market, Min / Max in-place, the average of the top 25%
// of in-place leases and the last three signed, with loss to lease against each benchmark.
// Units come from deal.rentRoll.units: [{ id, type, sf, market, rent, occ, leaseStart }].
const { useState: useStateR, useMemo: useMemoR, useRef: useRefR, useEffect: useEffectR } = React;

const rrMoney = (v) => (v == null || isNaN(v)) ? '—' : '$' + Math.round(v).toLocaleString('en-US');
const rMoney2 = (v) => (v == null || isNaN(v)) ? '—' : '$' + Number(v).toFixed(2);
const rPct = (v, d = 1) => (v == null || isNaN(v)) ? '—' : (v * 100).toFixed(d) + '%';
const rAvg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);

// Excel PERCENTILE.INC
function percentileInc(sorted, p) {
  if (!sorted.length) return null;
  const r = p * (sorted.length - 1), lo = Math.floor(r), hi = Math.ceil(r);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (r - lo);
}

// Natural sort for unit types ("1x1", "2x1", "2x2 Reno", "10x…").
const typeCmp = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' });

function typeStats(us) {
  const occ = us.filter((u) => u.occ && u.rent != null && u.rent > 0);
  const inPlace = occ.map((u) => u.rent).sort((a, b) => a - b);
  const p75 = percentileInc(inPlace, 0.75);
  const top25 = p75 == null ? null : rAvg(inPlace.filter((r) => r >= p75));
  // Last 3 signed: occupied leases on or after the third-newest lease start.
  const dated = occ.filter((u) => u.leaseStart).sort((a, b) => (a.leaseStart < b.leaseStart ? 1 : -1));
  const cut = dated.length ? dated[Math.min(2, dated.length - 1)].leaseStart : null;
  const last3 = cut ? rAvg(dated.filter((u) => u.leaseStart >= cut).map((u) => u.rent)) : null;
  const sfs = us.filter((u) => u.sf > 0).map((u) => u.sf);
  const mk = us.filter((u) => u.market != null && u.market > 0).map((u) => u.market);
  const avgSf = rAvg(sfs), avgIn = rAvg(inPlace), avgMk = rAvg(mk);
  return {
    units: us.length, occUnits: us.filter((u) => u.occ).length, avgSf, avgIn, avgMk,
    psf: avgIn != null && avgSf ? avgIn / avgSf : null, mpsf: avgMk != null && avgSf ? avgMk / avgSf : null,
    min: inPlace.length ? inPlace[0] : null, max: inPlace.length ? inPlace[inPlace.length - 1] : null, top25, last3,
  };
}

// Matrix rows by type plus a unit-weighted total row (as the template's Total row is).
function rentRollMatrix(units) {
  const by = {};
  (units || []).forEach((u) => { (by[u.type || 'All units'] = by[u.type || 'All units'] || []).push(u); });
  const rows = Object.keys(by).sort(typeCmp).map((t) => ({ type: t, ...typeStats(by[t]) }));
  const N = rows.reduce((s, r) => s + r.units, 0);
  const w = (k) => {
    const rs = rows.filter((r) => r[k] != null);
    const n = rs.reduce((s, r) => s + r.units, 0);
    return n ? rs.reduce((s, r) => s + r[k] * r.units, 0) / n : null;
  };
  const total = { type: 'Total / Avg', units: N, occUnits: rows.reduce((s, r) => s + r.occUnits, 0),
    avgSf: w('avgSf'), avgIn: w('avgIn'), avgMk: w('avgMk'), min: w('min'), max: w('max'), top25: w('top25'), last3: w('last3') };
  total.psf = total.avgIn != null && total.avgSf ? total.avgIn / total.avgSf : null;
  total.mpsf = total.avgMk != null && total.avgSf ? total.avgMk / total.avgSf : null;
  return { rows, total };
}

// GPR basis: what each unit is priced at for gross potential rent.
const GPR_BASES = [
  { key: 'market', label: 'Market rent' },
  { key: 'max', label: 'Max in-place rent' },
  { key: 'top25', label: 'Top 25% in-place rent' },
  { key: 'manual', label: 'Manual average rate' },
];

// Underwritten market rent by unit type, as the template's Property Info "Market Rents" block.
// Basis 'market': the rent roll's market rent for the type, floored at the type's average in-place
// lease. 'max' / 'top25': that in-place benchmark per type. 'manual': one monthly average for every
// unit. A per-type override (deal.marketRents) wins on any basis except manual.
function rentRollPricing(deal) {
  const units = deal && deal.rentRoll && Array.isArray(deal.rentRoll.units) ? deal.rentRoll.units : [];
  if (!units.length) return null;
  const basis = GPR_BASES.some((b) => b.key === deal.gprBasis) ? deal.gprBasis : 'market';
  const manual = Number(deal.gprManualRate) > 0 ? Number(deal.gprManualRate) : null;
  const ov = deal.marketRents || {};
  const types = rentRollMatrix(units).rows.map((r) => {
    const rrMkt = r.avgMk != null && r.avgMk > 0 ? r.avgMk : null;
    const inPlace = r.avgIn;
    const useRR = rrMkt != null && (inPlace == null || rrMkt >= inPlace);
    const mktDflt = useRR ? rrMkt : (inPlace != null ? inPlace : 0);
    let dflt = mktDflt, dfltSrc = useRR ? 'rent roll market' : rrMkt == null ? 'no market on roll · avg in-place' : 'market below in-place · avg in-place';
    if (basis === 'max' && r.max != null) { dflt = r.max; dfltSrc = 'max in-place'; }
    if (basis === 'top25' && r.top25 != null) { dflt = r.top25; dfltSrc = 'top 25% in-place'; }
    if (basis === 'manual') { dflt = manual != null ? manual : mktDflt; dfltSrc = manual != null ? 'manual average rate' : 'enter a manual rate'; }
    const o = Number(ov[r.type]);
    const own = basis !== 'manual' && o > 0;
    return { type: r.type, units: r.units, occUnits: r.occUnits, vac: r.units - r.occUnits, sf: r.avgSf, inPlace, rrMkt, dflt, dfltSrc,
      market: own ? o : dflt, overridden: own };
  });
  const N = types.reduce((s, t) => s + t.units, 0);
  const sum = (f) => types.reduce((s, t) => s + f(t), 0);
  const gprM = sum((t) => t.units * t.market);
  // physical vacancy: vacant units at the type's effective (avg in-place) lease rate
  const physM = sum((t) => t.vac * (t.inPlace != null ? t.inPlace : t.market));
  // loss to lease: market vs avg in-place across every unit (template R10 x units), so
  // GPR − physical vacancy − loss to lease = the rent roll's in-place rent
  const ltlM = sum((t) => t.units * (t.market - (t.inPlace != null ? t.inPlace : t.market)));
  const avgIn = N ? sum((t) => t.units * (t.inPlace != null ? t.inPlace : 0)) / N : 0;
  const avgMkt = N ? gprM / N : 0;
  const sfN = sum((t) => (t.sf ? t.units : 0));
  return { basis, manual, types, units: N, occ: N ? sum((t) => t.occUnits) / N : 0, avgSf: sfN ? sum((t) => (t.sf ? t.sf * t.units : 0)) / sfN : null,
    avgIn, avgMkt, ltlPerUnit: avgMkt - avgIn, ltlPct: avgMkt ? 1 - avgIn / avgMkt : null,
    inPlaceAnnual: Math.round(avgIn * N * 12), gprAnnual: Math.round(gprM * 12), physVacLoss: Math.round(physM * 12), lossToLease: Math.round(ltlM * 12) };
}
// The Full UW income fields the rent roll drives while the deal is linked to it. Fields the user
// has typed over (deal.rrOverride) are left alone. When the property's unit count is overridden
// (an incomplete roll), the rent roll's dollars scale to it: missing units are assumed average.
function rentRollFields(deal) {
  const p = rentRollPricing(deal);
  if (!p || (deal && deal.incomeFromRR === false)) return {};
  const ovr = deal.rrOverride || {};
  const n = ovr.units && Number(deal.units) > 0 ? Number(deal.units) : p.units;
  const k = p.units ? n / p.units : 1;
  const out = { gprAnnual: Math.round(p.gprAnnual * k) };
  if (!ovr.units) out.units = p.units;
  if (!ovr.physVacLoss) out.physVacLoss = Math.round(p.physVacLoss * k);
  if (!ovr.lossToLease) out.lossToLease = Math.round(p.lossToLease * k);
  return out;
}
// Apply a change and, if the deal is linked to its rent roll, re-derive the income fields with it.
function setWithRentRoll(deal, set, changes) {
  set({ ...changes, ...rentRollFields({ ...deal, ...changes }) });
}
// Type over one rent-roll-driven field (true) or hand it back to the rent roll (false).
function overrideRentRoll(deal, set, field, value) {
  const rrOverride = { ...(deal.rrOverride || {}) };
  if (value === undefined) delete rrOverride[field]; else rrOverride[field] = true;
  setWithRentRoll(deal, set, { rrOverride, ...(value === undefined ? {} : { [field]: value }) });
}

/* GPR basis picker (+ manual monthly rate), shared by the Rent Roll tab and Full UW. */
function GprBasisPicker({ deal, set, compact }) {
  const basis = GPR_BASES.some((b) => b.key === deal.gprBasis) ? deal.gprBasis : 'market';
  const sel = { height: compact ? 30 : 34, border: '1px solid var(--line-2)', borderRadius: 7, padding: '0 10px', background: 'var(--panel)', fontSize: 12.5, fontFamily: 'var(--font)', color: 'var(--ink)', cursor: 'pointer' };
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)' }}>GPR basis</span>
      <select value={basis} onChange={(e) => setWithRentRoll(deal, set, { gprBasis: e.target.value })} style={sel} aria-label="GPR basis">
        {GPR_BASES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
      </select>
      {basis === 'manual' && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <FieldInput value={deal.gprManualRate} onChange={(v) => setWithRentRoll(deal, set, { gprManualRate: v })} prefix="$" width={120} placeholder="avg / unit" />
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>/ unit / mo</span>
      </span>}
    </div>);
}

// Sandbox preview only: a plausible roll sized to the deal so the layout can be reviewed visually.
function sampleUnits(deal) {
  const n = Math.max(8, Math.min(400, Number(deal.units) || 120));
  const rpu = Number(deal.gprAnnual) > 0 && Number(deal.units) > 0 ? deal.gprAnnual / deal.units / 12 : 1050;
  const mix = [['1x1', 0.38, 650, 0.86], ['2x1', 0.27, 860, 1.0], ['2x2', 0.25, 980, 1.1], ['3x2', 0.1, 1200, 1.28]];
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const out = []; let id = 100;
  mix.forEach(([type, share, sf, rel], ti) => {
    const k = ti === mix.length - 1 ? n - out.length : Math.round(n * share);
    for (let i = 0; i < k; i++) {
      const market = Math.round(rpu * rel / 5) * 5;
      const occ = rnd() > 0.07;
      const rent = occ ? Math.round(market * (0.9 + rnd() * 0.12)) : null;
      const m = 1 + Math.floor(rnd() * 12);
      out.push({ id: String(++id), type, sf, market, rent, occ, leaseStart: occ ? (m > 9 ? '2025' : '2026') + '-' + String(((m + 8) % 12) + 1).padStart(2, '0') + '-' + String(1 + Math.floor(rnd() * 27)).padStart(2, '0') : '' });
    }
  });
  return out;
}

const R_HEAD = { fontSize: 9.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)', padding: '0 8px 6px', textAlign: 'right', whiteSpace: 'nowrap' };
const R_BTN = { border: '1px solid var(--line-2)', background: 'var(--panel)', color: 'var(--slate)', borderRadius: 7, padding: '6px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' };
const R_PRIMARY = { ...R_BTN, border: 'none', background: 'var(--accent)', color: '#fff' };

function RRConfirm({ label, confirmLabel, onConfirm, style }) {
  const [armed, setArmed] = useStateR(false);
  useEffectR(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3500); return () => clearTimeout(t); }, [armed]);
  return <button type="button" style={{ ...style, ...(armed ? { borderColor: 'var(--warn)', color: 'var(--warn)', background: 'var(--warn-soft)' } : {}) }}
    onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}>{armed ? confirmLabel : label}</button>;
}


function RRText({ value, onCommit, width, placeholder, type }) {
  const [v, setV] = useStateR(value || '');
  useEffectR(() => { setV(value || ''); }, [value]);
  return <input type={type || 'text'} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)}
    onBlur={() => { if ((v || '') !== (value || '')) onCommit(v); }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    style={{ width: width || '100%', height: 28, border: '1px solid var(--line-2)', borderRadius: 6, padding: '0 7px', fontSize: 12.5, background: 'var(--panel)', boxSizing: 'border-box', fontFamily: 'var(--font)' }} />;
}
function RRNum({ value, onCommit, width }) {
  return <RRText value={value == null ? '' : String(value)} width={width || 84} onCommit={(t) => { const n = Number(String(t).replace(/[$,\s]/g, '')); onCommit(t === '' || isNaN(n) ? null : Math.round(n)); }} />;
}

/* One rent-roll-driven figure: shows the derived value, can be typed over, and resets to the roll. */
function RROverrideField({ deal, set, field, label, derived, sub, prefix }) {
  const own = !!(deal.rrOverride || {})[field];
  return (
    <div style={{ minWidth: 150 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 5 }}>{label}</div>
      <FieldInput value={deal[field]} onChange={(v) => overrideRentRoll(deal, set, field, v === '' ? 0 : v)} prefix={prefix} />
      <div style={{ fontSize: 10.5, marginTop: 4, color: own ? 'var(--warn)' : 'var(--faint)' }}>
        {own
          ? <span>Overridden · roll {derived} · <button type="button" onClick={() => overrideRentRoll(deal, set, field, undefined)}
              style={{ border: 'none', background: 'none', padding: 0, color: 'var(--accent)', fontSize: 10.5, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'var(--font)' }}>use rent roll</button></span>
          : sub}
      </div>
    </div>);
}

/* What the rent roll sends to Full UW: GPR basis, unit count and vacancy, each overridable. */
function RRIncomePanel({ deal, set, pr, linked }) {
  const ovr = deal.rrOverride || {};
  const k = ovr.units && Number(deal.units) > 0 && pr.units ? Number(deal.units) / pr.units : 1;
  return (
    <div style={{ marginTop: 14, padding: '12px 14px', borderRadius: 10, border: '1px solid ' + (linked ? 'var(--accent-soft)' : 'var(--line)'), background: linked ? 'var(--panel)' : 'var(--panel-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>Full UW income from this rent roll</span>
        {linked && <GprBasisPicker deal={deal} set={set} compact />}
        <button type="button" style={{ ...R_BTN, marginLeft: 'auto', padding: '4px 10px' }}
          onClick={() => (linked ? set('incomeFromRR', false) : set({ incomeFromRR: true, ...rentRollFields({ ...deal, incomeFromRR: true }) }))}>
          {linked ? 'Enter income by hand' : 'Link to Full UW'}</button>
      </div>
      {linked ? <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 12, alignItems: 'flex-start' }}>
        <RROverrideField deal={deal} set={set} field="units" label="Property Units" derived={pr.units}
          sub={pr.units + ' on the rent roll'} />
        <div style={{ minWidth: 150 }}>
          <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 5 }}>Gross Potential Rent</div>
          <div className="num" style={{ height: 34, display: 'flex', alignItems: 'center', fontSize: 16, fontWeight: 700, color: 'var(--ink)' }}>{rrMoney(deal.gprAnnual)}</div>
          <div style={{ fontSize: 10.5, marginTop: 4, color: 'var(--faint)' }}>{rrMoney(pr.avgMkt)} avg / unit / mo{k !== 1 ? ' · scaled to ' + deal.units + ' units' : ''}</div>
        </div>
        <RROverrideField deal={deal} set={set} field="physVacLoss" label="Physical Vacancy" prefix="$" derived={rrMoney(pr.physVacLoss * k)}
          sub={(pr.units - Math.round(pr.occ * pr.units)) + ' vacant at in-place rent'} />
        <RROverrideField deal={deal} set={set} field="lossToLease" label="Loss to Lease" prefix="$" derived={rrMoney(pr.lossToLease * k)}
          sub={pr.ltlPct == null ? '' : rPct(pr.ltlPct) + ' · market vs avg in-place'} />
      </div>
      : <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>Full UW income is entered by hand, not from this rent roll.</div>}
    </div>);
}

function RentRollTab({ deal, set, onRRUpload, rrData }) {
  const rr = deal.rentRoll;
  const units = (rr && Array.isArray(rr.units)) ? rr.units : [];
  const fileRef = useRefR(null);
  const [showUnits, setShowUnits] = useStateR(false);
  const mx = useMemoR(() => rentRollMatrix(units), [units]);
  const parsing = rrData && rrData.status === 'parsing';
  const err = rrData && rrData.status === 'error' ? String(rrData.error || '') : '';
  const sandbox = !!(window.ALTUS_CONFIG && window.ALTUS_CONFIG.SANDBOX);
  const setUnits = (next) => setWithRentRoll(deal, set, { rentRoll: { ...rr, units: next, editedAt: new Date().toISOString() } });
  const editUnit = (i, k, v) => setUnits(units.map((u, j) => (j === i ? { ...u, [k]: v } : u)));

  const upload = onRRUpload && <>
    <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.pdf,.txt" style={{ display: 'none' }}
      onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) onRRUpload(deal.id, f); e.target.value = ''; }} />
    <button type="button" style={units.length ? R_BTN : R_PRIMARY} disabled={parsing} onClick={() => fileRef.current && fileRef.current.click()}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="upload" size={13} />{parsing ? 'Reading rent roll…' : units.length ? 'Replace rent roll' : 'Upload rent roll'}</span></button>
  </>;

  if (!units.length) {
    return (
      <Card>
        <SectionHead icon="table" title="Rent Roll Matrix" desc="Unit mix by type, built the way the Altus Excel template's Unit Mix Summary is." />
        <div style={{ marginTop: 18, padding: '34px 20px', border: '1px dashed var(--line-2)', borderRadius: 10, textAlign: 'center', background: 'var(--panel-2)' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{parsing ? 'Reading the rent roll…' : 'No rent roll on this deal yet'}</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', margin: '6px auto 16px', maxWidth: 540, lineHeight: 1.5 }}>
            Upload the seller's rent roll (Excel, CSV or PDF). Clean tables are read directly; anything else is read by Claude. Every unit stays editable here, and the Full UW income section prices off it.
          </div>
          {err && <div style={{ fontSize: 12, color: 'var(--neg)', marginBottom: 12 }}>Could not read that file: {err.slice(0, 160)}</div>}
          <div style={{ display: 'inline-flex', gap: 8 }}>
            {upload}
            {sandbox && <button type="button" style={R_BTN} onClick={() => setWithRentRoll(deal, set, { rentRoll: { fileName: 'Sample units (sandbox preview)', sample: true, parsedAt: new Date().toISOString(), units: sampleUnits(deal) } })}>Preview with sample units</button>}
          </div>
        </div>
      </Card>);
  }

  const T = mx.total;
  const physVac = T.units ? 1 - T.occUnits / T.units : null;
  const ltl = (b) => (b && T.avgIn != null ? 1 - T.avgIn / b : null);
  const pr = rentRollPricing(deal);
  const linked = deal.incomeFromRR !== false;
  const cols = 'minmax(110px,1.2fr) 60px 64px 72px 66px 92px 70px 92px 70px 84px 84px 90px 108px';
  const cellR = { padding: '8px 8px', fontSize: 12.5, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
  const rowView = (r, isTotal) => (
    <div key={r.type} style={{ display: 'grid', gridTemplateColumns: cols, borderTop: isTotal ? '2px solid var(--line-2)' : '1px solid var(--line)',
      background: isTotal ? 'var(--panel-2)' : 'transparent', fontWeight: isTotal ? 700 : 400 }}>
      <div style={{ ...cellR, textAlign: 'left', fontWeight: isTotal ? 700 : 600, color: 'var(--ink)' }}>{r.type}</div>
      <div style={cellR}>{r.units}</div>
      <div style={cellR}>{rPct(r.units / (T.units || 1), 0)}</div>
      <div style={cellR}>{r.avgSf ? Math.round(r.avgSf).toLocaleString() : '—'}</div>
      <div style={{ ...cellR, color: r.units && r.occUnits / r.units < 0.9 ? 'var(--warn)' : undefined }}>{rPct(r.units ? r.occUnits / r.units : null)}</div>
      <div style={{ ...cellR, color: 'var(--ink)', fontWeight: 600 }}>{rrMoney(r.avgIn)}</div>
      <div style={{ ...cellR, color: 'var(--muted)' }}>{rMoney2(r.psf)}</div>
      <div style={{ ...cellR, color: 'var(--accent-2)', fontWeight: 600 }}>{rrMoney(r.avgMk)}</div>
      <div style={{ ...cellR, color: 'var(--muted)' }}>{rMoney2(r.mpsf)}</div>
      <div style={{ ...cellR, background: 'var(--panel-3)' }}>{rrMoney(r.min)}</div>
      <div style={{ ...cellR, background: 'var(--panel-3)', fontWeight: 600 }}>{rrMoney(r.max)}</div>
      <div style={{ ...cellR, background: 'var(--panel-3)', fontWeight: 600 }}>{rrMoney(r.top25)}</div>
      <div style={{ ...cellR, background: 'var(--panel-3)' }}>{rrMoney(r.last3)}</div>
    </div>);

  const stat = (label, value, sub, color) => (
    <div style={{ flex: '1 1 140px', padding: '10px 14px', borderRadius: 9, background: 'var(--panel-2)', border: '1px solid var(--line)' }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</div>
      <div className="num" style={{ fontSize: 18, fontWeight: 700, color: color || 'var(--ink)', marginTop: 3 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>{sub}</div>}
    </div>);
  const th = (h, i, left) => <th key={h} style={{ ...R_HEAD, textAlign: left ? 'left' : 'right', position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 1 }}>{h}</th>;
  const td = { padding: '3px 6px', borderTop: '1px solid var(--line)' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <SectionHead icon="table" title="Rent Roll Matrix"
          desc={<span>{rr.sample ? <b style={{ color: 'var(--warn)' }}>Sample units for layout review, not from a rent roll · </b> : null}
            {rr.fileName || 'Rent roll'} · {units.length} units{rr.parsedAt ? ' · read ' + new Date(rr.parsedAt).toLocaleDateString() : ''}{rr.editedAt ? ' · edited ' + new Date(rr.editedAt).toLocaleDateString() : ''}</span>}
          right={<div style={{ display: 'flex', gap: 8 }}>{upload}
            <RRConfirm label="Remove" confirmLabel="Remove rent roll? Click again" onConfirm={() => set('rentRoll', null)} style={R_BTN} /></div>} />

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
          {stat('Physical Occupancy', rPct(T.units ? T.occUnits / T.units : null), T.occUnits + ' of ' + T.units + ' units')}
          {stat('Avg In-Place', rrMoney(T.avgIn), rMoney2(T.psf) + ' / SF')}
          {stat('Avg Market (roll)', rrMoney(T.avgMk), rMoney2(T.mpsf) + ' / SF', 'var(--accent-2)')}
          {stat('Top 25% In-Place', rrMoney(T.top25), T.avgIn ? '+' + rPct(T.top25 / T.avgIn - 1) + ' over avg in-place' : null)}
          {stat('UW Market', rrMoney(pr && pr.avgMkt), pr && pr.ltlPct != null ? rPct(pr.ltlPct) + ' loss to lease' : null, 'var(--pos)')}
        </div>

        <div style={{ overflowX: 'auto', marginTop: 16 }}>
          <div style={{ minWidth: 1080 }}>
            <div style={{ display: 'grid', gridTemplateColumns: cols }}>
              {['Unit Type', 'Units', '% Total', 'Avg SF', 'Occ %', 'Avg In-Place', '$/SF', 'Market', 'Mkt $/SF', 'Min', 'Max', 'Top 25%', 'Last 3 Signed'].map((h, i) =>
                <div key={h} style={{ ...R_HEAD, textAlign: i ? 'right' : 'left', paddingTop: 6, ...(i >= 9 ? { background: 'var(--panel-3)', borderRadius: i === 9 ? '6px 0 0 0' : i === 12 ? '0 6px 0 0' : 0 } : {}) }}>{h}</div>)}
            </div>
            {mx.rows.map((r) => rowView(r, false))}
            {rowView(T, true)}
            <div style={{ display: 'grid', gridTemplateColumns: cols, borderTop: '1px solid var(--line)' }}>
              <div style={{ ...cellR, textAlign: 'left', color: 'var(--muted)', fontSize: 11.5 }}>Vacancy / loss to lease</div>
              <div style={cellR} /><div style={cellR} /><div style={cellR} />
              <div style={{ ...cellR, fontSize: 11.5, color: 'var(--neg)' }} title="Physical vacancy = 1 − occupancy">{rPct(physVac)}</div>
              <div style={cellR} /><div style={cellR} />
              <div style={{ ...cellR, fontSize: 11.5, color: 'var(--neg)' }} title="1 − in-place ÷ market">{rPct(ltl(T.avgMk))}</div>
              <div style={cellR} />
              <div style={{ ...cellR, fontSize: 11.5, color: 'var(--muted)', background: 'var(--panel-3)' }}>{rPct(ltl(T.min))}</div>
              <div style={{ ...cellR, fontSize: 11.5, color: 'var(--neg)', background: 'var(--panel-3)' }}>{rPct(ltl(T.max))}</div>
              <div style={{ ...cellR, fontSize: 11.5, color: 'var(--neg)', background: 'var(--panel-3)' }}>{rPct(ltl(T.top25))}</div>
              <div style={{ ...cellR, fontSize: 11.5, color: 'var(--neg)', background: 'var(--panel-3)', borderRadius: '0 0 6px 0' }}>{rPct(ltl(T.last3))}</div>
            </div>
          </div>
        </div>
        <RRIncomePanel deal={deal} set={set} pr={pr} linked={linked} />
      </Card>

      <Card>
        <SectionHead icon="edit" title="Units" desc={'Edit any unit the parser got wrong; the matrix and Full UW update as you go. ' + (units.length - units.filter((u) => u.occ).length) + ' vacant.'}
          right={<button type="button" style={R_BTN} onClick={() => setShowUnits(!showUnits)} aria-expanded={showUnits}>{showUnits ? 'Hide units' : 'Show and edit units'}</button>} />
        {showUnits && <>
          <div style={{ overflowX: 'auto', marginTop: 12, maxHeight: 520, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 760 }}>
              <thead><tr>{th('Unit', 0, true)}{th('Type', 1, true)}{th('SF', 2)}{th('Market', 3)}{th('In-Place', 4)}{th('Occupied', 5)}{th('Lease Start', 6)}{th('', 7)}</tr></thead>
              <tbody>{units.map((u, i) => (
                <tr key={i}>
                  <td style={td}><RRText value={u.id} width={70} onCommit={(v) => editUnit(i, 'id', v)} /></td>
                  <td style={td}><RRText value={u.type} width={120} onCommit={(v) => editUnit(i, 'type', v.trim() || 'All units')} /></td>
                  <td style={{ ...td, textAlign: 'right' }}><RRNum value={u.sf} width={70} onCommit={(v) => editUnit(i, 'sf', v)} /></td>
                  <td style={{ ...td, textAlign: 'right' }}><RRNum value={u.market} onCommit={(v) => editUnit(i, 'market', v)} /></td>
                  <td style={{ ...td, textAlign: 'right' }}><RRNum value={u.rent} onCommit={(v) => editUnit(i, 'rent', v)} /></td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <select value={u.occ ? '1' : '0'} onChange={(e) => editUnit(i, 'occ', e.target.value === '1')}
                      style={{ height: 28, border: '1px solid var(--line-2)', borderRadius: 6, fontSize: 12.5, background: 'var(--panel)', color: u.occ ? 'var(--ink)' : 'var(--neg)', fontFamily: 'var(--font)' }}>
                      <option value="1">Occupied</option><option value="0">Vacant</option></select></td>
                  <td style={{ ...td, textAlign: 'right' }}><RRText type="date" value={u.leaseStart} width={132} onCommit={(v) => editUnit(i, 'leaseStart', v)} /></td>
                  <td style={{ ...td, textAlign: 'right' }}>
                    <button type="button" title="Remove unit" aria-label={'Remove unit ' + u.id} onClick={() => setUnits(units.filter((_, j) => j !== i))}
                      style={{ border: 'none', background: 'none', color: 'var(--faint)', cursor: 'pointer', padding: 4 }}><Icon name="close" size={12} /></button></td>
                </tr>))}</tbody>
            </table>
          </div>
          <button type="button" style={{ ...R_BTN, marginTop: 10 }} onClick={() => { const last = units[units.length - 1] || {}; setUnits([...units, { id: 'New', type: last.type || 'All units', sf: last.sf || null, market: last.market || null, rent: null, occ: false, leaseStart: '' }]); }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Icon name="plus" size={12} />Add unit</span></button>
        </>}
      </Card>
    </div>);
}

Object.assign(window, { RentRollTab, rentRollMatrix, rentRollPricing, rentRollFields, setWithRentRoll, overrideRentRoll, GprBasisPicker, GPR_BASES, percentileInc });
