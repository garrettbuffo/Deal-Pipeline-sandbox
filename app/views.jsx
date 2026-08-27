// app/views.jsx — Priority Deals widget + Pipeline Metrics view + Analytics view
const { useState: useStateV, useMemo: useMemoV } = React;

/* ============================ Priority Deals Widget ============================ */
// Ranks active deals by: CFO Date proximity → closeness to guidance → IRR → YOC → vintage → low vacancy
const PRIORITY_ACTIVE_STAGES = ['New Deal', 'Quick UW', 'Full UW', 'Excel UW', 'LOI Submitted', 'Under Contract'];

function _computeDealPriority(deal) {
  const today = new Date(window.ALTUS_TODAY + 'T12:00:00');
  let score = 0;
  let topReason = null;

  // 1. Closest upcoming CFO Date — highest weight
  if (deal.cfoDate) {
    const cfo = new Date(deal.cfoDate + 'T12:00:00');
    const daysUntil = Math.round((cfo - today) / 86400000);
    if (daysUntil >= 0 && daysUntil <= 7)  { score += 1000; topReason = { text: 'CFO in ' + daysUntil + 'd', urgency: 'high' }; }
    else if (daysUntil <= 30)               { score += 800;  topReason = { text: 'CFO in ' + daysUntil + 'd', urgency: 'high' }; }
    else if (daysUntil <= 60)               { score += 500;  topReason = { text: 'CFO in ' + daysUntil + 'd', urgency: 'mid' }; }
    else if (daysUntil <= 90)               { score += 280;  topReason = { text: 'CFO in ' + daysUntil + 'd', urgency: 'mid' }; }
  }

  // 2. Closest to Guidance Price
  if (deal.purchasePrice && deal.askPrice && deal.askPrice > 0) {
    const gap = (deal.askPrice - deal.purchasePrice) / deal.askPrice;
    if (gap >= -0.01 && gap < 0.03)      { score += 400; if (!topReason) topReason = { text: Math.abs(Math.round(gap * 100)) + '% from guidance', urgency: 'high' }; }
    else if (gap >= -0.01 && gap < 0.07) { score += 200; if (!topReason) topReason = { text: Math.round(gap * 100) + '% below ask',    urgency: 'mid' }; }
    else if (gap >= -0.01 && gap < 0.12) { score += 80; }
  }

  // 3. Highest Deal IRR  4. Highest YOC  6. Lowest Economic Vacancy
  // Excel-model returns win when a deal has been underwritten in Excel; otherwise use the
  // Full UW DCF exactly as before.
  if (window.hasExcelReturns && window.hasExcelReturns(deal)) {
    const R = window.dealReturns(deal);
    if (R.irr != null && R.irr > 0) {
      score += R.irr * 300;
      if (!topReason && R.irr >= 0.13)
        topReason = { text: (R.irr * 100).toFixed(1) + '% IRR', urgency: R.irr >= 0.16 ? 'high' : 'mid' };
    }
    if (R.stabYOC != null && R.stabYOC > 0) score += R.stabYOC * 150;
  } else if (window.hasUWInputs && window.hasUWInputs(deal) && window.computeUW) {
    try {
      const uw = window.computeUW(deal);
      if (uw.irr != null && uw.irr > 0) {
        score += uw.irr * 300;
        if (!topReason && uw.irr >= 0.13)
          topReason = { text: (uw.irr * 100).toFixed(1) + '% IRR', urgency: uw.irr >= 0.16 ? 'high' : 'mid' };
      }
      const yocRow = uw.rows && uw.rows[uw.hold];
      if (yocRow && yocRow.yieldOnCost > 0) score += yocRow.yieldOnCost * 150;
      if (uw.inPlaceEconVac != null) score += (1 - uw.inPlaceEconVac) * 30;
    } catch (e) {}
  }

  // 5. Vintage — newer = better
  if (deal.vintage) score += Math.max(0, deal.vintage - 1970) * 0.3;

  return { score, topReason };
}

function _getPriorityLevel(deal, score) {
  const today = new Date(window.ALTUS_TODAY + 'T12:00:00');
  if (deal.cfoDate) {
    const daysUntil = Math.round((new Date(deal.cfoDate + 'T12:00:00') - today) / 86400000);
    if (daysUntil >= 0 && daysUntil <= 30) return 'High';
    if (daysUntil >= 0 && daysUntil <= 90) return 'Medium';
  }
  if (score >= 380) return 'High';
  if (score >= 130) return 'Medium';
  return 'Low';
}

const PRIORITY_META = {
  High:   { color: '#c23a3e', bg: '#fce8e8' },
  Medium: { color: '#b8721a', bg: '#fdf0d8' },
  Low:    { color: '#5b7088', bg: '#eef1f5' },
};

function PriorityDealsWidget({ deals, onOpen, onPatch }) {
  const LS_PRIORITY_LIMIT = 'altus_priority_limit_v1';
  const LS_PRIORITY_COLLAPSED = 'altus_priority_collapsed_v1';
  const [limit, setLimit] = useStateV(() => {
    try { const v = parseInt(localStorage.getItem(LS_PRIORITY_LIMIT)); return [5,7,10].includes(v) ? v : 7; } catch(e) { return 7; }
  });
  const updateLimit = (n) => { setLimit(n); try { localStorage.setItem(LS_PRIORITY_LIMIT, n); } catch(e) {} };
  const [collapsed, setCollapsed] = useStateV(() => {
    try { return localStorage.getItem(LS_PRIORITY_COLLAPSED) === '1'; } catch(e) { return false; }
  });
  const toggleCollapsed = () => { setCollapsed((c) => { const next = !c; try { localStorage.setItem(LS_PRIORITY_COLLAPSED, next ? '1' : '0'); } catch(e) {} return next; }); };

  const rows = useMemoV(() => {
    const pool = deals.filter((d) => d.starred || PRIORITY_ACTIVE_STAGES.includes(d.stage));
    return pool
      .map((d) => { const { score, topReason } = _computeDealPriority(d); return { deal: d, score: score + (d.starred ? 100000 : 0), topReason, level: d.starred ? 'High' : _getPriorityLevel(d, score) }; })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }, [deals, limit]);

  if (!rows.length) return null;

  const today = new Date(window.ALTUS_TODAY + 'T12:00:00');

  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow)', marginBottom: 18, overflow: 'hidden' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 18px', borderBottom: collapsed ? 'none' : '1px solid var(--line)', background: 'var(--panel)' }}>
        <button onClick={toggleCollapsed} style={{ display: 'flex', alignItems: 'center', gap: 9, border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}>
          <span style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--navy)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
            <Icon name="target" size={13} />
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-.01em' }}>Priority Deals</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>Top {rows.length} by urgency &amp; opportunity</span>
          <Icon name={collapsed ? 'chevR' : 'chevD'} size={13} style={{ color: 'var(--faint)' }} />
        </button>
        {!collapsed &&
        <div style={{ display: 'flex', gap: 4 }}>
          {[5, 7, 10].map((n) => (
            <button key={n} onClick={() => updateLimit(n)} style={{
              padding: '3px 9px', fontSize: 11.5, fontWeight: 500, border: '1px solid var(--line-2)', borderRadius: 6,
              background: limit === n ? 'var(--navy)' : 'var(--panel-2)',
              color: limit === n ? '#fff' : 'var(--slate)', cursor: 'pointer', fontFamily: 'var(--font)' }}>
              Top {n}
            </button>
          ))}
        </div>}
      </div>

      {!collapsed && <React.Fragment>
      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: '30px 84px 1fr 120px 160px 124px', padding: '0 18px', background: 'var(--panel-3)', borderBottom: '1px solid var(--line)' }}>
        {['', 'Priority', 'Deal', 'Stage', 'Why Now', 'CFO Date'].map((h, i) => (
          <div key={h+i} style={{ padding: '6px 0', fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)', textAlign: i===5?'right':'left' }}>
            {h}
          </div>
        ))}
      </div>

      {/* Rows */}
      {rows.map(({ deal, level, topReason }, i) => {
        const pm = PRIORITY_META[level];
        const cfoD = deal.cfoDate ? new Date(deal.cfoDate + 'T12:00:00') : null;
        const cfoInDays = cfoD ? Math.round((cfoD - today) / 86400000) : null;
        const hasCFO = cfoInDays != null && cfoInDays >= 0;
        return (
          <div key={deal.id} onClick={() => onOpen(deal.id)}
            style={{ display: 'grid', gridTemplateColumns: '30px 84px 1fr 120px 160px 124px', alignItems: 'center',
              width: '100%', padding: '0 18px', minHeight: 42,
              borderBottom: i < rows.length - 1 ? '1px solid var(--line)' : 'none',
              background: 'transparent', textAlign: 'left', cursor: 'pointer', transition: 'background .1s', fontFamily: 'var(--font)' }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--accent-soft)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>

            {/* Star */}
            <div onClick={(e) => e.stopPropagation()}>
              {onPatch && <StarToggle on={!!deal.starred} onToggle={() => onPatch(deal.id, { starred: !deal.starred })} size={14} />}
            </div>

            {/* Priority badge */}
            <div>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, background: pm.bg, color: pm.color }}>
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: pm.color, flex: 'none' }} />
                {level}
              </span>
            </div>

            {/* Deal name */}
            <div className="clip" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{deal.name}</div>

            {/* Stage */}
            <div><StageBadge stage={deal.stage} dot={false} size="sm" /></div>

            {/* Why Now */}
            <div>
              {topReason ? (
                <span style={{ fontSize: 12, fontWeight: 600, color: topReason.urgency === 'high' ? 'var(--neg)' : topReason.urgency === 'mid' ? 'var(--warn)' : 'var(--muted)' }}>
                  {topReason.text}
                </span>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--faint)' }}>{deal.starred ? 'Starred' : '—'}</span>
              )}
            </div>

            {/* CFO Date */}
            <div style={{ textAlign: 'right' }}>
              {hasCFO ? (
                <span className="num" style={{ fontSize: 12, fontWeight: 600, color: cfoInDays <= 14 ? 'var(--neg)' : cfoInDays <= 30 ? 'var(--warn)' : 'var(--slate)' }}>
                  {fmtDateShort(deal.cfoDate)}
                  <span style={{ fontSize: 10.5, color: 'var(--muted)', marginLeft: 4 }}>({cfoInDays}d)</span>
                </span>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--faint)' }}>—</span>
              )}
            </div>
          </div>
        );
      })}
      </React.Fragment>}
    </div>
  );
}

/* ============================ Stash Widget ============================ */
// Deals parked out of active review (bucket: 'Stash') — collapsible, same pattern as Priority Deals.
function StashWidget({ deals, onOpen, onPatch }) {
  const LS_STASH_COLLAPSED = 'altus_stash_collapsed_v1';
  const [collapsed, setCollapsed] = useStateV(() => {
    try { return localStorage.getItem(LS_STASH_COLLAPSED) !== '0'; } catch(e) { return true; }
  });
  const toggleCollapsed = () => { setCollapsed((c) => { const next = !c; try { localStorage.setItem(LS_STASH_COLLAPSED, next ? '1' : '0'); } catch(e) {} return next; }); };

  const rows = useMemoV(() => deals.filter((d) => d.stage === 'Stash'), [deals]);
  if (!rows.length) return null;

  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow)', marginTop: 22, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 18px', borderBottom: collapsed ? 'none' : '1px solid var(--line)', background: 'var(--panel)' }}>
        <button onClick={toggleCollapsed} style={{ display: 'flex', alignItems: 'center', gap: 9, border: 'none', background: 'none', padding: 0, cursor: 'pointer' }}>
          <span style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--slate)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
            <Icon name="clip" size={13} />
          </span>
          <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-.01em' }}>Stash</span>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>{rows.length} deal{rows.length!==1?'s':''} parked out of active review</span>
          <Icon name={collapsed ? 'chevR' : 'chevD'} size={13} style={{ color: 'var(--faint)' }} />
        </button>
      </div>

      {!collapsed && <React.Fragment>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 130px 130px 140px 90px', padding: '0 18px', background: 'var(--panel-3)', borderBottom: '1px solid var(--line)' }}>
        {['Deal', 'Market', 'Stage', 'Last Activity', ''].map((h, i) => (
          <div key={h+i} style={{ padding: '6px 0', fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)', textAlign: i===4?'right':'left' }}>
            {h}
          </div>
        ))}
      </div>
      {rows.map((deal, i) => (
        <div key={deal.id} onClick={() => onOpen(deal.id)}
          style={{ display: 'grid', gridTemplateColumns: '1fr 130px 130px 140px 90px', alignItems: 'center',
            width: '100%', padding: '0 18px', minHeight: 42,
            borderBottom: i < rows.length - 1 ? '1px solid var(--line)' : 'none',
            cursor: 'pointer', transition: 'background .1s', fontFamily: 'var(--font)' }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--accent-soft)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
          <div className="clip" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{deal.name}</div>
          <div className="clip" style={{ fontSize: 12.5, color: 'var(--slate)' }}>{deal.market || '—'}</div>
          <div><StageBadge stage={deal.stage} dot={false} size="sm" /></div>
          <div className="num" style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtRelative(lastActivityOf(deal)) || '—'}</div>
          <div style={{ textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
            {onPatch && <button onClick={() => onPatch(deal.id, { stage: 'New Deal' })}
              style={{ border: '1px solid var(--line-2)', background: 'var(--panel)', borderRadius: 6, padding: '3px 9px',
                fontSize: 11, fontWeight: 600, color: 'var(--slate)', cursor: 'pointer', fontFamily: 'var(--font)' }}>
              Unstash
            </button>}
          </div>
        </div>
      ))}
      </React.Fragment>}
    </div>
  );
}

const RANGES = [
  { value:30,  label:'30 days' },
  { value:90,  label:'90 days' },
  { value:365, label:'365 days' },
  { value:99999, label:'All time' },
];

function inWindow(dateStr, days, endOffsetDays=0){
  if(!dateStr) return false;
  const t = parseD(dateStr).getTime();
  const end = TODAY.getTime() - endOffsetDays*DAY;
  const start = end - days*DAY;
  return t > start && t <= end;
}
const WON = ['Under Contract'];

function windowMetrics(deals, days, endOffsetDays=0){
  const entered = deals.filter(d=> inWindow(d.dateEntered, days, endOffsetDays));
  const loiSub = deals.filter(d=> inWindow(d.dateLOISubmitted, days, endOffsetDays));
  const loiSubOnMarket = loiSub.filter(d=> !d.offMarket);
  const loiSubOffMarket = loiSub.filter(d=> d.offMarket);
  const loiWon = deals.filter(d=> WON.includes(d.stage) && inWindow(d.dateUnderContract, days, endOffsetDays));
  const loiLost = deals.filter(d=> d.stage==='LOI Lost' && inWindow(d.dateLost, days, endOffsetDays));
  const offMarket = entered.filter(d=> d.offMarket);
  const onMarket = entered.filter(d=> !d.offMarket);
  const loiWonOffMarket = loiWon.filter(d=> d.offMarket);
  const loiWonOnMarket = loiWon.filter(d=> !d.offMarket);
  const sum = (arr,f)=> arr.reduce((s,d)=>s+(f(d)||0),0);
  const uwPrice = (d)=> Array.isArray(d.properties) && d.isPortfolio && d.properties.length>1
    ? d.properties.reduce((s,p)=>s+(Number(p.purchasePrice)||0),0)
    : (Number(d.purchasePrice)||0);
  return {
    entered: entered.length,
    dollarEntered: sum(entered, uwPrice),
    onMarket: onMarket.length,
    loiSubmitted: loiSub.length,
    loiSubmittedOnMarket: loiSubOnMarket.length,
    loiSubmittedOffMarket: loiSubOffMarket.length,
    loiWon: loiWon.length,
    loiWonOffMarket: loiWonOffMarket.length,
    loiWonOnMarket: loiWonOnMarket.length,
    loiLost: loiLost.length,
    offMarket: offMarket.length,
    dollarSubmitted: sum(loiSub, d=> d.loiAmount || d.purchasePrice),
    dollarWon: sum(loiWon, d=> d.loiAmount || d.purchasePrice),
    convRate: loiSub.length ? loiWon.length / loiSub.length : 0,
  };
}

/* --- Metrics tab: calendar-period toggle (This Month/Quarter/Year), distinct from the trailing-window RANGES above --- */
const PERIODS = [
  { value:'month',   label:'This Month' },
  { value:'quarter', label:'This Quarter' },
  { value:'year',    label:'This Year' },
  { value:'all',     label:'All time' },
];
// Underwritten price for a deal (portfolio-aware) — the "UW Price" total.
const uwPriceOf = (d)=> Array.isArray(d.properties) && d.isPortfolio && d.properties.length>1
  ? d.properties.reduce((s,p)=>s+(Number(p.purchasePrice)||0),0)
  : (Number(d.purchasePrice)||0);
// Current + previous calendar-period bounds, anchored to the app's TODAY.
function periodBounds(period){
  const y = TODAY.getFullYear(), m = TODAY.getMonth();
  const end = new Date(TODAY.getTime() + DAY); // through end of today
  if(period==='month')   return { start:new Date(y,m,1), end, prevStart:new Date(y,m-1,1), prevEnd:new Date(y,m,1) };
  if(period==='quarter'){ const q=Math.floor(m/3)*3;
                          return { start:new Date(y,q,1), end, prevStart:new Date(y,q-3,1), prevEnd:new Date(y,q,1) }; }
  if(period==='year')    return { start:new Date(y,0,1), end, prevStart:new Date(y-1,0,1), prevEnd:new Date(y,0,1) };
  return { start:null, end:null, prevStart:null, prevEnd:null }; // all time
}
function inRange(dateStr, start, end){
  if(!dateStr || !start || !end) return false;
  const t = parseD(dateStr).getTime();
  return t >= start.getTime() && t < end.getTime();
}
// Same shape as windowMetrics(), but over an explicit [start,end) calendar range. null start = all time (no date filter).
function rangeMetrics(deals, start, end){
  const inR = (ds)=> !start ? !!ds : inRange(ds, start, end);
  const entered = deals.filter(d=> inR(d.dateEntered));
  const loiSub = deals.filter(d=> inR(d.dateLOISubmitted));
  const loiSubOnMarket = loiSub.filter(d=> !d.offMarket);
  const loiSubOffMarket = loiSub.filter(d=> d.offMarket);
  const loiWon = deals.filter(d=> WON.includes(d.stage) && inR(d.dateUnderContract));
  const loiLost = deals.filter(d=> d.stage==='LOI Lost' && inR(d.dateLost));
  const offMarket = entered.filter(d=> d.offMarket);
  const onMarket = entered.filter(d=> !d.offMarket);
  const loiWonOffMarket = loiWon.filter(d=> d.offMarket);
  const loiWonOnMarket = loiWon.filter(d=> !d.offMarket);
  const sum = (arr,f)=> arr.reduce((s,d)=>s+(f(d)||0),0);
  return {
    entered: entered.length,
    dollarEntered: sum(entered, uwPriceOf),
    onMarket: onMarket.length,
    loiSubmitted: loiSub.length,
    loiSubmittedOnMarket: loiSubOnMarket.length,
    loiSubmittedOffMarket: loiSubOffMarket.length,
    loiWon: loiWon.length,
    loiWonOffMarket: loiWonOffMarket.length,
    loiWonOnMarket: loiWonOnMarket.length,
    loiLost: loiLost.length,
    offMarket: offMarket.length,
    dollarSubmitted: sum(loiSub, d=> d.loiAmount || d.purchasePrice),
    dollarWon: sum(loiWon, d=> d.loiAmount || d.purchasePrice),
    convRate: loiSub.length ? loiWon.length / loiSub.length : 0,
  };
}

function MetricsView({ deals, allDeals, onOpen }){
  const [period, setPeriod] = useStateV('year');
  const b = useMemoV(()=> periodBounds(period), [period]);
  const isAll = period==='all';
  const cur = useMemoV(()=> rangeMetrics(deals, b.start, b.end), [deals, b]);
  const prev = useMemoV(()=> rangeMetrics(deals, b.prevStart, b.prevEnd), [deals, b]);
  const d = (a,bb)=> isAll ? null : (a-bb);
  const periodLabel = PERIODS.find(r=>r.value===period).label;

  // Three mutually-exclusive status buckets over the selected period; uses ALL deals so dead deals are counted.
  const src = allDeals || deals;
  const cats = useMemoV(()=>{
    const inP = isAll ? src : src.filter(dl=> inRange(dl.dateEntered, b.start, b.end));
    const build = (arr)=> ({ n: arr.length, dollars: arr.reduce((s,dl)=>s+uwPriceOf(dl),0) });
    return {
      pipeline: build(inP.filter(dl=> isPipelineStage(dl.stage))),
      loi:      build(inP.filter(dl=> isLOIStage(dl.stage))),
      dead:     build(inP.filter(dl=> dl.stage==='Dead')),
    };
  }, [src, b, isAll]);

  // funnel steps
  const funnel = [
    { label:'Entered Pipeline', value:cur.entered,      color:'#6b7a8d' },
    { label:'LOI Submitted',    value:cur.loiSubmitted, color:'#bd7a16' },
    { label:'Won / Under Contract', value:cur.loiWon,   color:'#0f8a4d' },
  ];
  const fmax = Math.max(...funnel.map(f=>f.value), 1);

  // recent LOI activity list
  const loiActivity = deals
    .filter(dl=> dl.dateLOISubmitted && (isAll || inRange(dl.dateLOISubmitted, b.start, b.end)))
    .sort((a,bb)=> bb.dateLOISubmitted.localeCompare(a.dateLOISubmitted));

  // metro leaderboard — where are we actually submitting LOIs?
  const metroRank = useMemoV(()=>{
    const map = {};
    loiActivity.forEach(dl=>{ const mkt=dl.market||'Unspecified'; map[mkt]=(map[mkt]||0)+1; });
    return Object.entries(map).sort((a,b)=>b[1]-a[1]);
  }, [loiActivity]);
  const metroMax = Math.max(...metroRank.map(([,c])=>c), 1);

  return (
    <div className="fade" style={{ padding:'24px 30px 60px', maxWidth:1280, margin:'0 auto' }}>
      <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ margin:0, fontSize:21, fontWeight:700, color:'var(--ink)' }}>Pipeline Metrics</h2>
          <p style={{ margin:'4px 0 0', fontSize:13.5, color:'var(--muted)' }}>
            Activity & dollar volume — {isAll ? 'all time' : periodLabel} as of {fmtDate(window.ALTUS_TODAY)}.
          </p>
        </div>
        <Seg value={period} onChange={setPeriod} options={PERIODS}/>
      </div>

      {/* Deal activity by status — count + underwritten price per bucket (dead deals included) */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:14, marginBottom:16 }}>
        {[
          { label:'Deals in Pipeline', color:'#2f6df0', data:cats.pipeline, hint:'New Deal · Full UW · Excel UW' },
          { label:'Deals at LOI',      color:'#b87214', data:cats.loi,      hint:'LOI Submitted · Under Contract · Purchased · Lost' },
          { label:'Dead Deals',        color:'#8c7460', data:cats.dead,     hint:'Marked dead' },
        ].map(c=>(
          <div key={c.label} style={{ background:'var(--panel)', border:'1px solid var(--line)', borderLeft:'3px solid '+c.color,
            borderRadius:'var(--radius-lg)', padding:'16px 18px', boxShadow:'var(--shadow)' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span style={{ fontSize:12.5, fontWeight:700, color:c.color, textTransform:'uppercase', letterSpacing:'.02em' }}>{c.label}</span>
              <span className="num" style={{ fontSize:26, fontWeight:700, color:'var(--ink)' }}>{fmtNum(c.data.n)}</span>
            </div>
            <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', marginTop:10 }}>
              <span style={{ fontSize:11.5, color:'var(--muted)' }}>Underwritten price</span>
              <span className="num" style={{ fontSize:18, fontWeight:700, color:c.color }}>{fmtShort(c.data.dollars)}</span>
            </div>
            <div style={{ fontSize:11, color:'var(--faint)', marginTop:8 }}>{c.hint}</div>
          </div>
        ))}
      </div>

      {/* activity KPIs */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:14 }}>
        <Kpi label="On-Market Deals" value={fmtNum(cur.onMarket)} icon="plus" accent="#6b7a8d"
             delta={d(cur.onMarket,prev.onMarket)} sub={cur.entered ? fmtPct(cur.onMarket/cur.entered,0)+' of entered' : (isAll?'in pipeline':'vs prior '+periodLabel)}/>
        <Kpi label="Off-Market Deals" value={fmtNum(cur.offMarket)} icon="lock" accent="var(--warn)"
             delta={d(cur.offMarket,prev.offMarket)} sub={cur.entered ? fmtPct(cur.offMarket/cur.entered,0)+' of entered' : 'sourced directly'}/>
        <Kpi label="Total UW Price" value={fmtShort(cur.dollarEntered)} icon="dollar" accent="var(--ink)"
             sub={fmtNum(cur.entered)+' deals entered'}/>
        <Kpi label="LOIs Submitted" value={fmtNum(cur.loiSubmitted)} icon="flag" accent="#bd7a16"
             delta={d(cur.loiSubmitted,prev.loiSubmitted)} sub={
               <span style={{ display:'flex', gap:6 }}>
                 <span className="num" style={{ fontSize:12, fontWeight:700, color:'#6b7a8d', background:'#eef1f5', padding:'2px 7px', borderRadius:999 }}>{cur.loiSubmittedOnMarket} on-market</span>
                 <span className="num" style={{ fontSize:12, fontWeight:700, color:'var(--warn)', background:'var(--warn-soft)', padding:'2px 7px', borderRadius:999 }}>{cur.loiSubmittedOffMarket} off-market</span>
               </span>
             }/>
        <Kpi label="LOIs Won" value={fmtNum(cur.loiWon)} icon="check" accent="#0f8a4d"
             delta={d(cur.loiWon,prev.loiWon)} sub={
               <span style={{ display:'flex', gap:6 }}>
                 <span className="num" style={{ fontSize:12, fontWeight:700, color:'#6b7a8d', background:'#eef1f5', padding:'2px 7px', borderRadius:999 }}>{cur.loiWonOnMarket} on-market</span>
                 <span className="num" style={{ fontSize:12, fontWeight:700, color:'var(--warn)', background:'var(--warn-soft)', padding:'2px 7px', borderRadius:999 }}>{cur.loiWonOffMarket} off-market</span>
               </span>
             }/>
      </div>

      {/* dollar volume + conversion */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1.1fr', gap:14, marginTop:14 }}>
        <Kpi label="LOI $ Submitted" value={fmtShort(cur.dollarSubmitted)} icon="dollar" accent="#bd7a16"
             sub={fmtNum(cur.loiSubmitted)+' LOIs'}/>
        <Kpi label="LOI $ Won" value={fmtShort(cur.dollarWon)} icon="dollar" accent="#0f8a4d"
             sub={fmtNum(cur.loiWon)+' under contract'}/>
        <div style={{ background:'var(--navy)', borderRadius:'var(--radius-lg)', padding:'16px 20px', color:'#fff',
          display:'flex', alignItems:'center', justifyContent:'space-between', boxShadow:'var(--shadow)' }}>
          <div>
            <div style={{ fontSize:12, color:'#9fb4cf', fontWeight:600, textTransform:'uppercase', letterSpacing:'.02em' }}>LOI Conversion</div>
            <div className="num" style={{ fontSize:30, fontWeight:700, marginTop:6 }}>{fmtPct(cur.convRate,0)}</div>
            <div style={{ fontSize:12, color:'#9fb4cf', marginTop:4 }}>{cur.loiWon} won of {cur.loiSubmitted} submitted · {cur.loiLost} lost</div>
          </div>
          <Donut size={92} thickness={14} segments={[
            { value:cur.loiWon, color:'#39d98a' },
            { value:cur.loiLost, color:'#ff6b6e' },
            { value:Math.max(0,cur.loiSubmitted-cur.loiWon-cur.loiLost), color:'#3a5878' },
          ]} center={<span className="num" style={{ fontSize:14, fontWeight:700, color:'#fff' }}>{cur.loiSubmitted}</span>}/>
        </div>
      </div>

      {/* funnel */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr', gap:16, marginTop:16, alignItems:'start' }}>
        <Card title="Conversion Funnel" right={<span style={{ fontSize:12, color:'var(--muted)' }}>{isAll?'all time':periodLabel}</span>}>
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            {funnel.map((f,i)=>{
              const prevVal = i>0 ? funnel[i-1].value : null;
              const stepRate = prevVal ? f.value/prevVal : null;
              return (
                <div key={f.label}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:6 }}>
                    <span style={{ fontSize:13, fontWeight:600, color:'var(--ink)' }}>{f.label}</span>
                    <span style={{ display:'flex', gap:10, alignItems:'baseline' }}>
                      {stepRate!=null && <span className="num" style={{ fontSize:11.5, color:'var(--muted)' }}>{fmtPct(stepRate,0)} ↓</span>}
                      <span className="num" style={{ fontSize:16, fontWeight:700, color:f.color }}>{f.value}</span>
                    </span>
                  </div>
                  <Bar value={f.value} max={fmax} color={f.color} height={10}/>
                </div>
              );
            })}
            <div style={{ display:'flex', justifyContent:'space-between', paddingTop:12, borderTop:'1px solid var(--line)', fontSize:12.5 }}>
              <span style={{ color:'var(--muted)' }}>LOIs lost in period</span>
              <span className="num" style={{ fontWeight:700, color:'var(--neg)' }}>{cur.loiLost}</span>
            </div>
          </div>
        </Card>

        <Card title="LOIs by Metro" right={<span style={{ fontSize:12, color:'var(--muted)' }}>{loiActivity.length} in range</span>}>
          {metroRank.length===0 ? (
            <div style={{ padding:'40px 18px', textAlign:'center', color:'var(--muted)', fontSize:13 }}>No LOI activity in this window.</div>
          ) : (
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px, 1fr))', gap:14 }}>
              {metroRank.map(([mkt,count])=>(
                <div key={mkt} style={{ border:'1px solid var(--line)', borderRadius:10, padding:'12px 14px',
                  display:'flex', alignItems:'baseline', justifyContent:'space-between' }}>
                  <span className="clip" style={{ fontSize:14, fontWeight:600, color:'var(--ink)' }}>{mkt}</span>
                  <span className="num" style={{ fontSize:18, fontWeight:700, color:'var(--slate)' }}>{count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ============================ Broker Calls ============================ */
// Every logged broker call across all deals — grouped by date, then by metro, exportable to Excel for GHL.
const LS_STANDALONE_CALLS = 'altus_standalone_calls_v1';
function loadStandaloneCalls(){
  try { const s = JSON.parse(localStorage.getItem(LS_STANDALONE_CALLS)); if (Array.isArray(s)) return s; } catch(e) {}
  return [];
}

const NEWCALL_INPUT = { border:'1px solid var(--line-2)', borderRadius:7, padding:'0 10px', height:34,
  background:'var(--panel)', fontSize:12.5, color:'var(--ink)', fontFamily:'var(--font)', width:'100%', boxSizing:'border-box' };

function NewCallField({ label, value, placeholder, onChange, flex }){
  return (
    <div style={{ flex:flex||1, minWidth:150 }}>
      <div style={{ fontSize:10, fontWeight:700, letterSpacing:'.05em', textTransform:'uppercase', color:'var(--muted)', marginBottom:4 }}>{label}</div>
      <input value={value} placeholder={placeholder} onChange={(ev) => onChange(ev.target.value)} style={NEWCALL_INPUT}/>
    </div>
  );
}

function NewCallForm({ draft, setDraft, onSave, onCancel }){
  const upd = (k) => (v) => setDraft((d) => ({ ...d, [k]:v }));
  return (
    <Card>
      <div style={{ fontSize:11, fontWeight:700, letterSpacing:'.07em', textTransform:'uppercase', color:'var(--ink)', marginBottom:12 }}>
        New Broker Call <span style={{ fontWeight:400, textTransform:'none', letterSpacing:0, color:'var(--muted)' }}>— not attached to a deal</span>
      </div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:10, marginBottom:10 }}>
        <NewCallField label="Broker Name" value={draft.brokerName} onChange={upd('brokerName')} placeholder="Broker name…"/>
        <NewCallField label="Brokerage / Firm" value={draft.brokerFirm} onChange={upd('brokerFirm')} placeholder="Brokerage / firm…"/>
        <NewCallField label="Metro" value={draft.market} onChange={upd('market')} placeholder="e.g. Dallas, TX"/>
        <NewCallField label="Property (optional)" value={draft.propertyName} onChange={upd('propertyName')} placeholder="Property or portfolio…"/>
      </div>
      <div style={{ display:'flex', gap:10, alignItems:'flex-end', flexWrap:'wrap' }}>
        <NewCallField label="Note" value={draft.note} onChange={upd('note')} flex={3} placeholder="What did they say? Pricing guidance, timeline, feedback…"/>
        <button onClick={onSave}
          style={{ height:34, padding:'0 18px', border:'none', borderRadius:7, background:'var(--accent)', color:'#fff',
            fontSize:12.5, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>Save call</button>
        <button onClick={onCancel}
          style={{ height:34, padding:'0 14px', border:'1px solid var(--line-2)', borderRadius:7, background:'var(--panel)',
            color:'var(--slate)', fontSize:12.5, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>Cancel</button>
      </div>
    </Card>
  );
}

function BrokerCallsView({ deals, onOpen }){
  const [days, setDays] = useStateV(99999);
  const [standalone, setStandalone] = useStateV(loadStandaloneCalls);
  const [adding, setAdding] = useStateV(false);
  const [draft, setDraft] = useStateV({ brokerName:'', brokerFirm:'', market:'', propertyName:'', note:'' });

  React.useEffect(() => {
    try { localStorage.setItem(LS_STANDALONE_CALLS, JSON.stringify(standalone)); } catch(e) {}
  }, [standalone]);

  const saveDraft = () => {
    if (!draft.brokerName.trim() && !draft.note.trim()) return;
    setStandalone((s) => [{ id:'scall_'+Date.now().toString(36), ts:new Date().toISOString(),
      brokerName:draft.brokerName.trim(), brokerFirm:draft.brokerFirm.trim(),
      market:draft.market.trim(), propertyName:draft.propertyName.trim(), note:draft.note.trim() }, ...s]);
    setDraft({ brokerName:'', brokerFirm:'', market:'', propertyName:'', note:'' });
    setAdding(false);
  };
  const removeStandalone = (id) => setStandalone((s) => s.filter((e) => e.id !== id));

  const allCalls = useMemoV(() => {
    const flat = [];
    deals.forEach((d) => (Array.isArray(d.callLog) ? d.callLog : []).forEach((e) => {
      flat.push({ ...e, dealId: d.id, dealName: d.name, market: d.market || 'Unspecified' });
    }));
    standalone.forEach((e) => flat.push({ ...e, dealId: null,
      dealName: e.propertyName || 'No deal attached', market: e.market || 'Unspecified' }));
    return flat.sort((a,b) => (b.ts||'').localeCompare(a.ts||''));
  }, [deals, standalone]);

  const isAll = days === 99999;
  const cutoff = TODAY.getTime() - days*DAY;
  const inRange = useMemoV(() => isAll ? allCalls : allCalls.filter((e) => e.ts && new Date(e.ts).getTime() >= cutoff), [allCalls, days]);

  // group by day, then by metro within each day
  const grouped = useMemoV(() => {
    const byDay = {};
    inRange.forEach((e) => {
      const dayKey = e.ts ? new Date(e.ts).toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' }) : 'Unknown Date';
      byDay[dayKey] = byDay[dayKey] || { sortTs: e.ts, byMetro: {} };
      byDay[dayKey].byMetro[e.market] = byDay[dayKey].byMetro[e.market] || [];
      byDay[dayKey].byMetro[e.market].push(e);
    });
    return Object.entries(byDay).sort((a,b) => (b[1].sortTs||'').localeCompare(a[1].sortTs||''));
  }, [inRange]);

  const exportRows = (rows) => rows.map((e) => {
    const parts = (e.brokerName || '').trim().split(/\s+/);
    return {
      'First Name': parts[0] || '',
      'Last Name': parts.slice(1).join(' ') || '',
      'Email': e.brokerEmail || '',
      'Phone': e.brokerPhone || '',
      'Company Name': e.brokerFirm || '',
      'Property Name': e.dealName || '',
      'Metro': e.market || '',
      'Notes': e.note || '',
      'Call Date': e.ts ? new Date(e.ts).toLocaleDateString() : '',
    };
  });

  const doExport = (rows, filename) => {
    window.downloadCSV(exportRows(rows), filename);
  };

  return (
    <div className="fade" style={{ padding:'24px 30px 60px', maxWidth:1280, margin:'0 auto' }}>
      <div style={{ display:'flex', alignItems:'flex-end', justifyContent:'space-between', marginBottom:20, flexWrap:'wrap', gap:12 }}>
        <div>
          <h2 style={{ margin:0, fontSize:21, fontWeight:700, color:'var(--ink)' }}>Broker Calls</h2>
          <p style={{ margin:'4px 0 0', fontSize:13.5, color:'var(--muted)' }}>{inRange.length} logged call{inRange.length!==1?'s':''} across all deals</p>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8, flexWrap:'wrap' }}>
          <button onClick={() => setAdding((v) => !v)}
            style={{ display:'inline-flex', alignItems:'center', gap:6, height:36, padding:'0 14px', border:'none',
              borderRadius:8, background:'var(--navy)', color:'#fff', fontSize:12.5, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>
            <Icon name="plus" size={13}/> Log a call
          </button>
          <Seg value={days} onChange={setDays} options={RANGES}/>
          <button onClick={() => doExport(inRange, 'broker_calls_' + (isAll?'all':days+'d') + '.csv')} disabled={!inRange.length}
            style={{ display:'inline-flex', alignItems:'center', gap:6, height:36, padding:'0 14px', border:'1px solid var(--line-2)',
              borderRadius:8, background:'var(--panel)', fontSize:12.5, fontWeight:600,
              color:inRange.length?'var(--slate)':'var(--faint)', cursor:inRange.length?'pointer':'default' }}>
            <Icon name="download" size={13}/> Export {isAll?'All':'Range'}
          </button>
          {!isAll && <button onClick={() => doExport(allCalls, 'broker_calls_all.csv')} disabled={!allCalls.length}
            style={{ display:'inline-flex', alignItems:'center', gap:6, height:36, padding:'0 14px', border:'1px solid var(--line-2)',
              borderRadius:8, background:'var(--panel)', fontSize:12.5, fontWeight:600,
              color:allCalls.length?'var(--slate)':'var(--faint)', cursor:allCalls.length?'pointer':'default' }}>
            <Icon name="download" size={13}/> Export All
          </button>}
        </div>
      </div>

      {adding && <NewCallForm draft={draft} setDraft={setDraft} onSave={saveDraft} onCancel={() => setAdding(false)} />}

      <div style={{ height: adding ? 16 : 0 }} />

      {grouped.length === 0 ? (
        <div style={{ padding:'60px 20px', textAlign:'center', color:'var(--muted)', background:'var(--panel)',
          border:'1px solid var(--line)', borderRadius:'var(--radius-lg)' }}>
          <div style={{ fontSize:14, fontWeight:500, color:'var(--ink)' }}>No broker calls logged in this window.</div>
          <div style={{ fontSize:12.5, marginTop:4 }}>Log calls from a deal's Summary tab and they'll show up here.</div>
        </div>
      ) : grouped.map(([dayKey, { byMetro }]) => {
        const metros = Object.entries(byMetro).sort((a,b) => b[1].length - a[1].length);
        const dayTotal = metros.reduce((s,[,rows]) => s+rows.length, 0);
        return (
          <div key={dayKey} style={{ marginBottom:22 }}>
            <div style={{ display:'flex', alignItems:'baseline', gap:10, marginBottom:10 }}>
              <span style={{ fontSize:15, fontWeight:700, color:'var(--ink)' }}>{dayKey}</span>
              <span className="num" style={{ fontSize:12, fontWeight:600, color:'var(--muted)' }}>{dayTotal} call{dayTotal!==1?'s':''}</span>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {metros.map(([metro, rows]) => (
                <Card key={metro} title={metro} pad={false} right={<span style={{ fontSize:12, color:'var(--muted)' }}>{rows.length} call{rows.length!==1?'s':''}</span>}>
                  {rows.map((e,i) => (
                    <div key={e.id} onClick={() => { if (e.dealId) onOpen(e.dealId); }} style={{ display:'grid', gridTemplateColumns:'80px 1fr 1fr auto', gap:12,
                      padding:'11px 18px', cursor:e.dealId?'pointer':'default', borderBottom: i<rows.length-1 ? '1px solid var(--line)' : 'none' }}
                      onMouseEnter={(ev) => ev.currentTarget.style.background='var(--panel-2)'}
                      onMouseLeave={(ev) => ev.currentTarget.style.background='transparent'}>
                      <div className="num" style={{ fontSize:11.5, color:'var(--muted)' }}>
                        {e.ts ? new Date(e.ts).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) : '—'}
                      </div>
                      <div className="clip" style={{ fontSize:13, fontWeight:600, color:e.dealId?'var(--ink)':'var(--muted)', fontStyle:e.dealId?'normal':'italic' }}>{e.dealName}</div>
                      <div>
                        <span style={{ fontSize:12.5, fontWeight:600, color:'var(--ink)' }}>{e.brokerName || 'Unknown broker'}</span>
                        {e.brokerFirm && <span style={{ fontSize:12, color:'var(--muted)' }}> — {e.brokerFirm}</span>}
                        {e.note && <div className="clip" style={{ fontSize:12, color:'var(--slate)', marginTop:1 }}>{e.note}</div>}
                      </div>
                      <div>
                        {!e.dealId && <button onClick={(ev) => { ev.stopPropagation(); removeStandalone(e.id); }}
                          title="Delete call"
                          style={{ border:'1px solid var(--line-2)', borderRadius:6, background:'var(--panel)', color:'var(--faint)',
                            height:24, padding:'0 8px', fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'var(--font)' }}>Delete</button>}
                      </div>
                    </div>
                  ))}
                </Card>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ============================ Analytics ============================ */
function AnalyticsView({ deals, onOpen }){
  const active = deals.filter(d=> d.stage!=='Pass' && d.stage!=='LOI Lost');
  // by type
  const byType = {};
  active.forEach(d=>{ byType[d.type]=(byType[d.type]||0)+1; });
  const typeSegs = Object.entries(byType).sort((a,b)=>b[1]-a[1]).map(([k,v])=>({ label:k, value:v, color:TYPE_META[k]||'#9eabb9' }));
  // by stage
  const byStage = {};
  STAGE_ALL.forEach(s=> byStage[s]=deals.filter(d=>d.stage===s).length);
  const stageMax = Math.max(...Object.values(byStage),1);
  // cap rate distribution buckets (going-in)
  const caps = active.map(d=> computeMetrics(d).goingInCap).filter(c=>c>0 && c<0.15);
  const buckets = [[0,.04],[.04,.045],[.045,.05],[.05,.055],[.055,.06],[.06,.2]];
  const bucketLabels = ['<4.0','4.0–4.5','4.5–5.0','5.0–5.5','5.5–6.0','6.0+'];
  const capDist = buckets.map(([lo,hi])=> caps.filter(c=> c>=lo && c<hi).length);
  const capMax = Math.max(...capDist,1);
  // $ by type
  const dollarByType = {};
  active.forEach(d=>{ dollarByType[d.type]=(dollarByType[d.type]||0)+(d.purchasePrice||0); });
  const totalDollar = Object.values(dollarByType).reduce((a,b)=>a+b,0);
  const avgGoingIn = caps.length ? caps.reduce((a,b)=>a+b,0)/caps.length : 0;

  return (
    <div className="fade" style={{ padding:'24px 30px 60px', maxWidth:1280, margin:'0 auto' }}>
      <div style={{ marginBottom:20 }}>
        <h2 style={{ margin:0, fontSize:21, fontWeight:700, color:'var(--ink)' }}>Analytics</h2>
        <p style={{ margin:'4px 0 0', fontSize:13.5, color:'var(--muted)' }}>Composition of the active pipeline — {active.length} live deals, {fmtShort(totalDollar)} in purchase value.</p>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, alignItems:'start' }}>
        <Card title="Active Pipeline by Product Type">
          <div style={{ display:'flex', alignItems:'center', gap:26 }}>
            <Donut size={150} thickness={22} segments={typeSegs}
              center={<><span className="num" style={{ fontSize:24, fontWeight:700, color:'var(--ink)' }}>{active.length}</span><span style={{ fontSize:11, color:'var(--muted)' }}>deals</span></>}/>
            <div style={{ flex:1, display:'flex', flexDirection:'column', gap:9 }}>
              {typeSegs.map(s=>(
                <div key={s.label} style={{ display:'flex', alignItems:'center', gap:9 }}>
                  <span style={{ width:9, height:9, borderRadius:2, background:s.color, flex:'none' }}/>
                  <span style={{ fontSize:13, color:'var(--slate)', flex:1 }}>{s.label}</span>
                  <span className="num" style={{ fontSize:13, fontWeight:600, color:'var(--ink)' }}>{s.value}</span>
                  <span className="num" style={{ fontSize:12, color:'var(--muted)', width:42, textAlign:'right' }}>{fmtPct(s.value/active.length,0)}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card title="Deals by Stage">
          <div style={{ display:'flex', flexDirection:'column', gap:13 }}>
            {STAGE_ALL.map(s=>(
              <div key={s}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
                  <span style={{ display:'flex', alignItems:'center', gap:7, fontSize:12.5, color:'var(--slate)', fontWeight:500 }}>
                    <span style={{ width:8, height:8, borderRadius:2, background:STAGE_META[s].c }}/>{s}</span>
                  <span className="num" style={{ fontSize:13, fontWeight:600, color:'var(--ink)' }}>{byStage[s]}</span>
                </div>
                <Bar value={byStage[s]} max={stageMax} color={STAGE_META[s].c} height={8}/>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Going-In Cap Rate Distribution" right={<span className="num" style={{ fontSize:12.5, color:'var(--muted)' }}>avg {fmtPct(avgGoingIn)}</span>}>
          <div style={{ display:'flex', alignItems:'flex-end', gap:10, height:170, padding:'8px 4px 0' }}>
            {capDist.map((v,i)=>(
              <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:7, height:'100%', justifyContent:'flex-end' }}>
                <span className="num" style={{ fontSize:12, fontWeight:600, color:'var(--ink)' }}>{v||''}</span>
                <div style={{ width:'100%', height:(v/capMax)*120+4, background:'linear-gradient(180deg,#5b8bf5,#2f6df0)', borderRadius:'5px 5px 0 0', transition:'height .5s' }}/>
                <span className="num" style={{ fontSize:10.5, color:'var(--muted)' }}>{bucketLabels[i]}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Purchase Value by Product Type">
          <div style={{ display:'flex', flexDirection:'column', gap:13 }}>
            {Object.entries(dollarByType).sort((a,b)=>b[1]-a[1]).map(([k,v])=>(
              <div key={k}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
                  <span style={{ display:'flex', alignItems:'center', gap:7, fontSize:12.5, color:'var(--slate)', fontWeight:500 }}>
                    <span style={{ width:8, height:8, borderRadius:2, background:TYPE_META[k]||'#9eabb9' }}/>{k}</span>
                  <span className="num" style={{ fontSize:13, fontWeight:600, color:'var(--ink)' }}>{fmtShort(v)}</span>
                </div>
                <Bar value={v} max={totalDollar} color={TYPE_META[k]||'#9eabb9'} height={8}/>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

Object.assign(window, { MetricsView, AnalyticsView, PriorityDealsWidget, StashWidget, BrokerCallsView, windowMetrics, inWindow, RANGES });
