// app/assumptionsView.jsx — Assumptions tab: firm-wide inputs every deal's Full UW uses
// (current debt quotes, the acquisition-fee schedule, other closing costs). The values
// live in window.AltusAssumptions (app/assumptions.js); this file is only the editor.
const { useState: useStateA, useEffect: useEffectA, useMemo: useMemoA } = React;

const aMoney = (v) => (v == null || isNaN(v)) ? '—' : '$' + Math.round(v).toLocaleString('en-US');
const aPct = (v, d = 2) => (v == null || isNaN(v)) ? '—' : (v * 100).toFixed(d) + '%';
const A_TH = { padding: '9px 12px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap', background: 'var(--panel-3)' };
const A_TD = { padding: '8px 12px', borderTop: '1px solid var(--line)', fontSize: 12.5, color: 'var(--ink)', verticalAlign: 'middle' };
const A_TEXT = { border: '1px solid var(--line-2)', borderRadius: 7, padding: '0 10px', height: 34, width: '100%', boxSizing: 'border-box', background: 'var(--panel)', fontSize: 13, color: 'var(--ink)', fontFamily: 'var(--font)' };

function useAssumptions() {
  const A = window.AltusAssumptions;
  const [st, setSt] = useStateA(() => A.get());
  useEffectA(() => A.subscribe(setSt), []);
  return st;
}

function AGroupRow({ label, cols }) {
  return (
    <tr><td colSpan={cols} style={{ padding: '7px 12px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--accent)', background: 'var(--accent-soft)', borderTop: '1px solid var(--line)' }}>{label}</td></tr>);
}

function DebtQuotesCard({ st, linked }) {
  const A = window.AltusAssumptions;
  const upd = (k, f, v) => A.set((s) => ({ ...s, quotes: { ...s.quotes, [k]: { ...s.quotes[k], [f]: v } } }));
  const keys = Object.keys(st.quotes);
  const row = (k) => {
    const q = st.quotes[k];
    return (
      <tr key={k}>
        <td style={{ ...A_TD, fontWeight: 600 }}>{q.label}</td>
        <td style={A_TD}><FieldInput value={q.rate} onChange={(v) => upd(k, 'rate', v)} suffix="%" align="left" width={92} /></td>
        <td style={A_TD}><FieldInput value={q.amYears} onChange={(v) => upd(k, 'amYears', v)} suffix="yrs" align="left" width={92} /></td>
        <td style={A_TD}><FieldInput value={q.ioYears} onChange={(v) => upd(k, 'ioYears', v)} suffix="yrs" align="left" width={88} /></td>
        <td style={A_TD}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <FieldInput value={q.maxLev} onChange={(v) => upd(k, 'maxLev', v)} suffix="%" align="left" width={84} />
            <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{q.basis}</span>
          </div>
        </td>
        <td style={A_TD}><FieldInput value={q.minDscr == null ? '' : q.minDscr} onChange={(v) => upd(k, 'minDscr', v === '' ? null : v)} suffix="x" align="left" width={86} placeholder="none" /></td>
        <td style={A_TD}>
          <select value={q.dscrBasis || 'amortizing'} onChange={(e) => upd(k, 'dscrBasis', e.target.value)} aria-label="DSCR test payment"
            style={{ ...A_TEXT, width: 128, cursor: 'pointer' }}>
            <option value="amortizing">Amortizing</option><option value="io">Interest-only</option>
          </select>
        </td>
        <td style={A_TD}><FieldInput value={q.loanFeePct} onChange={(v) => upd(k, 'loanFeePct', v)} suffix="%" align="left" width={80} /></td>
        <td style={{ ...A_TD, textAlign: 'right' }} className="num">
          <span title="Deals not yet locked whose rate follows this quote; underwritten deals keep their own copy" style={{ fontWeight: 700, color: linked[k] ? 'var(--accent)' : 'var(--faint)' }}>{linked[k] || 0}</span>
        </td>
      </tr>);
  };
  return (
    <Card title="Current Debt Quotes"
      right={<span style={{ fontSize: 12, color: 'var(--muted)' }}>Loans size to the lesser of max leverage and min DSCR; leave min DSCR blank to size on leverage only</span>}
      pad={false}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1000 }}>
          <thead><tr>
            <th style={A_TH}>Program</th><th style={A_TH}>Rate</th><th style={A_TH}>Amortization</th><th style={A_TH}>Interest-Only</th>
            <th style={A_TH}>Max Leverage</th><th style={A_TH}>Min DSCR</th><th style={A_TH}>DSCR Test</th><th style={A_TH}>Loan Fee</th><th style={{ ...A_TH, textAlign: 'right' }}>Linked Deals</th>
          </tr></thead>
          <tbody>
            <AGroupRow label="At acquisition" cols={9} />
            {keys.filter((k) => st.quotes[k].use === 'acquisition').map(row)}
            <AGroupRow label="Refinance / takeout" cols={9} />
            {keys.filter((k) => st.quotes[k].use === 'refinance').map(row)}
          </tbody>
        </table>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderTop: '1px solid var(--line)', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12.5, color: 'var(--slate)' }}>Loan fees on debt without a quote (custom terms or an assumed loan)</span>
        <FieldInput value={st.otherLoanFeePct} onChange={(v) => window.AltusAssumptions.set((s) => ({ ...s, otherLoanFeePct: v }))} suffix="% of loan" align="left" width={130} />
        <span style={{ fontSize: 12, color: 'var(--faint)', marginLeft: 'auto' }}>Linked deals follow each quote's rate and loan fee</span>
      </div>
    </Card>);
}

function AcqFeeCard({ st }) {
  const A = window.AltusAssumptions;
  const tiers = st.acqFee.tiers;
  const setTier = (i, f, v) => A.set((s) => ({ ...s, acqFee: { ...s.acqFee, tiers: s.acqFee.tiers.map((t, j) => j === i ? { ...t, [f]: v } : t) } }));
  const setMethod = (m) => A.set((s) => ({ ...s, acqFee: { ...s.acqFee, method: m } }));
  return (
    <Card title="Acquisition Fee" right={<Seg size="sm" value={st.acqFee.method}
      options={[{ value: 'band', label: 'By price band' }, { value: 'blended', label: 'Blended' }]} onChange={setMethod} />}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.5 }}>
        {st.acqFee.method === 'band'
          ? 'The whole purchase price is charged at the rate of the band it falls in.'
          : 'Each slice of the purchase price is charged at its own band’s rate, so the fee never drops when a deal crosses a breakpoint.'}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tiers.map((t, i) => {
          const last = i === tiers.length - 1;
          const floor = i === 0 ? 0 : tiers[i - 1].upTo;
          return (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, color: 'var(--slate)', width: 92 }}>{last ? 'Above' : i === 0 ? 'Up to' : 'Above ' + fmtShort(floor) + ' to'}</span>
              {last
                ? <span className="num" style={{ fontSize: 13, fontWeight: 600, width: 160 }}>{fmtShort(floor)}</span>
                : <FieldInput value={t.upTo} onChange={(v) => setTier(i, 'upTo', v || 0)} prefix="$" width={160} />}
              <FieldInput value={t.pct} onChange={(v) => setTier(i, 'pct', v)} suffix="%" align="left" width={96} />
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>of purchase price</span>
            </div>);
        })}
      </div>
    </Card>);
}

function ClosingCostsCard({ st }) {
  const A = window.AltusAssumptions;
  const [confirmDel, setConfirmDel] = useStateA(null);
  const setItem = (i, f, v) => A.set((s) => ({ ...s, closing: s.closing.map((c, j) => j === i ? { ...c, [f]: v } : c) }));
  const remove = (i) => { A.set((s) => ({ ...s, closing: s.closing.filter((_, j) => j !== i) })); setConfirmDel(null); };
  const add = () => A.set((s) => ({ ...s, closing: [...s.closing, { id: 'c_' + Date.now().toString(36), label: 'New closing cost', basis: 'flat', value: 0 }] }));
  return (
    <Card title="Other Closing Costs" right={
      <button type="button" onClick={add} style={{ border: '1px solid var(--line-2)', background: 'var(--panel)', color: 'var(--accent)', borderRadius: 7, padding: '5px 11px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}>+ Add line item</button>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {st.closing.map((c, i) => (
          <div key={c.id || i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 128px 128px 30px', gap: 8, alignItems: 'center' }}>
            <input value={c.label} onChange={(e) => setItem(i, 'label', e.target.value)} style={A_TEXT} aria-label="Closing cost name" />
            <select value={c.basis} onChange={(e) => setItem(i, 'basis', e.target.value)} style={{ ...A_TEXT, cursor: 'pointer' }} aria-label="Basis">
              <option value="flat">Flat $</option><option value="price">% of price</option><option value="loan">% of loan</option>
            </select>
            <FieldInput value={c.value} onChange={(v) => setItem(i, 'value', v)} prefix={c.basis === 'flat' ? '$' : undefined} suffix={c.basis === 'flat' ? undefined : '%'} />
            <button type="button" onClick={() => (confirmDel === i ? remove(i) : setConfirmDel(i))} title={confirmDel === i ? 'Click again to remove' : 'Remove'}
              style={{ height: 30, border: 'none', borderRadius: 6, background: confirmDel === i ? 'var(--neg-soft)' : 'transparent', color: confirmDel === i ? 'var(--neg)' : 'var(--faint)', cursor: 'pointer', fontSize: 15 }}>×</button>
          </div>
        ))}
      </div>
    </Card>);
}

function ClosingPreviewCard({ st }) {
  const A = window.AltusAssumptions;
  const prices = [2e6, 5e6, 10e6, 15e6, 25e6, 50e6, 100e6];
  const LOAN = 0.7;
  return (
    <Card title="Total Closing Cost by Deal Size" right={<span style={{ fontSize: 12, color: 'var(--muted)' }}>includes loan fees on a {LOAN * 100}% loan at {st.otherLoanFeePct}% (HUD quotes use their own fee)</span>} pad={false}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 620 }}>
          <thead><tr>
            <th style={A_TH}>Purchase Price</th><th style={{ ...A_TH, textAlign: 'right' }}>Acquisition Fee</th>
            <th style={{ ...A_TH, textAlign: 'right' }}>Loan Fees + Other Costs</th><th style={{ ...A_TH, textAlign: 'right' }}>Total</th>
            <th style={{ ...A_TH, textAlign: 'right' }}>% of Price</th>
          </tr></thead>
          <tbody>
            {prices.map((p) => {
              const c = A.closingCosts(p, { loan: p * LOAN, loanFeePct: st.otherLoanFeePct });
              return (
                <tr key={p}>
                  <td style={{ ...A_TD, fontWeight: 600 }} className="num">{fmtShort(p)}</td>
                  <td style={{ ...A_TD, textAlign: 'right' }} className="num">{aMoney(c.fee)}</td>
                  <td style={{ ...A_TD, textAlign: 'right' }} className="num">{aMoney(c.total - c.fee)}</td>
                  <td style={{ ...A_TD, textAlign: 'right', fontWeight: 700 }} className="num">{aMoney(c.total)}</td>
                  <td style={{ ...A_TD, textAlign: 'right', fontWeight: 700, color: 'var(--accent)' }} className="num">{aPct(c.pctOfPrice)}</td>
                </tr>);
            })}
          </tbody>
        </table>
      </div>
    </Card>);
}

function AssumptionsView({ deals }) {
  const st = useAssumptions();
  const [confirmReset, setConfirmReset] = useStateA(false);
  useEffectA(() => { if (!confirmReset) return; const t = setTimeout(() => setConfirmReset(false), 3500); return () => clearTimeout(t); }, [confirmReset]);

  // Underwritten deals already locked to their own assumptions copy, and per quote, how many
  // deals still follow the live quote (none are locked yet), i.e. what a change here would move.
  const lockedN = (deals || []).filter((d) => d.uwAssumptions).length;
  const linked = useMemoA(() => {
    const out = {};
    (deals || []).forEach((d) => {
      if (d.uwAssumptions) return;
      if (!window.hasUWInputs || !window.hasUWInputs(d)) return;
      let uw; try { uw = window.computeUW(d); } catch (e) { return; }
      if (uw.acqRate && uw.acqRate.linked && uw.acqRate.quoteKey) out[uw.acqRate.quoteKey] = (out[uw.acqRate.quoteKey] || 0) + 1;
      if (uw.refiOn && uw.refiRate && uw.refiRate.linked && uw.refiRate.quoteKey) out[uw.refiRate.quoteKey] = (out[uw.refiRate.quoteKey] || 0) + 1;
    });
    return out;
  }, [deals, st]);

  return (
    <div className="fade" style={{ padding: '24px 30px 60px', maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 21, fontWeight: 700, color: 'var(--ink)' }}>Underwriting Assumptions</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--muted)', maxWidth: 720 }}>
            Firm-wide inputs for new underwriting. Changes apply to deals underwritten from now on; a deal that is already underwritten keeps the assumptions it was underwritten with ({lockedN} locked today). Any one deal can be moved onto the current set from its Full UW tab.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {st.updatedAt && <span style={{ fontSize: 12, color: 'var(--faint)' }}>Updated {fmtDate(st.updatedAt.slice(0, 10))}</span>}
          <button type="button" onClick={() => { if (confirmReset) { window.AltusAssumptions.reset(); setConfirmReset(false); } else setConfirmReset(true); }}
            style={{ border: '1px solid ' + (confirmReset ? 'var(--neg)' : 'var(--line-2)'), background: confirmReset ? 'var(--neg-soft)' : 'var(--panel)', color: confirmReset ? 'var(--neg)' : 'var(--slate)', borderRadius: 7, padding: '7px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}>
            {confirmReset ? 'Click again to reset' : 'Reset to defaults'}
          </button>
        </div>
      </div>
      <DebtQuotesCard st={st} linked={linked} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16, alignItems: 'start' }}>
        <AcqFeeCard st={st} />
        <ClosingCostsCard st={st} />
      </div>
      <ClosingPreviewCard st={st} />
    </div>);
}

Object.assign(window, { AssumptionsView });
