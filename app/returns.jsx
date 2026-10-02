// app/returns.jsx — Returns tab: deal-level returns and LP/GP waterfall returns.
// Loaded after uwsections.jsx.
const { useState: useSR } = React;
const RC = window; // shared primitives

const rMoney = (v) => (v == null || isNaN(v)) ? '—' : (v < 0 ? '−' : '') + '$' + Math.round(Math.abs(v)).toLocaleString('en-US');
const rPct1 = (v) => (v == null || isNaN(v)) ? '—' : (v * 100).toFixed(1) + '%';
const rX = (v) => (v == null || isNaN(v)) ? '—' : v.toFixed(2) + 'x';

function RLbl({ children }) {
  return <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', marginBottom: 4 }}>{children}</div>;
}
function RCAssump({ label, hint, w = 130, children }) {
  return (
    <div style={{ width: w }}>
      <RLbl>{label}</RLbl>
      {children}
      {hint && <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 3, lineHeight: 1.3 }}>{hint}</div>}
    </div>
  );
}

/* big headline stat */
function StatBig({ label, value, sub, accent, big }) {
  return (
    <div style={{ padding: '4px 0' }}>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 7 }}>{label}</div>
      <div className="num" style={{ fontSize: big ? 30 : 22, fontWeight: 700, color: accent || 'var(--ink)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 5 }}>{sub}</div>}
    </div>
  );
}

/* per-year metric table */
function YearTable({ hold, columns }) {
  const colW = 96, labelW = 190;
  const grid = `${labelW}px repeat(${hold}, minmax(${colW}px, 1fr))`;
  const head = (y) => 'Year ' + y;
  return (
    <div style={{ overflowX: 'auto', marginTop: 12 }}>
      <div style={{ minWidth: labelW + hold * colW }}>
        <div style={{ display: 'grid', gridTemplateColumns: grid, background: 'var(--panel-3)', borderRadius: '7px 7px 0 0', borderBottom: '1px solid var(--line)' }}>
          <div style={{ padding: '8px 13px', position: 'sticky', left: 0, background: 'var(--panel-3)', zIndex: 2, fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)' }}>Metric</div>
          {Array.from({ length: hold }, (_, i) => i + 1).map((y) => (
            <div key={y} style={{ padding: '8px 13px', textAlign: 'right', fontSize: 11.5, fontWeight: 700, color: 'var(--ink)' }}>{head(y)}</div>
          ))}
        </div>
        {columns.map((row, ri) => (
          <div key={ri} style={{ display: 'grid', gridTemplateColumns: grid, alignItems: 'center', borderTop: ri === 0 ? 'none' : '1px solid var(--line)' }}>
            <div style={{ padding: '8px 13px', position: 'sticky', left: 0, background: 'var(--panel)', zIndex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: row.strong ? 600 : 400, color: 'var(--ink)' }}>{row.label}</div>
              {row.hint && <div style={{ fontSize: 10, color: 'var(--faint)' }}>{row.hint}</div>}
            </div>
            {Array.from({ length: hold }, (_, i) => i + 1).map((y) => (
              <div key={y} className="num" style={{ padding: '8px 13px', textAlign: 'right', fontSize: row.strong ? 13 : 12.5, fontWeight: row.strong ? 700 : 500, color: row.accent || (row.strong ? 'var(--ink)' : 'var(--slate)') }}>{row.fmt(row.get(y))}</div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────── Returns tab ───────────── */
function ReturnsTab({ deal, set }) {
  const uw = RC.computeUW(deal);
  const lp = RC.computeLP(uw, { pref: deal.lpPref, split: deal.lpSplit });
  const hold = uw.hold;

  const noExit = deal.exitCap == null || deal.exitCap === '';
  const ready = RC.hasUWInputs ? RC.hasUWInputs(deal) : (Number(deal.gprAnnual) > 0);

  if (!ready) {
    return (
      <div style={{ padding: '64px 24px', textAlign: 'center', background: 'var(--panel)',
        border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow)' }}>
        <div style={{ width: 46, height: 46, borderRadius: 12, background: 'var(--panel-3)', color: 'var(--muted)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }}>
          <RC.Icon name="chart" size={22} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>Returns aren’t calculated yet</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 6, maxWidth: 420, marginInline: 'auto', lineHeight: 1.6 }}>
          Fill out the <strong>Income &amp; Economic Vacancy</strong> section on the Full UW tab (start with Gross Potential Rent) and the deal-level and LP returns will populate here.
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {noExit && (
        <div style={{ padding: '11px 15px', background: 'var(--panel-2)', border: '1px solid var(--line-2)', borderRadius: 8, fontSize: 12.5, color: 'var(--slate)' }}>
          No exit cap set — assuming a <strong>6.0% exit cap</strong>. Override it in the Full UW tab to refine IRR and multiples.
        </div>
      )}

      {/* LP structure inputs */}
      <RC.Card>
        <RC.SectionHead icon="target" title="Partnership Structure" desc="LP preferred return, profit split, and the asset-management fee feeding the cash flow." />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px 20px', marginTop: 14 }}>
          <RCAssump label="Preferred Return" hint="non-accruing, annual"><RC.FieldInput value={deal.lpPref == null ? 7 : deal.lpPref} onChange={(v) => set('lpPref', v)} suffix="%" align="left" /></RCAssump>
          <RCAssump label="LP Profit Split" hint="LP share above pref"><RC.FieldInput value={deal.lpSplit == null ? 75 : deal.lpSplit} onChange={(v) => set('lpSplit', v)} suffix="%" align="left" /></RCAssump>
          <RCAssump label="GP Promote" hint="above pref"><div className="num" style={{ height: 38, display: 'flex', alignItems: 'center', fontSize: 15, fontWeight: 600, color: 'var(--ink)' }}>{(100 - (deal.lpSplit == null ? 75 : Number(deal.lpSplit)))}%</div></RCAssump>
          <RCAssump label="Asset Mgmt Fee" hint="% of EGI"><RC.FieldInput value={deal.amFeePct == null ? 2 : deal.amFeePct} onChange={(v) => set('amFeePct', v)} suffix="%" align="left" /></RCAssump>
        </div>
      </RC.Card>

      {/* Deal-level returns */}
      <RC.Card>
        <RC.SectionHead icon="chart" title="Deal-Level Returns" desc="Unpromoted project returns over the full hold." />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 18, marginTop: 14, paddingBottom: 16, borderBottom: '1px solid var(--line)' }}>
          <StatBig label="Levered IRR" value={uw.irr == null ? '—' : rPct1(uw.irr)} accent="var(--pos)" big />
          <StatBig label="Equity Multiple" value={rX(uw.equityMultiple)} big />
          <StatBig label="Avg Annual Yield" value={rPct1(uw.avgYield)} sub="mean cash-on-cash" />
          <StatBig label="Profit" value={rMoney(uw.profit)} sub={'on ' + rMoney(uw.initialEquity) + ' equity'} />
        </div>
        <YearTable hold={hold} columns={[
          { label: 'Cash-on-Cash Yield', hint: 'net CF ÷ equity', get: (y) => uw.rows[y].cashOnCash, fmt: (v) => v == null ? '—' : rPct1(v) },
          { label: 'Principal Paydown', hint: 'amortization ÷ equity', get: (y) => uw.rows[y].principalPaydownPct, fmt: (v) => v == null || v === 0 ? '—' : rPct1(v) },
          { label: 'Yield + Paydown', strong: true, accent: 'var(--accent)', get: (y) => uw.rows[y].yieldPlusPaydown, fmt: (v) => v == null ? '—' : rPct1(v) },
        ]} />
      </RC.Card>

      {/* LP returns */}
      <RC.Card>
        <RC.SectionHead icon="deal" title="LP Returns" desc={'After a ' + (deal.lpPref == null ? 7 : deal.lpPref) + '% non-accruing pref and ' + (100 - (deal.lpSplit == null ? 75 : Number(deal.lpSplit))) + '% GP promote on profits above it.'} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 18, marginTop: 14, paddingBottom: 16, borderBottom: '1px solid var(--line)' }}>
          <StatBig label="LP IRR" value={lp.lpIRR == null ? '—' : rPct1(lp.lpIRR)} accent="var(--pos)" big />
          <StatBig label="LP Equity Multiple" value={rX(lp.lpMultiple)} big />
          <StatBig label="Avg LP Yield" value={rPct1(lp.avgLpYield)} sub="mean annual cash yield" />
          <StatBig label="Total GP Promote" value={rMoney(lp.gpPromote)} sub="carried interest" accent="var(--navy)" />
        </div>
        <YearTable hold={hold} columns={[
          { label: 'LP Cash Distribution', hint: 'operating', get: (y) => lp.years[y - 1].lpOp, fmt: rMoney },
          { label: 'LP Yield', strong: true, accent: 'var(--accent)', get: (y) => lp.years[y - 1].lpYield, fmt: (v) => v == null ? '—' : rPct1(v) },
          { label: 'GP Promote', hint: 'this year', get: (y) => lp.years[y - 1].gpOp + lp.years[y - 1].gpCapDist, fmt: (v) => v ? rMoney(v) : '—' },
        ]} />
      </RC.Card>

    </div>
  );
}

Object.assign(window, { ReturnsTab });
