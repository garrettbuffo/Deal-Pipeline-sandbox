// app/rentroll.jsx — Deal detail "Rent Roll" tab: the unit-mix matrix from the Altus Excel
// template's Unit Mix Summary (multifamily-uw skill). Groups the standardized rent roll by unit
// type and shows occupancy, in-place vs market, Min / Max in-place, the average of the top 25%
// of in-place leases and the last three signed, with loss to lease against each benchmark.
// Units come from deal.rentRoll.units: [{ id, type, sf, market, rent, occ, leaseStart }].
const { useState: useStateR, useMemo: useMemoR, useRef: useRefR, useEffect: useEffectR } = React;

const rMoney = (v) => (v == null || isNaN(v)) ? '—' : '$' + Math.round(v).toLocaleString('en-US');
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

// Rent premise for GPR: each type's units × the chosen benchmark (falls back to that type's market).
const BASES = [
  { key: 'avgMk', label: 'Market (rent roll)' },
  { key: 'top25', label: 'Top 25% in-place' },
  { key: 'max', label: 'Max in-place' },
  { key: 'last3', label: 'Last 3 signed' },
];
function rentRollUW(units, basisKey) {
  const { rows } = rentRollMatrix(units);
  const bench = {};
  rows.forEach((r) => { bench[r.type] = r[basisKey] != null ? r[basisKey] : r.avgMk; });
  let gprM = 0, ltlM = 0, inH = 0, occ = 0, vac = 0;
  units.forEach((u) => {
    const b = bench[u.type || 'All units'] != null ? bench[u.type || 'All units'] : (u.market || 0);
    gprM += b;
    if (u.occ) { occ++; if (u.rent != null) { inH += u.rent; ltlM += Math.max(0, b - u.rent); } } else vac++;
  });
  const avgOcc = occ ? inH / occ : 0;
  return { units: units.length, gprAnnual: Math.round(gprM * 12), lossToLease: Math.round(ltlM * 12), physVacLoss: Math.round(avgOcc * vac * 12), vacant: vac };
}

// Sandbox preview only: a plausible roll sized to the deal so the matrix can be reviewed visually.
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

function RentRollTab({ deal, set, onRRUpload, rrData }) {
  const rr = deal.rentRoll;
  const units = (rr && Array.isArray(rr.units)) ? rr.units : [];
  const fileRef = useRefR(null);
  const [basis, setBasis] = useStateR('avgMk');
  const [showUnits, setShowUnits] = useStateR(false);
  const [applied, setApplied] = useStateR(false);
  const mx = useMemoR(() => rentRollMatrix(units), [units]);
  const parsing = rrData && rrData.status === 'parsing';
  const err = rrData && rrData.status === 'error' ? String(rrData.error || '') : '';
  const sandbox = !!(window.ALTUS_CONFIG && window.ALTUS_CONFIG.SANDBOX);

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
          <div style={{ fontSize: 12.5, color: 'var(--muted)', margin: '6px auto 16px', maxWidth: 520, lineHeight: 1.5 }}>
            Upload the seller's rent roll (Excel, CSV or PDF). Clean tables are read directly; anything else is read by Claude. The matrix groups units by type with occupancy, in-place vs market, Max, Top 25% and the last three signed leases.
          </div>
          {err && <div style={{ fontSize: 12, color: 'var(--neg)', marginBottom: 12 }}>Could not read that file: {err.slice(0, 160)}</div>}
          <div style={{ display: 'inline-flex', gap: 8 }}>
            {upload}
            {sandbox && <button type="button" style={R_BTN} onClick={() => set('rentRoll', { fileName: 'Sample units (sandbox preview)', sample: true, parsedAt: new Date().toISOString(), units: sampleUnits(deal) })}>Preview with sample units</button>}
          </div>
        </div>
      </Card>);
  }

  const T = mx.total;
  const physVac = T.units ? 1 - T.occUnits / T.units : null;
  const ltl = (b) => (b && T.avgIn != null ? 1 - T.avgIn / b : null);
  const uwFig = rentRollUW(units, basis);
  const apply = () => {
    set({ units: uwFig.units, gprAnnual: uwFig.gprAnnual, physVacLoss: uwFig.physVacLoss, lossToLease: uwFig.lossToLease });
    setApplied(true); setTimeout(() => setApplied(false), 2500);
  };
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
      <div style={{ ...cellR, color: 'var(--ink)', fontWeight: 600 }}>{rMoney(r.avgIn)}</div>
      <div style={{ ...cellR, color: 'var(--muted)' }}>{rMoney2(r.psf)}</div>
      <div style={{ ...cellR, color: 'var(--accent-2)', fontWeight: 600 }}>{rMoney(r.avgMk)}</div>
      <div style={{ ...cellR, color: 'var(--muted)' }}>{rMoney2(r.mpsf)}</div>
      <div style={{ ...cellR, background: 'var(--panel-3)' }}>{rMoney(r.min)}</div>
      <div style={{ ...cellR, background: 'var(--panel-3)', fontWeight: 600 }}>{rMoney(r.max)}</div>
      <div style={{ ...cellR, background: 'var(--panel-3)', fontWeight: 600 }}>{rMoney(r.top25)}</div>
      <div style={{ ...cellR, background: 'var(--panel-3)' }}>{rMoney(r.last3)}</div>
    </div>);

  const occList = units.filter((u) => u.occ && u.rent > 0);
  const stat = (label, value, sub, color) => (
    <div style={{ flex: '1 1 140px', padding: '10px 14px', borderRadius: 9, background: 'var(--panel-2)', border: '1px solid var(--line)' }}>
      <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</div>
      <div className="num" style={{ fontSize: 18, fontWeight: 700, color: color || 'var(--ink)', marginTop: 3 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 2 }}>{sub}</div>}
    </div>);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <SectionHead icon="table" title="Rent Roll Matrix"
          desc={<span>{rr.sample ? <b style={{ color: 'var(--warn)' }}>Sample units for layout review, not from a rent roll · </b> : null}
            {rr.fileName || 'Rent roll'} · {units.length} units{rr.parsedAt ? ' · read ' + new Date(rr.parsedAt).toLocaleDateString() : ''}</span>}
          right={<div style={{ display: 'flex', gap: 8 }}>{upload}
            <RRConfirm label="Remove" confirmLabel="Remove rent roll? Click again" onConfirm={() => set('rentRoll', null)} style={R_BTN} /></div>} />

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
          {stat('Physical Occupancy', rPct(T.units ? T.occUnits / T.units : null), T.occUnits + ' of ' + T.units + ' units')}
          {stat('Avg In-Place', rMoney(T.avgIn), rMoney2(T.psf) + ' / SF')}
          {stat('Avg Market', rMoney(T.avgMk), rMoney2(T.mpsf) + ' / SF', 'var(--accent-2)')}
          {stat('Top 25% In-Place', rMoney(T.top25), T.avgIn ? '+' + rPct(T.top25 / T.avgIn - 1) + ' over avg in-place' : null)}
          {stat('Loss to Lease', rPct(ltl(T.avgMk)), 'in-place vs market')}
        </div>

        <div style={{ overflowX: 'auto', marginTop: 16 }}>
          <div style={{ minWidth: 1080 }}>
            <div style={{ display: 'grid', gridTemplateColumns: cols }}>
              {['Unit Type', 'Units', '% Total', 'Avg SF', 'Occ %', 'Avg In-Place', '$/SF', 'Market', 'Mkt $/SF', 'Min', 'Max', 'Top 25%', 'Last 3 Signed'].map((h, i) =>
                <div key={h} style={{ ...R_HEAD, textAlign: i ? 'right' : 'left', ...(i >= 9 ? { background: 'var(--panel-3)', borderRadius: i === 9 ? '6px 0 0 0' : i === 12 ? '0 6px 0 0' : 0, paddingTop: 6 } : { paddingTop: 6 }) }}>{h}</div>)}
            </div>
            {mx.rows.map((r) => rowView(r, false))}
            {rowView(T, true)}
            {/* vacancy / loss-to-lease tracker (template row 28) */}
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
        <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 8, lineHeight: 1.5 }}>
          Min, Max, Top 25% and Last 3 Signed use occupied in-place leases. Top 25% averages the leases at or above the 75th percentile for each type. Totals are weighted by unit count.
        </div>
      </Card>

      <Card>
        <SectionHead icon="calc" title="Use in Full UW" desc="Push gross potential rent, physical vacancy and loss to lease into the Full UW income section." />
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 14 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)' }}>Market rent basis</span>
            <select value={basis} onChange={(e) => setBasis(e.target.value)}
              style={{ height: 34, border: '1px solid var(--line-2)', borderRadius: 7, padding: '0 10px', background: 'var(--panel)', fontSize: 13, fontFamily: 'var(--font)' }}>
              {BASES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
          </label>
          {[['Units', uwFig.units.toLocaleString()], ['Gross Potential Rent', rMoney(uwFig.gprAnnual)], ['Physical Vacancy', rMoney(uwFig.physVacLoss)], ['Loss to Lease', rMoney(uwFig.lossToLease)]].map(([l, v]) =>
            <div key={l} style={{ minWidth: 120 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)' }}>{l}</div>
              <div className="num" style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', marginTop: 4 }}>{v}</div>
              {l !== 'Units' && <div style={{ fontSize: 10.5, color: 'var(--faint)' }}>annual</div>}
            </div>)}
          <button type="button" style={{ ...R_PRIMARY, marginLeft: 'auto', height: 34 }} onClick={apply}>{applied ? 'Applied ✓' : 'Apply to Full UW'}</button>
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 10 }}>
          Currently in Full UW: GPR {rMoney(deal.gprAnnual)} · physical vacancy {rMoney(deal.physVacLoss)} · loss to lease {rMoney(deal.lossToLease)}
        </div>
      </Card>

      <Card>
        <SectionHead icon="doc" title="Units" desc={occList.length + ' occupied with in-place rent · ' + (units.length - units.filter((u) => u.occ).length) + ' vacant'}
          right={<button type="button" style={R_BTN} onClick={() => setShowUnits(!showUnits)} aria-expanded={showUnits}>{showUnits ? 'Hide units' : 'Show units'}</button>} />
        {showUnits && <div style={{ overflowX: 'auto', marginTop: 12, maxHeight: 460, overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 620 }}>
            <thead><tr>{['Unit', 'Type', 'SF', 'Market', 'In-Place', 'Status', 'Lease Start'].map((h, i) =>
              <th key={h} style={{ ...R_HEAD, textAlign: i < 2 || i === 5 ? 'left' : 'right', position: 'sticky', top: 0, background: 'var(--panel)' }}>{h}</th>)}</tr></thead>
            <tbody>{units.map((u, i) => (
              <tr key={u.id + '-' + i} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={{ padding: '6px 8px' }}>{u.id}</td>
                <td style={{ padding: '6px 8px' }}>{u.type}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }} className="num">{u.sf || '—'}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }} className="num">{rMoney(u.market)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }} className="num">{u.occ ? rMoney(u.rent) : '—'}</td>
                <td style={{ padding: '6px 8px', color: u.occ ? 'var(--slate)' : 'var(--neg)' }}>{u.occ ? 'Occupied' : 'Vacant'}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }} className="num">{u.leaseStart || '—'}</td>
              </tr>))}</tbody>
          </table>
        </div>}
      </Card>
    </div>);
}

Object.assign(window, { RentRollTab, rentRollMatrix, rentRollUW, percentileInc });
