// app/uwsections.jsx — Quick & Full underwriting tabs.
// Quick UW = pricing + going-in / stabilized cap. Full UW = income & economic vacancy
// (current vs stabilized), operating assumptions, financing, refinance, and the
// multi-year cash-flow model. Loaded after components.jsx + dealDetail.jsx.
const { useState: useSU } = React;
const {
  Card, Seg, Icon, FieldInput, SectionHead, CalcRow, PerUnit, BannerShell, FoundRow, MissingRow,
  fmtMoney, fmtShort, fmtPct, fmtNum, computeUW, computeMetrics,
} = window;

const moneyFull = (v) => (v == null || isNaN(v)) ? '—' : (v < 0 ? '−' : '') + '$' + Math.round(Math.abs(v)).toLocaleString('en-US');
const pct1 = (v) => (v == null || isNaN(v)) ? '—' : (v * 100).toFixed(1) + '%';
const round1 = (v) => Math.round(v * 1000) / 10;
const num = (v) => Number(v) || 0;

function dateBox(value, onChange) {
  return (
    <input type="date" value={value || ''} onChange={(e) => onChange(e.target.value || null)}
      style={{ border: '1px solid var(--line-2)', borderRadius: 6, padding: '0 8px', background: 'var(--panel)',
        fontSize: 12.5, height: 32, width: '100%', boxSizing: 'border-box', color: 'var(--ink)', fontFamily: 'var(--font)' }}
      onFocus={(e) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--accent-soft)'; }}
      onBlur={(e) => { e.target.style.borderColor = 'var(--line-2)'; e.target.style.boxShadow = 'none'; }} />
  );
}

/* compact assumption field (label + small input, fixed width) */
function CAssump({ label, hint, w = 124, children }) {
  return (
    <div style={{ width: w }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, letterSpacing: '.03em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 3, lineHeight: 1.3 }}>{hint}</div>}
    </div>
  );
}
/* hint under a rate field: linked to a quote on the Assumptions tab, or a one-click relink */
function RateLinkHint({ r, onRelink }) {
  if (!r || !r.quote) return null;
  if (r.linked) return <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Linked · {r.quote.label}</span>;
  return (
    <button type="button" onClick={onRelink} title="Follow the current quote on the Assumptions tab"
      style={{ border: 'none', background: 'none', padding: 0, color: 'var(--accent)', fontSize: 10, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'var(--font)' }}>
      Custom · use quote ({Number(r.quote.rate).toFixed(2)}%)
    </button>);
}
/* lender sizing controls: min DSCR (from the quote unless entered) + sizing rule override */
function SizingFields({ spec, sizing, quote, onSet }) {
  const own = spec.minDscr != null && spec.minDscr !== '';
  const qMin = quote && quote.minDscr ? Number(quote.minDscr) : null;
  return (<>
    <CAssump label="Min DSCR" hint={own
      ? (qMin ? <button type="button" onClick={() => onSet('minDscr', null)} style={{ border: 'none', background: 'none', padding: 0, color: 'var(--accent)', fontSize: 10, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'var(--font)' }}>Custom · use quote ({qMin.toFixed(2)}x)</button> : 'custom')
      : (qMin ? <span style={{ color: 'var(--accent)', fontWeight: 600 }}>From quote</span> : 'optional')}>
      <FieldInput value={own ? spec.minDscr : (qMin == null ? '' : qMin)} onChange={(v) => onSet('minDscr', v === '' ? null : v)} suffix="x" align="left" placeholder="none" />
    </CAssump>
    <CAssump label="Sizing Rule" w={200} hint={sizing && sizing.minDscr ? 'lesser of the two · DSCR on ' + sizing.testedOn + ' payment' : 'set a min DSCR to size on it'}>
      <Seg size="sm" value={spec.sizing === 'ltv' ? 'ltv' : 'auto'} options={[{ value: 'auto', label: 'LTV / DSCR' }, { value: 'ltv', label: 'LTV only' }]} onChange={(v) => onSet('sizing', v)} />
    </CAssump>
  </>);
}
function sizingNote(sz) {
  if (!sz) return null;
  if (sz.binding === 'dscr') return 'sized by ' + Number(sz.minDscr).toFixed(2) + 'x DSCR · leverage allows ' + fmtShort(sz.levLoan);
  if (sz.dscrLoan != null) return 'sized by leverage · DSCR allows ' + fmtShort(sz.dscrLoan);
  return sz.rule === 'ltv' ? 'leverage only (override)' : null;
}
const assumptionQuotes = (deal) => (window.AltusAssumptions ? window.AltusAssumptions.forDeal(deal).get().quotes : null);
function CompactGrid({ children }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 18px', marginTop: 14 }}>{children}</div>;
}

/* ───────────── Pricing & Basis (shown on BOTH tabs) ───────────── */
function PricingBasis({ deal, set, m }) {
  const ask = num(deal.askPrice), uw = num(deal.purchasePrice);
  const offGuidance = ask > 0 && uw > 0 ? (uw - ask) / ask : null; // negative = below ask
  const dollarDelta = ask > 0 && uw > 0 ? ask - uw : null;          // positive = below ask
  const basis = uw + num(deal.capex);
  return (
    <Card>
      <SectionHead icon="bank" title="Pricing & Basis" desc="Acquisition pricing — feeds the cap-rate math and the cash-flow model." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '16px 22px', marginTop: 16 }}>
        <div><Lbl>Units</Lbl><FieldInput value={deal.units} align="left"
          onChange={(v) => (deal.rentRoll && deal.incomeFromRR !== false && window.overrideRentRoll ? window.overrideRentRoll(deal, set, 'units', Number(v) || 0) : set('units', Number(v) || 0))} /></div>
        <div><Lbl>Vintage</Lbl>
          <input value={deal.vintage || ''} onChange={(e) => set('vintage', e.target.value)} placeholder="Year built"
            style={{ border: '1px solid var(--line-2)', borderRadius: 7, padding: '0 10px', background: 'var(--panel)',
              fontSize: 13.5, height: 34, width: '100%', boxSizing: 'border-box', color: 'var(--ink)', fontFamily: 'var(--font)' }}
            onFocus={(e) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--accent-soft)'; }}
            onBlur={(e) => { e.target.style.borderColor = 'var(--line-2)'; e.target.style.boxShadow = 'none'; }} />
        </div>
        <div><Lbl>Ask Price</Lbl><FieldInput value={deal.askPrice} onChange={(v) => set('askPrice', v || 0)} prefix="$" /><PerUnit total={deal.askPrice} units={m.units} /></div>
        <div><Lbl>UW Price</Lbl><FieldInput value={deal.purchasePrice} onChange={(v) => set('purchasePrice', v || 0)} prefix="$" /><PerUnit total={deal.purchasePrice} units={m.units} /></div>
        <div><Lbl>CapEx Budget</Lbl><FieldInput value={deal.capex} onChange={(v) => set('capex', v || 0)} prefix="$" /><PerUnit total={deal.capex} units={m.units} /></div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
        <GuidancePill label="UW vs. Guidance" value={offGuidance == null ? '—'
          : (offGuidance <= 0 ? (Math.abs(offGuidance) * 100).toFixed(1) + '% below ask' : '+' + (offGuidance * 100).toFixed(1) + '% over ask')}
          sub={dollarDelta == null ? '' : (dollarDelta >= 0 ? moneyFull(dollarDelta) + ' below ask' : moneyFull(Math.abs(dollarDelta)) + ' over ask')}
          accent={offGuidance == null ? 'var(--faint)' : offGuidance <= 0 ? 'var(--pos)' : 'var(--neg)'} />
        <GuidancePill label="Total Basis" value={basis ? moneyFull(basis) : '—'} sub={m.units ? moneyFull(basis / m.units) + ' / unit' : ''} />
      </div>
    </Card>
  );
}
function GuidancePill({ label, value, sub, accent }) {
  return (
    <div style={{ flex: '1 1 200px', background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 13px' }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: 3 }}>{label}</div>
      <div className="num" style={{ fontSize: 15, fontWeight: 700, color: accent || 'var(--ink)' }}>{value}</div>
      {sub && <div className="num" style={{ fontSize: 11, color: 'var(--faint)', marginTop: 1 }}>{sub}</div>}
    </div>
  );
}
function Lbl({ children }) {
  return <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: 5 }}>{children}</div>;
}

/* ───────────── Income & Economic Vacancy (Full tab) ───────────── */
// A small inline note shown to the right of an input
function Note({ children }) {
  return <div className="num" style={{ fontSize: 11, color: 'var(--faint)', marginTop: 3 }}>{children}</div>;
}
// One vacancy line with paired % / $ inputs (editing either updates the stored $)
function VacLine({ label, value, gpr, onChange, note }) {
  const pct = gpr > 0 ? (value / gpr) * 100 : 0;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 84px 116px', gap: 8, alignItems: 'center', padding: '6px 0' }}>
      <div><span style={{ fontSize: 12.5, color: 'var(--ink)' }}>{label}</span>{note && <Note>{note}</Note>}</div>
      <FieldInput value={Math.round(pct * 10) / 10} suffix="%" align="left" onChange={(v) => onChange(gpr > 0 ? Math.round((num(v)) / 100 * gpr) : 0)} />
      <FieldInput value={value} prefix="$" onChange={(v) => onChange(num(v))} />
    </div>
  );
}
function OutRow({ label, value, strong, accent, hint }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10,
      padding: '8px 0', borderTop: '1px solid var(--line)' }}>
      <span style={{ fontSize: strong ? 13 : 12.5, color: 'var(--ink)', fontWeight: strong ? 600 : 400 }}>
        {label}{hint && <span style={{ fontSize: 11, color: 'var(--faint)', fontWeight: 400 }}> · {hint}</span>}
      </span>
      <span className="num" style={{ fontSize: strong ? 15 : 13, fontWeight: strong ? 700 : 500, color: accent || 'var(--ink)' }}>{value}</span>
    </div>
  );
}
function PanelHead({ children, accent }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase',
      color: accent || 'var(--muted)', marginBottom: 6 }}>{children}</div>
  );
}

// Read-only figure shown in place of an input when the line-item detail panel drives it.
function LinkedFigure({ value }) {
  return (
    <div title="Set by the line-item detail below" style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6, height: 32,
      padding: '0 10px', borderRadius: 7, border: '1px dashed var(--line-2)', background: 'var(--panel-3)' }}>
      <Icon name="lock" size={11} style={{ color: 'var(--faint)' }} />
      <span className="num" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{value}</span>
    </div>);
}

// Under a rent-roll-driven line: where the figure comes from, or that it was typed over (with a reset).
function RROverrideNote({ deal, set, field, text }) {
  if (!(deal.rrOverride || {})[field]) return <span>{text} · rent roll</span>;
  return <span style={{ color: 'var(--warn)' }}>overridden · <button type="button" onClick={() => window.overrideRentRoll(deal, set, field, undefined)}
    style={{ border: 'none', background: 'none', padding: 0, color: 'var(--accent)', fontSize: 11, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'var(--font)' }}>use rent roll</button></span>;
}

/* Market rents by unit type — the template's Property Info "Market Rents" block. */
function MarketRentsBlock({ deal, set, pr }) {
  const [open, setOpen] = (window.useOpenState || ((k, d) => React.useState(d)))('altus_mktrents_open', true);
  const linked = deal.incomeFromRR !== false;
  const ov = deal.marketRents || {};
  const setMkt = (type, v) => window.setWithRentRoll(deal, set, { marketRents: { ...ov, [type]: v === '' || !v ? undefined : v } });
  const g = 'minmax(110px,1.3fr) 56px 60px 92px 64px 118px 64px';
  const c = { padding: '4px 8px', fontSize: 12.5, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', fontVariantNumeric: 'tabular-nums', minHeight: 34 };
  const psf = (v, sf) => (v && sf ? '$' + (v / sf).toFixed(2) : '—');
  return (
    <div style={{ marginTop: 14, paddingBottom: 14, borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font)' }}>
          <span style={{ display: 'inline-block', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .12s', color: 'var(--muted)', fontSize: 10 }}>▶</span>
          <Lbl>Market Rents by Unit Type</Lbl>
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: -5 }}>
          {pr.units} units on the rent roll{(deal.rrOverride || {}).units && Number(deal.units) !== pr.units ? ' · scaled to ' + deal.units + ' property units' : ''} · loss to lease {moneyFull(pr.ltlPerUnit)}/unit ({pr.ltlPct == null ? '—' : (pr.ltlPct * 100).toFixed(1) + '%'})
        </span>
        {linked && window.GprBasisPicker && <span style={{ marginTop: -5 }}><window.GprBasisPicker deal={deal} set={set} compact /></span>}
        <button type="button" onClick={() => (linked ? set('incomeFromRR', false) : set({ incomeFromRR: true, ...window.rentRollFields({ ...deal, incomeFromRR: true }) }))}
          style={{ marginLeft: 'auto', marginTop: -5, border: '1px solid var(--line-2)', background: 'var(--panel)', color: 'var(--slate)', borderRadius: 6, padding: '3px 9px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}>
          {linked ? 'Enter income by hand' : 'Price from rent roll'}</button>
      </div>
      {open && <div style={{ overflowX: 'auto', marginTop: 4 }}>
        <div style={{ minWidth: 580, maxWidth: 760 }}>
          <div style={{ display: 'grid', gridTemplateColumns: g }}>
            {['Unit Type', 'Units', 'SF', 'In-Place', '$/SF', 'Market Rent', '$/SF'].map((h, i) =>
              <div key={i} style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: i >= 5 ? 'var(--accent-2)' : 'var(--muted)', padding: '4px 8px', textAlign: i ? 'right' : 'left' }}>{h}</div>)}
          </div>
          {pr.types.map((t) => (
            <div key={t.type} style={{ display: 'grid', gridTemplateColumns: g, borderTop: '1px solid var(--line)' }}>
              <div style={{ ...c, justifyContent: 'flex-start', fontWeight: 600, color: 'var(--ink)' }}>{t.type}</div>
              <div style={c}>{t.units}</div>
              <div style={c}>{t.sf ? Math.round(t.sf).toLocaleString() : '—'}</div>
              <div style={c}>{moneyFull(t.inPlace)}</div>
              <div style={{ ...c, color: 'var(--muted)' }}>{psf(t.inPlace, t.sf)}</div>
              <div style={c} title={'Default ' + moneyFull(t.dflt) + ' (' + t.dfltSrc + ')'}>
                {pr.basis === 'manual'
                  ? <span className="num" style={{ fontWeight: 600, color: 'var(--ink)' }}>{moneyFull(t.market)}</span>
                  : <FieldInput value={t.overridden ? ov[t.type] : ''} placeholder={Math.round(t.dflt).toLocaleString('en-US')} onChange={(v) => setMkt(t.type, v)} prefix="$" />}
              </div>
              <div style={{ ...c, color: 'var(--muted)' }}>{psf(t.market, t.sf)}</div>
            </div>))}
          <div style={{ display: 'grid', gridTemplateColumns: g, borderTop: '2px solid var(--line-2)', background: 'var(--panel-2)', fontWeight: 700 }}>
            <div style={{ ...c, justifyContent: 'flex-start' }}>Total / Avg</div>
            <div style={c}>{pr.units}</div>
            <div style={c}>{pr.avgSf ? Math.round(pr.avgSf).toLocaleString() : '—'}</div>
            <div style={c}>{moneyFull(pr.avgIn)}</div>
            <div style={{ ...c, color: 'var(--muted)' }}>{psf(pr.avgIn, pr.avgSf)}</div>
            <div style={{ ...c, color: 'var(--accent-2)' }}>{moneyFull(pr.avgMkt)}</div>
            <div style={{ ...c, color: 'var(--muted)' }}>{psf(pr.avgMkt, pr.avgSf)}</div>
          </div>
          <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 6 }}>
            {pr.basis === 'manual' ? 'Every unit at the manual average rate.' : pr.basis === 'market' ? "Blank market rent = the rent roll's market rent, floored at the type's average in-place lease." : 'Blank market rent = the ' + (pr.basis === 'max' ? 'max' : 'top 25%') + ' in-place lease for the type.'} Annual income {moneyFull(pr.inPlaceAnnual)} in-place vs {moneyFull(pr.gprAnnual)} at market.
          </div>
        </div>
      </div>}
    </div>);
}

function IncomeVacancySection({ deal, set, onT12Upload, t12Data }) {
  const units = deal.units || 1;
  const pr = window.rentRollPricing ? window.rentRollPricing(deal) : null;
  const rrLinked = !!pr && deal.incomeFromRR !== false;
  const gpr = num(deal.gprAnnual);
  const phys = num(deal.physVacLoss), ltl = num(deal.lossToLease);
  const comb = num(deal.concessions) + num(deal.badDebt);
  const other = num(deal.otherIncome);
  const curRubs = num(deal.curRubs), curOther = other - curRubs;
  const totalLoss = phys + ltl + comb;
  const inPlaceVac = gpr > 0 ? totalLoss / gpr : 0;
  const inPlaceEGI = gpr > 0 ? gpr - totalLoss + other : num(deal.trailingEGI);
  const t12Lines = window.t12OpexLines ? window.t12OpexLines(deal) : null;
  const curOpex = t12Lines ? (window.OPEX_LINES || []).reduce((s, l) => s + num(t12Lines[l.key]), 0) : num(deal.currentOpexTotal);
  const inPlaceNOI = inPlaceEGI - curOpex;

  const stabVac = (deal.stabEconVac == null || deal.stabEconVac === '') ? inPlaceVac : num(deal.stabEconVac) / 100;
  // Stabilized RUBS / other income per unit per month; until entered they carry the trailing figures.
  const uo = deal.uwOtherIncome && deal.uwOtherIncome.mode === 'lines' ? deal.uwOtherIncome : null;
  const legacyStab = !uo && !(deal.stabOtherIncome == null || deal.stabOtherIncome === '');
  const dRubs = curRubs / units / 12;
  const dOther = legacyStab ? Math.max(0, num(deal.stabOtherIncome) / units / 12 - dRubs) : curOther / units / 12;
  const rubsPU = uo ? num(uo.rubsPUPM) * num(uo.rubsPct == null ? 100 : uo.rubsPct) / 100 : dRubs;
  const otherPU = uo ? num(uo.otherPUPM) : dOther;
  const stabOther = uo ? units * 12 * (rubsPU + otherPU) : legacyStab ? num(deal.stabOtherIncome) : other;
  const setStabOI = (k, v) => set('uwOtherIncome', { mode: 'lines', rubsPct: 100,
    rubsPUPM: Math.round(uo ? rubsPU : dRubs), otherPUPM: Math.round(uo ? otherPU : dOther), [k]: v === '' ? 0 : v });
  const stabEGI = gpr * (1 - stabVac) + stabOther;
  const opexLines = !!(deal.uwOpex && deal.uwOpex.mode === 'lines');
  const stabOpex = window.stabOpexFor ? window.stabOpexFor(deal, stabEGI) : num(deal.marketOpexPerUnit) * units;
  const stabNOI = stabEGI - stabOpex;
  const rpu = gpr > 0 ? gpr / units / 12 : 0;
  const setComb = (v) => set({ concessions: v, badDebt: 0 });
  const [showExp, setShowExp] = (window.useOpenState || ((k, d) => React.useState(d)))('altus_opex_open', false);

  const panel = { background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 9, padding: '12px 14px' };
  const row = { display: 'grid', gridTemplateColumns: '1fr 116px', gap: 8, alignItems: 'center', padding: '6px 0' };
  const pupm = (v) => (v && units ? moneyFull(v / units / 12) + ' / unit / mo' : '—');

  return (
    <Card>
      <SectionHead icon="pulse" title="Income & Economic Vacancy"
        desc={rrLinked ? 'Left = in-place (rent roll + T-12). Right = our stabilized assumptions. GPR, vacancy and loss to lease price off the rent roll.'
          : 'Left = in-place (T-12 / rent roll). Right = our stabilized assumptions. Upload a rent roll and T-12 to auto-fill.'} />

      {/* GPR — applies to both columns */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 200px 200px', gap: 14, alignItems: 'end', marginTop: 16,
        paddingBottom: pr ? 0 : 14, borderBottom: pr ? 'none' : '1px solid var(--line)' }}>
        <div>
          <Lbl>Gross Potential Rent</Lbl>
          <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{rrLinked ? 'Every unit at the market rents below.' : 'Annual market rent across all units — the basis for every vacancy line below.'}</div>
        </div>
        <div>{rrLinked ? <LinkedFigure value={moneyFull(gpr)} /> : <FieldInput value={deal.gprAnnual} onChange={(v) => set('gprAnnual', v || 0)} prefix="$" />}</div>
        <div style={{ textAlign: 'right' }}>
          <div className="num" style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>{rpu ? moneyFull(rpu) : '—'}</div>
          <div style={{ fontSize: 11, color: 'var(--faint)' }}>rent / unit / month</div>
        </div>
      </div>
      {pr && <MarketRentsBlock deal={deal} set={set} pr={pr} />}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
        {/* CURRENT */}
        <div style={panel}>
          <PanelHead>Current · Rent Roll & T-12</PanelHead>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 84px 116px', gap: 8, padding: '0 0 2px' }}>
            <span />
            <span style={{ fontSize: 9.5, color: 'var(--faint)', fontWeight: 600, textTransform: 'uppercase', textAlign: 'center' }}>% of GPR</span>
            <span style={{ fontSize: 9.5, color: 'var(--faint)', fontWeight: 600, textTransform: 'uppercase', textAlign: 'center' }}>Annual $</span>
          </div>
          {rrLinked
            ? <VacLine label="Physical Vacancy" value={phys} gpr={gpr} onChange={(v) => window.overrideRentRoll(deal, set, 'physVacLoss', v)}
                note={<RROverrideNote deal={deal} set={set} field="physVacLoss" text={(pr.units - Math.round(pr.occ * pr.units)) + ' vacant at in-place rent'} />} />
            : <VacLine label="Physical Vacancy" value={phys} gpr={gpr} onChange={(v) => set('physVacLoss', v)} />}
          {rrLinked
            ? <VacLine label="Loss to Lease" value={ltl} gpr={gpr} onChange={(v) => window.overrideRentRoll(deal, set, 'lossToLease', v)}
                note={<RROverrideNote deal={deal} set={set} field="lossToLease" text="market vs avg in-place" />} />
            : <VacLine label="Loss to Lease" value={ltl} gpr={gpr} onChange={(v) => set('lossToLease', v)} />}
          <VacLine label="Concessions & Bad Debt" value={comb} gpr={gpr} onChange={setComb} />
          <div style={row}>
            <div><span style={{ fontSize: 12.5, color: 'var(--ink)' }}>RUBS</span><Note>{pupm(curRubs)}</Note></div>
            <FieldInput value={deal.curRubs == null ? '' : curRubs} onChange={(v) => set({ curRubs: num(v), otherIncome: num(v) + curOther })} prefix="$" placeholder="0" />
          </div>
          <div style={row}>
            <div><span style={{ fontSize: 12.5, color: 'var(--ink)' }}>Other Income</span><Note>{pupm(curOther)}</Note></div>
            <FieldInput value={Math.round(curOther)} onChange={(v) => set('otherIncome', curRubs + num(v))} prefix="$" />
          </div>
          <OutRow label="In-Place Effective Gross Income" value={moneyFull(inPlaceEGI)} strong accent="var(--accent)"
            hint={pct1(inPlaceVac) + ' econ. vacancy'} />
          <div style={{ ...row, padding: '8px 0 6px' }}>
            <div>
              <span style={{ fontSize: 12.5, color: 'var(--ink)' }}>Current Operating Expenses</span>
              <Note>{curOpex && units ? moneyFull(curOpex / units) + ' / unit' + (t12Lines ? ' · T-12 line items below' : '') : '—'}</Note>
            </div>
            {t12Lines ? <LinkedFigure value={moneyFull(curOpex)} /> : <FieldInput value={deal.currentOpexTotal} onChange={(v) => set('currentOpexTotal', v || 0)} prefix="$" />}
          </div>
          <OutRow label="In-Place NOI" value={moneyFull(inPlaceNOI)} strong />
        </div>

        {/* STABILIZED */}
        <div style={{ ...panel, borderColor: 'var(--accent-soft)' }}>
          <PanelHead accent="var(--accent-2)">Stabilized · Our Assumptions</PanelHead>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 116px', gap: 8, padding: '0 0 2px' }}>
            <span />
            <span style={{ fontSize: 9.5, color: 'var(--faint)', fontWeight: 600, textTransform: 'uppercase', textAlign: 'center' }}>Input</span>
          </div>
          <div style={row}>
            <div><span style={{ fontSize: 12.5, color: 'var(--ink)' }}>Economic Vacancy</span><Note>{gpr ? moneyFull(gpr * stabVac) + ' / yr' : '—'}</Note></div>
            <FieldInput value={deal.stabEconVac} onChange={(v) => set('stabEconVac', v)} suffix="%" align="left" placeholder={String(round1(inPlaceVac))} />
          </div>
          <div style={row}>
            <div><span style={{ fontSize: 12.5, color: 'var(--ink)' }}>RUBS / unit / mo</span><Note>{moneyFull(rubsPU * units * 12)} / yr{uo ? '' : ' · carries trailing'}</Note></div>
            <FieldInput value={uo ? uo.rubsPUPM : ''} onChange={(v) => setStabOI('rubsPUPM', v)} prefix="$" placeholder={String(Math.round(dRubs))} />
          </div>
          <div style={row}>
            <div><span style={{ fontSize: 12.5, color: 'var(--ink)' }}>Other Income / unit / mo</span><Note>{moneyFull(otherPU * units * 12)} / yr{uo ? '' : ' · carries trailing'}</Note></div>
            <FieldInput value={uo ? uo.otherPUPM : ''} onChange={(v) => setStabOI('otherPUPM', v)} prefix="$" placeholder={String(Math.round(dOther))} />
          </div>
          <OutRow label="Stabilized Effective Gross Income" value={moneyFull(stabEGI)} strong accent="var(--accent)" />
          <div style={{ ...row, padding: '8px 0 6px' }}>
            <div>
              <span style={{ fontSize: 12.5, color: 'var(--ink)' }}>OpEx / Unit</span>
              <Note>{stabOpex ? moneyFull(stabOpex) + ' total' + (opexLines ? ' · line items below' : '') : '—'}</Note>
            </div>
            {opexLines ? <LinkedFigure value={moneyFull(stabOpex / units)} /> : <FieldInput value={deal.marketOpexPerUnit} onChange={(v) => set('marketOpexPerUnit', v || 0)} prefix="$" />}
          </div>
          <OutRow label="Stabilized NOI" value={moneyFull(stabNOI)} strong accent="var(--pos)" />
        </div>
      </div>

      {window.ExpenseBreakout && <>
        <button type="button" onClick={() => setShowExp(!showExp)} aria-expanded={showExp}
          style={{ marginTop: 14, width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, cursor: 'pointer',
            border: '1px solid var(--line)', background: showExp ? 'var(--panel-2)' : 'var(--panel)', fontFamily: 'var(--font)', textAlign: 'left' }}>
          <span style={{ display: 'inline-block', transform: showExp ? 'rotate(90deg)' : 'none', transition: 'transform .12s', color: 'var(--muted)', fontSize: 10 }}>▶</span>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>{showExp ? 'Hide' : 'Show'} operating expense detail</span>
          <span className="num" style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted)' }}>
            T-12 {curOpex ? moneyFull(curOpex / units) : '—'}/unit · Stabilized {stabOpex ? moneyFull(stabOpex / units) : '—'}/unit{opexLines ? ' · by line item' : ''}
          </span>
        </button>
        {showExp && <window.ExpenseBreakout deal={deal} set={set} inPlaceEGI={inPlaceEGI} stabEGI={stabEGI} onT12Upload={onT12Upload} t12Data={t12Data} />}
      </>}
    </Card>
  );
}

/* ───────────── Operating Assumptions (compact) ───────────── */
function AssumptionsSection({ deal, set, uw }) {
  const hold = uw.hold;
  const vacOv = deal.vacOverride || {};
  const setOv = (y, v) => set('vacOverride', { ...vacOv, [y]: v });
  const clearOv = () => set('vacOverride', {});
  const hasOv = Object.keys(vacOv).length > 0;
  return (
    <Card>
      <SectionHead icon="calc" title="Operating Assumptions"
        desc="Growth, exit and costs. Stabilized vacancy is set in the income section above; this is the burn-off path to it." />
      <CompactGrid>
        <CAssump label="Hold Period" hint="years"><FieldInput value={deal.holdYears == null ? 10 : deal.holdYears} onChange={(v) => set('holdYears', v || 1)} suffix="yrs" align="left" /></CAssump>
        <CAssump label="GPR Growth"><FieldInput value={deal.gprGrowth == null ? 3 : deal.gprGrowth} onChange={(v) => set('gprGrowth', v)} suffix="%" align="left" /></CAssump>
        <CAssump label="OpEx Growth"><FieldInput value={deal.opexGrowth == null ? 2.5 : deal.opexGrowth} onChange={(v) => set('opexGrowth', v)} suffix="%" align="left" /></CAssump>
        <CAssump label="Exit Cap Rate" hint="sale = NOI ÷ cap"><FieldInput value={deal.exitCap == null ? 6 : deal.exitCap} onChange={(v) => set('exitCap', v)} suffix="%" align="left" /></CAssump>
        <CAssump label="Stabilization Yr" hint="reaches target by"><FieldInput value={deal.stabYear == null ? 3 : deal.stabYear} onChange={(v) => set('stabYear', v || 1)} suffix="yr" align="left" /></CAssump>
        {uw.closingCustom ? (
          <CAssump label="Acq. Closing Cost" hint={
            <button type="button" onClick={() => set({ closingMode: 'standard' })}
              style={{ border: 'none', background: 'none', padding: 0, color: 'var(--accent)', fontSize: 10, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'var(--font)' }}>
              Custom % · use standard schedule
            </button>}>
            <FieldInput value={deal.closingPct == null ? 5 : deal.closingPct} onChange={(v) => set({ closingPct: v, closingMode: 'custom' })} suffix="%" align="left" />
          </CAssump>
        ) : (
          <CAssump label="Acq. Closing Cost" w={196} hint={<span>Standard schedule · <button type="button" onClick={() => set({ closingMode: 'custom', closingPct: Math.round(uw.closingPct * 1000) / 10 })}
              style={{ border: 'none', background: 'none', padding: 0, color: 'var(--accent)', fontSize: 10, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'var(--font)' }}>use custom %</button></span>}>
            <div className="num" title={(uw.closingBreakdown ? uw.closingBreakdown.items : []).map((i) => i.label + ': ' + moneyFull(i.amount) + ' (' + i.note + ')').join('\n')}
              style={{ height: 34, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px', border: '1px dashed var(--line-2)', borderRadius: 7, background: 'var(--panel-2)', fontSize: 13.5, color: 'var(--ink)', cursor: 'help' }}>
              {moneyFull(uw.closingCosts)}<span style={{ color: 'var(--faint)', fontSize: 11.5 }}>{pct1(uw.closingPct)} of price</span>
            </div>
          </CAssump>
        )}
        <CAssump label="Selling Costs" hint="% of sale"><FieldInput value={deal.sellingPct == null ? 4 : deal.sellingPct} onChange={(v) => set('sellingPct', v)} suffix="%" align="left" /></CAssump>
      </CompactGrid>

      {/* vacancy glide */}
      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>Economic Vacancy Schedule</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>
              Auto step-down from {pct1(uw.inPlaceEconVac)} to {pct1(uw.stabVac)} by year {uw.stabYear}. Override any year.
            </div>
          </div>
          {hasOv && <button onClick={clearOv} style={{ border: '1px solid var(--line-2)', background: 'var(--panel-2)', color: 'var(--slate)', borderRadius: 6, padding: '4px 10px', fontSize: 11.5, fontWeight: 500, cursor: 'pointer' }}>Reset to auto</button>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${hold}, 1fr)`, gap: 7 }}>
          {Array.from({ length: hold }, (_, i) => i + 1).map((y) => {
            const overridden = vacOv[y] != null && vacOv[y] !== '';
            const shown = overridden ? Number(vacOv[y]) : round1(uw.defaultVac(y));
            return (
              <div key={y} style={{ background: 'var(--panel-2)', border: '1px solid var(--line)', borderRadius: 7, padding: '7px 8px' }}>
                <div style={{ fontSize: 9.5, color: 'var(--muted)', fontWeight: 600, marginBottom: 4 }}>YR {y}</div>
                <div style={{ display: 'inline-flex', alignItems: 'center', border: `1px solid ${overridden ? 'var(--accent)' : 'var(--line-2)'}`, borderRadius: 6, background: 'var(--panel)', height: 28, width: '100%', overflow: 'hidden' }}>
                  <input className="num" value={shown} inputMode="decimal"
                    onChange={(e) => setOv(y, e.target.value.replace(/[^0-9.]/g, ''))}
                    style={{ border: 'none', outline: 'none', background: 'transparent', width: '100%', textAlign: 'left', padding: '0 2px 0 7px', fontSize: 12.5, color: overridden ? 'var(--accent)' : 'var(--ink)', height: '100%' }} />
                  <span style={{ padding: '0 6px 0 0', color: 'var(--faint)', fontSize: 11 }}>%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Card>
  );
}

/* ───────────── Acquisition Financing (compact) ───────────── */
function AcqFinancingSection({ deal, set, uw }) {
  const fin = deal.acqFin || { mode: 'none' };
  const mode = fin.mode || 'none';
  const setMode = (label) => {
    const m = label === 'New Loan' ? 'new' : label === 'Assumable' ? 'assumable' : 'none';
    const next = { ...fin, mode: m };
    if (m === 'new' && !next.new) next.new = { basis: 'LTV', pct: 65, rate: 6.0, amYears: 30, ioYears: 0 };
    if (m === 'assumable' && !next.assumable) next.assumable = { origAmount: Math.round((deal.purchasePrice || 0) * 0.6), origDate: '2022-01-01', rate: 4.5, amYears: 30, ioYears: 2, maturity: '2032-01-01' };
    set('acqFin', next);
  };
  const setNew = (k, v) => set('acqFin', { ...fin, new: { ...(fin.new || {}), [k]: v } });
  const setAssum = (k, v) => set('acqFin', { ...fin, assumable: { ...(fin.assumable || {}), [k]: v } });
  const n = fin.new || {}; const a = fin.assumable || {};
  const goingInDSCR = uw.rows[1] && uw.rows[1].ds > 0 ? uw.rows[1].noi / uw.rows[1].ds : null;
  const modeLabel = mode === 'new' ? 'New Loan' : mode === 'assumable' ? 'Assumable' : 'All Cash';

  // Financing scenario presets. Each sets the new-loan terms; "Bridge to HUD" also
  // turns on and configures the HUD takeout refinance.
  // Terms come from the current quotes on the Assumptions tab; the rate stays linked so a
  // quote change there flows to this deal.
  const Q = assumptionQuotes(deal);
  const qLoan = (k, fb) => (Q && Q[k]) ? { basis: Q[k].basis, pct: Q[k].maxLev, rate: Q[k].rate, amYears: Q[k].amYears, ioYears: Q[k].ioYears, rateMode: 'linked' } : fb;
  const hudRefi = (Q && Q.hudRefi) || { maxLev: 80, rate: 6, amYears: 35, ioYears: 0 };
  const SCENARIOS = {
    'Bridge to HUD':     { loan: qLoan('bridge', { basis: 'LTC', pct: 70, rate: 6.25, amYears: 30, ioYears: 3 }),
                           refi: { enabled: true, year: 3, cap: 6, ltv: hudRefi.maxLev, rate: hudRefi.rate, amYears: hudRefi.amYears, ioYears: hudRefi.ioYears, costPct: 2, quote: 'hudRefi', rateMode: 'linked' } },
    'HUD at Acquisition':    { loan: qLoan('hudAcq', { basis: 'LTV', pct: 85, rate: 5.75, amYears: 35, ioYears: 0 }) },
    'Agency at Acquisition': { loan: qLoan('agencyAcq', { basis: 'LTV', pct: 70, rate: 5.5, amYears: 30, ioYears: 2 }) },
    'Custom':            null,
  };
  const applyScenario = (label) => {
    const s = SCENARIOS[label];
    if (!s) { set('acqFin', { ...fin, mode: 'new', scenario: 'Custom' }); return; }
    const next = { ...fin, mode: 'new', scenario: label, new: { ...s.loan } };
    if (s.refi) set({ acqFin: next, refi: { ...(deal.refi || {}), ...s.refi } });
    else set('acqFin', next);
  };

  return (
    <Card>
      <SectionHead icon="bank" title="Acquisition Financing" desc="New financing or assumed debt at close."
        right={<Seg size="sm" value={modeLabel} options={['All Cash', 'New Loan', 'Assumable']} onChange={setMode} />} />

      {mode === 'none' && (
        <div style={{ marginTop: 12, padding: '10px 14px', color: 'var(--muted)', fontSize: 12.5, background: 'var(--panel-2)', borderRadius: 7, fontStyle: 'italic' }}>
          All-cash acquisition — equity equals total basis plus closing costs.
        </div>
      )}

      {mode === 'new' && (<>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12, marginBottom: 4 }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)', flex: 'none' }}>Scenario</span>
          <select value={fin.scenario || 'Custom'} onChange={(e) => applyScenario(e.target.value)}
            style={{ border: '1px solid var(--line-2)', borderRadius: 7, padding: '6px 10px', background: 'var(--panel)',
              fontSize: 12.5, fontWeight: 600, color: 'var(--accent)', cursor: 'pointer', fontFamily: 'var(--font)' }}>
            {Object.keys(SCENARIOS).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>
            {fin.scenario === 'Bridge to HUD' ? 'bridge loan + HUD takeout refi · rates from the Assumptions tab'
              : fin.scenario && fin.scenario !== 'Custom' ? 'rate follows the Assumptions tab · other terms adjustable' : 'enter your own terms'}
          </span>
        </div>
        <CompactGrid>
          <CAssump label="Sizing" hint={n.basis === 'LTC' ? 'on total cost' : 'on price'} w={108}>
            <Seg size="sm" value={n.basis === 'LTC' ? 'LTC' : 'LTV'} options={['LTV', 'LTC']} onChange={(v) => setNew('basis', v)} />
          </CAssump>
          <CAssump label={n.basis === 'LTC' ? 'Loan to Cost' : 'Loan to Value'}><FieldInput value={n.pct == null ? 65 : n.pct} onChange={(v) => setNew('pct', v)} suffix="%" align="left" /></CAssump>
          <CAssump label="Interest Rate" w={150} hint={<RateLinkHint r={uw.acqRate} onRelink={() => setNew('rateMode', 'linked')} />}>
            <FieldInput value={uw.acqRate ? uw.acqRate.rate : (n.rate == null ? 6 : n.rate)}
              onChange={(v) => set('acqFin', { ...fin, new: { ...n, rate: v, rateMode: 'custom' } })} suffix="%" align="left" />
          </CAssump>
          <CAssump label="Amortization"><FieldInput value={n.amYears == null ? 30 : n.amYears} onChange={(v) => setNew('amYears', v)} suffix="yrs" align="left" /></CAssump>
          <CAssump label="Interest-Only"><FieldInput value={n.ioYears == null ? 0 : n.ioYears} onChange={(v) => setNew('ioYears', v)} suffix="yrs" align="left" /></CAssump>
          <SizingFields spec={n} sizing={uw.acqSizing} quote={uw.acqRate && uw.acqRate.quote} onSet={setNew} />
        </CompactGrid>
        <FinFooter uw={uw} goingInDSCR={goingInDSCR} />
      </>)}

      {mode === 'assumable' && (<>
        <CompactGrid>
          <CAssump label="Original Loan" w={150}><FieldInput value={a.origAmount} onChange={(v) => setAssum('origAmount', v || 0)} prefix="$" /></CAssump>
          <CAssump label="Origination" w={140}>{dateBox(a.origDate, (v) => setAssum('origDate', v))}</CAssump>
          <CAssump label="Interest Rate"><FieldInput value={a.rate} onChange={(v) => setAssum('rate', v)} suffix="%" align="left" /></CAssump>
          <CAssump label="Amortization"><FieldInput value={a.amYears == null ? 30 : a.amYears} onChange={(v) => setAssum('amYears', v)} suffix="yrs" align="left" /></CAssump>
          <CAssump label="Interest-Only"><FieldInput value={a.ioYears == null ? 0 : a.ioYears} onChange={(v) => setAssum('ioYears', v)} suffix="yrs" align="left" /></CAssump>
          <CAssump label="Maturity" w={140}>{dateBox(a.maturity, (v) => setAssum('maturity', v))}</CAssump>
        </CompactGrid>
        <FinFooter uw={uw} goingInDSCR={goingInDSCR} assumed />
      </>)}
    </Card>
  );
}
function FinFooter({ uw, goingInDSCR, assumed }) {
  const ds1 = uw.acqLoan ? uw.acqLoan.dsForYear(1) : 0;
  const ltv = uw.price > 0 ? uw.acqProceeds / uw.price : null;
  const q = uw.acqRate && uw.acqRate.quote;
  const minD = q && q.minDscr ? Number(q.minDscr) : null;
  const low = goingInDSCR != null && goingInDSCR < (minD || 1.2);
  const dy = uw.goingInDebtYield;
  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))', gap: 12 }}>
      <FootStat label={assumed ? 'Assumed Balance' : 'Loan Proceeds'} value={moneyFull(uw.acqProceeds)} accent="var(--accent)" sub={assumed ? null : sizingNote(uw.acqSizing)} />
      {assumed && <FootStat label="LTV" value={ltv == null ? '—' : (ltv * 100).toFixed(1) + '%'} />}
      <FootStat label="Annual Debt Service" value={moneyFull(ds1)} />
      <FootStat label="Equity Required" value={moneyFull(uw.initialEquity)} sub="incl. closing + capex" />
      <FootStat tone="boxed" label="Going-In DSCR" value={goingInDSCR == null ? '—' : goingInDSCR.toFixed(2) + 'x'}
        accent={low ? 'var(--neg)' : undefined} sub={minD ? (low ? 'below ' : 'min ') + minD.toFixed(2) + 'x' : 'Yr 1 NOI ÷ DS'} />
      <FootStat tone="boxed" label="Going-In Debt Yield" value={dy == null ? '—' : pct1(dy)} sub="Yr 1 NOI ÷ loan" />
    </div>
  );
}
function FootStat({ label, value, sub, accent, tone }) {
  if (tone === 'boxed') return (
    <div style={{ border: '1px solid var(--line-2)', borderRadius: 7, padding: '6px 10px', margin: '-7px 0' }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div className="num" style={{ fontSize: 16, fontWeight: 700, color: accent || 'var(--ink)' }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 2 }}>{sub}</div>}
    </div>);
  return (
    <div>
      <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div className="num" style={{ fontSize: 16, fontWeight: 700, color: accent || 'var(--ink)' }}>{value}</div>
      {sub && <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

/* ───────────── Refinance (compact) ───────────── */
function RefiSection({ deal, set, uw }) {
  const refi = deal.refi || { enabled: false };
  const on = !!refi.enabled;
  const setRefi = (k, v) => set('refi', { ...refi, [k]: v });
  const Q = assumptionQuotes(deal);
  const QUOTE_OPTS = [['hudRefi', 'HUD takeout'], ['agencyRefi', 'Agency takeout'], ['custom', 'Custom']];
  const quoteKey = refi.quote || 'hudRefi';
  const applyQuote = (k) => {
    if (k === 'custom' || !Q || !Q[k]) { set('refi', { ...refi, quote: 'custom', rate: uw.refiRate ? uw.refiRate.rate : refi.rate, rateMode: 'custom' }); return; }
    const q = Q[k];
    set('refi', { ...refi, quote: k, ltv: q.maxLev, amYears: q.amYears, ioYears: q.ioYears, rateMode: 'linked' });
  };
  const toggle = (label) => {
    const q = (Q && Q.hudRefi) || { maxLev: 80, rate: 6, amYears: 35, ioYears: 0 };
    if (label === 'Yes') set('refi', { enabled: true, year: refi.year || 3, cap: refi.cap || 6.0, ltv: refi.ltv || q.maxLev, rate: refi.rate || q.rate, amYears: refi.amYears || q.amYears, ioYears: refi.ioYears || q.ioYears, quote: refi.quote || 'hudRefi', rateMode: refi.rateMode || 'linked' });
    else set('refi', { ...refi, enabled: false });
  };
  const rq = uw.refiRate && uw.refiRate.quote;
  const refiMinD = rq && rq.minDscr ? Number(rq.minDscr) : null;
  const refiLow = uw.refiDSCR != null && uw.refiDSCR < (refiMinD || 1.2);
  return (
    <Card>
      <SectionHead icon="target" title="Refinance" desc="Cash-out refi during the hold. Value = refi-year NOI ÷ refi cap; proceeds repay the old loan."
        right={<Seg size="sm" value={on ? 'Yes' : 'No'} options={['No', 'Yes']} onChange={toggle} />} />
      {!on ? (
        <div style={{ marginTop: 12, padding: '10px 14px', color: 'var(--muted)', fontSize: 12.5, background: 'var(--panel-2)', borderRadius: 7, fontStyle: 'italic' }}>
          No refinance — acquisition loan carried through to sale.
        </div>
      ) : (<>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12, marginBottom: 4 }}>
          <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)', flex: 'none' }}>Takeout Debt</span>
          <select value={quoteKey} onChange={(e) => applyQuote(e.target.value)}
            style={{ border: '1px solid var(--line-2)', borderRadius: 7, padding: '6px 10px', background: 'var(--panel)',
              fontSize: 12.5, fontWeight: 600, color: 'var(--accent)', cursor: 'pointer', fontFamily: 'var(--font)' }}>
            {QUOTE_OPTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>{quoteKey === 'custom' ? 'enter your own terms' : 'rate follows the Assumptions tab · other terms adjustable'}</span>
        </div>
        <CompactGrid>
          <CAssump label="Refi Year"><FieldInput value={refi.year == null ? 3 : refi.year} onChange={(v) => setRefi('year', v || 1)} suffix="yr" align="left" /></CAssump>
          <CAssump label="Refi Cap Rate"><FieldInput value={refi.cap} onChange={(v) => setRefi('cap', v)} suffix="%" align="left" /></CAssump>
          <CAssump label="Refi LTV" hint={rq ? 'quote max ' + rq.maxLev + '%' : null}><FieldInput value={refi.ltv == null ? 80 : refi.ltv} onChange={(v) => setRefi('ltv', v)} suffix="%" align="left" /></CAssump>
          <CAssump label="Interest Rate" w={150} hint={<RateLinkHint r={uw.refiRate} onRelink={() => setRefi('rateMode', 'linked')} />}>
            <FieldInput value={uw.refiRate ? uw.refiRate.rate : (refi.rate == null ? 6 : refi.rate)} onChange={(v) => set('refi', { ...refi, rate: v, rateMode: 'custom' })} suffix="%" align="left" />
          </CAssump>
          <CAssump label="Amortization"><FieldInput value={refi.amYears == null ? 35 : refi.amYears} onChange={(v) => setRefi('amYears', v)} suffix="yrs" align="left" /></CAssump>
          <CAssump label="Interest-Only"><FieldInput value={refi.ioYears == null ? 0 : refi.ioYears} onChange={(v) => setRefi('ioYears', v)} suffix="yrs" align="left" /></CAssump>
          <CAssump label="Refi Loan Fees" w={150} hint={uw.refiCostPct && uw.refiCostPct.linked
              ? <span style={{ color: 'var(--accent)', fontWeight: 600 }}>Linked · quote loan fee</span>
              : (uw.refiRate && uw.refiRate.quote ? <button type="button" onClick={() => setRefi('costMode', 'linked')} style={{ border: 'none', background: 'none', padding: 0, color: 'var(--accent)', fontSize: 10, fontWeight: 600, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'var(--font)' }}>Custom · use quote fee</button> : '% of new loan')}>
            <FieldInput value={uw.refiCostPct ? uw.refiCostPct.pct : (refi.costPct == null ? 2 : refi.costPct)} onChange={(v) => set('refi', { ...refi, costPct: v, costMode: 'custom' })} suffix="%" align="left" />
          </CAssump>
          <SizingFields spec={refi} sizing={uw.refiSizing} quote={uw.refiRate && uw.refiRate.quote} onSet={setRefi} />
        </CompactGrid>
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(128px, 1fr))', gap: 12 }}>
          <FootStat label={'Refi Value (Yr ' + uw.refiYear + ')'} value={moneyFull(uw.refiValue)} sub="NOI ÷ refi cap" />
          <FootStat label="New Loan" value={moneyFull(uw.refiProceeds)} accent="var(--accent)" sub={sizingNote(uw.refiSizing)} />
          <FootStat label="Old Loan Payoff" value={moneyFull(uw.refiPayoff)} />
          <FootStat label="Refi Loan Fees" value={moneyFull(uw.refiCost)} sub={(uw.refiCostPct ? uw.refiCostPct.pct : 2) + '% of loan'} />
          <FootStat label="Cash-Out to Equity" value={moneyFull(uw.refiCashOut)} accent={uw.refiCashOut >= 0 ? 'var(--pos)' : 'var(--neg)'} />
          <FootStat tone="boxed" label="Refi DSCR" value={uw.refiDSCR == null ? '—' : uw.refiDSCR.toFixed(2) + 'x'} accent={refiLow ? 'var(--neg)' : undefined}
            sub={refiMinD ? (refiLow ? 'below ' : 'min ') + refiMinD.toFixed(2) + 'x' : 'refi-yr NOI ÷ new DS'} />
          <FootStat tone="boxed" label="Refi Debt Yield" value={uw.refiDebtYield == null ? '—' : pct1(uw.refiDebtYield)} sub="refi-yr NOI ÷ new loan" />
        </div>
      </>)}
    </Card>
  );
}

/* ───────────── Annual Cash Flow table ───────────── */
function CashFlowTable({ uw, showReturns = true }) {
  const cols = uw.rows;
  const colW = 116, labelW = 200;
  const grid = `${labelW}px repeat(${cols.length}, minmax(${colW}px, 1fr))`;
  const headLabel = (y) => y === 0 ? 'Acq Year' : 'Year ' + y;
  const Row = ({ label, hint, get, fmt, strong, accent, neg, top }) => (
    <div style={{ display: 'grid', gridTemplateColumns: grid, alignItems: 'center', borderTop: top ? '1px solid var(--line-2)' : '1px solid var(--line)' }}>
      <div style={{ padding: '9px 14px', position: 'sticky', left: 0, background: 'var(--panel)', zIndex: 1 }}>
        <div style={{ fontSize: 12.5, fontWeight: strong ? 600 : 400, color: 'var(--ink)' }}>{label}</div>
        {hint && <div style={{ fontSize: 10.5, color: 'var(--faint)' }}>{hint}</div>}
      </div>
      {cols.map((r) => {
        const v = get(r); const txt = fmt(v, r);
        const isNeg = neg && typeof v === 'number' && v < 0;
        return <div key={r.year} className="num" style={{ padding: '9px 14px', textAlign: 'right', fontSize: strong ? 13.5 : 12.5, fontWeight: strong ? 700 : 500, color: isNeg ? 'var(--neg)' : (accent || (strong ? 'var(--ink)' : 'var(--slate)')), background: r.year === 0 ? 'var(--panel-2)' : 'transparent' }}>{txt}</div>;
      })}
    </div>
  );
  // A light outline groups the debt metrics apart from the equity yields without recoloring them.
  const Boxed = ({ children }) => (
    <div style={{ position: 'relative' }}>
      {children}
      <div aria-hidden="true" style={{ position: 'absolute', inset: '3px 6px', border: '1px solid var(--line-2)', borderRadius: 8, pointerEvents: 'none', zIndex: 3 }} />
    </div>
  );
  return (
    <Card pad={false}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 30, height: 30, borderRadius: 7, background: 'var(--navy)', color: '#fff', flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="chart" size={15} /></span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Annual Cash Flow</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{uw.hold}-year hold · acquisition year + {uw.hold} years · sale at end of year {uw.hold}</div>
        </div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: labelW + cols.length * colW }}>
          <div style={{ display: 'grid', gridTemplateColumns: grid, background: 'var(--panel-3)', borderBottom: '1px solid var(--line)' }}>
            <div style={{ padding: '9px 14px', position: 'sticky', left: 0, background: 'var(--panel-3)', zIndex: 2, fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)' }}>Line Item</div>
            {cols.map((r) => <div key={r.year} style={{ padding: '9px 14px', textAlign: 'right', fontSize: 11.5, fontWeight: 700, color: r.year === 0 ? 'var(--accent)' : 'var(--ink)' }}>{headLabel(r.year)}</div>)}
          </div>
          <Row label="Effective Gross Income" get={(r) => r.egi} fmt={moneyFull} />
          <Row label="Operating Expenses" get={(r) => -r.opex} fmt={(v) => moneyFull(v)} neg />
          <Row label="Net Operating Income" get={(r) => r.noi} fmt={moneyFull} strong />
          <Row label="Debt Service" get={(r) => (r.ds ? -r.ds : 0)} fmt={(v) => (v ? moneyFull(v) : '—')} neg />
          <Row label="Asset Management Fee" hint={'on EGI'} get={(r) => (r.amFee ? -r.amFee : 0)} fmt={(v) => (v ? moneyFull(v) : '—')} neg />
          <Row label="Net Cash Flow" hint="NOI − debt service − AM fee" get={(r) => r.netIncome} fmt={moneyFull} strong accent="var(--accent)" neg />
          {uw.refiOn && <Row label="Return of Capital (Refi)" hint={'cash-out, year ' + uw.refiYear} get={(r) => r.refiDistribution} fmt={(v) => (v ? moneyFull(v) : '—')} accent="var(--navy)" />}
          <Row label="Net Sale Proceeds" hint={'at exit, year ' + uw.hold} get={(r) => r.saleProceeds} fmt={(v) => (v ? moneyFull(v) : '—')} accent="var(--navy)" />
          <Row label="Total Cash Flow to Equity" hint="net CF + refi ROC + sale" get={(r) => r.totalCashFlow} fmt={moneyFull} strong accent="var(--pos)" neg />
          <Row top label="Net Revenue Growth" hint="YoY EGI Δ · rent growth + vacancy" get={(r) => r.netRevGrowth} fmt={(v) => (v == null ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(1) + '%')} />
          <Boxed>
            <Row top label="Debt Yield" hint="NOI ÷ loan balance" get={(r) => r.debtYield} fmt={(v) => (v == null ? '—' : pct1(v))} />
            <Row label="DSCR" hint="NOI ÷ debt service" get={(r) => r.dscr} fmt={(v) => (v == null ? '—' : v.toFixed(2) + 'x')} />
          </Boxed>
          <Row top label="Yield on Cost" hint="NOI ÷ total basis" get={(r) => r.yieldOnCost} fmt={pct1} />
          <Row label="Cash-on-Cash Yield" hint="net CF ÷ equity balance" get={(r) => r.cashOnCash} fmt={(v) => (v == null ? '—' : pct1(v))} />
          <Row label="Principal Paydown" hint="amortization ÷ equity balance" get={(r) => r.principalPaydownPct} fmt={(v) => (v == null || v === 0 ? '—' : pct1(v))} />
          <Row label="Yield + Principal Paydown" hint="cash yield + paydown" get={(r) => r.yieldPlusPaydown} fmt={(v) => (v == null ? '—' : pct1(v))} strong accent="var(--pos)" />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', borderTop: '1px solid var(--line)' }}>
        <SumCell label="Equity Invested" value={moneyFull(uw.initialEquity)} />
        <SumCell label={'Exit Value (Yr ' + uw.hold + ')'} value={showReturns && uw.salePrice ? moneyFull(uw.salePrice) : '—'} sub={uw.exitCap ? pct1(uw.exitCap) + ' exit cap' : 'set exit cap'} />
        <SumCell label="Net Sale Proceeds" value={showReturns && uw.salePrice ? moneyFull(uw.netSaleProceeds) : '—'} />
        <SumCell label="Equity Multiple" value={showReturns && uw.equityMultiple != null ? uw.equityMultiple.toFixed(2) + 'x' : '—'} accent="var(--ink)" />
        <SumCell label="Levered IRR" value={showReturns && uw.irr != null ? (uw.irr * 100).toFixed(1) + '%' : '—'} accent={showReturns && uw.irr != null ? 'var(--pos)' : 'var(--faint)'} big />
      </div>
    </Card>
  );
}
function SumCell({ label, value, sub, accent, big }) {
  return (
    <div style={{ padding: '16px 18px', borderLeft: '1px solid var(--line)' }}>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', marginBottom: 8 }}>{label}</div>
      <div className="num" style={{ fontSize: big ? 26 : 20, fontWeight: 700, color: accent || 'var(--ink)', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

/* ───────────── Quick & Full tabs ───────────── */
function CapCards({ deal, set, m }) {
  const capDelta = m.stabilizedCap - m.goingInCap;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
      <Card>
        <SectionHead icon="target" title="Going-In Cap Rate" desc="In-place EGI vs. our per-unit expense assumption." />
        <div style={{ marginTop: 10 }}>
          <CalcRow kind="INPUT" label="Effective Gross Income" hint="in-place · from OM"><FieldInput value={deal.trailingEGI} onChange={(v) => set('trailingEGI', v || 0)} prefix="$" /></CalcRow>
          <CalcRow kind="INPUT" label="T-12 Operating Expenses" hint="total, in-place · from OM"><FieldInput value={deal.currentOpexTotal} onChange={(v) => set('currentOpexTotal', v || 0)} prefix="$" /></CalcRow>
          <CalcRow kind="OUTPUT" label="Current OpEx / Unit" hint={fmtNum(m.units) + ' units'}>{fmtMoney(m.currentOpexPerUnit)}</CalcRow>
          <CalcRow kind="INPUT" label="Assumption OpEx / Unit" hint="UW assumption"><FieldInput value={deal.marketOpexPerUnit} onChange={(v) => set('marketOpexPerUnit', v || 0)} prefix="$" /></CalcRow>
          <CalcRow kind="OUTPUT" label="Pro Forma OpEx" hint="assumption × units">{fmtMoney(m.marketOpex)}</CalcRow>
          <CalcRow kind="OUTPUT" label="Going-In NOI" hint="EGI − assumption opex" strong>{fmtMoney(m.goingInNOI)}</CalcRow>
          <CalcRow kind="OUTPUT" label="Going-In Cap Rate" hint="NOI ÷ purchase price" strong accent="var(--accent)">{fmtPct(m.goingInCap)}</CalcRow>
        </div>
      </Card>
      <Card>
        <SectionHead icon="pulse" title="Stabilized Cap Rate" desc="Broker EGI vs. market expenses over total basis." />
        <div style={{ marginTop: 10 }}>
          <CalcRow kind="INPUT" label="Broker / Pro Forma EGI" hint="stabilized projection"><FieldInput value={deal.brokerEGI} onChange={(v) => set('brokerEGI', v || 0)} prefix="$" /></CalcRow>
          <CalcRow kind="OUTPUT" label="Our Market Expenses" hint="same UW assumption">{fmtMoney(m.marketOpex)}</CalcRow>
          <CalcRow kind="OUTPUT" label="Pro Forma NOI" strong>{fmtMoney(m.proformaNOI)}</CalcRow>
          <CalcRow kind="OUTPUT" label="Total Basis" hint="price + CapEx">{fmtMoney(m.totalBasis)}</CalcRow>
          <CalcRow kind="OUTPUT" label="Stabilized Cap Rate" hint="NOI ÷ total basis" strong accent="var(--pos)">{fmtPct(m.stabilizedCap)}</CalcRow>
          <div style={{ marginTop: 12, padding: '10px 13px', background: 'var(--panel-2)', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12.5, color: 'var(--slate)', fontWeight: 400 }}>Spread, going-in → stabilized</span>
            <span className="num" style={{ fontSize: 14, fontWeight: 700, color: capDelta >= 0 ? 'var(--pos)' : 'var(--neg)' }}>{capDelta >= 0 ? '+' : ''}{Math.round(capDelta * 10000)} bps</span>
          </div>
        </div>
      </Card>
    </div>
  );
}

function QuickUnderwritingTab({ deal, set }) {
  const m = computeMetrics(deal);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PricingBasis deal={deal} set={set} m={m} />
      <CapCards deal={deal} set={set} m={m} />
    </div>
  );
}

/* ───────────── Portfolio: per-property switcher ───────────── */
function PropertyUWSwitcher({ props, view, setView }) {
  const chip = (key, label, active) => (
    <button key={key} onClick={() => setView(key)} style={{
      border: active ? '1px solid var(--accent)' : '1px solid var(--line-2)',
      background: active ? 'var(--accent-soft)' : 'var(--panel)', color: active ? 'var(--accent)' : 'var(--slate)',
      borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
      {label}
    </button>
  );
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {chip('combined', 'Combined (' + props.length + ')', view === 'combined')}
      {props.map((p, i) => chip('p' + i, p.name || 'Property ' + (i + 1), view === 'p' + i))}
    </div>
  );
}

/* ───────────── Portfolio: combined read-only rollup ───────────── */
function CombinedUWView({ deal, set }) {
  const uw = window.computeCombinedUW ? window.computeCombinedUW(deal) : null;
  const props = deal.properties || [];
  const uwCount = props.filter((p) => window.hasUWInputs && window.hasUWInputs(p)).length;
  if (!uw) {
    return (
      <Card>
        <SectionHead icon="chart" title="Combined Portfolio" desc="Sums each property's independent Full UW into one model." />
        <div style={{ marginTop: 12, padding: '10px 14px', color: 'var(--muted)', fontSize: 12.5, background: 'var(--panel-2)', borderRadius: 7, fontStyle: 'italic' }}>
          No property has Full UW inputs yet — open a property tab above and enter Gross Potential Rent to include it here.
        </div>
      </Card>
    );
  }
  const vintages = props.map((p) => Number(p.vintage)).filter((v) => v > 0);
  const vintageRange = vintages.length ? (Math.min(...vintages) === Math.max(...vintages) ? String(Math.min(...vintages)) : Math.min(...vintages) + '–' + Math.max(...vintages)) : '—';
  const totalUnits = props.reduce((s, p) => s + (Number(p.units) || 0), 0);
  const totalGuidance = props.reduce((s, p) => s + (Number(p.askPrice) || 0), 0);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <SectionHead icon="chart" title="Combined Portfolio" desc={uwCount + ' of ' + props.length + ' properties underwritten · summed cash flows, IRR from the combined stream'} />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 14, marginTop: 14 }}>
          <div><Lbl>Units</Lbl><FieldInput value={deal.units || totalUnits} onChange={(v) => set('units', Number(v) || 0)} align="left" /></div>
          <div><Lbl>Vintage</Lbl>
            <input value={deal.vintage || vintageRange} onChange={(e) => set('vintage', e.target.value)} placeholder="Year built"
              style={{ border: '1px solid var(--line-2)', borderRadius: 7, padding: '0 10px', background: 'var(--panel)',
                fontSize: 13.5, height: 34, width: '100%', boxSizing: 'border-box', color: 'var(--ink)', fontFamily: 'var(--font)' }}
              onFocus={(e) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--accent-soft)'; }}
              onBlur={(e) => { e.target.style.borderColor = 'var(--line-2)'; e.target.style.boxShadow = 'none'; }} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 14, marginTop: 12 }}>
          <GuidancePill label="Total Basis" value={moneyFull(uw.basis)} sub={uw.units ? moneyFull(uw.basis / uw.units) + ' / unit' : ''} />
          <GuidancePill label="Total Guidance Price" value={totalGuidance ? moneyFull(totalGuidance) : '—'}
            sub={totalGuidance && uw.basis ? (uw.basis <= totalGuidance ? moneyFull(totalGuidance - uw.basis) + ' below ask' : moneyFull(uw.basis - totalGuidance) + ' over ask') : ''}
            accent={totalGuidance && uw.basis ? (uw.basis <= totalGuidance ? 'var(--pos)' : 'var(--neg)') : 'var(--faint)'} />
          <GuidancePill label="Equity Required" value={moneyFull(uw.initialEquity)} />
          <GuidancePill label="Equity Multiple" value={uw.equityMultiple != null ? uw.equityMultiple.toFixed(2) + 'x' : '—'} />
          <GuidancePill label="Levered IRR" value={uw.irr != null ? (uw.irr * 100).toFixed(1) + '%' : '—'} accent={uw.irr != null ? 'var(--pos)' : 'var(--faint)'} />
        </div>
      </Card>
      <CashFlowTable uw={uw} showReturns={uwCount > 0} />
    </div>
  );
}

/* ───────────── Portfolio: one property's independent Full UW ───────────── */
function PropertyFullUW({ property, onChange }) {
  const m = computeMetrics(property);
  const uw = computeUW(property);
  const hasReturns = window.hasUWInputs ? window.hasUWInputs(property) : true;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <Card>
        <SectionHead icon="chart" title="Property Returns" desc="Levered returns for this property alone, independent of the rest of the portfolio." />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, marginTop: 14 }}>
          <GuidancePill label="Levered IRR" value={hasReturns && uw.irr != null ? (uw.irr * 100).toFixed(1) + '%' : '—'} accent={hasReturns && uw.irr != null ? 'var(--pos)' : 'var(--faint)'} />
          <GuidancePill label="Equity Multiple" value={hasReturns && uw.equityMultiple != null ? uw.equityMultiple.toFixed(2) + 'x' : '—'} />
          <GuidancePill label="Avg Yield" value={hasReturns && uw.avgYield != null ? (uw.avgYield * 100).toFixed(1) + '%' : '—'} />
        </div>
      </Card>
      <PricingBasis deal={property} set={onChange} m={m} />
      <IncomeVacancySection deal={property} set={onChange} />
      <AcqFinancingSection deal={property} set={onChange} uw={uw} />
      <RefiSection deal={property} set={onChange} uw={uw} />
      <AssumptionsSection deal={property} set={onChange} uw={uw} />
      <CashFlowTable uw={uw} showReturns={window.hasUWInputs ? window.hasUWInputs(property) : true} />
    </div>
  );
}

/* ───────────── Portfolio: Full UW tab wrapper ───────────── */
function PortfolioUWTab({ deal, set, view, setView, setProperties, excluded = {}, setExcluded, stickyTop = 0 }) {
  const props = deal.properties || [];
  const included = props.filter((p, i) => !excluded[p.id || i]);
  const toggleInc = (p, i) => setExcluded((e) => {
    const k = p.id || i;
    const n = { ...e };
    if (n[k]) delete n[k]; else n[k] = true;
    return n;
  });
  const propSet = (idx) => (k, v) => {
    const arr = [...props];
    arr[idx] = { ...arr[idx], ...(typeof k === 'object' ? k : { [k]: v }) };
    if (setProperties) setProperties(arr); else set('properties', arr);
  };
  const idx = view.startsWith('p') ? Number(view.slice(1)) : null;
  const safeIdx = idx != null && props[idx] ? idx : null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <PropertyUWSwitcher props={props} view={view} setView={setView} />
      {safeIdx != null &&
        <div style={{ position: 'sticky', top: stickyTop, zIndex: 12, display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 8, padding: '9px 14px',
          fontSize: 12.5, boxShadow: '0 2px 8px rgba(15,23,32,.06)' }}>
          <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{props[safeIdx].name || 'Property ' + (safeIdx + 1)}</span>
          <span style={{ color: 'var(--faint)' }}>·</span>
          <span className="num" style={{ color: 'var(--muted)' }}>{props[safeIdx].vintage ? 'Built ' + props[safeIdx].vintage : 'Vintage —'}</span>
          <span style={{ color: 'var(--faint)' }}>·</span>
          <span style={{ color: 'var(--muted)' }}>{props[safeIdx].market || '—'}</span>
        </div>}
      {safeIdx == null &&
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.04em', textTransform: 'uppercase' }}>Properties in combined view</div>
              <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 2 }}>{included.length} of {props.length} included · uncheck to model a partial portfolio</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setExcluded({})} style={{ border: '1px solid var(--line-2)', background: 'var(--panel)', color: 'var(--slate)', borderRadius: 7, padding: '5px 11px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>Select all</button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {props.map((p, i) => {
              const on = !excluded[p.id || i];
              return (
                <button key={p.id || i} onClick={() => toggleInc(p, i)} style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  border: on ? '1px solid var(--accent)' : '1px solid var(--line-2)',
                  background: on ? 'var(--accent-soft)' : 'var(--panel)', color: on ? 'var(--accent)' : 'var(--faint)',
                  borderRadius: 999, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                  <span style={{ width: 13, height: 13, borderRadius: 3, flex: 'none',
                    border: on ? '1px solid var(--accent)' : '1px solid var(--line-2)',
                    background: on ? 'var(--accent)' : 'transparent', color: '#fff',
                    fontSize: 10, lineHeight: '13px', textAlign: 'center' }}>{on ? '✓' : ''}</span>
                  {p.name || 'Property ' + (i + 1)}
                </button>
              );
            })}
          </div>
        </Card>}
      {safeIdx != null
        ? <PropertyFullUW key={props[safeIdx].id || safeIdx} property={props[safeIdx]} onChange={propSet(safeIdx)} />
        : <CombinedUWView deal={{ ...deal, properties: included }} set={set} />}
    </div>
  );
}

/* Which assumptions this deal runs on: the set it locked in when first underwritten. Changes on the
   Assumptions tab only reach deals underwritten afterwards; this offers a deliberate per-deal update. */
function AssumptionLockNote({ deal, set }) {
  const A = window.AltusAssumptions;
  const [armed, setArmed] = useSU(false);
  if (!A || !A.forDeal || !deal.uwAssumptions) return null;
  const stale = A.isStale(deal);
  const when = deal.uwAssumptions.takenAt ? new Date(deal.uwAssumptions.takenAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'underwriting';
  const update = () => { const next = A.refreshSnapshot(deal); set({ uwAssumptions: next.uwAssumptions, ...(next.properties ? { properties: next.properties } : {}) }); setArmed(false); };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', borderRadius: 'var(--radius-lg)', flexWrap: 'wrap',
      background: stale ? 'var(--warn-soft)' : 'var(--panel-2)', border: '1px solid ' + (stale ? '#f0d9a8' : 'var(--line)'), fontSize: 12.5, color: 'var(--slate)' }}>
      <Icon name="lock" size={13} style={{ color: stale ? 'var(--warn)' : 'var(--muted)' }} />
      <span>{stale
        ? <span>Underwritten on the assumptions from <b>{when}</b>. The Assumptions tab has changed since; this deal keeps its original debt quotes, fees and closing costs.</span>
        : <span>Locked to the assumptions from <b>{when}</b> (current). Later changes on the Assumptions tab won't change this deal.</span>}</span>
      {stale && <button type="button" onClick={() => (armed ? update() : setArmed(true))}
        style={{ marginLeft: 'auto', border: '1px solid ' + (armed ? 'var(--warn)' : 'var(--line-2)'), background: 'var(--panel)', color: armed ? 'var(--warn)' : 'var(--slate)',
          borderRadius: 7, padding: '4px 10px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}>
        {armed ? 'Re-price this deal? Click again' : 'Use current assumptions'}</button>}
    </div>);
}

function FullUnderwritingTab({ deal, set, propView, setPropView, setProperties, excluded, setExcluded, stickyTop, onT12Upload, t12Data }) {
  const isPortfolio = !!deal.isPortfolio && Array.isArray(deal.properties) && deal.properties.length > 1;
  if (isPortfolio) return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <AssumptionLockNote deal={deal} set={set} />
      <PortfolioUWTab deal={deal} set={set} view={propView} setView={setPropView} setProperties={setProperties} excluded={excluded} setExcluded={setExcluded} stickyTop={stickyTop} />
    </div>);
  const m = computeMetrics(deal);
  const uw = computeUW(deal);
  const fromExcel = window.hasExcelReturns ? window.hasExcelReturns(deal) : false;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {fromExcel &&
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '11px 14px', borderRadius: 'var(--radius-lg)',
        background: 'var(--accent-soft)', border: '1px solid var(--line-2)', color: 'var(--slate)', fontSize: 12.5, lineHeight: 1.5 }}>
        <Icon name="calc" size={15} style={{ color: 'var(--accent-2)', flex: 'none', marginTop: 1 }} />
        <span>This deal's reported returns come from the linked Excel model. The Full UW tab below is a screening estimate and is not the source of record for this deal.</span>
      </div>}
      <AssumptionLockNote deal={deal} set={set} />
      <PricingBasis deal={deal} set={set} m={m} />
      <IncomeVacancySection deal={deal} set={set} onT12Upload={onT12Upload} t12Data={t12Data} />
      <AcqFinancingSection deal={deal} set={set} uw={uw} />
      <RefiSection deal={deal} set={set} uw={uw} />
      <AssumptionsSection deal={deal} set={set} uw={uw} />
      <CashFlowTable uw={uw} showReturns={computeUW && window.hasUWInputs ? window.hasUWInputs(deal) : true} />
    </div>
  );
}

/* ───────────── T-12 parsed banner ───────────── */
function T12ParsedSection({ parsed, onAccept }) {
  const [dismissed, setDismissed] = useSU(false);
  if (dismissed) return null;
  const F = [
    { key: 'badDebt', label: 'Bad Debt / Delinquency', patch: (v) => ({ badDebt: Number(v) || 0 }) },
    { key: 'concessions', label: 'Concessions', patch: (v) => ({ concessions: Number(v) || 0 }) },
    { key: 'totalOpex', label: 'Total Operating Expenses', patch: (v) => ({ currentOpexTotal: Number(v) || 0 }) },
    { key: 'effectiveGrossIncome', label: 'Effective Gross Income', patch: (v) => ({ trailingEGI: Number(v) || 0 }) },
    { key: 'otherIncome', label: 'Other Income', patch: (v) => ({ otherIncome: Number(v) || 0 }) },
  ];
  const money = (v) => (v != null && v !== '') ? '$' + Number(v).toLocaleString() : null;
  const found = F.filter((f) => parsed[f.key] != null && parsed[f.key] !== '');
  const missing = F.filter((f) => parsed[f.key] == null || parsed[f.key] === '');
  const applyAll = () => { let p = {}; found.forEach((f) => { p = { ...p, ...f.patch(parsed[f.key]) }; }); onAccept(p); };
  return (
    <BannerShell title="T-12 parsed" sub={'Pulled ' + found.length + ' figure' + (found.length === 1 ? '' : 's') + ' from the trailing-12 statement'}
      canApply={found.length > 0} onApplyAll={applyAll} onDismiss={() => setDismissed(true)}>
      {found.map((f) => <FoundRow key={f.key} label={f.label} display={money(parsed[f.key])} onUse={() => onAccept(f.patch(parsed[f.key]))} />)}
      {missing.map((f) => <MissingRow key={f.key} label={f.label} />)}
    </BannerShell>
  );
}

/* ───────────── Rent Roll parsed banner ───────────── */
function RentRollParsedSection({ parsed, onAccept }) {
  const [dismissed, setDismissed] = useSU(false);
  if (dismissed) return null;
  const money = (v) => (v != null && v !== '') ? '$' + Number(v).toLocaleString() : null;
  const F = [
    { key: 'gprAnnual', label: 'Gross Potential Rent (annual)', disp: money, patch: (v) => ({ gprAnnual: Number(v) || 0 }) },
    { key: 'physVacLoss', label: 'Physical Vacancy Loss (annual)', disp: money, patch: (v) => ({ physVacLoss: Number(v) || 0 }) },
    { key: 'lossToLease', label: 'Loss to Lease (annual)', disp: money, patch: (v) => ({ lossToLease: Number(v) || 0 }) },
    { key: 'units', label: 'Units', disp: (v) => fmtNum(v), patch: (v) => ({ units: Number(v) || 0 }) },
  ];
  const found = F.filter((f) => parsed[f.key] != null && parsed[f.key] !== '');
  const applyAll = () => { let p = {}; found.forEach((f) => { p = { ...p, ...f.patch(parsed[f.key]) }; }); onAccept(p); };
  const vacPct = parsed.totalUnits ? (parsed.vacantUnits / parsed.totalUnits) : null;
  return (
    <BannerShell title="Rent Roll parsed"
      sub={(parsed.totalUnits ? parsed.totalUnits + ' units · ' : '') + (vacPct != null ? (vacPct * 100).toFixed(1) + '% physical vacancy' : '')}
      canApply={found.length > 0} onApplyAll={applyAll} onDismiss={() => setDismissed(true)}>
      {found.map((f) => <FoundRow key={f.key} label={f.label} display={f.disp(parsed[f.key])} onUse={() => onAccept(f.patch(parsed[f.key]))} />)}
    </BannerShell>
  );
}

Object.assign(window, { QuickUnderwritingTab, FullUnderwritingTab, T12ParsedSection, RentRollParsedSection });
