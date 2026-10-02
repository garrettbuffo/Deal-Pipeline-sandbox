// app/components.jsx — formatters, config, metric math, shared UI primitives
const { useState, useEffect, useRef, useMemo, useCallback } = React;

/* ============================ Formatters ============================ */
const TODAY = new Date(window.ALTUS_TODAY + 'T12:00:00');
const DAY = 86400000;
function parseD(s){ return s ? new Date(s + 'T12:00:00') : null; }
function daysAgo(s){ const d = parseD(s); return d ? Math.round((TODAY - d) / DAY) : null; }
function fmtMoney(n){ if(n==null||isNaN(n)) return '—'; return '$' + Math.round(n).toLocaleString('en-US'); }
function fmtShort(n){
  if(n==null||isNaN(n)) return '—';
  const a = Math.abs(n);
  if(a >= 1e9) return '$' + (n/1e9).toFixed(a>=1e10?1:2).replace(/\.0+$/,'') + 'B';
  if(a >= 1e6) return '$' + (n/1e6).toFixed(a>=1e7?1:2).replace(/\.?0+$/,'') + 'M';
  if(a >= 1e3) return '$' + Math.round(n/1e3) + 'K';
  return '$' + Math.round(n);
}
function fmtPct(n, d=2){ if(n==null||isNaN(n)) return '—'; return (n*100).toFixed(d) + '%'; }
function fmtNum(n){ if(n==null||isNaN(n)) return '—'; return Math.round(n).toLocaleString('en-US'); }
function fmtDate(s){ const d = parseD(s); if(!d) return '—'; return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function fmtDateShort(s){ const d = parseD(s); if(!d) return '—'; return d.toLocaleDateString('en-US',{month:'short',day:'numeric'}); }
// relative “time ago” label, matching how a CRM reads activity recency
function fmtRelative(s){
  const d = daysAgo(s);
  if(d==null) return '—';
  if(d<=0) return 'Today';
  if(d===1) return 'Yesterday';
  if(d<7) return d+' days ago';
  if(d<11) return '1 week ago';
  if(d<31) return Math.round(d/7)+' weeks ago';
  if(d<45) return 'about a month ago';
  if(d<340) return 'about '+Math.round(d/30)+' months ago';
  const y = Math.round(d/365); return 'about '+y+' year'+(y>1?'s':'')+' ago';
}
// most-recent pipeline milestone for a deal (latest ISO date string)
function lastActivityOf(d){
  const dates = [d.dateEntered, d.dateLOISubmitted, d.dateUnderContract, d.dateLost].filter(Boolean);
  if(!dates.length) return null;
  return dates.slice().sort().pop();
}

/* ============================ Domain config ============================ */
// funnel progression, then terminal/negative outcomes
// Active-pipeline review stages, then LOI-process stages, then dead.
const PIPELINE_STAGES = ['New Deal','Claude UW','Full UW','Excel UW'];
const LOI_STAGES = ['LOI Submitted','LOI Lost','Under Contract','Purchased'];
// Linear happy-path progression used by the deal-detail stepper.
const STAGES = ['New Deal','Claude UW','Full UW','Excel UW','LOI Submitted','Under Contract','Purchased'];
const STAGE_ALL = ['New Deal','Claude UW','Full UW','Excel UW','LOI Submitted','LOI Lost','Under Contract','Purchased','Dead','Stash'];
const STAGE_META = {
  'New Deal':       { c:'#5b7088', bg:'#eef1f5', label:'New Deal' },
  // imported and underwritten by Claude (folder import), waiting for a human review
  'Claude UW':      { c:'#c15f3c', bg:'#fbeee8', label:'Claude UW' },
  'Full UW':        { c:'#1b59c4', bg:'#e2ebfb', label:'Full UW' },
  'Excel UW':       { c:'#6b46e0', bg:'#ece6fd', label:'Excel UW' },
  'LOI Submitted':  { c:'#b87214', bg:'#fdf0d8', label:'LOI Submitted' },
  'LOI Lost':       { c:'#c93c40', bg:'#fce8e8', label:'LOI Lost' },
  'Under Contract': { c:'#0c7a43', bg:'#e0f2ea', label:'Under Contract' },
  'Purchased':      { c:'#0a6b3b', bg:'#d6efe0', label:'Purchased' },
  'Dead':           { c:'#8c7460', bg:'#f2ece4', label:'Dead' },
  'Stash':          { c:'#6b7a8d', bg:'#eef1f5', label:'Stash' },
};
// Map legacy stage names (and Notion imports) onto the current set.
const STAGE_MIGRATE = {
  'Needs UW':'New Deal', 'Needs Underwriting':'New Deal', 'New':'New Deal',
  'Quick UW':'Full UW', // retired stage — fold existing Quick UW deals into Full UW
  'Underwritten':'Full UW', 'Underwriting':'Full UW',
  'Pass':'Dead', 'Passed':'Dead', 'Done':'Dead', 'Dead/Pass':'Dead',
};
function normalizeStage(s){
  if(STAGE_META[s]) return s;
  return STAGE_MIGRATE[s] || 'New Deal';
}
const isPipelineStage = (s)=> PIPELINE_STAGES.includes(s);
const isLOIStage = (s)=> LOI_STAGES.includes(s);
const isDeadStage = (s)=> s==='Dead';
const TYPE_META = {
  'Multifamily':   '#2f6df0',
  'Industrial':    '#5b6b7f',
  'Retail':        '#bd7a16',
  'Mixed-Use':     '#7c5cff',
  'Development':   '#0f8a4d',
  'Other':         '#9eabb9',
};

/* ============================ Metric math ============================ */
// Per Garrett's spec — Going-In and Stabilized (Pro Forma) cap rates.
function computeMetrics(d){
  // Portfolios: quick-UW fields live per-property, not on the deal — sum them so the
  // Quick UW fallback (when Full UW isn't entered yet) still produces sane numbers.
  if (d && d.isPortfolio && Array.isArray(d.properties) && d.properties.length > 1) {
    const props = d.properties;
    d = {
      units: props.reduce((s,p)=>s+(Number(p.units)||0),0),
      purchasePrice: props.reduce((s,p)=>s+(Number(p.purchasePrice)||0),0),
      capex: props.reduce((s,p)=>s+(Number(p.capex)||0),0),
      trailingEGI: props.reduce((s,p)=>s+(Number(p.trailingEGI)||0),0),
      brokerEGI: props.reduce((s,p)=>s+(Number(p.brokerEGI)||0),0),
      currentOpexTotal: props.reduce((s,p)=>s+(Number(p.currentOpexTotal)||0),0),
      marketOpexPerUnit: props.reduce((s,p)=>s+(Number(p.units)||0),0) > 0
        ? props.reduce((s,p)=>s+((Number(p.marketOpexPerUnit)||0)*(Number(p.units)||0)),0) / props.reduce((s,p)=>s+(Number(p.units)||0),0)
        : 0,
    };
  }
  const units = d.units || 1;
  const marketOpex = (d.marketOpexPerUnit||0) * units;          // our market-rate expense assumption
  const currentOpexPerUnit = (d.currentOpexTotal||0) / units;   // current T12 per unit (output)
  const goingInNOI = (d.trailingEGI||0) - marketOpex;           // trailing EGI − market expenses
  const goingInCap = d.purchasePrice ? goingInNOI / d.purchasePrice : 0;
  const proformaNOI = (d.brokerEGI||0) - marketOpex;            // broker/pro-forma EGI − market expenses
  const totalBasis = (d.purchasePrice||0) + (d.capex||0);
  const stabilizedCap = totalBasis ? proformaNOI / totalBasis : 0;
  return { units, marketOpex, currentOpexPerUnit, marketOpexPerUnit:d.marketOpexPerUnit||0,
           goingInNOI, goingInCap, proformaNOI, stabilizedCap, totalBasis };
}

/* ============================ Tiny icons ============================ */
function Icon({ name, size=16, style }){
  const p = { width:size, height:size, viewBox:'0 0 24 24', fill:'none', stroke:'currentColor',
    strokeWidth:1.8, strokeLinecap:'round', strokeLinejoin:'round', style };
  const paths = {
    board:    <><rect x="3" y="3" width="6" height="18" rx="1"/><rect x="10" y="3" width="6" height="12" rx="1"/><rect x="17" y="3" width="4" height="8" rx="1"/></>,
    table:    <><rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 9h18M3 14h18M9 4v16"/></>,
    chart:    <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></>,
    deal:     <><path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h8M8 17h5"/></>,
    search:   <><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></>,
    chevR:    <path d="m9 6 6 6-6 6"/>,
    chevD:    <path d="m6 9 6 6 6-6"/>,
    chevL:    <path d="m15 6-6 6 6 6"/>,
    arrowU:   <path d="m6 15 6-6 6 6"/>,
    arrowD:   <path d="m6 9 6 6 6-6"/>,
    plus:     <path d="M12 5v14M5 12h14"/>,
    close:    <path d="M18 6 6 18M6 6l12 12"/>,
    calc:     <><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 7h6M9 11h.01M12 11h.01M15 11h.01M9 15h.01M12 15h.01M15 15h.01"/></>,
    bank:     <><path d="M3 21h18M4 10h16M5 21V10M19 21V10M9 21V10M15 21V10M12 3 4 8h16z"/></>,
    note:     <><path d="M4 4h16v12l-4 4H4z"/><path d="M14 20v-4h4"/></>,
    clock:    <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    dollar:   <path d="M12 2v20M17 6.5c0-2-2.2-3-5-3s-5 1-5 3.2c0 4.8 10 2.3 10 7.1 0 2.2-2.2 3.2-5 3.2s-5-1.2-5-3.2"/>,
    flag:     <><path d="M4 22V4M4 4h12l-2 4 2 4H4"/></>,
    target:   <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/></>,
    pulse:    <path d="M3 12h4l2 6 4-14 2 8h6"/>,
    filter:   <path d="M3 5h18l-7 8v6l-4 2v-8z"/>,
    check:    <path d="M5 12.5 10 17 19 6"/>,
    edit:     <><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/></>,
    upload:   <><path d="M4 14v5a2 2 0 002 2h12a2 2 0 002-2v-5"/><path d="M12 3v11"/><path d="m8 7 4-4 4 4"/></>,
    clip:     <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>,
    doc:      <><path d="M14 3H6a2 2 0 00-2 2v14a2 2 0 002 2h12a2 2 0 002-2V9z"/><path d="M14 3v6h6"/></>,
    download: <><path d="M12 3v12"/><path d="m8 11 4 4 4-4"/><path d="M4 19h16"/></>,
    expand:   <><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></>,
    trash:    <><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></>,
    star:     <path d="M12 2.5l3.09 6.26 6.91 1-5 4.87 1.18 6.87L12 17.9l-6.18 3.6L7 14.63l-5-4.87 6.91-1z" strokeLinejoin="round"/>,
    lock:     <><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></>,
    eyeOff:   <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/></>,
    noEntry:  <><circle cx="12" cy="12" r="9"/><path d="M6.5 17.5l11-11"/></>,
    mail:     <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></>,
    phone:    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/>,
    users:    <><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0113 0"/><path d="M16 4.5a3.5 3.5 0 010 7M18 14.5a6.5 6.5 0 013.5 5.5"/></>,
  };
  return <svg {...p}>{paths[name]}</svg>;
}

/* ── Star toggle — click to mark a deal as priority-starred ── */
function StarToggle({ on, onToggle, size = 19 }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onToggle(); }}
      title={on ? 'Remove from Priority Deals' : 'Star for Priority Deals'}
      style={{ border: 'none', background: 'none', padding: 3, cursor: 'pointer', display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center', flex: 'none', lineHeight: 0 }}>
      <Icon name="star" size={size} style={{ color: on ? '#e0a715' : 'var(--faint)', fill: on ? '#e0a715' : 'none' }} />
    </button>
  );
}

/* ============================ Primitives ============================ */
function StageBadge({ stage, dot=true, size='md' }){
  const m = STAGE_META[stage] || STAGE_META['New Deal'];
  const pad = size==='sm' ? '2px 8px' : '3px 10px';
  const fs = size==='sm' ? 11 : 12;
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:6, padding:pad, borderRadius:999,
      background:m.bg, color:m.c, fontSize:fs, fontWeight:600, whiteSpace:'nowrap', lineHeight:1.3 }}>
      {dot && <span style={{ width:6, height:6, borderRadius:999, background:m.c }}/>}
      {m.label}
    </span>
  );
}
// large solid badge — the dominant, instant-read stage indicator
function StageBadgeSolid({ stage, count }){
  const m = STAGE_META[stage] || STAGE_META['New Deal'];
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:9, padding:'6px 8px 6px 14px', borderRadius:999,
      background:m.c, color:'#fff', fontSize:14, fontWeight:700, whiteSpace:'nowrap', lineHeight:1, letterSpacing:'-.01em',
      boxShadow:'0 1px 2px '+m.c+'55' }}>
      {m.label}
      {count!=null && <span className="num" style={{ background:'rgba(255,255,255,.22)', borderRadius:999, padding:'2px 9px', fontSize:12.5, fontWeight:700 }}>{count}</span>}
    </span>
  );
}
/* ── Off-market toggle — click to mark a deal as off-market without opening it ── */
function OffMarketToggle({ on, onToggle, size = 17 }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onToggle(); }}
      title={on ? 'Off-market — click to unmark' : 'Mark as off-market'}
      style={{ border: '1px solid ' + (on ? 'var(--warn)' : 'var(--line-2)'), borderRadius: 999,
        background: on ? 'var(--warn-soft)' : 'var(--panel)', padding: '3px 8px', cursor: 'pointer', display: 'inline-flex',
        alignItems: 'center', justifyContent: 'center', textAlign: 'center', flex: 'none', lineHeight: 1,
        fontSize: Math.round(size * 0.62), fontWeight: 700, letterSpacing: '.02em', whiteSpace: 'nowrap',
        color: on ? 'var(--warn)' : 'var(--slate)' }}>
      Off Market
    </button>
  );
}

/* Off-market identifier — deals sourced directly, not via broker listing */
function OffMarketTag({ size='md', style }){
  const pad = size==='sm' ? '2px 7px' : '3px 9px';
  const fs = size==='sm' ? 10.5 : 11.5;
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:5, padding:pad, borderRadius:999,
      background:'var(--warn-soft)', color:'var(--warn)', fontSize:fs, fontWeight:700,
      letterSpacing:'.02em', whiteSpace:'nowrap', lineHeight:1.3, ...style }}>
      <Icon name="noEntry" size={size==='sm'?9:10} style={{ color:'var(--warn)' }}/>
      Off-Market
    </span>
  );
}
/* Marks headline returns sourced from the linked Excel model, not the Full UW tab */
function ExcelSourceTag({ size='md', syncedAt, style }){
  const pad = size==='sm' ? '2px 7px' : '3px 9px';
  const fs = size==='sm' ? 10.5 : 11.5;
  let when = null;
  if (syncedAt) { try { when = fmtDate(String(syncedAt).slice(0,10)); } catch(e) { when = String(syncedAt).slice(0,10); } }
  const tip = 'Returns pulled from the linked Excel model, not the Full UW tab' + (when && when !== '—' ? ' · synced ' + when : '');
  return (
    <span title={tip} style={{ display:'inline-flex', alignItems:'center', gap:5, padding:pad, borderRadius:999,
      background:'var(--accent-soft)', color:'var(--accent-2)', fontSize:fs, fontWeight:700,
      letterSpacing:'.02em', whiteSpace:'nowrap', lineHeight:1.3, ...style }}>
      <Icon name="calc" size={size==='sm'?9:10} style={{ color:'var(--accent-2)' }}/>
      * from Excel model
    </span>
  );
}
function TypeTag({ type }){
  const c = TYPE_META[type] || TYPE_META.Other;
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:6, fontSize:12.5, color:'var(--slate)', fontWeight:500 }}>
      <span style={{ width:7, height:7, borderRadius:2, background:c }}/>{type}
    </span>
  );
}
function Avatar({ name, size=26 }){
  const colors = { Fisher:'#2f6df0', Garrett:'#0f8a4d' };
  return (
    <span title={name} style={{ width:size, height:size, borderRadius:999, flex:'none',
      background:colors[name]||'#7a8a9c', color:'#fff', fontSize:size*0.42, fontWeight:600,
      display:'inline-flex', alignItems:'center', justifyContent:'center' }}>
      {name ? name[0] : '?'}
    </span>
  );
}
function Delta({ value, suffix='', good='up' }){
  if(value==null || value===0) return <span style={{ color:'var(--faint)', fontSize:12 }} className="num">—</span>;
  const up = value > 0;
  const positive = good==='up' ? up : !up;
  const col = positive ? 'var(--pos)' : 'var(--neg)';
  return (
    <span className="num" style={{ color:col, fontSize:12.5, fontWeight:600, display:'inline-flex', alignItems:'center', gap:2 }}>
      <Icon name={up?'arrowU':'arrowD'} size={12}/>{Math.abs(value)}{suffix}
    </span>
  );
}

/* KPI tile */
function Kpi({ label, value, sub, delta, deltaSuffix, deltaGood='up', accent, icon }){
  return (
    <div style={{ background:'var(--panel)', border:'1px solid var(--line)', borderRadius:'var(--radius-lg)',
      padding:'16px 18px', boxShadow:'var(--shadow)', position:'relative', overflow:'hidden' }}>
      {accent && <div style={{ position:'absolute', left:0, top:0, bottom:0, width:3, background:accent }}/>}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
        <span style={{ fontSize:12, color:'var(--muted)', fontWeight:600, letterSpacing:'.02em', textTransform:'uppercase' }}>{label}</span>
        {icon && <span style={{ color:'var(--faint)' }}><Icon name={icon} size={15}/></span>}
      </div>
      <div className="num" style={{ fontSize:27, fontWeight:600, color:'var(--ink)', lineHeight:1 }}>{value}</div>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:8, minHeight:16 }}>
        {delta!=null && <Delta value={delta} suffix={deltaSuffix} good={deltaGood}/>}
        {sub && <span style={{ fontSize:12, color:'var(--muted)' }}>{sub}</span>}
      </div>
    </div>
  );
}

/* segmented control */
function Seg({ options, value, onChange, size='md' }){
  return (
    <div style={{ display:'inline-flex', background:'var(--panel-3)', borderRadius:8, padding:3, gap:2 }}>
      {options.map(o=>{
        const v = typeof o==='string'?o:o.value; const l = typeof o==='string'?o:o.label;
        const on = v===value;
        return (
          <button key={v} onClick={()=>onChange(v)} style={{
            border:'none', background:on?'var(--panel)':'transparent', color:on?'var(--ink)':'var(--slate)',
            fontWeight:on?600:500, fontSize:size==='sm'?12.5:13, padding:size==='sm'?'5px 11px':'6px 14px',
            borderRadius:6, boxShadow:on?'0 1px 2px rgba(16,30,50,.12)':'none', transition:'all .12s' }}>
            {l}
          </button>
        );
      })}
    </div>
  );
}

/* horizontal bar within a track */
function Bar({ value, max, color, height=8, track='var(--panel-3)' }){
  const pct = max>0 ? Math.min(100, (value/max)*100) : 0;
  return (
    <div style={{ background:track, borderRadius:999, height, width:'100%', overflow:'hidden' }}>
      <div style={{ width:pct+'%', height:'100%', background:color, borderRadius:999, transition:'width .5s cubic-bezier(.2,.7,.2,1)' }}/>
    </div>
  );
}

/* Donut chart from segments [{label,value,color}] */
function Donut({ segments, size=132, thickness=18, center }){
  const total = segments.reduce((s,x)=>s+x.value,0) || 1;
  const r = (size - thickness)/2; const C = 2*Math.PI*r; let off = 0;
  return (
    <div style={{ position:'relative', width:size, height:size }}>
      <svg width={size} height={size} style={{ transform:'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--panel-3)" strokeWidth={thickness}/>
        {segments.map((s,i)=>{
          const len = (s.value/total)*C; const el =
            <circle key={i} cx={size/2} cy={size/2} r={r} fill="none" stroke={s.color}
              strokeWidth={thickness} strokeDasharray={`${len} ${C-len}`} strokeDashoffset={-off}
              strokeLinecap="butt" style={{ transition:'stroke-dasharray .6s' }}/>;
          off += len; return el;
        })}
      </svg>
      {center && <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column',
        alignItems:'center', justifyContent:'center', textAlign:'center' }}>{center}</div>}
    </div>
  );
}

/* Card shell */
function Card({ title, right, children, pad=true, style }){
  return (
    <div style={{ background:'var(--panel)', border:'1px solid var(--line)', borderRadius:'var(--radius-lg)',
      boxShadow:'var(--shadow)', display:'flex', flexDirection:'column', ...style }}>
      {(title||right) && (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'14px 18px', borderBottom:'1px solid var(--line)' }}>
          <span style={{ fontSize:13.5, fontWeight:600, color:'var(--ink)' }}>{title}</span>
          {right}
        </div>
      )}
      <div style={{ padding:pad?18:0, flex:1 }}>{children}</div>
    </div>
  );
}

/* Team assignee multi-select — Fisher / Garrett / Andy. Compact avatar chips + popover. */
const ASSIGNEES = ['Fisher', 'Garrett', 'Andy'];
const ASSIGNEE_COLOR = { Fisher: '#2f6df0', Garrett: '#0f8a4d', Andy: '#b8651b' };
function AssigneePicker({ value, onChange, size = 24 }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const sel = Array.isArray(value) ? value : [];
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  const toggle = (name) => {
    const next = sel.includes(name) ? sel.filter((n) => n !== name) : [...sel, name];
    onChange(next);
  };
  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }} onClick={(e) => e.stopPropagation()}>
      <button onClick={() => setOpen((o) => !o)} title="Assign reviewers"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 0, border: '1px solid var(--line-2)', background: 'var(--panel)',
          borderRadius: 999, padding: sel.length ? '2px 7px 2px 3px' : '0 9px', height: size + 6, cursor: 'pointer', minWidth: sel.length ? 'auto' : 56 }}>
        {sel.length === 0 ?
          <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 500 }}>+ Assign</span> :
          <span style={{ display: 'inline-flex' }}>
            {sel.map((n, i) => (
              <span key={n} title={n} style={{ width: size, height: size, borderRadius: 999, flex: 'none',
                background: ASSIGNEE_COLOR[n] || '#7a8a9c', color: '#fff', fontSize: size * 0.42, fontWeight: 700,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                marginLeft: i ? -size * 0.3 : 0, border: '1.5px solid var(--panel)' }}>{n[0]}</span>
            ))}
          </span>}
      </button>
      {open && (
        <div style={{ position: 'absolute', top: size + 10, left: 0, zIndex: 50, background: 'var(--panel)',
          border: '1px solid var(--line)', borderRadius: 10, boxShadow: '0 10px 30px rgba(15,23,32,.18)', padding: 5, minWidth: 150 }}>
          {ASSIGNEES.map((name) => {
            const on = sel.includes(name);
            return (
              <button key={name} onClick={() => toggle(name)}
                style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', border: 'none', background: on ? 'var(--accent-soft)' : 'transparent',
                  borderRadius: 7, padding: '7px 9px', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font)' }}
                onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = 'var(--panel-2)'; }}
                onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = 'transparent'; }}>
                <span style={{ width: 22, height: 22, borderRadius: 999, flex: 'none', background: ASSIGNEE_COLOR[name],
                  color: '#fff', fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{name[0]}</span>
                <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: on ? 600 : 400, flex: 1 }}>{name}</span>
                {on && <Icon name="check" size={14} style={{ color: 'var(--accent)' }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// GoHighLevel's bulk importer only accepts .csv (not .xlsx) — shared exporter for any
// GHL-bound download (broker call log, etc).
function rowsToCSV(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [headers.join(','), ...rows.map((r) => headers.map((h) => esc(r[h])).join(','))].join('\r\n');
}
function downloadCSV(rows, filename) {
  if (!rows.length) return;
  const blob = new Blob([rowsToCSV(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

Object.assign(window, {
  TODAY, DAY, parseD, daysAgo, fmtMoney, fmtShort, fmtPct, fmtNum, fmtDate, fmtDateShort, fmtRelative, lastActivityOf,
  STAGES, STAGE_ALL, STAGE_META, PIPELINE_STAGES, LOI_STAGES,
  normalizeStage, isPipelineStage, isLOIStage, isDeadStage,
  TYPE_META, computeMetrics, ASSIGNEES, ASSIGNEE_COLOR, AssigneePicker,
  Icon, StageBadge, StageBadgeSolid, TypeTag, OffMarketTag, ExcelSourceTag, OffMarketToggle, Avatar, Delta, Kpi, Seg, Bar, Donut, Card,
  downloadCSV,
});
