// app/app.jsx — shell, pipeline (workflow funnel + cards + board), OM upload, add-deal modal, tweaks
const { useState: useS, useEffect: useE, useMemo: useM, useRef: useR } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#2f6df0",
  "density": "regular",
  "zebra": false,
  "monoNums": true
} /*EDITMODE-END*/;

const LS_KEY = 'altus_pipeline_v2';
const LS_CONTACTS = 'altus_contacts_v1';
const LS_TODOS    = 'altus_todos_v1';

function loadContacts() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_CONTACTS));
    if (saved && Array.isArray(saved)) return saved;
  } catch (e) {}
  return [];
}

function loadDeals() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_KEY));
    if (saved && Array.isArray(saved) && saved.length) return saved;
  } catch (e) {}
  if (window.AltusCloud && window.AltusCloud.enabled) return []; // Supabase is authoritative — never seed from the bundled snapshot
  return window.ALTUS_DEALS.map((d) => ({ ...d }));
}

// AI document parsing bridge. Tries ALTUS_AI (Cloudflare Function) first, then
// falls back to window.claude (Design Canvas). Both environments work without
// reconfiguration — production uses the hosted endpoint, preview uses claude directly.
async function aiComplete(prompt, opts) {
  const maxTokens = (opts && opts.maxTokens) || 4096;
  const callClaude = () => window.claude.complete(prompt, { maxTokens });
  if (window.ALTUS_AI && typeof window.ALTUS_AI.complete === 'function') {
    try { return await window.ALTUS_AI.complete(prompt, maxTokens); } catch (e) {
      if (!(window.claude && typeof window.claude.complete === 'function')) throw e;
      // fall through to window.claude when the hosted endpoint isn't reachable
    }
  }
  if (window.claude && typeof window.claude.complete === 'function') {
    // A "no data for Ns" error is a transient stall, not a bad document — retry once.
    try { return await callClaude(); }
    catch (e) {
      if (!/no data for/i.test(String(e && e.message || e))) throw e;
      return await callClaude();
    }
  }
  throw new Error('AI is not connected — wire up ALTUS_AI in supabase-config.js or open in the Design Canvas.');
}

// Tolerant JSON parse for LLM output. The model occasionally returns JSON with
// small defects — trailing commas, a missing comma between adjacent contact
// objects, ```json fences, or a response truncated mid-array. A plain
// JSON.parse throws on any of these and we'd report the whole OM unparseable,
// so we extract the object and retry through a series of escalating repairs.
function safeParseJSON(raw) {
  if (raw == null) return null;
  let s = String(raw).replace(/```(?:json)?/gi, '').trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last > first) s = s.slice(first, last + 1);

  const repairs = [
    (x) => x,
    (x) => x.replace(/,(\s*[}\]])/g, '$1'),                       // trailing commas
    (x) => x.replace(/}(\s*)\{/g, '},$1{')                        // missing comma between objects
            .replace(/](\s*)\[/g, '],$1[')                        // …between arrays
            .replace(/"(\s*\n\s*)"/g, '",$1"'),                   // …between string values on new lines
    (x) => x.replace(/,(\s*[}\]])/g, '$1')
            .replace(/}(\s*)\{/g, '},$1{')
            .replace(/](\s*)\[/g, '],$1[')
            .replace(/"(\s*\n\s*)"/g, '",$1"'),
  ];
  for (const fix of repairs) {
    try { return JSON.parse(fix(s)); } catch (e) {}
  }
  // Last resort: output truncated mid-structure. Walk back from the end and
  // close any open brackets to recover whatever complete fields we can.
  for (let end = s.length; end > first + 1; end--) {
    let candidate = s.slice(0, end).replace(/,\s*$/, '');
    const opens = (candidate.match(/[{\[]/g) || []).length;
    const closes = (candidate.match(/[}\]]/g) || []).length;
    if (opens <= closes) continue;
    // balance brackets in LIFO order
    const stack = [];
    for (const ch of candidate) {
      if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if (ch === '}' || ch === ']') stack.pop();
    }
    candidate += stack.reverse().join('');
    try { return JSON.parse(candidate.replace(/,(\s*[}\]])/g, '$1')); } catch (e) {}
  }
  return null;
}

// format a typed numeric string with thousands separators while preserving an
// in-progress decimal (so "1234." and "5.2" stay editable). Returns '' for empty.
function groupNum(s) {
  let raw = String(s == null ? '' : s).replace(/[^0-9.]/g, '');
  const parts = raw.split('.');
  if (parts.length > 2) raw = parts[0] + '.' + parts.slice(1).join('');
  const [int, dec] = raw.split('.');
  if (int === '' && dec == null) return '';
  const intF = int === '' ? '' : Number(int).toLocaleString('en-US');
  return dec != null ? intF + '.' + dec : intF;
}

/* ========================= Workflow Funnel ========================= */
function WorkflowFunnel({ deals, active, onPick }) {
  const activeFunnel = STAGES; // New Deal → … → Purchased
  const terminal = ['LOI Lost', 'Dead'];
  return (
    <div style={{ display: 'flex', background: 'var(--panel)', border: '1px solid var(--line)',
      borderRadius: 'var(--radius-lg)', overflow: 'hidden', boxShadow: 'var(--shadow)', marginBottom: 16 }}>

      {activeFunnel.map((stage, i) => {
        const items = deals.filter((d) => d.stage === stage);
        const vol = items.reduce((s, d) => s + (d.purchasePrice || 0), 0);
        const meta = STAGE_META[stage];
        const on = active === stage;
        return (
          <React.Fragment key={stage}>
            {i > 0 &&
            <div style={{ display: 'flex', alignItems: 'center', flex: 'none', color: 'var(--line-2)' }}>
                <svg width="14" height="100%" viewBox="0 0 14 56" preserveAspectRatio="none" style={{ height: '100%', minHeight: 72 }}>
                  <path d="M0 0 L14 28 L0 56" fill="none" stroke="currentColor" strokeWidth="1.5" />
                </svg>
              </div>
            }
            <button key={stage} onClick={() => onPick(on ? 'All' : stage)} style={{
              flex: 1, border: 'none', background: on ? meta.bg : 'transparent',
              padding: '14px 16px 13px', textAlign: 'left', cursor: 'pointer',
              transition: 'background .12s', position: 'relative', minWidth: 0 }}
            onMouseEnter={(e) => {if (!on) e.currentTarget.style.background = 'var(--panel-2)';}}
            onMouseLeave={(e) => {if (!on) e.currentTarget.style.background = 'transparent';}}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: on ? meta.c : 'transparent', transition: 'background .12s' }} />
              <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase',
                color: on ? meta.c : 'var(--muted)', marginBottom: 7, paddingLeft: i === 0 ? 5 : 0 }}>
                {meta.label}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, paddingLeft: i === 0 ? 5 : 0 }}>
                <span className="num" style={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1 }}>{items.length}</span>
                {vol > 0 && <span className="num" style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>{fmtShort(vol)}</span>}
              </div>
            </button>
          </React.Fragment>);

      })}

      {/* Terminal stages */}
      <div style={{ borderLeft: '1px solid var(--line-2)', background: 'var(--panel-2)',
        display: 'flex', alignItems: 'center', flex: 'none' }}>
        {terminal.map((stage, i) => {
          const count = deals.filter((d) => d.stage === stage).length;
          const meta = STAGE_META[stage];
          const on = active === stage;
          return (
            <button key={stage} onClick={() => onPick(on ? 'All' : stage)} style={{
              border: 'none', background: on ? meta.bg : 'transparent', cursor: 'pointer',
              padding: '14px 18px 13px', textAlign: 'center',
              borderLeft: i > 0 ? '1px solid var(--line-2)' : 'none', transition: 'background .12s' }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase',
                color: on ? meta.c : 'var(--muted)', marginBottom: 7 }}>{meta.label}</div>
              <span className="num" style={{ fontSize: 22, fontWeight: 600, color: on ? meta.c : 'var(--slate)', lineHeight: 1 }}>{count}</span>
            </button>);

        })}
      </div>
    </div>);

}

/* ========================= OM Upload button ========================= */
function SpinIcon() {return <span style={{ display: 'inline-block', animation: 'spin .8s linear infinite', lineHeight: 1 }}><Icon name="arrowD" size={11} /></span>;}

function OMBtn({ dealId, om, onUpload, onOpenDeal, label = 'OM', accept = '.pdf,application/pdf' }) {
  const fileRef = useR(null);
  const isParsing = om?.status === 'parsing';
  const isDone = om?.status === 'done';
  const isError = om?.status === 'error';

  const handleClick = (e) => {
    e.stopPropagation();
    if (isDone) {onOpenDeal(dealId);return;}
    fileRef.current.click();
  };

  return (
    <>
      <input ref={fileRef} type="file" accept={accept} style={{ display: 'none' }}
      onChange={(e) => {const f = e.target.files[0];if (f) onUpload(dealId, f);e.target.value = '';}} />
      <button onClick={handleClick} title={isDone ? label + ' parsed — click to review' : isError ? 'Parse failed — retry' : 'Upload ' + label} style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 6,
        fontSize: 11.5, fontWeight: 500, cursor: isParsing ? 'wait' : 'pointer',
        border: `1px solid ${isDone ? 'var(--pos)' : isError ? 'var(--neg)' : 'var(--line-2)'}`,
        background: isDone ? 'var(--pos-soft)' : isError ? 'var(--neg-soft)' : 'var(--panel-2)',
        color: isDone ? 'var(--pos)' : isError ? 'var(--neg)' : 'var(--slate)' }}>
        {isParsing ? <><SpinIcon /> Parsing…</> :
        isDone ? <><Icon name="check" size={11} /> {label}</> :
        isError ? <><Icon name="close" size={11} /> Retry</> :
        <><Icon name="upload" size={11} /> {label}</>}
      </button>
    </>);

}

const DOC_ACCEPT = '.pdf,.csv,.txt,.xlsx,.xls,.xlsm,application/pdf,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';

// Three document upload buttons (OM · T-12 · Rent Roll) shown together on cards/rows.
function DocBar({ dealId, omMap, t12Map, rrMap, onOM, onT12, onRR, onOpenDeal }) {
  return (
    <>
      <OMBtn dealId={dealId} om={omMap?.[dealId]} onUpload={onOM} onOpenDeal={onOpenDeal} label="OM" accept=".pdf,application/pdf" />
      <OMBtn dealId={dealId} om={t12Map?.[dealId]} onUpload={onT12} onOpenDeal={onOpenDeal} label="T-12" accept={DOC_ACCEPT} />
      <OMBtn dealId={dealId} om={rrMap?.[dealId]} onUpload={onRR} onOpenDeal={onOpenDeal} label="RR" accept={DOC_ACCEPT} />
    </>
  );
}

/* ========================= Deal card ========================= */
function DealCard({ d, onOpen, omMap, t12Map, rrMap, onOM, onT12, onRR, onPatch }) {
  const m = computeMetrics(d);
  const meta = STAGE_META[d.stage] || STAGE_META['New Deal'];
  const caps = window.displayCaps ? window.displayCaps(d) : { goingIn: m.goingInCap, stab: m.stabilizedCap };
  const fromExcel = window.hasExcelReturns ? window.hasExcelReturns(d) : false;
  const R = fromExcel && window.dealReturns ? window.dealReturns(d) : null;
  const days = daysAgo(d.dateEntered);
  const brokerShort = d.broker ? d.broker.split(/[—\-·]/)[0].trim() : '';

  return (
    <div onClick={() => onOpen(d.id)} style={{
      background: 'var(--panel)', borderRadius: 'var(--radius-lg)',
      border: '1px solid var(--line)', borderLeft: `3px solid ${meta.c}`,
      padding: '14px 16px', cursor: 'pointer',
      boxShadow: 'var(--shadow)', transition: 'box-shadow .15s, transform .15s' }}
    onMouseEnter={(e) => {e.currentTarget.style.boxShadow = '0 4px 16px rgba(16,30,50,.11)';e.currentTarget.style.transform = 'translateY(-1px)';}}
    onMouseLeave={(e) => {e.currentTarget.style.boxShadow = 'var(--shadow)';e.currentTarget.style.transform = 'none';}}>

      {/* Name + type */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1, minWidth: 0 }}>
          <div className="clip" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.3 }}>{d.name}</div>
          {onPatch && <StarToggle on={!!d.starred} onToggle={() => onPatch(d.id, { starred: !d.starred })} />}
          {onPatch && <OffMarketToggle on={!!d.offMarket} onToggle={() => onPatch(d.id, { offMarket: !d.offMarket })} />}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
          {d.offMarket && <OffMarketTag size="sm" />}
          {fromExcel && window.ExcelSourceTag && <window.ExcelSourceTag size="sm" syncedAt={R.syncedAt} />}
          <TypeTag type={d.type} />
        </div>
      </div>

      {/* Location + units */}
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, fontWeight: 400 }}>
        {[d.market, d.units ? fmtNum(d.units) + ' units' : null].filter(Boolean).join('  ·  ')}
      </div>

      {/* Key metrics */}
      {(d.askPrice || (fromExcel ? (R.irr != null || R.equityMultiple != null) : (caps.goingIn > 0 || caps.stab > 0))) &&
      <div style={{ display: 'flex', gap: 18, marginBottom: 12 }}>
          {d.askPrice ?
        <div>
              <div className="num" style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', lineHeight: 1, fontFamily: 'var(--font)' }}>{fmtShort(d.askPrice)}</div>
              <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 2 }}>ask</div>
            </div> :
        null}
          {fromExcel ? <React.Fragment>
          {R.irr != null ?
        <div>
              <div className="num" style={{ fontSize: 15, fontWeight: 600, color: 'var(--accent-2)', lineHeight: 1 }}>{fmtPct(R.irr, 1)}</div>
              <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 2 }}>IRR · Excel</div>
            </div> : null}
          {R.equityMultiple != null ?
        <div>
              <div className="num" style={{ fontSize: 15, fontWeight: 600, color: 'var(--pos)', lineHeight: 1 }}>{R.equityMultiple.toFixed(2)}x</div>
              <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 2 }}>equity mult.</div>
            </div> : null}
          </React.Fragment> : <React.Fragment>
          {caps.goingIn > 0.001 ?
        <div>
              <div className="num" style={{ fontSize: 15, fontWeight: 600, color: 'var(--accent-2)', lineHeight: 1 }}>{fmtPct(caps.goingIn, 1)}</div>
              <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 2 }}>going-in</div>
            </div> :
        null}
          {caps.stab > 0.001 ?
        <div>
              <div className="num" style={{ fontSize: 15, fontWeight: 600, color: 'var(--pos)', lineHeight: 1 }}>{fmtPct(caps.stab, 1)}</div>
              <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 2 }}>stab. cap</div>
            </div> :
        null}
          </React.Fragment>}
        </div>
      }

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 10, borderTop: '1px solid var(--line)', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1 }}>
          {onPatch && <AssigneePicker value={d.assignees} onChange={(v) => onPatch(d.id, { assignees: v })} size={22} />}
          {brokerShort && <span className="clip" style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 400 }}>{brokerShort}</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
          <DocBar dealId={d.id} omMap={omMap} t12Map={t12Map} rrMap={rrMap} onOM={onOM} onT12={onT12} onRR={onRR} onOpenDeal={onOpen} />
          {days != null && <span className="num" style={{ fontSize: 11, color: 'var(--faint)' }}>{days}d</span>}
        </div>
      </div>
    </div>);

}

/* ========================= Grouped cards ========================= */
function GroupedCards({ deals, onOpen, onOM, onT12, onRR, omMap, t12Map, rrMap, onPatch }) {
  const groups = STAGE_ALL.
  map((stage) => ({ stage, items: deals.filter((d) => d.stage === stage), meta: STAGE_META[stage] })).
  filter((g) => g.items.length > 0);

  if (groups.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '72px 24px', color: 'var(--muted)' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>∅</div>
        <div style={{ fontSize: 14, fontWeight: 500 }}>No deals match your filters.</div>
      </div>);

  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      {groups.map((g) => {
        const vol = g.items.reduce((s, d) => s + (d.purchasePrice || 0), 0);
        return (
          <div key={g.stage}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <StageBadgeSolid stage={g.stage} count={g.items.length} />
              {vol > 0 && <span className="num" style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 400 }}>{fmtShort(vol)}</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(268px,1fr))', gap: 10 }}>
              {g.items.map((d) =>
              <DealCard key={d.id} d={d} onOpen={onOpen}
              omMap={omMap} t12Map={t12Map} rrMap={rrMap} onOM={onOM} onT12={onT12} onRR={onRR} onPatch={onPatch} />
              )}
            </div>
          </div>);

      })}
    </div>);

}

/* ========================= Kanban board (board mode) ========================= */
function BoardCard({ d, onOpen, onDragStart, onPatch }) {
  const m = computeMetrics(d);
  const caps = window.displayCaps ? window.displayCaps(d) : { goingIn: m.goingInCap, stab: m.stabilizedCap };
  return (
    <div draggable onDragStart={(e) => onDragStart(e, d.id)} onClick={() => onOpen(d.id)}
    style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 9, padding: '11px 12px',
      cursor: 'pointer', boxShadow: 'var(--shadow)', transition: 'box-shadow .12s, transform .12s' }}
    onMouseEnter={(e) => {e.currentTarget.style.boxShadow = '0 4px 16px rgba(16,30,50,.11)';e.currentTarget.style.transform = 'translateY(-1px)';}}
    onMouseLeave={(e) => {e.currentTarget.style.boxShadow = 'var(--shadow)';e.currentTarget.style.transform = 'none';}}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
        <div className="clip" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{d.name}</div>
        {onPatch && <StarToggle on={!!d.starred} onToggle={() => onPatch(d.id, { starred: !d.starred })} size={17} />}
        {onPatch && <OffMarketToggle on={!!d.offMarket} onToggle={() => onPatch(d.id, { offMarket: !d.offMarket })} size={17} />}
      </div>
      <div className="clip" style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 9, fontWeight: 400 }}>{d.market}</div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <TypeTag type={d.type} />
          {d.offMarket && <OffMarketTag size="sm" />}
        </div>
        <span className="num" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{fmtShort(d.askPrice)}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 9,
        paddingTop: 9, borderTop: '1px solid var(--line)' }}>
        <span style={{ display: 'flex', gap: 10, fontSize: 11.5 }}>
          <span className="num" style={{ color: 'var(--accent-2)', fontWeight: 500 }}>{fmtPct(caps.goingIn, 1)}</span>
          <span className="num" style={{ color: 'var(--pos)', fontWeight: 500 }}>{fmtPct(caps.stab, 1)}</span>
        </span>
      </div>
    </div>);

}

function PipelineBoard({ deals, onOpen, onPatch }) {
  const [over, setOver] = useS(null);
  const drag = (e, id) => {e.dataTransfer.setData('id', id);};
  const drop = (e, stage) => {e.preventDefault();const id = e.dataTransfer.getData('id');if (id) onPatch(id, { stage });setOver(null);};
  return (
    <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 12 }}>
      {STAGE_ALL.map((stage) => {
        const items = deals.filter((d) => d.stage === stage);
        const m = STAGE_META[stage];
        return (
          <div key={stage} onDragOver={(e) => {e.preventDefault();setOver(stage);}}
          onDragLeave={() => setOver((o) => o === stage ? null : o)} onDrop={(e) => drop(e, stage)}
          style={{ width: 240, flex: 'none', display: 'flex', flexDirection: 'column', gap: 8, padding: 8,
            borderRadius: 'var(--radius-lg)', background: over === stage ? 'var(--accent-soft)' : 'transparent',
            outline: over === stage ? '1.5px dashed var(--accent)' : 'none', transition: 'background .12s' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 4px 8px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: 'var(--ink)' }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: m.c }} />{m.label}
                <span className="num" style={{ color: 'var(--muted)', fontWeight: 400 }}>{items.length}</span>
              </span>
              <span className="num" style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtShort(items.reduce((s, d) => s + (d.purchasePrice || 0), 0))}</span>
            </div>
            {items.map((d) => <BoardCard key={d.id} d={d} onOpen={onOpen} onDragStart={drag} onPatch={onPatch} />)}
            {items.length === 0 &&
            <div style={{ padding: '16px 8px', textAlign: 'center', fontSize: 11.5, color: 'var(--faint)',
              border: '1px dashed var(--line-2)', borderRadius: 8 }}>Drop here</div>
            }
          </div>);

      })}
    </div>);

}

/* ========================= Grouped table ========================= */
const TABLE_COLS = [
  { key:'name',         label:'Deal',         w:'minmax(180px,2fr)' },
  { key:'type',         label:'Type',         w:'110px' },
  { key:'market',       label:'Market',       w:'minmax(110px,1fr)' },
  { key:'units',        label:'Units',        w:'70px',  align:'right' },
  { key:'vintage',      label:'Vintage',      w:'82px',  align:'right' },
  { key:'askPrice',     label:'Ask',          w:'100px', align:'right' },
  { key:'purchasePrice',label:'UW Price',     w:'100px', align:'right' },
  { key:'goingInCap',   label:'Going-In',     w:'85px',  align:'right' },
  { key:'stabilized',   label:'Stab. Cap',    w:'85px',  align:'right' },
  { key:'broker',       label:'Broker',       w:'minmax(110px,1.2fr)' },
  { key:'om',           label:'Files',        w:'210px', align:'center' },
];

function GroupedTable({ deals, onOpen, onPatch, omMap, t12Map, rrMap, onOM, onT12, onRR }){
  const groups = STAGE_ALL
    .map(stage=>({ stage, items:deals.filter(d=>d.stage===stage), meta:STAGE_META[stage] }))
    .filter(g=>g.items.length>0);

  if(groups.length===0) return (
    <div style={{ textAlign:'center', padding:'72px 24px', color:'var(--muted)' }}>
      <div style={{ fontSize:32, marginBottom:12 }}>∅</div>
      <div style={{ fontSize:14, fontWeight:500 }}>No deals match your filters.</div>
    </div>
  );

  const grid = TABLE_COLS.map(c=>c.w).join(' ');

  return (
    <div style={{ display:'flex', flexDirection:'column', gap:20 }}>
      {groups.map(g=>{
        const vol = g.items.reduce((s,d)=>s+(d.purchasePrice||0),0);
        return (
          <div key={g.stage} style={{ background:'var(--panel)', border:'1px solid var(--line)',
            borderRadius:'var(--radius-lg)', overflow:'hidden', boxShadow:'var(--shadow)' }}>
            {/* Group header */}
            <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px',
              background:'var(--panel-2)', borderBottom:'1px solid var(--line)' }}>
              <StageBadgeSolid stage={g.stage} count={g.items.length}/>
              {vol>0 && <span className="num" style={{ fontSize:12, color:'var(--muted)', fontWeight:400 }}>{fmtShort(vol)}</span>}
            </div>
            {/* Column headers */}
            <div style={{ display:'grid', gridTemplateColumns:grid, padding:'0 14px',
              borderBottom:'1px solid var(--line)', background:'var(--panel-3)' }}>
              {TABLE_COLS.map(c=>(
                <div key={c.key} style={{ padding:'7px 6px', fontSize:10.5, fontWeight:600,
                  letterSpacing:'.04em', textTransform:'uppercase', color:'var(--muted)',
                  textAlign:c.align||'left' }}>
                  {c.label}
                </div>
              ))}
            </div>
            {/* Rows */}
            {g.items.map((d,i)=>{
              const m = computeMetrics(d);
              const caps = window.displayCaps ? window.displayCaps(d) : { goingIn: m.goingInCap, stab: m.stabilizedCap };
              const om = omMap?.[d.id];
              return (
                <div key={d.id} onClick={()=>onOpen(d.id)} style={{
                  display:'grid', gridTemplateColumns:grid, alignItems:'center',
                  padding:'0 14px', minHeight:42, cursor:'pointer',
                  borderBottom:i<g.items.length-1?'1px solid var(--line)':'none',
                  background:i%2===1?'var(--panel-2)':'var(--panel)', transition:'background .1s' }}
                  onMouseEnter={e=>e.currentTarget.style.background='var(--accent-soft)'}
                  onMouseLeave={e=>e.currentTarget.style.background=i%2===1?'var(--panel-2)':'var(--panel)'}>
                  {/* Deal name */}
                  <div style={{ padding:'8px 6px', display:'flex', alignItems:'center', gap:8, minWidth:0 }} onClick={e=>e.stopPropagation()}>
                    <span className="clip" style={{ fontSize:13.5, fontWeight:600, color:'var(--ink)' }}>{d.name}</span>
                    <OffMarketToggle on={!!d.offMarket} onToggle={() => onPatch && onPatch(d.id, { offMarket: !d.offMarket })} size={16} />
                  </div>
                  {/* Type */}
                  <div style={{ padding:'8px 6px' }}><TypeTag type={d.type}/></div>
                  {/* Market */}
                  <div className="clip" style={{ padding:'8px 6px', fontSize:12.5, color:'var(--slate)', fontWeight:400 }}>{d.market||'—'}</div>
                  {/* Units */}
                  <div className="num" style={{ padding:'8px 6px', fontSize:12.5, color:'var(--slate)', textAlign:'right' }}>{d.units?fmtNum(d.units):'—'}</div>
                  {/* Vintage */}
                  <div className="num" style={{ padding:'8px 6px', fontSize:12.5, color:'var(--slate)', textAlign:'right' }}>{d.vintage||'—'}</div>
                  {/* Ask */}
                  <div className="num" style={{ padding:'8px 6px', fontSize:13, fontWeight:500, color:'var(--ink)', textAlign:'right' }}>{fmtShort(d.askPrice)}</div>
                  {/* UW Price */}
                  <div className="num" style={{ padding:'8px 6px', fontSize:13, fontWeight:500, color:'var(--slate)', textAlign:'right' }}>{fmtShort(d.purchasePrice)}</div>
                  {/* Going-in cap */}
                  <div className="num" style={{ padding:'8px 6px', fontSize:13, fontWeight:500,
                    color:caps.goingIn>0.001?'var(--accent-2)':'var(--faint)', textAlign:'right' }}>
                    {caps.goingIn>0.001?fmtPct(caps.goingIn,1):'—'}
                  </div>
                  {/* Stab cap */}
                  <div className="num" style={{ padding:'8px 6px', fontSize:13, fontWeight:500,
                    color:caps.stab>0.001?'var(--pos)':'var(--faint)', textAlign:'right' }}>
                    {caps.stab>0.001?fmtPct(caps.stab,1):'—'}
                  </div>
                  {/* Broker */}
                  <div className="clip" style={{ padding:'8px 6px', fontSize:12, color:'var(--muted)', fontWeight:400 }}>
                    {d.broker?d.broker.split(/[—\-·]/)[0].trim():'—'}
                  </div>
                  {/* Files */}
                  <div style={{ padding:'8px 6px', display:'flex', gap:6, justifyContent:'center', flexWrap:'wrap' }} onClick={e=>e.stopPropagation()}>
                    <DocBar dealId={d.id} omMap={omMap} t12Map={t12Map} rrMap={rrMap} onOM={onOM} onT12={onT12} onRR={onRR} onOpenDeal={onOpen}/>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/* ========================= KPI summary cards ========================= */
function StatChip({ dir, text }) {
  const up = dir === 'up';
  return (
    <span className="num" style={{ display: 'inline-flex', alignItems: 'center', gap: 2,
      fontSize: 11.5, fontWeight: 600, color: up ? 'var(--pos)' : 'var(--neg)',
      background: up ? 'var(--pos-soft)' : 'var(--neg-soft)', borderRadius: 6, padding: '2px 7px' }}>
      <Icon name={up ? 'arrowU' : 'arrowD'} size={11} />{text}
    </span>);
}
function StatCard({ label, value, chip, sub }) {
  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--line)',
      borderRadius: 'var(--radius-lg)', padding: '15px 18px', boxShadow: 'var(--shadow)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</span>
        {chip}
      </div>
      <div className="num" style={{ fontSize: 28, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, marginTop: 10 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 4 }}>{sub}</div>}
    </div>);
}
function PipelineStats({ deals, allDeals }) {
  const all = allDeals || deals;
  const active = deals.filter((d) => STAGES.includes(d.stage));
  const pipelineVal = active.reduce((s, d) => s + (d.askPrice || 0), 0);
  // Discount to guidance: avg % our UW price sits below the asking/guidance price,
  // across deals that have BOTH an ask and a UW price.
  const discRows = active.filter((d) => (d.askPrice || 0) > 0 && (d.purchasePrice || 0) > 0)
    .map((d) => (d.askPrice - d.purchasePrice) / d.askPrice);
  const avgDiscount = discRows.length ? discRows.reduce((a, b) => a + b, 0) / discRows.length : null;
  const uc = all.filter((d) => d.stage === 'Under Contract');
  const ucVal = uc.reduce((s, d) => s + (d.purchasePrice || d.askPrice || 0), 0);
  const newCount = active.filter((d) => { const a = daysAgo(d.dateEntered); return a != null && a <= 30; }).length;
  const loiOut = all.filter((d) => d.stage === 'LOI Submitted').length;

  const cards = [
    { label: 'Active Deals', value: fmtNum(active.length), chip: newCount ? <StatChip dir="up" text={'+' + newCount} /> : null, sub: 'in review' },
    { label: 'Pipeline Value', value: fmtShort(pipelineVal), sub: 'total ask' },
    { label: 'Discount to Guidance', value: avgDiscount != null ? (avgDiscount * 100).toFixed(1) + '%' : '—', sub: discRows.length + (discRows.length === 1 ? ' deal' : ' deals') + ' vs. ask' },
    { label: 'LOIs Outstanding', value: fmtNum(loiOut), sub: loiOut ? 'awaiting response' : 'none submitted' },
    { label: 'Under Contract', value: fmtNum(uc.length), sub: ucVal ? fmtShort(ucVal) + ' value' : 'none yet' }];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 18 }}>
      {cards.map((c, i) => <StatCard key={i} {...c} />)}
    </div>);
}

/* ========================= Flat pipeline table (sortable + resizable) ========================= */
const PIPE_COLS = [
  { key: 'sel',           label: '',              defW: 64,  min: 64 },
  { key: 'name',          label: 'Deal / Asset',  defW: 256, min: 190, sortable: true, flex: true },
  { key: 'market',        label: 'Market',        defW: 138, min: 90,  sortable: true },
  { key: 'stage',         label: 'Stage',         defW: 162, min: 144 },
  { key: 'status',        label: 'Status',        defW: 170, min: 120, sortable: true },
  { key: 'tasks',         label: 'Tasks',         defW: 190, min: 140 },
  { key: 'assignee',      label: 'Assignee',      defW: 116, min: 92, sortable: true },
  { key: 'askPrice',      label: 'Ask',           defW: 100, min: 78,  sortable: true, align: 'right' },
  { key: 'purchasePrice', label: 'UW Price',      defW: 100, min: 78,  sortable: true, align: 'right' },
  { key: 'cfoDate',       label: 'CFO Date',      defW: 116, min: 92,  sortable: true },
  { key: 'lastActivity',  label: 'Last Activity', defW: 124, min: 100, sortable: true },
  { key: 'files',         label: 'Files',         defW: 196, min: 150, sortable: false, align: 'center' },
];
const LS_PIPE_W = 'altus.pipeline.colw.v1';
const DEFAULT_PIPE_W = PIPE_COLS.reduce((o, c) => { o[c.key] = c.defW; return o; }, {});

function sortValue(d, key) {
  switch (key) {
    case 'name':          return (d.name || '').toLowerCase();
    case 'market':        return (d.market || '').toLowerCase();
    case 'stage':         return STAGE_ALL.indexOf(d.stage);
    case 'status':        return (d.status || d._rawStatus || '').toLowerCase();
    case 'assignee':      return (Array.isArray(d.assignees) ? d.assignees.slice().sort().join(',') : '').toLowerCase();
    case 'askPrice':      return d.askPrice || 0;
    case 'purchasePrice': return d.purchasePrice || 0;
    case 'stabilizedCap': { if (window.hasExcelReturns && window.hasExcelReturns(d)) return window.dealReturns(d).stabYOC || 0; return (window.displayCaps ? window.displayCaps(d).stab : computeMetrics(d).stabilizedCap) || 0; }
    case 'dealIRR':       { if (window.hasExcelReturns && window.hasExcelReturns(d)) { const v = window.dealReturns(d).irr; return v == null ? -1 : v; } if (!window.hasUWInputs || !window.hasUWInputs(d)) return -1; const v = computeUW(d).irr; return v == null ? -1 : v; }
    case 'avgYield':      { if (window.hasExcelReturns && window.hasExcelReturns(d)) { const v = window.dealReturns(d).stabYOC; return v == null ? -1 : v; } if (!window.hasUWInputs || !window.hasUWInputs(d)) return -1; const v = computeUW(d).avgYield; return v == null ? -1 : v; }
    case 'cfoDate':       return d.cfoDate || '';
    case 'lastActivity':  return lastActivityOf(d) || '';
    default:              return '';
  }
}

/* Inline stage dropdown — styled to read like the stage badge but editable in place */
function StageSelect({ stage, onChange }) {
  const meta = STAGE_META[stage] || STAGE_META['New Deal'];
  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 22px 3px 10px', borderRadius: 999,
        background: meta.bg, color: meta.c, fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', lineHeight: 1.3, pointerEvents: 'none' }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: meta.c }} />{meta.label}
      </span>
      <Icon name="chevD" size={11} style={{ position: 'absolute', right: 7, color: meta.c, pointerEvents: 'none' }} />
      <select value={stage} onChange={(e) => onChange(e.target.value)} title="Change stage"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 'none', appearance: 'none' }}>
        {STAGE_ALL.map((s) => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
      </select>
    </div>
  );
}

/* Inline free-text status — debounced into onPatch so typing stays smooth */
function StatusInput({ value, onChange }) {
  const [v, setV] = useS(value);
  const ref = useR(value);
  useE(() => { if (value !== ref.current) { ref.current = value; setV(value); } }, [value]);
  const commit = (nv) => { ref.current = nv; onChange(nv); };
  return (
    <input value={v} placeholder="Add status…"
      onChange={(e) => setV(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      style={{ width: '100%', border: '1px solid transparent', borderRadius: 6, background: 'transparent',
        padding: '5px 7px', fontSize: 12.5, color: v ? 'var(--ink)' : 'var(--faint)', fontFamily: 'var(--font)',
        outline: 'none', boxSizing: 'border-box' }}
      onFocus={(e) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.background = 'var(--panel)'; e.target.style.boxShadow = '0 0 0 3px var(--accent-soft)'; }}
      onMouseEnter={(e) => { if (document.activeElement !== e.target) e.target.style.borderColor = 'var(--line-2)'; }}
      onMouseLeave={(e) => { if (document.activeElement !== e.target) e.target.style.borderColor = 'transparent'; }}
      onBlurCapture={(e) => { e.target.style.borderColor = 'transparent'; e.target.style.background = 'transparent'; e.target.style.boxShadow = 'none'; }} />
  );
}

function PipelineTable({ deals, onOpen, onPatch, onBulkPatch, onBulkDelete, onReorder, omMap, t12Map, rrMap, onOM, onT12, onRR, sortKey: sortKeyProp, sortDir: sortDirProp, onSortKeyChange, onSortDirChange, taskApi }) {
  // The Tasks column only shows where a task store is passed in (the active pipeline, not Dead Deals).
  const COLS = taskApi && window.PipelineTaskCell ? PIPE_COLS : PIPE_COLS.filter((c) => c.key !== 'tasks');
  const [localSortKey, setLocalSortKey] = useS('manual');   // manual = persisted drag order; stage edits never reorder
  const [localSortDir, setLocalSortDir] = useS('asc');
  // sort state is lifted to the app shell when a controller is passed in, so it survives
  // opening/closing a deal (which unmounts this table) instead of resetting to 'manual'.
  const sortKey = sortKeyProp !== undefined ? sortKeyProp : localSortKey;
  const sortDir = sortDirProp !== undefined ? sortDirProp : localSortDir;
  const setSortKey = onSortKeyChange || setLocalSortKey;
  const setSortDir = onSortDirChange || setLocalSortDir;
  const [selected, setSelected] = useS([]);        // selected deal ids (bulk)
  const [dragId, setDragId] = useS(null);          // id being dragged
  const [dropTarget, setDropTarget] = useS(null);  // { id, place:'before'|'after' }

  const [colW, setColW] = useS(() => {
    try { const s = JSON.parse(localStorage.getItem(LS_PIPE_W)); return s && typeof s === 'object' ? { ...DEFAULT_PIPE_W, ...s } : { ...DEFAULT_PIPE_W }; }
    catch (e) { return { ...DEFAULT_PIPE_W }; }
  });
  useE(() => { try { localStorage.setItem(LS_PIPE_W, JSON.stringify(colW)); } catch (e) {} }, [colW]);

  // prune selection to deals still present
  useE(() => {
    const ids = new Set(deals.map((d) => d.id));
    setSelected((sel) => { const next = sel.filter((id) => ids.has(id)); return next.length === sel.length ? sel : next; });
  }, [deals]);

  const startResize = (key, min, e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX, startW = colW[key];
    const onMove = (ev) => setColW((w) => ({ ...w, [key]: Math.max(min || 76, startW + (ev.clientX - startX)) }));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.cursor = ''; document.body.style.userSelect = '';
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
  };

  // header click: asc → desc → back to manual order
  const handleSort = (key) => {
    if (sortKey === key) {
      if (sortDir === 'asc') setSortDir('desc');
      else { setSortKey('manual'); setSortDir('asc'); }
    } else { setSortKey(key); setSortDir('asc'); }
  };

  const manual = sortKey === 'manual';
  const rows = useM(() => {
    if (manual) return deals.slice();   // parent order = persisted manual order
    const arr = deals.slice();
    arr.sort((a, b) => {
      const av = sortValue(a, sortKey), bv = sortValue(b, sortKey);
      let r;
      if (typeof av === 'number' && typeof bv === 'number') r = av - bv;
      else r = String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? r : -r;
    });
    return arr;
  }, [deals, sortKey, sortDir, manual]);

  // selection helpers
  const selSet = new Set(selected);
  const allVisibleSelected = rows.length > 0 && rows.every((d) => selSet.has(d.id));
  const toggleSel = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);
  const toggleAll = () => setSelected(allVisibleSelected ? [] : rows.map((d) => d.id));
  const clearSel = () => setSelected([]);

  // drag reorder
  const onRowDragOver = (id, e) => {
    if (!manual || dragId == null) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const place = (e.clientY - rect.top) < rect.height / 2 ? 'before' : 'after';
    setDropTarget((t) => (t && t.id === id && t.place === place) ? t : { id, place });
  };
  const onRowDrop = (id, e) => {
    if (!manual || dragId == null) return;
    e.preventDefault();
    const place = dropTarget && dropTarget.id === id ? dropTarget.place : 'before';
    const movingIds = selSet.has(dragId) ? selected.slice() : [dragId];
    const allIds = rows.map((d) => d.id);
    const movingSet = new Set(movingIds);
    const orderedMoving = allIds.filter((x) => movingSet.has(x));
    const remaining = allIds.filter((x) => !movingSet.has(x));
    let idx = remaining.indexOf(id);
    if (idx === -1) { setDragId(null); setDropTarget(null); return; }
    if (place === 'after') idx += 1;
    const newIds = [...remaining.slice(0, idx), ...orderedMoving, ...remaining.slice(idx)];
    onReorder && onReorder(newIds);
    setDragId(null); setDropTarget(null);
  };

  const tableRef = useR(null);
  const topRef = useR(null);
  const syncing = useR(false);
  const [scrollW, setScrollW] = useS(0);
  useE(() => {
    const el = tableRef.current; if (!el) return;
    const update = () => setScrollW(el.scrollWidth);
    update();
    let ro;
    if (window.ResizeObserver) { ro = new ResizeObserver(update); ro.observe(el); }
    window.addEventListener('resize', update);
    return () => { if (ro) ro.disconnect(); window.removeEventListener('resize', update); };
  }, []);
  useE(() => { if (tableRef.current) setScrollW(tableRef.current.scrollWidth); }, [colW, rows.length]);
  const onTopScroll = () => { if (syncing.current) return; syncing.current = true; if (tableRef.current && topRef.current) tableRef.current.scrollLeft = topRef.current.scrollLeft; syncing.current = false; };
  const onTableScroll = () => { if (syncing.current) return; syncing.current = true; if (tableRef.current && topRef.current) topRef.current.scrollLeft = tableRef.current.scrollLeft; syncing.current = false; };

  const grid = COLS.map((c) => c.flex ? `minmax(${colW[c.key]}px,1.7fr)` : `${colW[c.key]}px`).join(' ');
  const nameLeft = colW.sel;  // frozen Deal/Asset column sits just right of the select column
  const DOC_ACCEPT = '.pdf,.csv,.txt,.xlsx,.xls,.xlsm,application/pdf,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';

  return (
    <div>
      {/* Bulk action bar */}
      {selected.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 14px', marginBottom: 10,
          background: 'var(--navy)', color: '#fff', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow)' }}>
          <span style={{ fontSize: 13, fontWeight: 600 }} className="num">{selected.length} selected</span>
          <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,.25)' }} />
          <span style={{ fontSize: 12.5, opacity: .85 }}>Set stage</span>
          <select defaultValue="" onChange={(e) => { if (e.target.value) { onBulkPatch(selected, { stage: e.target.value }); e.target.value = ''; } }}
            style={{ height: 30, borderRadius: 7, border: '1px solid rgba(255,255,255,.3)', background: 'rgba(255,255,255,.12)',
              color: '#fff', fontSize: 12.5, fontWeight: 500, padding: '0 8px', cursor: 'pointer' }}>
            <option value="" disabled style={{ color: '#333' }}>Choose…</option>
            {STAGE_ALL.map((s) => <option key={s} value={s} style={{ color: '#333' }}>{STAGE_META[s].label}</option>)}
          </select>
          <button onClick={() => { if (window.confirm(`Delete ${selected.length} deal${selected.length > 1 ? 's' : ''}? This cannot be undone.`)) { onBulkDelete(selected); clearSel(); } }}
            style={{ height: 30, padding: '0 12px', borderRadius: 7, border: '1px solid rgba(255,255,255,.3)',
              background: 'transparent', color: '#fff', fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', gap: 5 }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--neg)'; e.currentTarget.style.borderColor = 'var(--neg)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'rgba(255,255,255,.3)'; }}>
            <Icon name="close" size={12} /> Delete
          </button>
          <button onClick={clearSel} style={{ marginLeft: 'auto', height: 30, padding: '0 12px', borderRadius: 7,
            border: 'none', background: 'rgba(255,255,255,.14)', color: '#fff', fontSize: 12.5, fontWeight: 500, cursor: 'pointer' }}>Clear</button>
        </div>
      )}

      {/* Top horizontal scrollbar — mirrors the table so you can scroll left/right from the top */}
      <div ref={topRef} onScroll={onTopScroll} style={{ overflowX: 'auto', overflowY: 'hidden', height: 14 }}>
        <div style={{ width: scrollW, height: 1 }} />
      </div>

      <div ref={tableRef} onScroll={onTableScroll} style={{ background: 'var(--panel)', border: '1px solid var(--line)',
        borderRadius: 'var(--radius-lg)', overflowX: 'auto', boxShadow: 'var(--shadow)' }}>

        {/* Column headers */}
        <div style={{ display: 'grid', gridTemplateColumns: grid, padding: '0 14px',
          background: 'var(--panel-2)', borderBottom: '1px solid var(--line)', position: 'sticky', top: 0, zIndex: 3 }}>
          {COLS.map((c, ci) => {
            if (c.key === 'sel') return (
              <div key="sel" style={{ padding: '9px 7px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                position: 'sticky', left: 0, zIndex: 4, background: 'var(--panel-2)' }} onClick={(e) => e.stopPropagation()}>
                <CheckBox checked={allVisibleSelected} indeterminate={!allVisibleSelected && selected.length > 0} onChange={toggleAll} title="Select all" />
              </div>
            );
            const frozen = c.key === 'name';
            return (
              <div key={c.key} onClick={c.sortable ? () => handleSort(c.key) : undefined}
                style={{ padding: '9px 7px', fontSize: 10.5, fontWeight: 600, letterSpacing: '.04em',
                  textTransform: 'uppercase', color: sortKey === c.key ? 'var(--accent)' : 'var(--muted)',
                  cursor: c.sortable ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: 4,
                  userSelect: 'none', position: frozen ? 'sticky' : 'relative', left: frozen ? nameLeft : undefined,
                  zIndex: frozen ? 4 : undefined, background: frozen ? 'var(--panel-2)' : undefined,
                  justifyContent: c.align === 'right' ? 'flex-end' : c.align === 'center' ? 'center' : 'flex-start' }}>
                {c.label}
                {c.sortable && sortKey === c.key && <Icon name={sortDir === 'asc' ? 'arrowU' : 'arrowD'} size={10} />}
                {c.key !== 'sel' && ci < COLS.length - 1 && (
                  <div onMouseDown={(e) => startResize(c.key, c.min, e)} onClick={(e) => e.stopPropagation()}
                    title="Drag to resize"
                    style={{ position: 'absolute', top: 0, right: -5, width: 11, height: '100%', cursor: 'col-resize', zIndex: 5 }}
                    onMouseEnter={(e) => { const b = e.currentTarget.firstChild; if (b) b.style.background = 'var(--accent)'; }}
                    onMouseLeave={(e) => { const b = e.currentTarget.firstChild; if (b) b.style.background = 'transparent'; }}>
                    <div style={{ position: 'absolute', right: 5, top: '20%', height: '60%', width: 2, background: 'transparent', borderRadius: 2, transition: 'background .1s' }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Empty state */}
        {rows.length === 0 && (
          <div style={{ textAlign: 'center', padding: '64px 24px', color: 'var(--muted)' }}>
            <div style={{ fontSize: 30, marginBottom: 10, color: 'var(--faint)' }}>∅</div>
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>No deals match your filters.</div>
          </div>
        )}

        {/* Rows */}
        {rows.map((d, i) => {
          const meta = STAGE_META[d.stage] || STAGE_META['New Deal'];
          const isSel = selSet.has(d.id);
          const isDragging = dragId === d.id;
          const showLine = dropTarget && dropTarget.id === d.id;
          return (
            <div key={d.id} onClick={() => onOpen(d.id)}
              onDragOver={(e) => onRowDragOver(d.id, e)} onDrop={(e) => onRowDrop(d.id, e)}
              style={{
                display: 'grid', gridTemplateColumns: grid, alignItems: 'center', padding: '0 14px',
                minHeight: 52, cursor: 'pointer', borderBottom: i < rows.length - 1 ? '1px solid var(--line)' : 'none',
                background: isSel ? 'var(--accent-soft)' : 'var(--panel)', opacity: isDragging ? .4 : 1,
                boxShadow: showLine ? (dropTarget.place === 'before' ? 'inset 0 2px 0 var(--accent)' : 'inset 0 -2px 0 var(--accent)') : 'none',
                transition: 'background .1s' }}
              onMouseEnter={(e) => { if (!isSel) { e.currentTarget.style.background = 'var(--accent-soft)'; const c = e.currentTarget.children; if (c[0]) c[0].style.background = 'var(--accent-soft)'; if (c[1]) c[1].style.background = 'var(--accent-soft)'; } }}
              onMouseLeave={(e) => { if (!isSel) { e.currentTarget.style.background = 'var(--panel)'; const c = e.currentTarget.children; if (c[0]) c[0].style.background = 'var(--panel)'; if (c[1]) c[1].style.background = 'var(--panel)'; } }}>

              {/* Select + drag handle */}
              <div style={{ padding: '8px 7px', display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center',
                position: 'sticky', left: 0, zIndex: 2, background: isSel ? 'var(--accent-soft)' : 'var(--panel)' }} onClick={(e) => e.stopPropagation()}>
                {manual && (
                  <span draggable onDragStart={(e) => { setDragId(d.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', d.id); }}
                    onDragEnd={() => { setDragId(null); setDropTarget(null); }}
                    title="Drag to reorder" style={{ cursor: 'grab', color: 'var(--faint)', display: 'inline-flex', padding: '2px 1px', lineHeight: 0 }}
                    onMouseEnter={(e) => e.currentTarget.style.color = 'var(--slate)'}
                    onMouseLeave={(e) => e.currentTarget.style.color = 'var(--faint)'}>
                    <GripIcon />
                  </span>
                )}
                <CheckBox checked={isSel} onChange={() => toggleSel(d.id)} />
              </div>

              {/* Deal / Asset — frozen pane */}
              <div style={{ padding: '8px 7px', display: 'flex', alignItems: 'center', gap: 11, minWidth: 0,
                position: 'sticky', left: nameLeft, zIndex: 2, background: isSel ? 'var(--accent-soft)' : 'var(--panel)' }}>
                <div style={{ minWidth: 0 }}>
                  <div className="clip" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.25, display: 'flex', alignItems: 'center', gap: 2 }}>
                    {d.name}
                    <StarToggle on={!!d.starred} onToggle={() => onPatch(d.id, { starred: !d.starred })} size={18} />
                  </div>
                  <div className="clip" style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>
                    {[d.type, d.units ? fmtNum(d.units) + ' units' : d.vintage ? 'Built ' + d.vintage : null].filter(Boolean).join(' · ')}
                  </div>
                </div>
              </div>

              {/* Market */}
              <div className="clip" style={{ padding: '8px 7px', fontSize: 12.5, color: 'var(--slate)', fontWeight: 400 }}>{d.market || '—'}</div>

              {/* Stage — inline editable */}
              <div style={{ padding: '8px 7px' }} onClick={(e) => e.stopPropagation()}>
                <StageSelect stage={d.stage} onChange={(s) => onPatch(d.id, { stage: s })} />
              </div>

              {/* Status — free text */}
              <div style={{ padding: '8px 7px' }} onClick={(e) => e.stopPropagation()}>
                <StatusInput value={d.status != null ? d.status : (d._rawStatus || '')} onChange={(v) => onPatch(d.id, { status: v })} />
              </div>

              {/* Tasks — open tasks for the deal + quick add */}
              {COLS.some((c) => c.key === 'tasks') &&
              <div style={{ padding: '6px 7px', minWidth: 0 }} onClick={(e) => e.stopPropagation()}>
                <window.PipelineTaskCell dealId={d.id} todos={taskApi.todos} onAdd={taskApi.add} onPatch={taskApi.patch} />
              </div>}

              {/* Assignee */}
              <div style={{ padding: '8px 7px', display: 'flex', alignItems: 'center', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                <AssigneePicker value={d.assignees} onChange={(v) => onPatch(d.id, { assignees: v })} size={22} />
                <OffMarketToggle on={!!d.offMarket} onToggle={() => onPatch(d.id, { offMarket: !d.offMarket })} size={17} />
              </div>

              {/* Ask */}
              <div className="num" style={{ padding: '8px 7px', fontSize: 13, fontWeight: 600, color: 'var(--ink)', textAlign: 'right' }}>{d.askPrice ? fmtShort(d.askPrice) : '—'}</div>

              {/* UW Price */}
              <div className="num" style={{ padding: '8px 7px', fontSize: 13, fontWeight: 500, color: 'var(--slate)', textAlign: 'right' }}>{d.purchasePrice ? fmtShort(d.purchasePrice) : '—'}</div>

              {/* CFO Date */}
              <div style={{ padding: '8px 7px', fontSize: 12.5, color: d.cfoDate ? 'var(--slate)' : 'var(--faint)', fontWeight: 400 }}>{d.cfoDate ? fmtDateShort(d.cfoDate) : '—'}</div>

              {/* Last Activity */}
              <div style={{ padding: '8px 7px', fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>{fmtRelative(lastActivityOf(d))}</div>

              {/* Files */}
              <div style={{ padding: '8px 7px', display: 'flex', gap: 5, justifyContent: 'center', flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
                <DocBar dealId={d.id} omMap={omMap} t12Map={t12Map} rrMap={rrMap} onOM={onOM} onT12={onT12} onRR={onRR} onOpenDeal={onOpen} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// minimal checkbox + grip handle
function CheckBox({ checked, indeterminate, onChange, title }) {
  const ref = useR(null);
  useE(() => { if (ref.current) ref.current.indeterminate = !!indeterminate; }, [indeterminate]);
  return (
    <input ref={ref} type="checkbox" checked={!!checked} title={title}
      onChange={(e) => { e.stopPropagation(); onChange(); }} onClick={(e) => e.stopPropagation()}
      style={{ width: 15, height: 15, cursor: 'pointer', accentColor: 'var(--accent)', margin: 0 }} />
  );
}
function GripIcon() {
  return (
    <svg width="11" height="16" viewBox="0 0 11 16" fill="currentColor" aria-hidden="true">
      <circle cx="3" cy="3" r="1.4" /><circle cx="8" cy="3" r="1.4" />
      <circle cx="3" cy="8" r="1.4" /><circle cx="8" cy="8" r="1.4" />
      <circle cx="3" cy="13" r="1.4" /><circle cx="8" cy="13" r="1.4" />
    </svg>
  );
}

/* ========================= Add deal modal ========================= */
const TYPE_OPTS = Object.keys(TYPE_META);
const BLANK_DEAL = { name: '', type: 'Multifamily', bucket: 'Pipeline', stage: 'New Deal', market: '', broker: '', units: '', vintage: '', askPrice: '', purchasePrice: '', capex: '', offMarket: false, isPortfolio: false, properties: [] };

function MField({ label, children, span }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5, gridColumn: span ? '1 / -1' : 'auto' }}>
      <span style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--muted)', letterSpacing: '.04em', textTransform: 'uppercase' }}>{label}</span>
      {children}
    </label>);

}
const mInput = { border: '1px solid var(--line-2)', borderRadius: 8, background: 'var(--panel)', height: 36, padding: '0 11px', fontSize: 13, color: 'var(--ink)', outline: 'none', width: '100%', boxSizing: 'border-box' };

function AddDealModal({ onClose, onAdd }) {
  const [f, setF] = useS(BLANK_DEAL);
  const [omState, setOmState] = useS('idle'); // idle | parsing | done | error
  const [omMsg, setOmMsg] = useS('');
  const [omFields, setOmFields] = useS(null);  // financial fields pulled from the OM
  const [omContacts, setOmContacts] = useS(null);
  const omFileRef = useR(null);
  const fileRef = useR(null);
  const [dragOver, setDragOver] = useS(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const ref = useR(null);
  useE(() => {ref.current?.focus();const esc = (e) => {if (e.key === 'Escape') onClose();};window.addEventListener('keydown', esc);return () => window.removeEventListener('keydown', esc);}, []);
  const num = (v) => {const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));return isNaN(n) ? null : n;};

  // Upload an OM and auto-fill the form (name, market, units, vintage, broker + financials).
  const handleOM = async (file) => {
    if (!file) return;
    setOmState('parsing'); setOmMsg(file.name);
    omFileRef.current = file;   // kept so the new deal's Document Vault gets the OM
    try {
      const { parsed } = await runOMParse(file);
      setF((s) => ({
        ...s,
        name: s.name || parsed.name || '',
        market: parsed.market || s.market,
        units: parsed.units != null ? String(parsed.units) : s.units,
        vintage: parsed.vintage || s.vintage,
        broker: parsed.brokerFirm || s.broker,
      }));
      setOmFields({
        trailingEGI: parsed.effectiveGrossIncome != null ? Number(parsed.effectiveGrossIncome) : null,
        currentOpexTotal: parsed.totalOpex != null ? Number(parsed.totalOpex) : null,
        brokerEGI: parsed.brokerEGI != null ? Number(parsed.brokerEGI) : null,
      });
      const named = (Array.isArray(parsed.brokerContacts) ? parsed.brokerContacts : []).filter((c) => c && c.name).slice(0, 6);
      setOmContacts({ firm: parsed.brokerFirm || '', people: named, brokerOffice: parsed.brokerOffice || null, market: parsed.market || null });
      const got = ['name','market','units','vintage','brokerFirm'].filter((k) => parsed[k] != null && parsed[k] !== '').length;
      setOmState('done'); setOmMsg(got + ' field' + (got === 1 ? '' : 's') + ' filled from ' + file.name + ' — review below');
    } catch (e) {
      setOmState('error'); setOmMsg(String(e && e.message ? e.message : e));
    }
  };

  const valid = f.name.trim().length > 0;
  const submit = () => {
    if (!valid) return;
    onAdd({ id: 'new-' + Date.now(), name: f.name.trim(), type: f.type, bucket: f.bucket, stage: f.stage,
      market: f.market.trim(), broker: f.broker.trim(), analyst: null,
      units: num(f.units), purchasePrice: num(f.purchasePrice), askPrice: num(f.askPrice), capex: num(f.capex),
      vintage: (f.vintage||'').trim() || null, offMarket: !!f.offMarket,
      trailingEGI: null, currentOpexTotal: null, marketOpexPerUnit: 0, brokerEGI: null, debt: null,
      dateEntered: window.ALTUS_TODAY, dateLOISubmitted: null, loiAmount: null,
      dateUnderContract: null, dateLost: null, notes: '', status: '', _rawStatus: '',
      ...(omFields || {}),
      _omContacts: omContacts && omContacts.people.length ? omContacts : undefined,
      _omFile: omFileRef.current || undefined });
    onClose();
  };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '6vh 16px' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(11,25,45,.45)', animation: 'scrimIn .18s ease both' }} />
      <div style={{ position: 'relative', width: 'min(580px,100%)', background: 'var(--bg)',
        borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)',
        animation: 'modalIn .22s cubic-bezier(.2,.7,.2,1) both',
        display: 'flex', flexDirection: 'column', maxHeight: '88vh' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--line)' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--ink)' }}>Add a deal</h3>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>Name is required. Fill in what you have — everything is editable later.</p>
          </div>
          <button onClick={onClose} style={{ border: 'none', background: 'var(--panel-2)', borderRadius: 7, width: 30, height: 30,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--slate)', cursor: 'pointer' }}>
            <Icon name="close" size={15} />
          </button>
        </div>
        <div style={{ padding: '18px 20px', overflowY: 'auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '13px 14px' }}>
          {/* OM auto-fill */}
          <div style={{ gridColumn: '1 / -1' }}>
            <input ref={fileRef} type="file" accept=".pdf,application/pdf" style={{ display: 'none' }}
              onChange={(e) => { const file = e.target.files && e.target.files[0]; e.target.value = ''; handleOM(file); }} />
            <div onClick={() => omState !== 'parsing' && fileRef.current && fileRef.current.click()}
              onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); if (omState !== 'parsing') setDragOver(true); }}
              onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); }}
              onDrop={(e) => {
                e.preventDefault(); e.stopPropagation(); setDragOver(false);
                if (omState === 'parsing') return;
                const file = e.dataTransfer.files && e.dataTransfer.files[0];
                if (file) handleOM(file);
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 14px', cursor: omState === 'parsing' ? 'wait' : 'pointer',
                border: '1px dashed ' + (dragOver ? 'var(--accent)' : omState === 'done' ? 'var(--pos)' : omState === 'error' ? 'var(--neg)' : 'var(--line-2)'),
                borderRadius: 9, transition: 'border-color .12s, background .12s',
                background: dragOver ? 'var(--accent-soft)' : omState === 'done' ? 'rgba(12,122,67,.05)' : 'var(--panel-2)' }}>
              <span style={{ width: 32, height: 32, borderRadius: 8, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                background: omState === 'done' ? 'var(--pos)' : 'var(--accent)', color: '#fff' }}>
                {omState === 'parsing' ? <SpinIcon /> : <Icon name={omState === 'done' ? 'check' : 'upload'} size={16} />}
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>
                  {omState === 'parsing' ? 'Reading OM…' : omState === 'done' ? 'OM parsed' : omState === 'error' ? 'Couldn’t read that OM' : 'Upload an OM to auto-fill'}
                </div>
                <div style={{ fontSize: 11.5, color: omState === 'error' ? 'var(--neg)' : 'var(--muted)', marginTop: 1,
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {omState === 'idle' ? (dragOver ? 'Drop the PDF to parse' : 'PDF · drag & drop or click · pulls name, market, units, vintage, broker & financials') : omMsg}
                </div>
              </div>
            </div>
          </div>
          <MField label="Deal name" span>
            <input ref={ref} value={f.name} onChange={(e) => set('name', e.target.value)}
            placeholder="e.g. Bell Point — Indiana" style={mInput} />
          </MField>
          <MField label="Type">
            <select value={f.type} onChange={(e) => set('type', e.target.value)} style={{ ...mInput, cursor: 'pointer' }}>
              {TYPE_OPTS.map((o) => <option key={o}>{o}</option>)}
            </select>
          </MField>
          <MField label="Stage">
            <select value={f.stage} onChange={(e) => set('stage', e.target.value)} style={{ ...mInput, cursor: 'pointer' }}>
              {STAGE_ALL.map((o) => <option key={o} value={o}>{STAGE_META[o].label}</option>)}
            </select>
          </MField>
          <MField label="Market"><input value={f.market} onChange={(e) => set('market', e.target.value)} placeholder="City, ST" style={mInput} /></MField>
          <MField label="Broker / Firm"><input value={f.broker} onChange={(e) => set('broker', e.target.value)} placeholder="Firm — Name" style={mInput} /></MField>
          <MField label="Sourcing" span>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--ink)' }}>
              <input type="checkbox" checked={!!f.offMarket} onChange={(e) => set('offMarket', e.target.checked)} style={{ width: 15, height: 15, cursor: 'pointer' }} />
              Off-market deal (sourced directly, not a broker listing)
            </label>
          </MField>
          <MField label="Units"><input value={f.units} onChange={(e) => set('units', groupNum(e.target.value))} inputMode="numeric" placeholder="0" style={mInput} /></MField>
          <MField label="Vintage"><input value={f.vintage} onChange={(e) => set('vintage', e.target.value)} placeholder="e.g. 1985" style={mInput} /></MField>
          <MField label="Ask price ($)"><input value={f.askPrice} onChange={(e) => set('askPrice', groupNum(e.target.value))} inputMode="numeric" placeholder="0" style={mInput} /></MField>
          <MField label="UW price ($)"><input value={f.purchasePrice} onChange={(e) => set('purchasePrice', groupNum(e.target.value))} inputMode="numeric" placeholder="0" style={mInput} /></MField>
          <MField label="CapEx ($)"><input value={f.capex} onChange={(e) => set('capex', groupNum(e.target.value))} inputMode="numeric" placeholder="0" style={mInput} /></MField>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, padding: '12px 20px', borderTop: '1px solid var(--line)' }}>
          <button onClick={onClose} style={{ height: 36, padding: '0 14px', border: '1px solid var(--line-2)',
            borderRadius: 7, background: 'var(--panel)', fontSize: 13, fontWeight: 500, color: 'var(--slate)', cursor: 'pointer' }}>Cancel</button>
          <button onClick={submit} disabled={!valid} style={{ height: 36, padding: '0 16px', border: 'none',
            borderRadius: 7, background: valid ? 'var(--accent)' : 'var(--line-2)', color: '#fff',
            fontSize: 13, fontWeight: 600, cursor: valid ? 'pointer' : 'not-allowed',
            display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Icon name="plus" size={14} /> Add deal
          </button>
        </div>
      </div>
    </div>);

}

/* ========================= Pipeline view ========================= */
// CSV parser (RFC-4180-ish: handles quoted fields, embedded commas/newlines, "" escapes)
function parseCSV(text) {
  const rows = []; let field = '', row = [], inQ = false, i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQ = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"') { inQ = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; i++; continue; }
    if (c === '\r') { i++; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += c; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const NOTION_STAGE_MAP = {
  'needs underwriting': 'New Deal', 'need underwriting': 'New Deal', 'needs uw': 'New Deal', 'new deal': 'New Deal', 'new': 'New Deal',
  'quick uw': 'Quick UW', 'quick underwriting': 'Quick UW',
  'underwritten': 'Full UW', 'underwriting': 'Full UW', 'full uw': 'Full UW',
  'excel uw': 'Excel UW', 'excel': 'Excel UW',
  'loi submitted': 'LOI Submitted', 'loi': 'LOI Submitted', 'loi out': 'LOI Submitted',
  'under contract': 'Under Contract', 'psa': 'Under Contract',
  'purchased': 'Purchased', 'closed': 'Purchased', 'acquired': 'Purchased',
  'loi lost': 'LOI Lost', 'lost': 'LOI Lost',
  'pass': 'Dead', 'passed': 'Dead', 'dead': 'Dead', 'done': 'Dead',
};
function mapNotionStage(stage, database, status) {
  const s = (stage || '').trim().toLowerCase();
  const db = (database || '').trim().toLowerCase();
  const st = (status || '').trim().toLowerCase();
  if (db.includes('pass') || db.includes('done') || st === 'pass') return 'Dead';
  return NOTION_STAGE_MAP[s] || 'New Deal';
}
function csvMoney(v) { const n = Number(String(v == null ? '' : v).replace(/[$,()\s]/g, '')); return isNaN(n) ? 0 : n; }
function parseNotionDate(s) { if (!s) return null; const d = new Date(s); return isNaN(d) ? null : d.toISOString().slice(0, 10); }
// Map a Notion pipeline CSV export → deal objects. Dedupes against existingNames (Set of lowercased names).
function notionRowsToDeals(text, existingNames) {
  const rows = parseCSV(text);
  if (rows.length < 2) return { deals: [], skipped: 0, total: 0 };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = (n) => header.indexOf(n);
  const col = {
    name: idx('name'), ask: idx('ask price'), cfo: idx('cfo date'), db: idx('database'),
    edited: idx('last edited time'), type: idx('product type'), email: idx("sender's email"),
    sender: idx("sender's name"), stage: idx('stage'), status: idx('status'), uw: idx('uw price'),
  };
  if (col.name < 0) return { deals: [], skipped: 0, total: 0, badHeader: true };
  const seen = new Set([...(existingNames || [])]);
  const get = (row, c) => (c >= 0 && row[c] != null ? String(row[c]).trim() : '');
  const deals = []; let skipped = 0, total = 0;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r]; if (!row) continue;
    const name = get(row, col.name); if (!name) continue;
    total++;
    const key = name.toLowerCase();
    if (seen.has(key)) { skipped++; continue; }
    seen.add(key);
    const type = get(row, col.type) || 'Multifamily';
    const status = get(row, col.status);
    deals.push({
      id: 'imp_' + Date.now().toString(36) + '_' + r,
      name, type, bucket: 'Pipeline',
      stage: mapNotionStage(get(row, col.stage), get(row, col.db), status),
      status,
      market: '', broker: get(row, col.sender), brokerEmail: get(row, col.email),
      units: '', vintage: null,
      askPrice: csvMoney(get(row, col.ask)), purchasePrice: csvMoney(get(row, col.uw)), capex: 0,
      cfoDate: parseNotionDate(get(row, col.cfo)),
      trailingEGI: null, currentOpexTotal: null, marketOpexPerUnit: 0, brokerEGI: null, debt: null,
      dateEntered: parseNotionDate(get(row, col.edited)) || window.ALTUS_TODAY,
      notes: '', _rawStatus: status,
    });
  }
  return { deals, skipped, total };
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--panel)',
      border: '1px solid var(--line-2)', borderRadius: 8, padding: '0 4px 0 10px', height: 36 }}>
      <span style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 600, letterSpacing: '.01em' }}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}
      style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 13, fontWeight: 400,
        color: 'var(--ink)', padding: '7px 4px', cursor: 'pointer' }}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>);

}

/* ========================= Metro normalization ========================= */
const METRO_MAP = {
  // Dallas–Fort Worth
  'Dallas, TX':'Dallas–Fort Worth, TX','Fort Worth, TX':'Dallas–Fort Worth, TX',
  'Lewisville, TX':'Dallas–Fort Worth, TX','Plano, TX':'Dallas–Fort Worth, TX',
  'Frisco, TX':'Dallas–Fort Worth, TX','Allen, TX':'Dallas–Fort Worth, TX',
  'McKinney, TX':'Dallas–Fort Worth, TX','Arlington, TX':'Dallas–Fort Worth, TX',
  'Irving, TX':'Dallas–Fort Worth, TX','Denton, TX':'Dallas–Fort Worth, TX',
  'Garland, TX':'Dallas–Fort Worth, TX','Mesquite, TX':'Dallas–Fort Worth, TX',
  'Carrollton, TX':'Dallas–Fort Worth, TX','Mansfield, TX':'Dallas–Fort Worth, TX',
  'Grapevine, TX':'Dallas–Fort Worth, TX','Grand Prairie, TX':'Dallas–Fort Worth, TX',
  'Southlake, TX':'Dallas–Fort Worth, TX','Euless, TX':'Dallas–Fort Worth, TX',
  'Bedford, TX':'Dallas–Fort Worth, TX','Hurst, TX':'Dallas–Fort Worth, TX',
  'Keller, TX':'Dallas–Fort Worth, TX','Waxahachie, TX':'Dallas–Fort Worth, TX',
  // Oklahoma City
  'Midwest City, OK':'Oklahoma City, OK','Edmond, OK':'Oklahoma City, OK',
  'Norman, OK':'Oklahoma City, OK','Moore, OK':'Oklahoma City, OK',
  'Del City, OK':'Oklahoma City, OK','Yukon, OK':'Oklahoma City, OK',
  'Mustang, OK':'Oklahoma City, OK','Bethany, OK':'Oklahoma City, OK',
  // Tulsa
  'Broken Arrow, OK':'Tulsa, OK','Owasso, OK':'Tulsa, OK',
  'Bixby, OK':'Tulsa, OK','Jenks, OK':'Tulsa, OK',
  'Sand Springs, OK':'Tulsa, OK','Sapulpa, OK':'Tulsa, OK',
  // Indianapolis
  'Carmel, IN':'Indianapolis, IN','Fishers, IN':'Indianapolis, IN',
  'Greenwood, IN':'Indianapolis, IN','Noblesville, IN':'Indianapolis, IN',
  'Lawrence, IN':'Indianapolis, IN','Avon, IN':'Indianapolis, IN',
  'Plainfield, IN':'Indianapolis, IN','Brownsburg, IN':'Indianapolis, IN',
  // Nashville
  'Murfreesboro, TN':'Nashville, TN','Franklin, TN':'Nashville, TN',
  'Brentwood, TN':'Nashville, TN','Smyrna, TN':'Nashville, TN',
  'Hendersonville, TN':'Nashville, TN','Gallatin, TN':'Nashville, TN',
  'Clarksville, TN':'Nashville, TN','Spring Hill, TN':'Nashville, TN',
  // Memphis
  'Bartlett, TN':'Memphis, TN','Germantown, TN':'Memphis, TN',
  'Collierville, TN':'Memphis, TN','Southaven, MS':'Memphis, TN',
  // Chattanooga
  'East Ridge, TN':'Chattanooga, TN','Hixson, TN':'Chattanooga, TN',
  // San Antonio
  'New Braunfels, TX':'San Antonio, TX','Schertz, TX':'San Antonio, TX',
  'Converse, TX':'San Antonio, TX','Universal City, TX':'San Antonio, TX',
  // Houston
  'The Woodlands, TX':'Houston, TX','Sugar Land, TX':'Houston, TX',
  'Katy, TX':'Houston, TX','Pearland, TX':'Houston, TX',
  'Lake Jackson, TX':'Houston, TX','Pasadena, TX':'Houston, TX',
  'Baytown, TX':'Houston, TX','Missouri City, TX':'Houston, TX',
  // Phoenix
  'Scottsdale, AZ':'Phoenix, AZ','Tempe, AZ':'Phoenix, AZ',
  'Mesa, AZ':'Phoenix, AZ','Chandler, AZ':'Phoenix, AZ',
  'Gilbert, AZ':'Phoenix, AZ','Peoria, AZ':'Phoenix, AZ',
  'Glendale, AZ':'Phoenix, AZ','Surprise, AZ':'Phoenix, AZ',
  'Avondale, AZ':'Phoenix, AZ','Goodyear, AZ':'Phoenix, AZ',
  // Denver
  'Aurora, CO':'Denver, CO','Lakewood, CO':'Denver, CO',
  'Arvada, CO':'Denver, CO','Westminster, CO':'Denver, CO',
  'Englewood, CO':'Denver, CO','Centennial, CO':'Denver, CO',
  'Thornton, CO':'Denver, CO','Commerce City, CO':'Denver, CO',
  'Littleton, CO':'Denver, CO','Highlands Ranch, CO':'Denver, CO',
  // Sacramento
  'Elk Grove, CA':'Sacramento, CA','Roseville, CA':'Sacramento, CA',
  'Folsom, CA':'Sacramento, CA','Rancho Cordova, CA':'Sacramento, CA',
  'Citrus Heights, CA':'Sacramento, CA','Rocklin, CA':'Sacramento, CA',
  // Reno
  'Sparks, NV':'Reno, NV','Carson City, NV':'Reno, NV',
  // Little Rock
  'North Little Rock, AR':'Little Rock, AR','Conway, AR':'Little Rock, AR',
  'Benton, AR':'Little Rock, AR','Maumelle, AR':'Little Rock, AR',
  'Bryant, AR':'Little Rock, AR','Elkins, AR':'Little Rock, AR',
  // Columbia SC
  'West Columbia, SC':'Columbia, SC','Lexington, SC':'Columbia, SC',
  'Irmo, SC':'Columbia, SC','Cayce, SC':'Columbia, SC',
  // Greenville NC / SC
  'Greer, SC':'Greenville, NC','Mauldin, SC':'Greenville, NC',
  'Simpsonville, SC':'Greenville, NC','Spartanburg, SC':'Greenville, NC',
  'Rural Hall, NC':'Greenville, NC',
};
function normalizeMarket(m){ if(!m) return 'No Market Set'; const t=m.trim(); return METRO_MAP[t]||t; }
function getBrokerFirm(b){ if(!b) return 'Unknown'; return b.split(/\s*[—\-–]\s*/)[0].trim(); }

/* ========================= Submarket-grouped table ========================= */
function SubmarketTable({ deals, onOpen, onPatch, omMap, t12Map, rrMap, onOM, onT12, onRR }) {
  const [brokerTab, setBrokerTab] = useS('All');

  // Sorted unique broker firms present in the current deal set
  const brokerFirms = useM(() => {
    const firms = new Set();
    deals.forEach(d => { if (d.broker) firms.add(getBrokerFirm(d.broker)); });
    return ['All', ...Array.from(firms).sort()];
  }, [deals]);

  // Filter by broker tab, then group by consolidated metro market
  const groups = useM(() => {
    const vis = brokerTab === 'All' ? deals : deals.filter(d => getBrokerFirm(d.broker) === brokerTab);
    const map = {};
    vis.forEach(d => {
      const key = normalizeMarket(d.market);
      if (!map[key]) map[key] = [];
      map[key].push(d);
    });
    return Object.entries(map).sort(([a],[b]) => a.localeCompare(b));
  }, [deals, brokerTab]);

  const cols = [
    { key:'name',          label:'Deal',      w:'minmax(180px,2fr)' },
    { key:'stage',         label:'Stage',     w:'158px' },
    { key:'type',          label:'Type',      w:'100px' },
    { key:'units',         label:'Units',     w:'72px',  align:'right' },
    { key:'askPrice',      label:'Ask',       w:'100px', align:'right' },
    { key:'purchasePrice', label:'UW Price',  w:'100px', align:'right' },
    { key:'stabilized',    label:'Stab. Cap', w:'90px',  align:'right' },
    { key:'assignee',      label:'Assignee',  w:'110px' },
    { key:'files',         label:'Files',     w:'200px', align:'center' },
  ];
  const grid = cols.map(c=>c.w).join(' ');

  return (
    <div>
      {/* ── Brokerage firm tabs ── */}
      <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:18, paddingBottom:4,
        borderBottom:'1px solid var(--line)' }}>
        {brokerFirms.map(firm => {
          const count = firm === 'All' ? deals.length : deals.filter(d => getBrokerFirm(d.broker) === firm).length;
          const active = brokerTab === firm;
          return (
            <button key={firm} onClick={() => setBrokerTab(firm)} style={{
              display:'inline-flex', alignItems:'center', gap:6,
              padding:'5px 13px', borderRadius:20,
              border: active ? '1.5px solid var(--accent)' : '1.5px solid var(--line-2)',
              background: active ? 'var(--accent)' : 'var(--panel)',
              color: active ? '#fff' : 'var(--slate)',
              fontSize:12.5, fontWeight: active ? 600 : 400,
              cursor:'pointer', fontFamily:'var(--font)', transition:'all .15s',
              whiteSpace:'nowrap', boxShadow: active ? '0 1px 4px rgba(47,109,240,.25)' : 'none' }}>
              {firm}
              <span style={{ fontSize:11, opacity: active ? .85 : .65,
                background: active ? 'rgba(255,255,255,.2)' : 'var(--panel-3)',
                color: active ? '#fff' : 'var(--muted)',
                padding:'1px 6px', borderRadius:10, fontWeight:600 }}>
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ── Market groups ── */}
      {!groups.length ? (
        <div style={{ textAlign:'center', padding:'72px 24px', color:'var(--muted)' }}>
          <div style={{ fontSize:32, marginBottom:12 }}>∅</div>
          <div style={{ fontSize:14, fontWeight:500 }}>No deals match your filters.</div>
        </div>
      ) : (
        <div style={{ display:'flex', flexDirection:'column', gap:18 }}>
          {groups.map(([market, items]) => {
            const vol = items.reduce((s,d) => s+(d.purchasePrice||0), 0);
            return (
              <div key={market} style={{ background:'var(--panel)', border:'1px solid var(--line)',
                borderRadius:'var(--radius-lg)', overflow:'hidden', boxShadow:'var(--shadow)' }}>
                {/* Market header */}
                <div style={{ display:'flex', alignItems:'center', gap:10, padding:'11px 16px', background:'var(--navy)' }}>
                  <span style={{ width:22, height:22, borderRadius:6, background:'rgba(255,255,255,.12)',
                    display:'inline-flex', alignItems:'center', justifyContent:'center', flex:'none' }}>
                    <Icon name="search" size={11} style={{ color:'#8aaac8' }}/>
                  </span>
                  <span style={{ fontWeight:700, fontSize:13.5, color:'#fff', flex:1 }}>{market}</span>
                  <span className="num" style={{ fontSize:12, color:'#8aaac8' }}>
                    {items.length} deal{items.length!==1?'s':''}
                    {vol>0 ? ' · '+fmtShort(vol) : ''}
                  </span>
                </div>
                {/* Column headers */}
                <div style={{ display:'grid', gridTemplateColumns:grid, padding:'0 14px',
                  background:'var(--panel-3)', borderBottom:'1px solid var(--line)' }}>
                  {cols.map(c=>(
                    <div key={c.key} style={{ padding:'7px 6px', fontSize:10.5, fontWeight:600,
                      letterSpacing:'.04em', textTransform:'uppercase', color:'var(--muted)',
                      textAlign:c.align||'left' }}>{c.label}</div>
                  ))}
                </div>
                {/* Rows */}
                {items.map((d,i) => {
                  const m = computeMetrics(d);
                  const caps = window.displayCaps ? window.displayCaps(d) : { goingIn:m.goingInCap, stab:m.stabilizedCap };
                  return (
                    <div key={d.id} onClick={()=>onOpen(d.id)} style={{
                      display:'grid', gridTemplateColumns:grid, alignItems:'center',
                      padding:'0 14px', minHeight:46, cursor:'pointer',
                      borderBottom:i<items.length-1?'1px solid var(--line)':'none',
                      background:i%2===1?'var(--panel-2)':'var(--panel)', transition:'background .1s' }}
                      onMouseEnter={e=>e.currentTarget.style.background='var(--accent-soft)'}
                      onMouseLeave={e=>e.currentTarget.style.background=i%2===1?'var(--panel-2)':'var(--panel)'}>
                      <div style={{ padding:'8px 6px', minWidth:0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:6, minWidth:0 }} onClick={e=>e.stopPropagation()}>
                          <span className="clip" style={{ fontSize:13.5, fontWeight:600, color:'var(--ink)', display:'block' }}>{d.name}</span>
                        </div>
                        {d.broker && <span className="clip" style={{ fontSize:11, color:'var(--muted)', display:'block', marginTop:1 }}>{getBrokerFirm(d.broker)}</span>}
                      </div>
                      <div style={{ padding:'8px 6px' }} onClick={e=>e.stopPropagation()}>
                        <StageSelect stage={d.stage} onChange={s=>onPatch(d.id,{stage:s})}/>
                      </div>
                      <div style={{ padding:'8px 6px' }}><TypeTag type={d.type}/></div>
                      <div className="num" style={{ padding:'8px 6px', fontSize:12.5, color:'var(--slate)', textAlign:'right' }}>{d.units?fmtNum(d.units):'—'}</div>
                      <div className="num" style={{ padding:'8px 6px', fontSize:13, fontWeight:500, color:'var(--ink)', textAlign:'right' }}>{fmtShort(d.askPrice)}</div>
                      <div className="num" style={{ padding:'8px 6px', fontSize:13, fontWeight:500, color:'var(--slate)', textAlign:'right' }}>{fmtShort(d.purchasePrice)}</div>
                      <div className="num" style={{ padding:'8px 6px', fontSize:13, fontWeight:500,
                        color:caps.stab>0.001?'var(--pos)':'var(--faint)', textAlign:'right' }}>
                        {caps.stab>0.001?fmtPct(caps.stab,1):'—'}
                      </div>
                      <div style={{ padding:'8px 6px', display:'flex', alignItems:'center', gap:4 }} onClick={e=>e.stopPropagation()}>
                        <AssigneePicker value={d.assignees} onChange={v=>onPatch(d.id,{assignees:v})} size={22}/>
                        <OffMarketToggle on={!!d.offMarket} onToggle={() => onPatch && onPatch(d.id, { offMarket: !d.offMarket })} size={16} />
                      </div>
                      <div style={{ padding:'8px 6px', display:'flex', gap:5, justifyContent:'center', flexWrap:'wrap' }} onClick={e=>e.stopPropagation()}>
                        <DocBar dealId={d.id} omMap={omMap} t12Map={t12Map} rrMap={rrMap} onOM={onOM} onT12={onT12} onRR={onRR} onOpenDeal={onOpen}/>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PipelineView({ deals, allDeals, onOpen, onPatch, onAdd, onImport, onOM, onT12, onRR, onBulkPatch, onBulkDelete, onReorder, omMap, t12Map, rrMap, zebra, sortKey, sortDir, onSortKeyChange, onSortDirChange, taskApi }) {
  const [q, setQ] = useS('');
  const [type, setType] = useS('All');
  const [stage, setStage] = useS('All');
  const [offMarketOnly, setOffMarketOnly] = useS(false);
  const [mode, setMode] = useS('table');
  const [adding, setAdding] = useS(false);
  const [importMsg, setImportMsg] = useS('');
  const [groupBy, setGroupBy] = useS('none'); // 'none' = by stage, 'market' = by submarket
  const importRef = useR(null);

  const handleImportFile = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (e.target) e.target.value = '';
    if (!file) return;
    try {
      let text;
      const isExcel = /\.xlsx?$/i.test(file.name) || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || file.type === 'application/vnd.ms-excel';
      if (isExcel) {
        if (!window.XLSX) throw new Error('Excel parser not loaded yet — wait a moment and try again.');
        const buf = await file.arrayBuffer();
        const wb = window.XLSX.read(new Uint8Array(buf), { type: 'array' });
        text = window.XLSX.utils.sheet_to_csv(wb.Sheets[wb.SheetNames[0]]);
      } else {
        text = await file.text();
      }
      const existing = new Set(deals.map((d) => d.name.toLowerCase()));
      const { deals: newDeals, skipped, total, badHeader } = notionRowsToDeals(text, existing);
      if (badHeader) { setImportMsg('Couldn’t find a “Name” column — make sure your spreadsheet has a Name column header.'); }
      else if (!total) { setImportMsg('No rows found in that file.'); }
      else { if (newDeals.length) onImport(newDeals); setImportMsg('Imported ' + newDeals.length + ' deal' + (newDeals.length === 1 ? '' : 's') + (skipped ? ' · ' + skipped + ' skipped (already in pipeline)' : '') + '.'); }
    } catch (err) { setImportMsg('Import failed: ' + (err && err.message ? err.message : String(err))); }
    setTimeout(() => setImportMsg(''), 7000);
  };

  const types = ['All', ...Array.from(new Set(window.ALTUS_DEALS.map((d) => d.type)))];
  const preStage = useM(() => deals.filter((d) => {
    if (q && !(d.name.toLowerCase().includes(q.toLowerCase()) || d.market.toLowerCase().includes(q.toLowerCase()) || (d.broker || '').toLowerCase().includes(q.toLowerCase()))) return false;
    if (type !== 'All' && d.type !== type) return false;
    if (offMarketOnly && !d.offMarket) return false;
    return true;
  }), [deals, q, type, offMarketOnly]);
  const filtered = useM(() => stage === 'All' ? preStage : preStage.filter((d) => d.stage === stage), [preStage, stage]);

  const activeDeals = deals.filter((d) => STAGES.includes(d.stage));
  const totalVol = activeDeals.reduce((s, d) => s + (d.askPrice || 0), 0);

  const exportCSV = () => {
    const headers = ['Deal', 'Type', 'Market', 'Stage', 'Units', 'Ask Price', 'UW Price', 'Going-In Cap', 'Stab Cap', 'Broker', 'Last Activity'];
    const esc = (v) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
    const lines = filtered.map((d) => {
      const m = computeMetrics(d);
      const caps = window.displayCaps ? window.displayCaps(d) : { goingIn: m.goingInCap, stab: m.stabilizedCap };
      return [d.name, d.type, d.market, STAGE_META[d.stage]?.label || d.stage, d.units || '',
        d.askPrice || '', d.purchasePrice || '',
        caps.goingIn ? (caps.goingIn * 100).toFixed(2) + '%' : '',
        caps.stab ? (caps.stab * 100).toFixed(2) + '%' : '',
        d.broker || '', fmtRelative(lastActivityOf(d))].map(esc).join(',');
    });
    const csv = [headers.join(','), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'altus-pipeline.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="fade" style={{ padding: '22px 28px 60px', maxWidth: 'min(1760px, 97vw)', margin: '0 auto' }}>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-.01em', fontSize: "25px" }}>Pipeline</h2>
          <p style={{ margin: '3px 0 0', fontWeight: 400, fontFamily: 'var(--font)', fontSize: '16px', color: 'var(--slate)' }}>
            {activeDeals.length} active deal{activeDeals.length !== 1 ? 's' : ''} · {fmtShort(totalVol)} in review
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => setAdding(true)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 14px',
            border: 'none', borderRadius: 8, background: 'var(--accent)', color: '#fff',
            fontSize: 13, fontWeight: 600, cursor: 'pointer', boxShadow: '0 1px 3px rgba(16,30,50,.2)' }}
          onMouseEnter={(e) => e.currentTarget.style.background = 'var(--accent-2)'}
          onMouseLeave={(e) => e.currentTarget.style.background = 'var(--accent)'}>
            <Icon name="plus" size={14} /> Add deal
          </button>
        </div>
      </div>

      {/* KPI summary cards */}
      <PipelineStats deals={deals} allDeals={allDeals} />

      {/* Priority Deals — executive queue */}
      <PriorityDealsWidget deals={deals} onOpen={onOpen} onPatch={onPatch} />

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--panel)',
          border: '1px solid var(--line-2)', borderRadius: 8, padding: '0 11px', height: 36,
          minWidth: 220, flex: '0 1 280px' }}>
          <Icon name="search" size={15} style={{ color: 'var(--muted)' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search deals, markets, brokers…"
          style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, fontSize: 13, color: 'var(--ink)' }} />
          {q && <button onClick={() => setQ('')} style={{ border: 'none', background: 'transparent', color: 'var(--muted)', padding: 2, cursor: 'pointer' }}><Icon name="close" size={13} /></button>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'var(--panel)',
          border: '1px solid var(--line-2)', borderRadius: 8, padding: '0 4px 0 10px', height: 36 }}>
          <Icon name="filter" size={13} style={{ color: 'var(--muted)' }} />
          <select value={stage} onChange={(e) => setStage(e.target.value)}
            style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 13, fontWeight: 500,
              color: stage === 'All' ? 'var(--slate)' : STAGE_META[stage].c, padding: '7px 4px', cursor: 'pointer' }}>
            <option value="All">All Stages</option>
            {STAGE_ALL.map((s) => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
          </select>
        </div>
        <FilterSelect label="Type" value={type} onChange={setType} options={types} />
        <button onClick={() => setOffMarketOnly((v) => !v)} title="Show only off-market deals"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 36, padding: '0 12px', borderRadius: 8,
            border: '1px solid ' + (offMarketOnly ? 'var(--warn)' : 'var(--line-2)'),
            background: offMarketOnly ? 'var(--warn-soft)' : 'var(--panel)',
            color: offMarketOnly ? 'var(--warn)' : 'var(--slate)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
          <Icon name="lock" size={12} /> Off-Market
        </button>
        <span style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 500, marginLeft: 4 }} className="num">
          {filtered.length} deal{filtered.length !== 1 ? 's' : ''}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Seg value={groupBy} onChange={setGroupBy} options={[{ value: 'none', label: 'By Stage' }, { value: 'market', label: 'By Market' }]} />
          {groupBy === 'none' && <Seg value={mode} onChange={setMode} options={[{ value: 'table', label: 'Table' }, { value: 'cards', label: 'Cards' }]} />}
          <input ref={importRef} type="file" accept=".csv,.xlsx,.xls,text/csv" style={{ display: 'none' }} onChange={handleImportFile} />
          <button onClick={() => importRef.current && importRef.current.click()} title="Import deals from a CSV or Excel spreadsheet" style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
            height: 36, padding: '0 12px', border: '1px solid var(--line-2)', borderRadius: 8,
            background: 'var(--panel)', fontSize: 12.5, fontWeight: 500, color: 'var(--slate)', cursor: 'pointer' }}>
            <Icon name="upload" size={13} /> Import
          </button>
          <button onClick={exportCSV} disabled={filtered.length === 0} style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
            height: 36, padding: '0 12px', border: '1px solid var(--line-2)', borderRadius: 8,
            background: 'var(--panel)', fontSize: 12.5, fontWeight: 500,
            color: filtered.length === 0 ? 'var(--faint)' : 'var(--slate)', cursor: filtered.length === 0 ? 'default' : 'pointer' }}>
            <Icon name="arrowD" size={13} /> Export
          </button>
        </div>
      </div>

      {importMsg && (
        <div style={{ marginBottom: 12, padding: '9px 14px', background: 'var(--accent-soft)', border: '1px solid var(--accent)',
          borderRadius: 8, fontSize: 12.5, color: 'var(--accent-2)', fontWeight: 500 }}>{importMsg}</div>
      )}
      {groupBy === 'market'
        ? <SubmarketTable deals={filtered} onOpen={onOpen} onPatch={onPatch} omMap={omMap} t12Map={t12Map} rrMap={rrMap} onOM={onOM} onT12={onT12} onRR={onRR}/>
        : mode === 'table'
          ? <PipelineTable deals={filtered} onOpen={onOpen} onPatch={onPatch} onBulkPatch={onBulkPatch} onBulkDelete={onBulkDelete} onReorder={onReorder} omMap={omMap} t12Map={t12Map} rrMap={rrMap} onOM={onOM} onT12={onT12} onRR={onRR} sortKey={sortKey} sortDir={sortDir} onSortKeyChange={onSortKeyChange} onSortDirChange={onSortDirChange} taskApi={taskApi}/>
          : <GroupedCards deals={filtered} onOpen={onOpen} onPatch={onPatch} omMap={omMap} t12Map={t12Map} rrMap={rrMap} onOM={onOM} onT12={onT12} onRR={onRR}/>}

      <StashWidget deals={allDeals} onOpen={onOpen} onPatch={onPatch} />

      {adding && <AddDealModal onClose={() => setAdding(false)} onAdd={onAdd} />}
    </div>);

}

/* ========================= Deal drawer ========================= */
function DealDrawer({ deal, onClose, onPatch, omData, onAcceptOM }) {
  useE(() => {
    const esc = (e) => {if (e.key === 'Escape') onClose();};
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(11,25,45,.3)',
        animation: 'scrimIn .2s ease both' }} />
      <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(640px,95vw)',
        background: 'var(--bg)', boxShadow: '-10px 0 36px rgba(11,25,45,.18)',
        animation: 'drawerIn .26s cubic-bezier(.2,.7,.2,1) both', display: 'flex', flexDirection: 'column' }}>
        <DealDetail deal={deal} onBack={onClose} onPatch={onPatch} panel
        omData={omData} onAcceptOM={onAcceptOM} />
      </div>
    </div>);

}

/* ========================= Dead Deals view ========================= */
function DeadDealsView({ deals, onOpen, onPatch, onBulkPatch, onBulkDelete, onReorder, omMap, t12Map, rrMap, onOM, onT12, onRR }) {
  const [q, setQ] = useS('');
  const filtered = useM(() => !q ? deals : deals.filter((d) =>
    d.name.toLowerCase().includes(q.toLowerCase()) ||
    (d.market || '').toLowerCase().includes(q.toLowerCase()) ||
    (d.broker || '').toLowerCase().includes(q.toLowerCase())), [deals, q]);
  return (
    <div className="fade" style={{ padding: '22px 28px 60px', maxWidth: 'min(1760px, 97vw)', margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-.01em', fontSize: '25px' }}>Dead Deals</h2>
          <p style={{ margin: '3px 0 0', fontWeight: 400, fontFamily: 'var(--font)', fontSize: '16px', color: 'var(--slate)' }}>
            {deals.length} passed or lost deal{deals.length !== 1 ? 's' : ''} · change a stage to revive one back into the pipeline
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--panel)',
          border: '1px solid var(--line-2)', borderRadius: 8, padding: '0 11px', height: 36,
          minWidth: 220, flex: '0 1 280px' }}>
          <Icon name="search" size={15} style={{ color: 'var(--muted)' }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search dead deals…"
            style={{ border: 'none', outline: 'none', background: 'transparent', flex: 1, fontSize: 13, color: 'var(--ink)' }} />
          {q && <button onClick={() => setQ('')} style={{ border: 'none', background: 'transparent', color: 'var(--muted)', padding: 2, cursor: 'pointer' }}><Icon name="close" size={13} /></button>}
        </div>
        <span style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 500, marginLeft: 4 }} className="num">
          {filtered.length} deal{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {deals.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '72px 24px', color: 'var(--muted)', background: 'var(--panel)',
          border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ fontSize: 30, marginBottom: 10, color: 'var(--faint)' }}>✓</div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>No dead deals.</div>
          <div style={{ fontSize: 12.5, marginTop: 4 }}>Deals moved to <b>Pass</b> or <b>LOI Lost</b> land here.</div>
        </div>
      ) : (
        <PipelineTable deals={filtered} onOpen={onOpen} onPatch={onPatch} onBulkPatch={onBulkPatch}
          onBulkDelete={onBulkDelete} onReorder={onReorder} omMap={omMap} t12Map={t12Map} rrMap={rrMap}
          onOM={onOM} onT12={onT12} onRR={onRR} />
      )}
    </div>
  );
}

/* ========================= LOI Status view ========================= */
// Separate tracking table per LOI-process stage. Active review deals stay in the
// Pipeline tab; once a deal reaches LOI it surfaces here for milestone tracking.
const LOI_SECTIONS = ['LOI Submitted', 'Under Contract', 'Purchased', 'LOI Lost'];
function LOIStatusView({ deals, onOpen, onPatch }) {
  const hasUW = window.hasUWInputs || (() => false);
  const cols = [
    { key: 'name', label: 'Deal / Asset', w: 'minmax(200px,1.6fr)', align: 'left' },
    { key: 'market', label: 'Market', w: '130px', align: 'left' },
    { key: 'units', label: 'Units', w: '70px', align: 'right' },
    { key: 'uw', label: 'UW Price', w: '110px', align: 'right' },
    { key: 'loi', label: 'LOI Amount', w: '110px', align: 'right' },
    { key: 'cap', label: 'Going-In Cap', w: '100px', align: 'right' },
    { key: 'stab', label: 'Stab Cap', w: '90px', align: 'right' },
    { key: 'irr', label: 'Levered IRR', w: '100px', align: 'right' },
    { key: 'date', label: 'Key Date', w: '110px', align: 'right' },
  ];
  const grid = cols.map((c) => c.w).join(' ');
  const dateFor = (d) => {
    if (d.stage === 'LOI Submitted') return d.dateLOISubmitted;
    if (d.stage === 'Under Contract') return d.dateUnderContract;
    if (d.stage === 'Purchased') return d.dateUnderContract || d.cfoDate;
    if (d.stage === 'LOI Lost') return d.dateLost || d.dateLOISubmitted;
    return d.dateEntered;
  };

  const cell = (d, c) => {
    const m = computeMetrics(d);
    const caps = window.displayCaps ? window.displayCaps(d) : { goingIn: m.goingInCap, stab: m.stabilizedCap };
    switch (c.key) {
      case 'name': return <span style={{ fontWeight: 600, color: 'var(--ink)' }} className="clip">{d.name}</span>;
      case 'market': return <span style={{ color: 'var(--slate)' }}>{d.market || '—'}</span>;
      case 'units': return <span className="num">{d.units ? fmtNum(d.units) : '—'}</span>;
      case 'uw': return <span className="num">{d.purchasePrice ? fmtShort(d.purchasePrice) : '—'}</span>;
      case 'loi': return <span className="num">{d.loiAmount ? fmtShort(d.loiAmount) : '—'}</span>;
      case 'cap': return <span className="num" style={{ color: caps.goingIn ? 'var(--accent)' : 'var(--faint)' }}>{caps.goingIn ? fmtPct(caps.goingIn) : '—'}</span>;
      case 'stab': return <span className="num" style={{ color: caps.stab ? 'var(--pos)' : 'var(--faint)' }}>{caps.stab ? fmtPct(caps.stab) : '—'}</span>;
      case 'irr': {
        if (!hasUW(d)) return <span className="num" style={{ color: 'var(--faint)' }}>—</span>;
        const uw = computeUW(d);
        return <span className="num" style={{ color: uw.irr == null ? 'var(--faint)' : 'var(--pos)', fontWeight: 600 }}>{uw.irr == null ? '—' : (uw.irr * 100).toFixed(1) + '%'}</span>;
      }
      case 'date': return <span className="num" style={{ color: 'var(--slate)' }}>{fmtDateShort(dateFor(d)) || '—'}</span>;
      default: return null;
    }
  };

  return (
    <div className="fade" style={{ padding: '22px 28px 60px', maxWidth: 'min(1760px, 97vw)', margin: '0 auto' }}>
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ margin: 0, fontWeight: 600, color: 'var(--ink)', letterSpacing: '-.01em', fontSize: 25 }}>LOI Status</h2>
        <p style={{ margin: '3px 0 0', fontSize: 13.5, color: 'var(--muted)' }}>
          {deals.length} deal{deals.length !== 1 ? 's' : ''} in the LOI process · tracked separately from active pipeline review
        </p>
      </div>

      {deals.length === 0 ? (
        <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--muted)', background: 'var(--panel)',
          border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>No deals in the LOI process yet.</div>
          <div style={{ fontSize: 12.5, marginTop: 4 }}>Move a deal to <b>LOI Submitted</b>, <b>Under Contract</b>, <b>Purchased</b>, or <b>LOI Lost</b> and it appears here.</div>
        </div>
      ) : LOI_SECTIONS.map((stage) => {
        const items = deals.filter((d) => d.stage === stage);
        if (!items.length) return null;
        const meta = STAGE_META[stage];
        const totalVol = items.reduce((s, d) => s + (d.purchasePrice || 0), 0);
        return (
          <div key={stage} style={{ marginBottom: 22 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}>
              <span style={{ width: 9, height: 9, borderRadius: 3, background: meta.c }} />
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{meta.label}</span>
              <span className="num" style={{ fontSize: 11.5, fontWeight: 600, color: meta.c, background: meta.bg, padding: '2px 9px', borderRadius: 999 }}>{items.length}</span>
              {totalVol > 0 && <span className="num" style={{ fontSize: 12.5, color: 'var(--muted)', marginLeft: 'auto' }}>{fmtShort(totalVol)} total UW value</span>}
            </div>
            <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', overflowX: 'auto', boxShadow: 'var(--shadow)' }}>
              <div style={{ minWidth: 940 }}>
                <div style={{ display: 'grid', gridTemplateColumns: grid, background: 'var(--panel-3)', borderBottom: '1px solid var(--line)' }}>
                  {cols.map((c) => (
                    <div key={c.key} style={{ padding: '9px 12px', fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em',
                      textTransform: 'uppercase', color: 'var(--muted)', textAlign: c.align }}>{c.label}</div>
                  ))}
                </div>
                {items.map((d, i) => (
                  <div key={d.id} onClick={() => onOpen(d.id)}
                    style={{ display: 'grid', gridTemplateColumns: grid, cursor: 'pointer',
                      borderBottom: i < items.length - 1 ? '1px solid var(--line)' : 'none' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-soft)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                    {cols.map((c) => (
                      <div key={c.key} style={{ padding: '10px 12px', fontSize: 12.5, textAlign: c.align, minWidth: 0,
                        display: 'flex', justifyContent: c.align === 'right' ? 'flex-end' : 'flex-start', alignItems: 'center' }}>{cell(d, c)}</div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ========================= Root ========================= */
// Canonical (key-order-independent) JSON serialization. Postgres jsonb does NOT preserve
// object key order on storage — it canonicalizes keys by length then alphabetically — so a
// plain JSON.stringify comparison between a local JS object and the same row read back from
// Supabase (or echoed via realtime) essentially never matches even when the content is
// identical, since the two sides serialize keys in different orders. Every comparison
// between local state and cloud-sourced data must go through this instead of
// JSON.stringify, or the comparison is permanently false.
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

// Records a snapshot into a per-id rolling history (capped, small) so a realtime echo of
// one of our own recent saves can still be recognized even after a later save has already
// fired — a single "last snapshot" isn't enough once realtime is actually delivering
// events, since a fast edit burst can fire several debounced saves before the first one's
// echo returns.
function recordSentSnapshot(historyRef, id, json) {
  let set = historyRef.current[id];
  if (!set) { set = new Set(); historyRef.current[id] = set; }
  if (!set.has(json)) {
    set.add(json);
    if (set.size > 6) set.delete(set.values().next().value);
  }
}

// Normalize any legacy stage names onto the current set whenever deals enter state.
const migrateDeals = (arr) => Array.isArray(arr)
  ? arr.map((d) => {
      if (d.bucket === 'Stash' && d.stage !== 'Stash') d = { ...d, stage: 'Stash' };
      const ns = window.normalizeStage(d.stage);
      let r = ns === d.stage ? d : { ...d, stage: ns };
      // Migrate legacy analyst string → assignees array so AssigneePicker shows it
      if (r.analyst && !r.assignees) r = { ...r, assignees: [r.analyst] };
      // Will is no longer on the team: drop him from deal assignees (Fisher is available to assign).
      if (r.analyst === 'Will') r = { ...r, analyst: null };
      if (Array.isArray(r.assignees) && r.assignees.includes('Will')) r = { ...r, assignees: r.assignees.filter((n) => n !== 'Will') };
      // Underwritten deals keep the assumptions they were underwritten with (see assumptions.js).
      if (window.AltusAssumptions && window.AltusAssumptions.withSnapshot) r = window.AltusAssumptions.withSnapshot(r);
      return r;
    })
  : arr;
const isDead = (d) => d.stage === 'Dead';
const isLOI = (d) => window.LOI_STAGES.includes(d.stage);
const isPipeline = (d) => window.PIPELINE_STAGES.includes(d.stage);
const NAV = [
{ key: 'pipeline', label: 'Pipeline', icon: 'board' },
{ key: 'loi', label: 'LOI Status', icon: 'flag' },
{ key: 'metrics', label: 'Metrics', icon: 'pulse' },
{ key: 'network', label: 'Network', icon: 'users' },
{ key: 'tasks', label: 'Tasks', icon: 'check' },
{ key: 'dead', label: 'Dead Deals', icon: 'close' },
{ key: 'assumptions', label: 'Assumptions', icon: 'calc' }];


// PDFs that render bold text via double-struck glyphs (each character drawn twice)
// extract as garbled doubled tokens, e.g. "$$33,,999900,,660000" for "$3,990,600" —
// which wrecks every bold financial total. Collapse any fully-doubled token (each
// adjacent pair identical) back to single characters. Guarded to 6+ chars with a
// non-digit present so legit comma-formatted numbers and short words are untouched.
function fixDoubledGlyphs(text){
  if(!text) return text;
  return text.replace(/\S+/g,(tok)=>{
    if(tok.length>=6 && tok.length%2===0 && /[^0-9]/.test(tok)){
      let doubled=true;
      for(let i=0;i<tok.length;i+=2){ if(tok[i]!==tok[i+1]){ doubled=false; break; } }
      if(doubled){ let s=''; for(let i=0;i<tok.length;i+=2) s+=tok[i]; return s; }
    }
    return tok;
  });
}

// Deterministic extraction of the broker's PRO-FORMA EFFECTIVE GROSS INCOME from the OM
// financial-analysis table. The model is unreliable at picking the right row + column
// out of these dense single-line tables, so we do it in code. The wanted figure is the
// EFFECTIVE GROSS INCOME row (gross scheduled income LESS vacancy/loss-to-lease/concessions
// PLUS other income) in the stabilized / pro-forma column — NOT the top-line gross rent:
//   Hilltop Oaks: pro-forma "Effective Gross Income" → 4,628,301
// Strategy: find the EGI row, then take the LAST large ($100k+) dollar figure on it
// (right-most column = pro-forma / upgrade forecast). Per-unit, per-SF and % values are
// dropped by the >=100k filter and the comma-group regex.
// Returns null if the layout isn't present (caller keeps the model's value).
function extractProFormaTopline(text){
  if(!text) return null;
  const labels = ['Total Effective Gross Income','Effective Gross Income','Effective Gross Revenue','Effective Gross','Total Effective Gross'];
  const boundaries = ['Operating Expense','Total Operating','Total Expense','Net Operating','NOI','Less Operating','Less:','Expenses'];
  const moneyRe = /\$\s?([0-9]{1,3}(?:,[0-9]{3})+)(?:\.[0-9]+)?/g;
  for(const label of labels){
    let from = 0, idx;
    while((idx = text.indexOf(label, from)) !== -1){
      from = idx + label.length;
      let tail = text.slice(idx + label.length, idx + label.length + 700);
      // require the DATA row: a $ amount must appear almost immediately after the label
      const firstDollar = tail.indexOf('$');
      if(firstDollar < 0 || firstDollar > 20) continue;
      // cut at the next row's label or a parenthesized negative so we stay on this row
      let cut = tail.length;
      for(const b of boundaries){ const bi = tail.indexOf(b); if(bi > 0 && bi < cut) cut = bi; }
      const negParen = tail.indexOf('($'); if(negParen > 0 && negParen < cut) cut = negParen;
      const row = tail.slice(0, cut);
      const large = [];
      let m; moneyRe.lastIndex = 0;
      while((m = moneyRe.exec(row)) !== null){
        const v = Number(m[1].replace(/,/g,''));
        if(v >= 100000) large.push(v);
      }
      if(large.length >= 2) return large[large.length-1];
    }
  }
  return null;
}

async function extractFileText(file) {
  const name = (file.name || '').toLowerCase();
  if (window.XLSX && /\.(xlsx|xlsm|xls)$/.test(name)) {
    try {
      const buf = await file.arrayBuffer();
      const wb = window.XLSX.read(buf, { type: 'array' });
      let out = '';
      wb.SheetNames.forEach((sn) => {
        const csv = window.XLSX.utils.sheet_to_csv(wb.Sheets[sn]);
        if (csv.trim()) out += `=== Sheet: ${sn} ===\n${csv}\n\n`;
      });
      return out;
    } catch (e) {/* fall through */}
  }
  // PDF — prefer pdf-parse (bundles a MODERN pdf.js). The legacy global pdfjsLib
  // (v3.11) shatters this OM's faux-bold financial tables into irrecoverable
  // space-split doubled glyphs ("B Be ee ec ch h"); pdf-parse decodes the same
  // embedded subset fonts into contiguous text the de-doubler can repair.
  if (/\.pdf$/.test(name) || file.type === 'application/pdf') {
    // 1) pdf-parse via dynamic import (CSP-verified)
    try {
      const buf = await file.arrayBuffer();
      const mod = await import('https://cdn.jsdelivr.net/npm/pdf-parse@2.4.5/dist/pdf-parse/web/pdf-parse.es.js');
      mod.PDFParse.setWorker('https://cdn.jsdelivr.net/npm/pdf-parse@2.4.5/dist/pdf-parse/web/pdf.worker.min.mjs');
      const parser = new mod.PDFParse({ data: new Uint8Array(buf) });
      const out = await parser.getText();
      if (out && out.text && out.text.trim()) return fixDoubledGlyphs(out.text);
    } catch (e) {/* fall through to legacy extractor */}
    // 2) legacy global pdfjsLib fallback
    if (window.pdfjsLib) {
      try {
        const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        let text = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          text += `\n[Page ${i}]\n` + content.items.map((x) => x.str).join(' ');
        }
        return fixDoubledGlyphs(text);
      } catch (e) {/* fall through */}
    }
  }
  // CSV / plain text
  return await file.text().catch(() => '');
}

// Build a focused excerpt around financial keywords so a big OM's pro-forma page
// is always included even when the doc far exceeds the model budget.
// `keywords` is ordered by priority (most specific first); windows created by
// higher-priority keywords are kept first, so a deep page-29 GPR table wins over
// dozens of early generic-word hits.
function focusExcerpt(text, keywords, budget = 16000) {
  if (text.length <= budget) return text;
  const lower = text.toLowerCase();
  const radius = 1600;
  const windows = [];
  keywords.forEach((kw, rank) => {
    const k = kw.toLowerCase();
    let idx = 0, count = 0;
    while ((idx = lower.indexOf(k, idx)) !== -1) {
      windows.push({ pos: idx, rank, start: Math.max(0, idx - radius), end: Math.min(text.length, idx + radius) });
      idx += k.length;
      if (++count > 40) break;
    }
  });
  if (!windows.length) return text.slice(0, budget);
  // Keep specific (low-rank) windows first; tie-break by document order
  windows.sort((a, b) => a.rank - b.rank || a.pos - b.pos);
  const chosen = [];
  let used = 0;
  for (const w of windows) {
    // skip if already covered by a chosen window
    if (chosen.some((c) => w.pos >= c.start && w.pos <= c.end)) continue;
    const len = w.end - w.start;
    if (used + len > budget) continue;
    chosen.push(w);
    used += len;
    if (used >= budget) break;
  }
  // Emit in document order so tables read coherently
  chosen.sort((a, b) => a.start - b.start);
  return chosen.map((w) => text.slice(w.start, w.end)).join('\n…\n');
}

// The listing / financing team almost always lives on the FINAL page(s) of a modern
// OM, in a vertical Name / Title / Phone / Email block under headers like "Primary
// Contacts", "DSF Contacts" (Debt & Structured Finance), "Capital Markets", "Debt &
// Equity" or "Primary Markets Team" — a DIFFERENT layout from the cover-page
// "Exclusively Listed By" box. focusExcerpt fills its budget with income tables and
// routinely drops these tail pages (on a 200k-char OM the last page never makes the
// cut), so capture them deterministically here. Strategy: from the back half of the
// document, start at the earliest contact-header we can find; if none matches, fall
// back to the final `budget` characters — the contacts are there either way.
function contactExcerpt(text, budget = 9000) {
  if (!text) return '';
  if (text.length <= budget) return text;
  const lower = text.toLowerCase();
  const markers = [
    'primary contacts', 'dsf contacts', 'debt & structured finance', 'debt and structured finance',
    'debt & equity', 'debt and equity', 'capital markets', 'primary markets team',
    'listing team', 'for more information', 'exclusively listed', 'exclusively represented',
    'licensed broker', 'iabs'
  ];
  const tailStart = Math.floor(text.length * 0.55);
  let begin = -1;
  for (const m of markers) {
    const i = lower.indexOf(m, tailStart);
    if (i !== -1 && (begin === -1 || i < begin)) begin = i;
  }
  let slice = begin !== -1 ? text.slice(begin) : text.slice(-budget);
  if (slice.length > budget) slice = slice.slice(-budget);
  return slice;
}

// Rent rolls must be read as ONE table — keyword-window fragmenting (focusExcerpt)
// splits the per-unit rows apart and silently drops units off the end, which makes
// every sum come up short. Instead: cut the Future Residents / Applicants section
// (we never count it) and keep the full remaining table, only capping at a generous
// budget. The model then extracts rows; JS does the arithmetic.
function rentRollExcerpt(text, budget = 130000) {
  const lower = text.toLowerCase();
  let cut = text.length;
  for (const marker of ['future resident', 'future occupanc', 'pending applicant', 'future applicant']) {
    const i = lower.indexOf(marker);
    if (i !== -1 && i < cut) cut = i;
  }
  let out = text.slice(0, cut);
  if (out.length > budget) out = out.slice(0, budget);
  return out;
}

// Turn the model's per-unit rows into exact aggregate figures — all summing/counting
// happens here in JS, never in the model. Falls back to any aggregate fields the
// model returned if no per-unit array is present.
function summarizeRentRoll(raw) {
  const num = (v) => { const n = Number(String(v ?? '').replace(/[$,()]/g, '')); return isNaN(n) ? 0 : Math.abs(n); };
  const units = Array.isArray(raw.units) ? raw.units : [];
  if (!units.length) return raw;
  let totalUnits = 0, vacantUnits = 0, mAll = 0, mInH = 0, mVac = 0;
  const vacantUnitList = [];
  units.forEach((u) => {
    const market = num(u.m != null ? u.m : u.market);
    const rent   = num(u.r != null ? u.r : u.rent);
    const vf     = (u.v != null ? u.v : u.vacant);
    // Vacancy comes from the unit's status flag only — a $0 rent does NOT make a unit vacant
    // (units on notice / in eviction read $0 but are still occupied).
    const isVac  = vf === 1 || vf === true || vf === '1' || vf === 'true';
    totalUnits++;
    mAll += market;
    if (isVac) {
      vacantUnits++; mVac += market;
      const id = u.i != null ? u.i : u.id;
      if (id != null && String(id) !== '') vacantUnitList.push(String(id));
    } else {
      mInH += rent;
    }
  });
  return {
    totalUnits,
    vacantUnits,
    marketRentMonthlyAll: Math.round(mAll),
    inHouseRentMonthlyOccupied: Math.round(mInH),
    marketRentMonthlyVacant: Math.round(mVac),
    vacantUnitList,
    notes: raw.notes || ''
  };
}

// Deterministic tabular rent-roll parser. Most rent rolls are clean one-row-per-unit
// grids (Unit | … | Status | Market Rent | Rent). Asking the model to echo back every
// row overflows its output on medium/large rolls and the upload fails — so when we can
// detect the header + columns we sum it all in code. Returns null if it's not a clean
// table (caller falls back to the model per-unit extraction, fine for small/odd rolls).
function parseRentRollTabular(text){
  if(!text) return null;
  // delimiter-aware line parser that respects quoted fields (handles CSV and tab-separated)
  const parseRows = (t, delim) => {
    const rows = [];
    t.split(/\r?\n/).forEach((line) => {
      const cells = []; let cur = '', q = false;
      for(let i=0;i<line.length;i++){
        const c = line[i];
        if(q){ if(c==='"'){ if(line[i+1]==='"'){ cur+='"'; i++; } else q=false; } else cur+=c; }
        else { if(c==='"') q=true; else if(c===delim){ cells.push(cur); cur=''; } else cur+=c; }
      }
      cells.push(cur); rows.push(cells);
    });
    return rows;
  };
  const money = (v) => { const n = Number(String(v==null?'':v).replace(/[$,()\s]/g,'')); return isNaN(n)?null:n; };
  // auto-detect delimiter (xlsx→csv uses commas; some exports are tab-separated)
  const sample = text.slice(0, 6000);
  const delim = ((sample.match(/\t/g)||[]).length > (sample.match(/,/g)||[]).length) ? '\t' : ',';
  const rows = parseRows(text, delim);
  // locate the header row (needs a unit column, a market-rent column, and a rent column).
  // Tolerant matchers cover the many label variants brokers/PM software use.
  const notUnitId = (c)=> /type|plan|sq|\bsf\b|size|status|rent|bed|bath|model/.test(c);
  const isUnit   = (c)=> ['unit','unit #','unit#','unit no','unit no.','unit number','unit id','unit name','apt','apt #','apt no','apartment','space','door'].includes(c) || (!notUnitId(c) && (/^(unit|apt|apartment|bldg)\b/.test(c) || /\bunit\s*(#|no\.?|number|id)?$/.test(c)));
  const isMarket = (c)=> !/\/\s*sf|per\s*sf|psf/.test(c) && (c==='market' || /market\s*(rent|rate)?/.test(c) || /gross.*market/.test(c));
  const isRent   = (c)=> !/market|\/\s*sf|psf/.test(c) && (['rent','actual rent','lease rent','current rent','base rent','scheduled rent','charge','actual','tenant rent','net rent','monthly rent','contract rent','lease rent/charge'].includes(c) || /^rent\b/.test(c) || /\brent$/.test(c));
  const isStatus = (c)=> c.includes('status') || c.includes('occupanc') || c==='lease status';
  const isType   = (c)=> ['type','unit type','floorplan','floor plan','plan','model','unit plan','bd/ba','bed/bath','unit style','style'].includes(c) || /^(unit\s*)?(type|floor\s*plan)\b/.test(c);
  const isSF     = (c)=> ['sf','sqft','sq ft','sq. ft.','sq.ft.','sq ft.','square feet','square footage','unit sf','unit sqft','unit sq ft','size','rentable sf','net sf','area'].includes(c) || /^(sq\.?\s*f(ee)?t|square\s*f)/.test(c);
  const isStart  = (c)=> /lease\s*(start|from|begin)|move[\s-]*in/.test(c);
  const isBeds   = (c)=> /^(beds?|bedrooms?|br|bd)$/.test(c);
  const isBaths  = (c)=> /^(baths?|bathrooms?|ba)$/.test(c);
  // Prefer an occupancy status over e.g. a renovation status column.
  const findStatus = (r) => { const o = r.findIndex((c) => /occup|lease status|unit status/.test(c)); return o >= 0 ? o : r.findIndex(isStatus); };
  let hi = -1, cols = null;
  for(let i=0;i<rows.length;i++){
    // Many exports stack the header over two rows ("Market" / "Rent"); test the row alone and merged with the row above.
    const one = rows[i].map((c)=>c.trim().toLowerCase());
    const two = i > 0 ? one.map((c, k) => (((rows[i-1][k]||'').trim().toLowerCase() + ' ' + c).trim())) : one;
    const ok = (r) => r.findIndex(isUnit)>=0 && r.findIndex(isMarket)>=0 && r.findIndex(isRent)>=0;
    const r = ok(one) ? one : ok(two) ? two : one;
    const unitIdx   = r.findIndex(isUnit);
    const marketIdx = r.findIndex(isMarket);
    const rentIdx   = r.findIndex(isRent);
    if(unitIdx>=0 && marketIdx>=0 && rentIdx>=0){
      hi=i; cols={unitIdx,marketIdx,rentIdx,statusIdx:findStatus(r),typeIdx:r.findIndex(isType),sfIdx:r.findIndex(isSF),
        startIdx:r.findIndex(isStart),bedIdx:r.findIndex(isBeds),bathIdx:r.findIndex(isBaths)};
      break;
    }
  }
  if(hi<0) return null;
  const units = [];
  const seenUnits = new Set(); // dedupe charge-code rows (multiple rows per unit)
  const cell = (r, idx) => idx>=0 ? (r[idx]||'').trim() : '';
  for(let i=hi+1;i<rows.length;i++){
    const r = rows[i]; if(!r || !r.length) continue;
    const unit = (r[cols.unitIdx]||'').trim();
    if(!unit || /total|average|summary|subtotal/i.test(unit)) continue;
    if(seenUnits.has(unit)) continue; // skip duplicate rows for same unit
    seenUnits.add(unit);
    const market = money(r[cols.marketIdx]);
    const rent   = money(r[cols.rentIdx]);
    if(market==null && rent==null) continue; // not a real unit row
    let type = cell(r, cols.typeIdx);
    if(!type && cols.bedIdx>=0) type = (cell(r, cols.bedIdx) || '0') + 'x' + (cell(r, cols.bathIdx) || '1');
    units.push({ id: unit, type, sf: money(cell(r, cols.sfIdx)), market, rent, status: cell(r, cols.statusIdx), leaseStart: cell(r, cols.startIdx), statusKnown: cols.statusIdx>=0 });
  }
  return summarizeRentRollUnits(units, 'Parsed ' + units.length + ' units directly from the rent-roll table.');
}

// Normalize a lease-start cell (Excel serial, m/d/yyyy or ISO) to yyyy-mm-dd, else ''.
function rrDate(v){
  const t = String(v==null?'':v).trim(); if(!t) return '';
  const n = Number(t);
  if(!isNaN(n) && n > 20000 && n < 80000){ const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000); return d.toISOString().slice(0,10); }
  const m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if(m){ const y = m[3].length===2 ? 2000 + Number(m[3]) : Number(m[3]); return y + '-' + String(m[1]).padStart(2,'0') + '-' + String(m[2]).padStart(2,'0'); }
  const d = Date.parse(t); return isNaN(d) ? '' : new Date(d).toISOString().slice(0,10);
}

// Unit rows → the aggregates the Rent Roll banner applies, plus the standardized unit list the
// Rent Roll Matrix tab groups by type (multifamily-uw Unit Mix: type, SF, market, in-place, occupied,
// lease start). Physical vacancy is decided by STATUS, not by a zero rent.
function summarizeRentRollUnits(raw, notes){
  if(!raw || !raw.length) return null;
  let vacantUnits=0, mAll=0, mInH=0, ltlSum=0;
  const vacantUnitList = [];
  const units = raw.map((u) => {
    const status = u.status || '';
    const statusKnown = u.statusKnown !== false && status !== '';
    // A unit counts as physically VACANT only when its status says vacant AND it is NOT
    // pre-leased. "Vacant-Rented" / "Vacant-Leased" / applicant units have income coming and
    // are excluded from the vacancy count. Units on Notice or in Eviction are OCCUPIED.
    // With no status, fall back to "no rent ⇒ vacant".
    const preLeased = /\b(rented|leased|pre[\s-]?leased|applicant|pending|reserved)\b/i.test(status);
    const isVac = statusKnown ? (/vacant/i.test(status) && !preLeased) : (u.rent==null || u.rent===0);
    if(u.market!=null) mAll += u.market;
    if(isVac){ vacantUnits++; vacantUnitList.push(u.id); }
    else if(u.rent!=null){
      mInH += u.rent;
      // Loss to lease is per-unit: market minus current, floored at 0.
      if(u.market!=null) ltlSum += Math.max(0, u.market - u.rent);
    }
    return { id: String(u.id||''), type: String(u.type||'').trim(), sf: u.sf && u.sf > 0 ? Math.round(u.sf) : null,
      market: u.market==null ? null : Math.round(u.market), rent: u.rent==null ? null : Math.round(u.rent), occ: !isVac, leaseStart: rrDate(u.leaseStart) };
  });
  // Backfill missing SF with the most common SF for that unit type; untyped units group by SF.
  const modeSf = {};
  units.forEach((u) => { if(u.type && u.sf){ const m = modeSf[u.type] || (modeSf[u.type] = {}); m[u.sf] = (m[u.sf]||0) + 1; } });
  units.forEach((u) => {
    if(!u.sf && u.type && modeSf[u.type]){ const m = modeSf[u.type]; u.sf = Number(Object.keys(m).sort((a,b) => m[b]-m[a])[0]); }
    if(!u.type) u.type = u.sf ? u.sf + ' SF' : 'All units';
  });
  return {
    totalUnits: units.length, vacantUnits,
    marketRentMonthlyAll: Math.round(mAll),
    inHouseRentMonthlyOccupied: Math.round(mInH),
    lossToLeaseMonthly: Math.round(ltlSum),
    vacantUnitList, units, notes,
  };
}

// CSV unit list returned by the model → raw unit rows for summarizeRentRollUnits.
function parseRentRollCsv(out){
  const body = String(out||'').replace(/```[a-z]*\n?/gi,'');
  const money = (v) => { const n = Number(String(v==null?'':v).replace(/[$,()\s]/g,'')); return isNaN(n) || String(v).trim()==='' ? null : n; };
  const units = [];
  body.split(/\r?\n/).forEach((line) => {
    const c = line.split('|').map((x) => x.trim());
    if(c.length < 5 || /^unit$/i.test(c[0]) || !c[0]) return;
    units.push({ id: c[0], type: c[1], sf: money(c[2]), market: money(c[3]), rent: money(c[4]), status: c[5] || '', leaseStart: c[6] || '', statusKnown: !!c[5] });
  });
  return units;
}

function CloudSplash({ text }) {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--muted)', fontSize: 14 }}>
        <span style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin .8s linear infinite' }} />
        {text}
      </div>
    </div>
  );
}

function LoginGate({ onSignIn, busy }) {
  const [email, setEmail] = useS('');
  const [pw, setPw] = useS('');
  const [err, setErr] = useS('');
  const submit = async (e) => {
    e.preventDefault();
    setErr('');
    try { await onSignIn(email, pw); }
    catch (ex) { setErr(ex && ex.message ? ex.message : 'Sign-in failed. Check your email and password.'); }
  };
  const field = {
    width: '100%', boxSizing: 'border-box', height: 42, borderRadius: 9, border: '1px solid var(--line-2)',
    background: 'var(--panel)', padding: '0 13px', fontSize: 14, color: 'var(--ink)', fontFamily: 'var(--font)', outline: 'none',
  };
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--navy)' }}>
      <form onSubmit={submit} style={{ width: 360, maxWidth: '90vw', background: 'var(--panel)', borderRadius: 16,
        padding: '32px 30px', boxShadow: '0 24px 60px rgba(0,0,0,.35)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 22 }}>
          <span style={{ width: 34, height: 34, borderRadius: 9, background: 'var(--accent)', color: '#fff',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16 }}>A</span>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-.01em' }}>Altus Pipeline</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>Sign in to continue</div>
          </div>
        </div>
        <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Email</label>
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)}
          style={{ ...field, margin: '6px 0 16px' }} onFocus={(e) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--accent-soft)'; }} onBlur={(e) => { e.target.style.borderColor = 'var(--line-2)'; e.target.style.boxShadow = 'none'; }} />
        <label style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em' }}>Password</label>
        <input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)}
          style={{ ...field, margin: '6px 0 0' }} onFocus={(e) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--accent-soft)'; }} onBlur={(e) => { e.target.style.borderColor = 'var(--line-2)'; e.target.style.boxShadow = 'none'; }} />
        {err && <div style={{ marginTop: 14, fontSize: 12.5, color: 'var(--neg)', background: 'rgba(200,40,40,.08)', borderRadius: 8, padding: '8px 11px' }}>{err}</div>}
        <button type="submit" disabled={busy} style={{ width: '100%', marginTop: 20, height: 44, borderRadius: 10, border: 'none',
          background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? .7 : 1 }}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}

// Parse an Offering Memorandum into deal fields (name, market, units, vintage, broker,
// contacts, and in-place + pro-forma financials). Shared by the per-deal upload handler
// and the Add-Deal modal's auto-fill. Returns { parsed, fullText }.
async function runOMParse(file) {
  const fullText = await extractFileText(file);
      const finText = focusExcerpt(fullText, [
        // pro-forma EFFECTIVE GROSS INCOME — the PRIMARY target, often deep in the OM.
        // Listed first so its table wins the budget over early generic hits.
        'effective gross income', 'total effective gross', 'effective gross',
        'upgrade forecast', 'unit upgrade', 'acquisition / unit', 'stabilized',
        'pro forma', 'proforma', 'financial summary', 'income statement',
        // in-place / T-12 OPERATING EXPENSES — second target for the going-in underwriting
        'total operating expenses', 'total operating expense', 'operating expenses',
        't-12', 't12', 't-3', 't3', 't-1', 't1', 'trailing', 'total expenses', 'expense summary',
        'controllable', 'non-controllable', 'property taxes', 'real estate taxes', 'insurance',
        'net operating income',
        'total revenue', 'total income', 'net rental income',
        'gross scheduled income', 'gross potential rent', 'rental revenue', 'rental income',
        // cover-page listing box (the OTHER place contacts appear) — lower priority
        'exclusively listed', 'investment sales', 'rent roll'
      ], 34000);
      // Broker / financing-team contacts almost always sit on the FINAL page(s) in a
      // vertical Name/Title/Phone/Email block under headers like "Primary Contacts",
      // "DSF Contacts", "Capital Markets" or "Debt & Equity" — a different layout the
      // financial excerpt above routinely drops. Guarantee those tail pages here.
      const contactText = contactExcerpt(fullText, 9000);
      const text = finText + (contactText
        ? '\n\n=== END-OF-OM CONTACT PAGES (extract EVERY person listed in this section) ===\n' + contactText
        : '');
      const prompt = `You are parsing a multifamily Offering Memorandum for Altus Equity. Extract ONLY the fields below. Return ONLY a valid JSON object — no commentary. Use null for any field not found.

{
  "name": "property or deal name",
  "market": "City, ST — city and two-letter state only, no street address or ZIP",
  "units": 0,
  "vintage": "year built (see rules) — a string; null if not stated",
  "brokerFirm": "full brokerage firm name from the cover page or 'Exclusively Listed By' section",
  "brokerOffice": "City, ST of the listing brokerage's office address printed on the OM (contact page, back cover or footer) — the broker's office, NOT the property's address; null if not shown",
  "brokerContacts": [{ "name": "", "title": "", "phone": "", "email": "", "office": "City, ST of this person's own office address if printed with their contact info, else null" }],
  "effectiveGrossIncome": 0,
  "totalOpex": 0,
  "opexBasis": "T-12",
  "brokerEGI": 0
}

Rules for vintage — the year the property was originally BUILT (its construction vintage), not the renovation year. Look on the cover page, the property-summary / highlights box, and any "Year Built", "Built", or "Vintage" field. It may read "Built in 1985", "Year Built: 1985", "1985 Vintage", or "Built 1986 / Renovated 2019" (take the BUILT year, 1986). For a multi-building property built in different years it is often a slash- or comma-joined list, e.g. "Built in 1997/1986/1975" — return all of them exactly as "1997/1986/1975". Return the year(s) as a STRING (no labels). Use null if no construction year is stated.

Rules for brokerOffice and each contact's office — look for a street address next to the broker contacts, on the back cover or in the page footer (e.g. "2101 Cedar Springs Rd, Suite 900, Dallas, TX 75201" → "Dallas, TX"). Return only City, ST. Never return the subject property's address. When the team sits in different offices, give each person their own office.
Rules for brokerContacts — extract ONLY the named LISTING TEAM for THIS deal: the handful of people a buyer would actually contact (the agents in the cover / "Exclusively Listed By" box, a "For more information contact" block, and the primary people on the final contact page). This is normally 1–6 people.
CRITICAL — DO NOT dump the brokerage's company directory. Many OMs include a full firm "team" / "advisory group" / "our professionals" roster page listing 15–30 employees by Name + Title across a region. That is a marketing org chart, NOT the deal's listing team — EXCLUDE it entirely. Signs you are looking at a directory to skip: a long grid/list of names under one firm with no per-person phone/email, names for unrelated markets, or more than ~6 people. NEVER return more than 6 contacts. If a page has many names, keep ONLY the few explicitly tied to listing/marketing THIS property (usually the cover or "Exclusively Listed By" names) and drop the rest.
Capture each person's phone and email WHEN SHOWN — but a person still qualifies as a listing contact if only their name + title appear (some OMs list the listing team without individual emails/phones, sometimes with just a shared team email/phone). Capture name + title in that case and leave phone/email null.
WHERE the contacts are: a section delimited by "=== END-OF-OM CONTACT PAGES ===" is appended below. Two layouts appear (handle both):
  FORMAT A (vertical block): each person's Name, Title, Phone and Email sit on their OWN consecutive lines, often under headers like "Primary Contacts", "Investment Sales", "Capital Markets", "Debt & Equity".
  FORMAT B (horizontal / tab-separated TREC or IABS "Licensed Broker" disclosure): one person per line, fields in ANY order, possibly with a state license number, e.g. "Bard.Hoover@MarcusMillichap.com  TX 610697  Bard Hoover  (972) 755-5216" (Email · License# · Name · Phone). Parse by field TYPE — the token with an @ is the email, the phone-pattern token is the phone, a license number (e.g. "TX 610697", "432723", "9002994") is NOT a name and must be dropped, the remaining human name is the name.
DEDUPE & SKIP: skip any row that names ONLY the brokerage firm with no individual. Merge duplicates of the same person into ONE entry with the most complete info. For each kept person capture:
- name (full name)
- title (exact title as printed)
- phone (direct line if shown — strip any trailing "direct" / "mobile" / "office" label, keep just the number; null if not shown)
- email (null if not shown)
Return at most 6 people. Return [] only if no individual listing contact is named anywhere.
Note: names may contain apostrophes (e.g. O’Brien, O’Connor, D’Angelo) — these are valid full names; keep the apostrophe.

rules for effectiveGrossIncome — the CURRENT / IN-PLACE (actual, NOT pro-forma) EFFECTIVE GROSS INCOME from the OM's financial statement. This is the income subtotal AFTER economic / physical vacancy and loss are subtracted and AFTER other income (RUBS, fees, etc.) is ADDED — i.e. Gross Potential / Scheduled Income − economic vacancy + other income = Effective Gross Income. Use the row labeled EXACTLY "Effective Gross Income" (or "Total Effective Gross Income" / "Effective Gross Revenue" / "EGI" / "Total Revenue" / "Total Income"). PICK THE COLUMN that reflects ACTUAL / IN-PLACE / TRAILING performance — the trailing-twelve (T-12) or most-recent-actual-year column — NOT the stabilized "Upgrade Forecast" / "Pro Forma" projection column. Return one ANNUAL figure as a raw number (no $ or commas). If only a partial trailing period (T-3 or T-1) is shown, annualize it to 12 months (T-3 × 4, T-1 × 12).

rules for totalOpex — the TOTAL OPERATING EXPENSES from the OM's IN-PLACE / TRAILING financials. PREFER the T-12 (trailing-twelve-month) total operating expenses. If the OM only shows a T-3 (trailing 3 months) or T-1 (trailing 1 month) operating-expense figure, USE that and ANNUALIZE it to a full 12-month number (T-3 × 4, T-1 × 12). CRITICAL: Property Taxes AND Insurance MUST be included in totalOpex. Many statements report a "Total Operating Expenses" subtotal that covers only "controllable" expenses and list Property Taxes and Insurance separately BELOW it as "non-controllable" / fixed expenses — if so, ADD taxes and insurance on top so totalOpex always includes both. NEVER include debt service, mortgage interest, depreciation, amortization, capital expenditures, reserves, replacement reserves, or asset-management fees. Return one ANNUAL figure as a raw number (no $ or commas).

rules for opexBasis — a SHORT string naming the trailing period the totalOpex came from and whether it was annualized: "T-12" if a full trailing-twelve figure was used, "T-3 annualized" if you used a trailing-3-month figure × 4, "T-1 annualized" if a trailing-1-month figure × 12. Use null if no operating-expense figure was found.

rules for brokerEGI — the broker's PRO FORMA / STABILIZED "Upgrade Forecast" EFFECTIVE GROSS INCOME. Work step by step:
STEP 1 — PICK THE RIGHT ROW: Use the row whose label is EXACTLY "Effective Gross Income" (sometimes "Total Effective Gross Income", "Effective Gross Revenue", or abbreviated "EGI"). This is the income subtotal AFTER vacancy, loss-to-lease, concessions and bad debt are subtracted and other income is added — it sits LOWER in the income statement, just ABOVE operating expenses / NOI. DO NOT use the top-line "Gross Scheduled Income", "Gross Scheduled Rent", "Gross Potential Rent", or "Market Rent" rows — those are gross rent BEFORE deductions and are the WRONG, higher number. Also do NOT use "Net Operating Income". If no explicit "Effective Gross Income" line exists, fall back to "Total Revenue" or "Total Income" (the equivalent effective-income subtotal).
STEP 2 — PICK THE RIGHT COLUMN: That row jams MANY columns onto one text line: historical actuals (e.g. 2023, 2024, 2025), trailing / annualized columns, an "Acquisition Forecast" column, a per-unit column, a per-square-foot column, and FINALLY a stabilized "Upgrade Forecast" / "Unit Upgrade" / "Acquisition / Unit Upgrade" column. Return the value from that stabilized "Upgrade Forecast" column — in these side-by-side rows it is the LAST / RIGHT-MOST large annual dollar amount (hundreds-of-thousands or millions). IGNORE per-unit amounts, per-square-foot amounts (e.g. $14.47), and percentages (e.g. 100%, 103%).
WORKED EXAMPLE — for the row:
"Effective Gross Income $4,201,118 $4,310,540 102% $4,402,776 100% $18.32 100% $4,628,301 100%"
the correct answer is 4628301 — the LAST large dollar figure (the Upgrade Forecast column).
Return that single ANNUAL figure as a raw number (no $ or commas). This table is usually deep in the OM (often page 50+) — scan the ENTIRE excerpt, not just the start.

OM text (page markers like [Page 29] are included; excerpt focused around financial sections):
${text}`;
      const result = await aiComplete(prompt);
      const parsed = safeParseJSON(result) || {};
      // Deterministic override: pull the pro-forma top-line gross rent straight from the
      // text — the dense financial-analysis table is too error-prone for the model.
      const gsiForecast = extractProFormaTopline(fullText);
      if (gsiForecast != null) parsed.brokerEGI = gsiForecast;
  return { parsed, fullText };
}

/* Header save-status indicator — shows cloud sync state so it's clear when edits are safe. */
function SaveIndicator({ state }) {
  const cfg = {
    idle:   { dot: '#5a7a96', text: '' },
    dirty:  { dot: '#d9a441', text: 'Unsaved…' },
    saving: { dot: '#d9a441', text: 'Saving…' },
    saved:  { dot: '#4caf7e', text: 'Saved' },
    error:  { dot: '#e0686b', text: 'Save failed' },
    conflict: { dot: '#e0686b', text: 'Sync paused — data mismatch, contact an admin' },
  }[state] || { dot: '#5a7a96', text: '' };
  if (!cfg.text) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: state === 'error' ? '#ff9a9c' : '#8aaac8', fontWeight: 500 }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: cfg.dot,
        animation: state === 'saving' || state === 'dirty' ? 'pulse 1s ease-in-out infinite' : 'none' }} />
      {cfg.text}
    </span>
  );
}

// Full-width, persistent banner for save failures — the corner SaveIndicator is easy to
// miss during focused work, which is exactly how "Triad 3 Portfolio" got closed/logged
// out from without anyone noticing the save had stopped going through.
function SaveErrorBanner({ state, onRetry }) {
  if (state !== 'error' && state !== 'conflict') return null;
  const isConflict = state === 'conflict';
  return (
    <div style={{ background: isConflict ? '#4a1414' : '#5c1f1f', color: '#ffd7d7', padding: '9px 22px',
      display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, flex: 'none', borderBottom: '1px solid rgba(255,255,255,.12)' }}>
      <Icon name="pulse" size={15} style={{ flex: 'none' }} />
      <span style={{ flex: 1 }}>
        {isConflict
          ? 'Sync paused — the cloud read looked wrong, so nothing was overwritten. Contact an admin before continuing to edit.'
          : "Your changes aren't saving. Don't close this tab or log out until this is resolved — check your connection and retry."}
      </span>
      {!isConflict && (
        <button onClick={onRetry} style={{ border: '1px solid rgba(255,255,255,.35)', background: 'rgba(255,255,255,.08)',
          color: '#fff', borderRadius: 6, padding: '5px 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', flex: 'none' }}>
          Retry now
        </button>
      )}
    </div>
  );
}

/* ── Activity feed: what changed while you were away ───────────────────────────
   Diffs the cloud copy against what this browser last saw (on load) and against
   live realtime updates, so a returning user can follow other people's saves. */
const LS_ACTIVITY      = 'altus_activity_v1';
const LS_ACTIVITY_SEEN = 'altus_activity_seen_v1';

function loadActivity() {
  try { const s = JSON.parse(localStorage.getItem(LS_ACTIVITY)); if (Array.isArray(s)) return s; } catch (e) {}
  return [];
}
function loadActivitySeen() {
  try { return localStorage.getItem(LS_ACTIVITY_SEEN) || ''; } catch (e) { return ''; }
}

const _actMoney = (v) => (v == null || v === '' || isNaN(+v)) ? '—' :
  (Math.abs(+v) >= 1e6 ? '$' + (+v / 1e6).toFixed(2) + 'M' :
   Math.abs(+v) >= 1e3 ? '$' + Math.round(+v / 1e3) + 'K' : '$' + (+v));
const _actNum = (v) => (v == null || v === '') ? '—' : String(v);
const _actPct = (v) => (v == null || v === '' || isNaN(+v)) ? '—' : (+v).toFixed(2) + '%';

const ACT_FIELDS = [
  ['stage', 'Stage', _actNum],
  ['name', 'Name', _actNum],
  ['market', 'Market', _actNum],
  ['units', 'Units', _actNum],
  ['vintage', 'Year built', _actNum],
  ['askPrice', 'Guidance price', _actMoney],
  ['purchasePrice', 'Offer price', _actMoney],
  ['capex', 'CapEx', _actMoney],
  ['exitCap', 'Exit cap', _actPct],
  ['broker', 'Broker', _actNum],
  ['cfoDate', 'CFO date', _actNum],
  ['gprAnnual', 'GPR', _actMoney],
  ['trailingEGI', 'EGI', _actMoney],
  ['currentOpexTotal', 'OpEx', _actMoney],
  ['brokerEGI', 'Pro forma EGI', _actMoney],
  ['lpPref', 'LP pref', _actPct],
  ['lpSplit', 'LP split', _actPct],
];

function describeDealChange(prev, next) {
  const out = [];
  ACT_FIELDS.forEach(([k, label, fmt]) => {
    const a = prev[k], b = next[k];
    if ((a == null ? '' : String(a)) === (b == null ? '' : String(b))) return;
    out.push(label + ': ' + fmt(a) + ' → ' + fmt(b));
  });
  const pc = Array.isArray(prev.callLog) ? prev.callLog.length : 0;
  const nc = Array.isArray(next.callLog) ? next.callLog.length : 0;
  if (nc > pc) out.push((nc - pc) + ' broker call' + (nc - pc === 1 ? '' : 's') + ' logged');
  if ((prev.notes || '') !== (next.notes || '')) out.push('Notes updated');
  const ms = (d) => d && d.marketReview && d.marketReview.status;
  if (ms(prev) !== ms(next) && ms(next) === 'done') out.push('Market review generated');
  if (!(prev.memo && prev.memo.data) && (next.memo && next.memo.data)) out.push('IC memo drafted');
  if (!out.length && stableStringify(prev) !== stableStringify(next)) out.push('Underwriting updated');
  return out;
}

// Build activity entries from a before/after map of deals.
function buildDealActivity(prevById, nextList, tsIso) {
  const entries = [];
  const nextIds = new Set();
  nextList.forEach((d) => {
    nextIds.add(d.id);
    const prev = prevById[d.id];
    if (!prev) {
      entries.push({ id: 'a_' + d.id + '_new_' + tsIso, ts: tsIso, dealId: d.id,
        dealName: d.name || 'Untitled deal', kind: 'added', text: 'Added to the pipeline' });
      return;
    }
    describeDealChange(prev, d).forEach((text, i) => entries.push({
      id: 'a_' + d.id + '_' + i + '_' + tsIso, ts: tsIso, dealId: d.id,
      dealName: d.name || prev.name || 'Untitled deal', kind: 'changed', text }));
  });
  Object.values(prevById).forEach((p) => {
    if (!nextIds.has(p.id)) entries.push({ id: 'a_' + p.id + '_del_' + tsIso, ts: tsIso,
      dealId: null, dealName: p.name || 'Untitled deal', kind: 'removed', text: 'Removed from the pipeline' });
  });
  return entries;
}

function ChangeFeedBar({ items, open, onToggle, onDismiss, onOpenDeal }) {
  if (!items.length) return null;
  const KIND = { added: { c: '#0c7a43', l: 'New' }, removed: { c: '#c93c40', l: 'Removed' }, changed: { c: '#1f57c4', l: 'Updated' } };
  const when = (ts) => { try { return new Date(ts).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } };
  return (
    <div style={{ background: '#eef3fd', borderBottom: '1px solid #cfdcf5', fontFamily: 'var(--font)' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '9px 30px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#1f57c4', flex: 'none' }} />
        <span style={{ fontSize: 13, fontWeight: 600, color: '#0d1f35' }}>
          {items.length} change{items.length !== 1 ? 's' : ''} since you were last here
        </span>
        <span style={{ fontSize: 12.5, color: '#607080' }}>
          across {new Set(items.map((i) => i.dealName)).size} deal{new Set(items.map((i) => i.dealName)).size !== 1 ? 's' : ''}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={onToggle} style={{ border: '1px solid #cfdcf5', background: '#fff', color: '#1f57c4',
          borderRadius: 7, height: 28, padding: '0 12px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}>
          {open ? 'Hide' : 'What changed?'}
        </button>
        <button onClick={onDismiss} title="Mark as read" style={{ border: 'none', background: 'none', color: '#8fa0b2',
          fontSize: 16, lineHeight: 1, cursor: 'pointer', padding: 3 }}>✕</button>
      </div>
      {open && (
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 30px 12px' }}>
          <div style={{ background: '#fff', border: '1px solid #cfdcf5', borderRadius: 9, overflow: 'hidden', maxHeight: 300, overflowY: 'auto' }}>
            {items.slice(0, 80).map((it, i) => {
              const k = KIND[it.kind] || KIND.changed;
              return (
                <div key={it.id} onClick={() => { if (it.dealId) onOpenDeal(it.dealId); }}
                  style={{ display: 'grid', gridTemplateColumns: '132px 74px 1fr 2fr', gap: 12, alignItems: 'center',
                    padding: '8px 14px', cursor: it.dealId ? 'pointer' : 'default',
                    borderTop: i ? '1px solid #edf0f7' : 'none' }}>
                  <span className="num" style={{ fontSize: 11.5, color: '#8fa0b2' }}>{when(it.ts)}</span>
                  <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: k.c }}>{k.l}</span>
                  <span className="clip" style={{ fontSize: 12.5, fontWeight: 600, color: '#0d1f35' }}>{it.dealName}</span>
                  <span style={{ fontSize: 12.5, color: '#41576e' }}>{it.text}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Top-of-screen toast — import / parse status (CoStar, docs, AI runs) ─────── */
function TopToast({ toast, onClose }) {
  if (!toast) return null;
  const cfg = {
    busy:  { bg: '#0d1f35', bd: '#1b3e60', fg: '#ffffff', sub: '#9fb4cf' },
    ok:    { bg: '#0c7a43', bd: '#0a6538', fg: '#ffffff', sub: '#c9ecd8' },
    error: { bg: '#c93c40', bd: '#ab3034', fg: '#ffffff', sub: '#fbd8d9' },
  }[toast.kind] || { bg: '#0d1f35', bd: '#1b3e60', fg: '#fff', sub: '#9fb4cf' };
  return (
    <div style={{ position: 'fixed', top: 66, left: '50%', transform: 'translateX(-50%)', zIndex: 10000,
      display: 'flex', alignItems: 'center', gap: 12, minWidth: 380, maxWidth: 620,
      background: cfg.bg, border: '1px solid ' + cfg.bd, borderRadius: 11, padding: '11px 14px',
      boxShadow: '0 12px 34px rgba(6,16,28,.32)', fontFamily: 'var(--font)' }}>
      {toast.kind === 'busy' ? (
        <span style={{ width: 18, height: 18, flex: 'none', borderRadius: '50%', border: '2.5px solid #6d9ae0',
          borderTopColor: 'transparent', animation: 'spin .8s linear infinite' }} />
      ) : (
        <span style={{ width: 22, height: 22, flex: 'none', borderRadius: '50%', background: 'rgba(255,255,255,.18)',
          color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={toast.kind === 'error' ? 'close' : 'check'} size={12} />
        </span>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: cfg.fg }}>{toast.title}</div>
        {toast.sub && <div style={{ fontSize: 11.5, color: cfg.sub, marginTop: 2 }}>{toast.sub}</div>}
      </div>
      {toast.kind !== 'busy' && (
        <button onClick={onClose} style={{ border: 'none', background: 'none', color: cfg.sub,
          fontSize: 15, lineHeight: 1, cursor: 'pointer', padding: 3 }}>✕</button>
      )}
    </div>
  );
}

function AltusApp() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  // Cloud mode: never seed deals from localStorage. The browser holds no persistent deal
  // copy that could overwrite Supabase — start empty and load fresh from the cloud on every
  // open. Local-only fallback (cloud disabled) still uses the localStorage cache.
  const [deals, setDeals] = useS(() => (window.AltusCloud && window.AltusCloud.enabled) ? [] : migrateDeals(loadDeals()));
  const [view, setView] = useS('pipeline');
  const [openId, setOpenId] = useS(null);
  const [showSettings, setShowSettings] = useS(false);
  const [user, setUser] = useS('Garrett');
  const [omMap, setOMMap] = useS({});
  const [t12Map, setT12Map] = useS({});
  const [rrMap, setRRMap] = useS({});
  const [todos, setTodos] = useS(() => { try { return JSON.parse(localStorage.getItem(LS_TODOS)) || []; } catch { return []; } });
  const clearOM  = (id) => setOMMap( (m) => { const n = {...m}; delete n[id]; return n; });
  const addTodo    = (t)  => setTodos((ts) => [t, ...ts]);
  const patchTodo  = (id, fields) => setTodos((ts) => ts.map((t) => t.id === id ? { ...t, ...fields } : t));
  const deleteTodo = (id) => {
    setTodos((ts) => ts.filter((t) => t.id !== id));
    // Explicitly delete from cloud — never rely on auto-save pruning for this.
    if (cloud.enabled && cloud.deleteCloudTodos) {
      cloud.deleteCloudTodos([id]).catch((e) => console.warn('[cloud] explicit todo delete failed', e));
    }
  };
  const clearT12 = (id) => setT12Map((m) => { const n = {...m}; delete n[id]; return n; });
  const clearRR  = (id) => setRRMap( (m) => { const n = {...m}; delete n[id]; return n; });
  const [contacts, setContacts] = useS(loadContacts);

  // ---- Cloud auth + sync (Supabase) ----
  const cloud = window.AltusCloud || {};
  const [session, setSession] = useS(cloud.requireLogin ? undefined : null); // undefined = still checking
  const [authBusy, setAuthBusy] = useS(false);
  const cloudLoaded = useR(false);
  const [cloudReady, setCloudReady] = useS(false); // false until the first cloud reconcile completes (gates the pipeline render)
  const skipNextSave = useR(false);                // set when adopting a cloud read, so it isn't echoed straight back as a save
  // Firm-wide assumptions (debt quotes, closing-cost schedule) feed every deal's model:
  // when they change, hand React a fresh deals array so memoized views recompute.
  // Deal data itself is unchanged, so this is never echoed back as a save.
  useE(() => {
    const A = window.AltusAssumptions;
    if (!A) return undefined;
    return A.subscribe(() => { skipNextSave.current = true; setDeals((ds) => ds.slice()); });
  }, []);
  const saveTimer = useR(null);
  const firstPendingSaveAt = useR(null);   // bounds the debounce so continuous typing can't defer a save indefinitely
  const mainRef = useR(null);          // ref to <main> for scroll save/restore
  const savedScrollRef = useR(0);      // saved scroll position before opening a deal
  const contactsLoaded = useR(false);
  const contactsSaveTimer = useR(null);
  const justSavedContactsRef = useR({}); // same self-echo guard as justSavedDealsRef, for contacts
  const todosLoaded = useR(false);
  const todosSaveTimer = useR(null);
  const justSavedTodosRef = useR({});    // same self-echo guard as justSavedDealsRef, for todos
  const dealsRef = useR(deals);          // always-fresh deals for the unload flush
  // id -> Set of recent JSON snapshots we've pushed, to ignore self-echoes. Keeps a short
  // rolling history rather than just the latest save — with realtime now actually delivering
  // events, a fast typing burst fires a new debounced save every ~400ms, and a Postgres
  // Changes echo for an earlier save can arrive after a later save has already moved on.
  // A single last-snapshot comparison would then miss the match and let the earlier
  // (stale) echo overwrite whatever was typed since, which is exactly what caused notes
  // fields to flicker and drop characters once realtime was turned on.
  const justSavedDealsRef = useR({});
  const [pipeSortKey, setPipeSortKey] = useS('manual');
  const [pipeSortDir, setPipeSortDir] = useS('asc');
  const [saveState, setSaveState] = useS('idle'); // idle | dirty | saving | saved | error
  const saveStateRef = useR('idle');

  // Activity feed — remote changes this browser hasn't shown yet.
  const [activity, setActivity] = useS(loadActivity);
  const [activitySeen, setActivitySeen] = useS(loadActivitySeen);
  const [feedOpen, setFeedOpen] = useS(false);
  const [toast, setToast] = useS(null);
  useE(() => {
    window.__altusToast = setToast;   // lets other modules surface the same top-of-screen status
    return () => { delete window.__altusToast; };
  }, []);
  useE(() => {
    if (!toast || toast.kind === 'busy') return undefined;
    const id = setTimeout(() => setToast(null), toast.kind === 'error' ? 9000 : 6000);
    return () => clearTimeout(id);
  }, [toast]);
  useE(() => {
    try { localStorage.setItem(LS_ACTIVITY, JSON.stringify(activity.slice(0, 200))); } catch (e) {}
  }, [activity]);
  const pushActivity = (entries) => {
    if (!entries || !entries.length) return;
    setActivity((a) => [...entries, ...a].slice(0, 200));
  };
  const unseenActivity = activity.filter((a) => !activitySeen || a.ts > activitySeen);
  const markActivitySeen = () => {
    const now = new Date().toISOString();
    setActivitySeen(now);
    setFeedOpen(false);
    try { localStorage.setItem(LS_ACTIVITY_SEEN, now); } catch (e) {}
  };

  useE(() => {
    if (!cloud.requireLogin) { setSession(null); return; }
    let active = true;
    cloud.getSession().then((s) => { if (active) setSession(s); }).catch(() => { if (active) setSession(null); });
    const off = cloud.onAuthChange((s) => { if (active) setSession(s); });
    return () => { active = false; if (off) off(); };
  }, []);

  // Reset the one-time "already loaded" guards whenever the session drops (sign-out).
  // Without this, signing out and back in — without a hard page refresh — left these
  // flags set from the previous session, so the load effects below skipped their fetch
  // entirely and just kept whatever was in memory from before logout. That stale
  // in-memory copy is what was overriding Supabase after a logout/login cycle; this
  // ensures a fresh sign-in always re-runs the same safe reconcile-from-cloud a page
  // refresh does.
  useE(() => {
    if (!session) {
      cloudLoaded.current = false;
      contactsLoaded.current = false;
      todosLoaded.current = false;
      setCloudReady(false);
    }
  }, [session]);

  // Load deals from cloud once authenticated (or immediately if no login required but enabled).
  // Cloud is unconditionally authoritative here (see cloud.reconcileDeals) — local state
  // is always fully replaced with whatever cloud says, no local-wins exceptions. The one
  // safety net is a circuit breaker: if a read looks like it lost a large share of
  // previously-known rows (the exact failure mode that wiped the pipeline on
  // 2026-07-08), it's flagged as suspicious and left untouched with a visible warning
  // instead of being blindly applied.
  useE(() => {
    if (!cloud.enabled) return;
    if (cloud.requireLogin && !session) return;
    if (cloudLoaded.current) return; // already loaded — skip token-refresh re-fires that would wipe local edits
    let active = true;
    cloud.reconcileDeals(deals).then((result) => {
      if (!active) return;
      if (result.suspicious) {
        console.error('[cloud] refusing to sync deals: the cloud read came back empty while ' +
          result.total + ' deals were previously known. Leaving state untouched.');
        setSaveState('conflict');
        setCloudReady(true); // still render the app (with the warning) rather than hang on the splash
        return; // don't mark cloudLoaded — a later auth/session event gets another chance
      }
      cloudLoaded.current = true;
      if (result.changed) {
        const items = migrateDeals(result.items);
        // Diff against what this browser last saw so the user can follow other people's
        // saves made while they were away. Skipped on a genuinely empty first load.
        const prevById = {};
        (dealsRef.current || []).forEach((d) => { prevById[d.id] = d; });
        if (Object.keys(prevById).length) {
          pushActivity(buildDealActivity(prevById, items, new Date().toISOString()));
        }
        skipNextSave.current = true; // adopting the cloud read must not bounce back as a save
        setDeals(items);
      }
      setCloudReady(true);
    }).catch((e) => { console.warn('[cloud] load failed', e); setCloudReady(true); });
    return () => { active = false; };
  }, [session]);

  // Load contacts from cloud once authenticated (same safe-merge approach as deals).
  useE(() => {
    if (!cloud.enabled) return;
    if (cloud.requireLogin && !session) return;
    if (contactsLoaded.current) return; // already loaded
    let active = true;
    cloud.reconcileContacts(contacts).then((result) => {
      if (!active) return;
      if (result.suspicious) {
        console.error('[cloud] refusing to sync contacts: the cloud read looks like it lost ' +
          result.dropped + ' of ' + result.total + ' previously-synced contacts. Leaving local data untouched.');
        setSaveState('conflict');
        return;
      }
      contactsLoaded.current = true;
      if (result.changed) setContacts(result.items);
    }).catch((e) => console.warn('[cloud] contacts load failed, using local', e));
    return () => { active = false; };
  }, [session]);

  const addContact = (c) => setContacts((cs) => cs.find((x) => x.id === c.id) ? cs : [...cs, c]);
  const patchContact = (id, changes) => setContacts((cs) => cs.map((c) => c.id === id ? { ...c, ...changes } : c));

  // Load todos from cloud once authenticated (mirrors contacts/deals).
  useE(() => {
    if (!cloud.enabled) return;
    if (cloud.requireLogin && !session) return;
    if (todosLoaded.current) return;
    let active = true;
    cloud.reconcileTodos(todos).then((result) => {
      if (!active) return;
      if (result.suspicious) {
        console.error('[cloud] refusing to sync todos: the cloud read looks like it lost ' +
          result.dropped + ' of ' + result.total + ' previously-synced todos. Leaving local data untouched.');
        setSaveState('conflict');
        return;
      }
      todosLoaded.current = true;
      if (result.changed) setTodos(result.items);
    }).catch((e) => console.warn('[cloud] todos load failed, using local', e));
    return () => { active = false; };
  }, [session]);

  // Persist todos: localStorage immediately + debounced cloud save
  useE(() => {
    try {localStorage.setItem(LS_TODOS, JSON.stringify(todos));} catch (e) {}
    if (cloud.enabled && (!cloud.requireLogin || session) && todosLoaded.current) {
      clearTimeout(todosSaveTimer.current);
      todosSaveTimer.current = setTimeout(() => {
        todos.forEach((t) => recordSentSnapshot(justSavedTodosRef, t.id, stableStringify(t)));
        cloud.saveTodos(todos).catch((e) => console.warn('[cloud] todos save failed', e));
      }, 1000);
    }
  }, [todos]);

  useE(() => {
    try {localStorage.setItem(LS_CONTACTS, JSON.stringify(contacts));} catch (e) {}
    if (cloud.enabled && (!cloud.requireLogin || session) && contactsLoaded.current) {
      clearTimeout(contactsSaveTimer.current);
      contactsSaveTimer.current = setTimeout(() => {
        contacts.forEach((c) => recordSentSnapshot(justSavedContactsRef, c.id, stableStringify(c)));
        cloud.saveContacts(contacts).catch((e) => console.warn('[cloud] contacts save failed', e));
      }, 1200);
    }
  }, [contacts]);

  // Persist deals: in cloud mode we do NOT cache deals in localStorage at all — the browser
  // holds no persistent copy that could ever be flushed over Supabase. Each change is written
  // straight through to the cloud (debounced ~0.4s so typing isn't a request per keystroke),
  // and only the deals that actually changed are upserted. localStorage is used solely as the
  // store in local-only fallback mode when cloud is disabled.
  useE(() => {
    dealsRef.current = deals;
    if (!cloud.enabled) { try { localStorage.setItem(LS_KEY, JSON.stringify(deals)); } catch (e) {} }
    // Adopting a cloud read updates `deals`; don't echo that straight back as a save.
    if (skipNextSave.current) { skipNextSave.current = false; return; }

    if (cloud.enabled && (!cloud.requireLogin || session) && cloudLoaded.current) {
      setSaveState('dirty');
      clearTimeout(saveTimer.current);
      const now = Date.now();
      if (!firstPendingSaveAt.current) firstPendingSaveAt.current = now;
      // Shorter trailing debounce so co-editors see changes sooner, plus a hard 1.5s cap on
      // how long continuous edits (e.g. tabbing through many fields) can keep deferring a
      // save — previously an uninterrupted editing streak could push the save out indefinitely,
      // widening the window in which a closed tab/lost connection loses unsaved edits.
      const delay = (now - firstPendingSaveAt.current >= 1500) ? 0 : 400;
      saveTimer.current = setTimeout(() => {
        firstPendingSaveAt.current = null;
        setSaveState('saving');
        dealsRef.current.forEach((d) => recordSentSnapshot(justSavedDealsRef, d.id, stableStringify(d)));
        cloud.saveDeals(dealsRef.current)
          .then(() => setSaveState('saved'))
          .catch((e) => { console.warn('[cloud] save failed', e); setSaveState('error'); });
      }, delay);
    }
  }, [deals]);

  // Manual retry for the error banner — bypasses the debounce and fires the save immediately.
  const retrySaveNow = () => {
    if (!cloud.enabled) return;
    clearTimeout(saveTimer.current);
    firstPendingSaveAt.current = null;
    setSaveState('saving');
    cloud.saveDeals(dealsRef.current)
      .then(() => setSaveState('saved'))
      .catch((e) => { console.warn('[cloud] retry save failed', e); setSaveState('error'); });
  };

  // Flush any pending save when the tab is hidden or closed, so edits made right before
  // leaving aren't lost to the debounce window. Best-effort — the browser can still cut
  // this off mid-flight on an actual close, which is exactly why the beforeunload warning
  // below exists as a second line of defense.
  useE(() => {
    if (!cloud.enabled) return;
    const flush = () => {
      if (!cloudLoaded.current) return;
      clearTimeout(saveTimer.current);
      cloud.saveDeals(dealsRef.current).catch(() => {});
    };
    const onVis = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
    };
  }, []);

  // Keep a ref mirror of saveState so the beforeunload handler (registered once) always
  // reads the current value instead of a stale closure.
  useE(() => { saveStateRef.current = saveState; }, [saveState]);

  // Warn before leaving with unsaved or failed changes. A stuck/failed save is otherwise
  // easy to miss — this is the safety net for exactly the case that lost "Triad 3
  // Portfolio" on 2026-07-22: edits sitting unsaved (or failing to save) with no friction
  // stopping someone from closing the tab or logging out before they land.
  useE(() => {
    if (!cloud.enabled) return;
    const onBeforeUnload = (e) => {
      const s = saveStateRef.current;
      if (s === 'dirty' || s === 'saving' || s === 'error' || s === 'conflict') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // Live cloud sync: reflect other clients' changes in realtime via Supabase Postgres changes.
  useE(() => {
    if (!cloud.enabled) return undefined;
    if (cloud.requireLogin && !session) return undefined;
    return cloud.subscribeTable('deals', (payload) => {
      if (payload.eventType === 'DELETE') {
        const id = payload.old.id;
        const gone = (dealsRef.current || []).find((d) => d.id === id);
        if (gone) pushActivity([{ id: 'a_' + id + '_del_' + Date.now(), ts: new Date().toISOString(),
          dealId: null, dealName: gone.name || 'Untitled deal', kind: 'removed', text: 'Removed from the pipeline' }]);
        setDeals((ds) => ds.filter((d) => d.id !== id));
        return;
      }
      const incoming = migrateDeals([{ ...(payload.new.data || {}), id: payload.new.id }])[0];
      // Skip echoes of our own recent saves — the debounced upload can round-trip back via
      // realtime after the user has already typed further (and, during a fast typing burst,
      // after one or more later saves have already fired too), and applying a match against
      // only the latest save would let an earlier save's late echo stomp newer keystrokes.
      const sentSet = justSavedDealsRef.current[incoming.id];
      if (sentSet && sentSet.has(stableStringify(incoming))) return;
      // Log the remote change for the "what changed" bar before applying it.
      (() => {
        const ts = new Date().toISOString();
        const prev = (dealsRef.current || []).find((d) => d.id === incoming.id);
        if (!prev) {
          pushActivity([{ id: 'a_' + incoming.id + '_new_' + Date.now(), ts, dealId: incoming.id,
            dealName: incoming.name || 'Untitled deal', kind: 'added', text: 'Added to the pipeline' }]);
          return;
        }
        if (stableStringify(prev) === stableStringify(incoming)) return;
        pushActivity(describeDealChange(prev, incoming).map((text, i) => ({
          id: 'a_' + incoming.id + '_' + i + '_' + Date.now(), ts, dealId: incoming.id,
          dealName: incoming.name || prev.name || 'Untitled deal', kind: 'changed', text })));
      })();
      setDeals((ds) => {
        const existing = ds.find((d) => d.id === incoming.id);
        if (existing && stableStringify(existing) === stableStringify(incoming)) return ds;
        // Guard against applying a stale/partial row over real local data — if the incoming
        // row is drastically smaller (e.g. a delayed echo of a pre-edit snapshot, or a
        // truncated write) it's more likely data loss than a legitimate remote edit.
        if (existing) {
          const existingLen = JSON.stringify(existing).length;
          const incomingLen = JSON.stringify(incoming).length;
          if (existingLen > 200 && incomingLen < existingLen * 0.5) {
            console.warn('[cloud] ignored suspiciously smaller realtime update for deal', incoming.id, { existingLen, incomingLen });
            return ds;
          }
        }
        return existing ? ds.map((d) => d.id === incoming.id ? incoming : d) : [...ds, incoming];
      });
    });
  }, [session]);

  useE(() => {
    if (!cloud.enabled) return undefined;
    if (cloud.requireLogin && !session) return undefined;
    return cloud.subscribeTable('contacts', (payload) => {
      if (payload.eventType === 'DELETE') {
        const id = payload.old.id;
        setContacts((cs) => cs.filter((c) => c.id !== id));
        return;
      }
      const incoming = { ...(payload.new.data || {}), id: payload.new.id };
      const sentSet = justSavedContactsRef.current[incoming.id];
      if (sentSet && sentSet.has(stableStringify(incoming))) return;
      setContacts((cs) => {
        const existing = cs.find((c) => c.id === incoming.id);
        if (existing && stableStringify(existing) === stableStringify(incoming)) return cs;
        return existing ? cs.map((c) => c.id === incoming.id ? incoming : c) : [...cs, incoming];
      });
    });
  }, [session]);

  useE(() => {
    if (!cloud.enabled) return undefined;
    if (cloud.requireLogin && !session) return undefined;
    return cloud.subscribeTable('todos', (payload) => {
      if (payload.eventType === 'DELETE') {
        const id = payload.old.id;
        setTodos((ts) => ts.filter((t) => t.id !== id));
        return;
      }
      const incoming = { ...(payload.new.data || {}), id: payload.new.id };
      const sentSet = justSavedTodosRef.current[incoming.id];
      if (sentSet && sentSet.has(stableStringify(incoming))) return;
      setTodos((ts) => {
        const existing = ts.find((t) => t.id === incoming.id);
        if (existing && stableStringify(existing) === stableStringify(incoming)) return ts;
        return existing ? ts.map((t) => t.id === incoming.id ? incoming : t) : [...ts, incoming];
      });
    });
  }, [session]);

  // Scroll <main> to top when a deal opens so DealDetail is always fully visible;
  // restore previous position when the user goes back.
  useE(() => {
    if (openId) {
      savedScrollRef.current = mainRef.current ? mainRef.current.scrollTop : 0;
      if (mainRef.current) mainRef.current.scrollTop = 0;
    } else {
      if (mainRef.current) mainRef.current.scrollTop = savedScrollRef.current;
    }
  }, [openId]);

  useE(() => {
    const r = document.documentElement.style;
    r.setProperty('--accent', t.accent);
    r.setProperty('--accent-2', shade(t.accent, -18));
    r.setProperty('--accent-soft', tint(t.accent, 0.90));
    r.setProperty('--row-h', (t.density === 'compact' ? 38 : t.density === 'comfy' ? 52 : 44) + 'px');
  }, [t.accent, t.density]);

  const lockUW = (d) => (window.AltusAssumptions && window.AltusAssumptions.withSnapshot ? window.AltusAssumptions.withSnapshot(d) : d);
  const patch = (id, changes) => setDeals((ds) => ds.map((d) => d.id === id ? lockUW({ ...d, ...changes }) : d));
  const bulkPatch = (ids, changes) => { const s = new Set(ids); setDeals((ds) => ds.map((d) => s.has(d.id) ? { ...d, ...changes } : d)); };
  const bulkDelete = (ids) => {
    const s = new Set(ids);
    setDeals((ds) => ds.filter((d) => !s.has(d.id)));
    // Explicitly delete from cloud — never rely on auto-save pruning for this.
    if (cloud.enabled && cloud.deleteCloudDeals) {
      cloud.deleteCloudDeals([...ids]).catch((e) => console.warn('[cloud] explicit delete failed', e));
    }
  };
  // Reorder the VISIBLE deals into orderedIds, keeping each visible deal's original slot
  // in the full array occupied (so the manual order survives filtering/search).
  const reorderVisible = (orderedIds) => setDeals((ds) => {
    const idSet = new Set(orderedIds);
    const slots = []; ds.forEach((d, i) => { if (idSet.has(d.id)) slots.push(i); });
    const byId = {}; ds.forEach((d) => { byId[d.id] = d; });
    const reordered = orderedIds.map((id) => byId[id]).filter(Boolean);
    const copy = ds.slice();
    slots.forEach((slot, k) => { copy[slot] = reordered[k]; });
    return copy;
  });
  const addDeal = (rawDeal) => {
    const { _omContacts, _omFile, ...deal } = rawDeal || {};
    setDeals((ds) => [deal, ...ds]);
    setOpenId(deal.id);
    if (_omFile) stashDoc(deal.id, _omFile, 'OM');   // the OM used to fill the form goes to the Document Vault
    // Create CRM contacts from any broker contacts the OM auto-fill captured.
    const people = _omContacts && Array.isArray(_omContacts.people) ? _omContacts.people : [];
    if (people.length) {
      setContacts((cs) => {
        let next = [...cs];
        people.forEach((pc) => {
          if (!pc || !pc.name) return;
          const exists = next.find((c) =>
            (pc.email && c.email && c.email.toLowerCase() === pc.email.toLowerCase()) ||
            (c.name && c.name.toLowerCase() === pc.name.toLowerCase()));
          if (exists) {
            next = next.map((c) => c.id === exists.id
              ? { ...c, dealIds: Array.from(new Set([...(c.dealIds || []), deal.id])), firm: c.firm || _omContacts.firm || '',
                  ...(window.netContactMarket ? window.netContactMarket(pc, _omContacts, c) : {}) }
              : c);
          } else {
            next = [...next, { id: 'c_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
              name: pc.name, title: pc.title || '', firm: _omContacts.firm || '', email: pc.email || '', phone: pc.phone || '',
              ...(window.netContactMarket ? window.netContactMarket(pc, { ..._omContacts, market: _omContacts.market || deal.market }, null) : {}),
              dealIds: [deal.id], lastActivity: window.ALTUS_TODAY }];
          }
        });
        return next;
      });
    }
  };
  const importDeals = (arr) => setDeals((ds) => [...arr, ...ds]);
  const open = (id) => setOpenId(id);
  const deal = deals.find((d) => d.id === openId);
  const pipelineDeals = deals.filter(isPipeline);
  const loiDeals = deals.filter(isLOI);
  const liveDeals = deals.filter((d) => !isDead(d));
  const deadDeals = deals.filter(isDead);

  const acceptOM = (dealId, fields) => patch(dealId, fields);

  // ── Property / Submarket Review ── progressive two-phase load.
  // Phase 1: sentiment + crime (~800 token response) → shows immediately.
  // Phase 2: economic drivers + submarket context. Silent failure keeps Phase 1 results.
  const runMarketReview = async (dealId) => {
    const d = (dealsRef.current || deals).find((x) => x.id === dealId);
    if (!d) return;
    patch(dealId, { marketReview: { status: 'running', startedAt: new Date().toISOString() } });
    const ctx = [
      d.name    ? 'Property: '  + d.name         : '',
      d.market  ? 'Market: '    + d.market        : '',
      d.units   ? 'Units: '     + d.units         : '',
      d.vintage ? 'Built: '     + d.vintage       : '',
      d.type    ? 'Type: '      + d.type          : '',
      d.locationQuery ? 'Address: ' + d.locationQuery : '',
    ].filter(Boolean).join(', ');

    try {
      // ── Phase 1 ── resident sentiment + crime snapshot
      const p1 = 'Property & submarket review for: ' + (ctx || 'unknown') + '.\n' +
        'Return ONLY JSON (no markdown, no extra text):\n' +
        '{"residentSentiment":{"rating":3.6,"reviewCount":162,"trend":"Stable","positives":["loc convenience","quiet","responsive mgmt"],"negatives":["parking","security","pests"],"recentReviews":[{"date":"May 2025","stars":4,"text":"1 sentence."},{"date":"Apr 2025","stars":3,"text":"1 sentence."},{"date":"Mar 2025","stars":3,"text":"1 sentence."}],"source":"Google Reviews (est.)"},' +
        '"crimeSnapshot":{"overall":{"label":"Better than Metro","vsMetro":"18% below metro avg"},"violentCrime":{"label":"Lower","vsMetro":"20% below metro avg"},"propertyCrime":{"label":"Lower","vsMetro":"15% below metro avg"},"relativePosition":["1 sentence.","1 sentence."],"recentActivity":["1 sentence.","1 sentence."],"investmentImplication":["1 sentence.","1 sentence."],"source":"NeighborhoodScout, FBI UCR (est.)"}}\n' +
        'Replace ALL placeholder values with real estimates for this location. trend: Stable/Improving/Declining. crime labels: Better than Metro/At Metro Avg/Worse than Metro and Lower/At Metro Avg/Higher.';

      const out1 = await aiComplete(p1, { maxTokens: 900 });
      const r1 = safeParseJSON(out1);
      if (!r1) throw new Error('Could not parse the property review.');

      const baseData = {
        residentSentiment: r1.residentSentiment || {},
        crimeSnapshot:     r1.crimeSnapshot     || {},
      };
      patch(dealId, { marketReview: { status: 'done', generatedAt: new Date().toISOString(), data: baseData } });

      // ── Phase 2 ── economic drivers + submarket context (silent failure OK)
      try {
        const p2 = 'Economic drivers and submarket context for: ' + (ctx || 'unknown') + '.\n' +
          'Return ONLY JSON (no markdown, no extra text):\n' +
          '{"economicDrivers":{"capitalInjections":[{"name":"project name","amount":"$XM"},{"name":"project name","amount":"$XM"},{"name":"project name","amount":"$XM"}],"majorEmployers":[{"name":"Employer","size":"large"},{"name":"Employer","size":"medium"},{"name":"Employer","size":"small"}],"employerNote":"1 sentence about employer diversity.","populationTrend":{"cagr5yr":"+X.X%","vsState":"text","drivers":"text"},"source":"sources"},' +
          '"submarketContext":{"overallGrade":"B+","overallAssessment":"2 sentences.","comparables":[{"rank":1,"name":"submarket","crimeIndex":66,"label":"Safer","isSubject":false},{"rank":2,"name":"subject (Subject)","crimeIndex":82,"label":"Safer","isSubject":true},{"rank":3,"name":"submarket","crimeIndex":101,"label":"Similar","isSubject":false},{"rank":4,"name":"submarket","crimeIndex":112,"label":"Less Safe","isSubject":false}],"source":"sources"}}\n' +
          'Replace ALL values. grade options: A B+ B B- C+ C D. 4-6 comparables with subject marked isSubject:true. crimeIndex: 100=metro avg, lower=safer. label: Safer/Similar/Less Safe.';

        const out2 = await aiComplete(p2, { maxTokens: 1800 });
        let r2 = safeParseJSON(out2);
        if (!r2) {   // one retry — truncation or stray prose is the usual cause
          const out2b = await aiComplete(p2 + '\nJSON only. Keep every string under 200 characters so the object is complete.', { maxTokens: 1800 });
          r2 = safeParseJSON(out2b);
        }
        if (!r2) throw new Error('Could not parse economic drivers / submarket context.');
        if (r2) {
          const fresh = (dealsRef.current || []).find((x) => x.id === dealId);
          const freshMR = (fresh && fresh.marketReview) || {};
          const freshData = freshMR.data || baseData;
          patch(dealId, { marketReview: { ...freshMR, data: {
            ...freshData,
            economicDrivers:  r2.economicDrivers  || {},
            submarketContext: r2.submarketContext  || {},
          }, phase2Error: null }});
        }
      } catch (e2) {
        console.warn('[MarketReview] Phase 2 failed:', e2 && e2.message);
        const fresh2 = (dealsRef.current || []).find((x) => x.id === dealId);
        const mr2 = (fresh2 && fresh2.marketReview) || {};
        patch(dealId, { marketReview: { ...mr2, phase2Error: String(e2 && e2.message ? e2.message : e2) } });
      }

    } catch (e) {
      patch(dealId, { marketReview: { status: 'error', error: String(e && e.message ? e.message : e) } });
    }
  };

  // ── CoStar import ── parse a downloaded CoStar PDF/Excel export and fold its
  // submarket metrics into the Property & Location Review.
  const importCoStar = async (dealId, file) => {
    const d = (dealsRef.current || deals).find((x) => x.id === dealId);
    if (!d || !file) return;
    setToast({ kind: 'busy', title: 'Reading ' + file.name + '…', sub: 'Extracting CoStar submarket metrics' });
    try {
      const raw = await extractFileText(file);
      if (!raw || !raw.trim()) throw new Error('No readable text in that file.');
      const text = focusExcerpt(raw, ['vacancy', 'asking rent', 'rent growth', 'net absorption',
        'under construction', 'inventory', 'market cap rate', 'sale comps', 'price/unit',
        'submarket', '12 mo', 'forecast'], 14000);
      const prompt = 'You are reading a CoStar export for ' + (d.name || 'a multifamily property') +
        (d.market ? ' in ' + d.market : '') + '. Extract the submarket / market data.\n' +
        'Return ONLY JSON (no markdown):\n' +
        '{"asOf":"Q2 2026","submarket":"submarket name","metrics":{"vacancy":"5.4%","vacancy12moChange":"+40 bps",' +
        '"askingRent":"$1,285","rentGrowth12mo":"+2.1%","rentGrowthForecast":"+3.0%","absorption12mo":"312 units",' +
        '"underConstruction":"1,450 units","inventory":"24,300 units","constructionPctInventory":"6.0%",' +
        '"marketCapRate":"5.4%","pricePerUnit":"$168,000","salesVolume12mo":"$412M"},' +
        '"comps":[{"name":"Property","units":248,"vintage":2003,"askingRent":"$1,240","vacancy":"6.1%"}],' +
        '"takeaways":["1 sentence.","1 sentence.","1 sentence."]}\n' +
        'Use ONLY figures present in the document; omit any key you cannot find (do not invent). ' +
        'Up to 8 comps. Keep values formatted as shown.\n\nCOSTAR EXPORT:\n' + text;
      const out = await aiComplete(prompt, { maxTokens: 1400 });
      const parsed = safeParseJSON(out);
      if (!parsed) throw new Error('Could not parse the CoStar export.');
      const costar = { ...parsed, fileName: file.name,
        importedAt: new Date().toISOString(), source: 'CoStar — ' + file.name };
      const fresh = (dealsRef.current || []).find((x) => x.id === dealId) || d;
      const mr = fresh.marketReview || {};
      patch(dealId, { marketReview: { ...mr, status: 'done',
        generatedAt: mr.generatedAt || new Date().toISOString(),
        data: { ...(mr.data || {}), costar } } });
      const nMetrics = Object.keys(parsed.metrics || {}).length;
      const nComps = Array.isArray(parsed.comps) ? parsed.comps.length : 0;
      setToast({ kind: 'ok', title: 'CoStar data added to the report',
        sub: file.name + ' · ' + (parsed.submarket ? parsed.submarket + ' · ' : '') + (parsed.asOf || 'current') +
          ' · ' + nMetrics + ' metric' + (nMetrics === 1 ? '' : 's') + (nComps ? ' · ' + nComps + ' comps' : '') });
    } catch (e) {
      setToast({ kind: 'error', title: "Couldn't import that CoStar file", sub: String(e && e.message ? e.message : e) });
    }
  };

  // ── IC Memo narrative ── Claude-written thesis / value drivers / risks for the memo.
  const runMemoNarrative = async (dealId) => {
    const d = (dealsRef.current || deals).find((x) => x.id === dealId);
    if (!d) return null;
    const m = window.computeMetrics ? window.computeMetrics(d) : {};
    const uw = window.hasUWInputs && window.hasUWInputs(d) && window.computeUW ? window.computeUW(d) : null;
    const mr = d.marketReview && d.marketReview.status === 'done' ? d.marketReview.data : null;
    const ctx = [
      'Property: ' + (d.name || '') + (d.market ? ' — ' + d.market : ''),
      d.isPortfolio && Array.isArray(d.properties) && d.properties.length > 1
        ? 'Portfolio of ' + d.properties.length + ' properties: ' + d.properties.map((p) => p.name || 'Unnamed').join(', ') : '',
      d.units ? 'Units: ' + d.units : '', d.vintage ? 'Year built: ' + d.vintage : '',
      d.purchasePrice ? 'UW price: $' + Math.round(d.purchasePrice).toLocaleString() : '',
      d.askPrice ? 'Ask: $' + Math.round(d.askPrice).toLocaleString() : '',
      m.goingInCap ? 'Going-in cap: ' + (m.goingInCap * 100).toFixed(2) + '%' : '',
      m.stabilizedCap ? 'Stabilized cap: ' + (m.stabilizedCap * 100).toFixed(2) + '%' : '',
      uw ? 'Levered IRR: ' + (uw.irr != null ? (uw.irr * 100).toFixed(1) + '%' : 'n/a') + ', Equity multiple: ' + (uw.equityMultiple != null ? uw.equityMultiple.toFixed(2) + 'x' : 'n/a') : '',
      uw && uw.inPlaceEconVac != null ? 'In-place economic vacancy: ' + (uw.inPlaceEconVac * 100).toFixed(1) + '%, stabilized: ' + (uw.stabVac * 100).toFixed(1) + '%' : '',
      mr ? 'Independent market read — grade ' + (mr.grade || '?') + '; ' + (mr.overallAssessment || '') : '',
      d.notes ? 'Analyst notes: ' + String(d.notes).slice(0, 800) : '',
    ].filter(Boolean).join('\n');
    const prompt = `You are an investment professional at Altus Equity drafting the narrative for a one-page Investment Committee memo on a multifamily acquisition. Be sharp, specific, and institutional — written for Partners deciding on tens of millions of dollars. No fluff.

DEAL CONTEXT:
${ctx}

Return ONLY valid JSON (no markdown) with this shape:
{
  "thesis": "2-3 tight sentences: why acquire this asset now. Be specific — reference the market, the basis, or the value-add angle.",
  "whyWeWin": "1-2 sentences: what specific edge does Altus have in winning and executing this deal — operator expertise, speed, relationships, or structure.",
  "keyStrengths": ["3-4 IC-level value drivers — concrete and specific, e.g. 'Push in-place rents $180/mo to market via unit interior program'"],
  "keyRisks": ["2-3 operational or market risks to monitor — each specific, not generic"],
  "dealKillers": ["1-3 things that would cause us to pass or re-trade — be direct and blunt"],
  "uwAssumptions": ["3-4 major underwriting assumptions being made (rent growth rate, stabilized vacancy, exit cap, hold period, etc.)"],
  "recommendation": "one of: Pursue, Pursue with conditions, Pass"
}
Do not include any text outside the JSON object.`;
    const out = await aiComplete(prompt);
    const parsed = safeParseJSON(out);
    if (!parsed) throw new Error('Could not parse the memo response.');
    patch(dealId, { memo: { generatedAt: new Date().toISOString(), data: parsed } });
    return parsed;
  };

  // Store an uploaded document in the vault (Supabase Storage + deal.documents).
  // Used by the OM/T-12/Rent Roll parse handlers so parsed files are kept automatically.
  const stashDoc = async (dealId, file, category) => {
    const cloud = window.AltusCloud;
    const cloudOn = !!(cloud && cloud.enabled && cloud.uploadDoc);
    const sandbox = !!(window.ALTUS_CONFIG && window.ALTUS_CONFIG.SANDBOX && window.vaultLocalPut);
    if (!cloudOn && !sandbox) return;
    try {
      const meta = cloudOn ? await cloud.uploadDoc(dealId, file) : await window.vaultLocalPut(file);
      const entry = { id: 'doc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...meta, category };
      setDeals((ds) => ds.map((d) => d.id === dealId
        ? { ...d, documents: [...(Array.isArray(d.documents) ? d.documents : []), entry] }
        : d));
    } catch (e) { console.warn('[vault] stash failed:', e); }
  };

  const handleOMUpload = async (dealId, file) => {
    setOMMap((m) => ({ ...m, [dealId]: { status: 'parsing', fileName: file.name } }));
    stashDoc(dealId, file, 'OM');
    try {
      const { parsed, fullText } = await runOMParse(file);
      setOMMap((m) => ({ ...m, [dealId]: { status: 'done', fileName: file.name, parsed } }));
      setOpenId(dealId);
      // Auto-create or update CRM contacts from EVERY broker contact parsed from the OM.
      // Each contact is explicitly tagged with this deal's id so the CRM can show exactly
      // which brokers are tied to which deals (who to reach out to).
      const parsedContacts = Array.isArray(parsed.brokerContacts) ? parsed.brokerContacts
        : Array.isArray(parsed.isrContacts) ? parsed.isrContacts : [];
      // Keep the named listing team. Prefer people who have an email or phone (the real,
      // contactable agents); but if the OM lists its listing team by name + title only,
      // still keep them. Cap at 6 either way so a stray firm-directory page can't flood
      // the CRM with dozens of un-contactable roster names.
      const named = parsedContacts.filter((c) => c && c.name);
      const withInfo = named.filter((c) => c.email || c.phone);
      const people = (withInfo.length ? withInfo : named).slice(0, 6);
      if (people.length) {
        setContacts((cs) => {
          let next = [...cs];
          let firstId = null;
          const withDeal = (arr) => Array.from(new Set([...(Array.isArray(arr) ? arr : []), dealId]));
          people.forEach((pc, idx) => {
            const existing = next.find((c) =>
            pc.email && c.email && c.email.toLowerCase() === pc.email.toLowerCase() ||
            pc.name && c.name && c.name.toLowerCase() === pc.name.toLowerCase()
            );
            if (existing) {
              if (!firstId) firstId = existing.id;
              next = next.map((c) => c.id === existing.id ? {
                ...c, lastActivity: window.ALTUS_TODAY,
                title: c.title || pc.title || '',
                firm: c.firm || parsed.brokerFirm || '',
                dealIds: withDeal(c.dealIds),
                ...(window.netContactMarket ? window.netContactMarket(pc, parsed, c) : {})
              } : c);
            } else {
              const newId = 'c-' + Date.now() + '-' + idx;
              if (!firstId) firstId = newId;
              next.push({
                id: newId, name: pc.name || '', firm: parsed.brokerFirm || '',
                title: pc.title || '', email: pc.email || '', phone: pc.phone || '',
                markets: parsed.market || '', property: parsed.name || '',
                ...(window.netContactMarket ? window.netContactMarket(pc, parsed, null) : {}),
                dealIds: [dealId], notes: '',
                dateAdded: window.ALTUS_TODAY, lastActivity: window.ALTUS_TODAY
              });
            }
          });
          if (firstId) setDeals((ds) => ds.map((d) => d.id === dealId ? { ...d, contactId: firstId } : d));
          return next;
        });
      }
    } catch (e) {
      setOMMap((m) => ({ ...m, [dealId]: { status: 'error', fileName: file.name, error: String(e) } }));
    }
  };

  // ── Rent Roll upload ── parse current rent, market rent, physical vacancy and loss
  // to lease. Prefer the deterministic tabular parser; fall back to a model extraction
  // of the same aggregates. All annual figures are computed here in JS.
  const handleRentRollUpload = async (dealId, file) => {
    setRRMap((m) => ({ ...m, [dealId]: { status: 'parsing', fileName: file.name } }));
    stashDoc(dealId, file, 'Rent Roll');
    try {
      const fullText = await extractFileText(file);
      let agg = parseRentRollTabular(fullText);
      if (!agg) {
        // model fallback 1 — the unit list as compact pipe-delimited rows, so the matrix
        // (type, SF, Max, Top 25%, last signed) can be built in code like a clean table
        const excerpt = rentRollExcerpt(fullText, 60000);
        const unitPrompt = `You are reading a multifamily RENT ROLL for Altus Equity. List EVERY current unit (occupied and vacant; skip future residents, applicants and charge-detail rows) as one line per unit, pipe-delimited, with NO header, NO commentary and NO code fences:
unit|unit type|sq ft|market rent|current rent|status|lease start
Rules: unit type exactly as the roll labels it (floor plan or bed/bath; never rename it). Rents are MONTHLY numbers with no $ or commas; current rent is the BASE rent charge only (never total charges); leave blank if none. Status is the roll's own status text (Occupied, Vacant, Vacant-Leased, Notice, Eviction, Model, Down...). Lease start as m/d/yyyy or blank.

RENT ROLL:
${excerpt}`;
        try { agg = summarizeRentRollUnits(parseRentRollCsv(await aiComplete(unitPrompt, { maxTokens: 16000 })), 'Units read by Claude from the rent roll.'); } catch (e) { agg = null; }
      }
      if (!agg) {
        // model fallback 2 — ask for the aggregate monthly figures only
        const excerpt = rentRollExcerpt(fullText, 60000);
        const prompt = `You are reading a multifamily RENT ROLL. Return ONLY a JSON object — no commentary — with these MONTHLY aggregate figures summed across every CURRENT resident unit (exclude future/applicant rows):
{
  "totalUnits": 0,
  "vacantUnits": 0,
  "marketRentMonthlyAll": 0,
  "inHouseRentMonthlyOccupied": 0,
  "lossToLeaseMonthly": 0
}
Definitions:
marketRentMonthlyAll = sum of the MARKET / GROSS-POTENTIAL rent column over ALL units (occupied + vacant). If the roll gives only a per-unit market-rent AVERAGE instead of a full column, multiply that average by totalUnits. If the roll shows both a stated market-rent total AND a per-unit figure that would compute to a different total, use whichever is LARGER.
inHouseRentMonthlyOccupied = sum of the ACTUAL / LEASE / current rent column for OCCUPIED units only. A unit on Notice or in Eviction is OCCUPIED.
lossToLeaseMonthly = for EACH occupied unit, take (market rent − current rent); if the current rent is HIGHER than market for that unit, use 0 for it (never negative); SUM this per-unit amount across every occupied unit. Do not net it against units where current exceeds market.
Numbers only, no $ or commas.

RENT ROLL:
${excerpt}`;
        const out = await aiComplete(prompt);
        agg = safeParseJSON(out);
      }
      // Keep the standardized unit list on the deal for the Rent Roll Matrix tab.
      // While a deal prices off its rent roll (the default), GPR, physical vacancy and loss to
      // lease are re-derived from the new units and the deal's market rents.
      if (agg && Array.isArray(agg.units) && agg.units.length) {
        const rentRoll = { fileName: file.name, parsedAt: new Date().toISOString(), units: agg.units };
        setDeals((ds) => ds.map((d) => {
          if (d.id !== dealId) return d;
          const nd = { ...d, rentRoll };
          return lockUW(window.rentRollFields ? { ...nd, ...window.rentRollFields(nd) } : nd);
        }));
      }
      if (!agg || !agg.totalUnits) throw new Error('No unit rows could be read from this rent roll.');
      const mAll = Number(agg.marketRentMonthlyAll) || 0;
      const mInH = Number(agg.inHouseRentMonthlyOccupied) || 0;
      const vacant = Number(agg.vacantUnits) || 0;
      const occUnits = Math.max(0, (Number(agg.totalUnits) || 0) - vacant);
      // Average CURRENT rent across OCCUPIED units only — including vacant units (which
      // read $0) in this average would understate it and skew the vacancy-loss estimate.
      const avgOccCurrentRent = occUnits > 0 ? mInH / occUnits : 0;
      const parsed = {
        totalUnits: agg.totalUnits,
        vacantUnits: vacant,
        units: agg.totalUnits,
        gprAnnual: Math.round(mAll * 12),
        physVacLoss: Math.round(avgOccCurrentRent * vacant * 12),
        lossToLease: Math.round((Number(agg.lossToLeaseMonthly) || 0) * 12),
        applied: !!(agg && Array.isArray(agg.units) && agg.units.length),
      };
      setRRMap((m) => ({ ...m, [dealId]: { status: 'done', fileName: file.name, parsed } }));
      setOpenId(dealId);
    } catch (e) {
      setRRMap((m) => ({ ...m, [dealId]: { status: 'error', fileName: file.name, error: String(e) } }));
    }
  };

  // ── T-12 upload ── pull delinquency (bad debt) and concessions, plus opex / EGI when
  // present, from the trailing-12 income statement.
  const handleT12Upload = async (dealId, file) => {
    setT12Map((m) => ({ ...m, [dealId]: { status: 'parsing', fileName: file.name } }));
    stashDoc(dealId, file, 'T-12');
    try {
      const fullText = await extractFileText(file);
      const text = focusExcerpt(fullText, [
        'bad debt', 'delinquen', 'collection loss', 'uncollect', 'write-off', 'write off',
        'concession', 'rent concession', 'employee concession',
        'gross potential', 'vacancy loss', 'loss to lease', 'effective gross income', 'total income', 'total revenue',
        'net rental income', 'other income', 'rubs', 'utility reimburs',
        'total operating expense', 'operating expense', 'net operating income',
      ], 36000);
      const prompt = `You are parsing a multifamily T-12 (trailing-twelve-month) operating statement for Altus Equity. Return ONLY a valid JSON object — no commentary. Use null for any field not found. All figures must be the TRAILING-12 (annual) totals as raw numbers (no $ or commas). If the statement shows only a partial trailing period (T-3 or T-1), annualize it (T-3 × 4, T-1 × 12).

{
  "badDebt": 0,
  "concessions": 0,
  "totalOpex": 0,
  "effectiveGrossIncome": 0,
  "otherIncome": 0
}

rules for badDebt — the trailing bad debt / delinquency / collection-loss / uncollectible-rent / write-off line, as a POSITIVE number (the loss amount). Sum multiple such lines if shown separately. null if none.
rules for concessions — the trailing rent-concessions / concessions-and-discounts / employee-unit-concession line, as a POSITIVE number. Sum multiple concession lines. null if none.
rules for totalOpex — TOTAL OPERATING EXPENSES. CRITICAL: Property Taxes AND Insurance MUST be included — if they are listed separately below a "controllable" subtotal, ADD them on top. NEVER include debt service, mortgage interest, depreciation, amortization, capital expenditures, or reserves. null if not shown.
rules for effectiveGrossIncome — the Effective Gross Income / Total Income / Total Revenue line (income after vacancy & loss, plus other income). null if not shown.
rules for otherIncome — total other income (RUBS / utility reimbursement, fees, etc.). null if not shown.

T-12 text:
${text}`;
      const linesPrompt = `You are categorizing a multifamily T-12 operating statement line by line for Altus Equity, following the Altus underwriting template. Return ONLY a valid JSON object, no commentary:
{"period":"T-12 ending Mon YYYY","months":12,"lines":[{"name":"line item as written","category":"Rental Revenue","total":0}]}
Include EVERY leaf line item (one entry per account line). SKIP section headers, subtotals, totals, NOI and anything below NOI (debt service, interest, depreciation, amortization, capital expenditures, partnership/asset-management fees).
category must be exactly one of:
Revenue: "Rental Revenue", "Loss to Lease", "Physical Vacancy", "Concessions", "Bad Debt", "RUBs", "Other Income"
Expense: "General & Admin", "Maintenance & Repairs", "Management", "Payroll / Payroll Taxes", "Marketing", "Contract Services", "Taxes", "Insurance", "Utilities", "Other"
Categorize by the statement's own SECTION, not by keywords in the line name: a staff title such as "Property Manager" or "Groundskeeper" under a Payroll section is Payroll; "Trash Contract" follows whichever section it sits in. Turnover / make-ready sections are Maintenance & Repairs. Fire & safety is Contract Services when listed there, else General & Admin. Split a Taxes & Insurance section per line. RUBs = utility reimbursement income (water/sewer, trash, electric, pest income, utility billing); every other non-rent income line is Other Income. Employee units and model units are Concessions unless shown as vacancy.
total = the trailing-12 annual total for the line, keeping the statement's native sign (revenue positive; vacancy, loss to lease, concessions and bad debt negative; expenses positive). If the statement covers fewer than 12 months, annualize each line and set months to the months shown.

T-12 text:
${fullText.slice(0, 60000)}`;
      const [out, linesOut] = await Promise.all([
        aiComplete(prompt),
        aiComplete(linesPrompt, { maxTokens: 12000 }).catch(() => null),
      ]);
      const parsed = safeParseJSON(out) || {};
      const lp = linesOut ? safeParseJSON(linesOut) : null;
      const okCats = ['Rental Revenue', 'Loss to Lease', 'Physical Vacancy', 'Concessions', 'Bad Debt', 'RUBs', 'Other Income',
        'General & Admin', 'Maintenance & Repairs', 'Management', 'Payroll / Payroll Taxes', 'Marketing', 'Contract Services', 'Taxes', 'Insurance', 'Utilities', 'Other'];
      const lines = lp && Array.isArray(lp.lines) ? lp.lines
        .filter((l) => l && l.name && !isNaN(Number(l.total)) && (okCats.includes(l.category) || !/exclu|total|subtotal|below noi|n\/a/i.test(String(l.category || ''))))
        .map((l) => ({ name: String(l.name).slice(0, 80), category: okCats.includes(l.category) ? l.category : 'Other', total: Math.round(Number(l.total)) })) : [];
      if (lines.length) {
        // Pull the T-12 into the Full UW current column: RUBS and other income split, concessions
        // and bad debt, and every expense line (which then sums to Current Operating Expenses).
        const cat = {};
        lines.forEach((l) => { cat[l.category] = (cat[l.category] || 0) + l.total; });
        const t12Opex = {};
        (window.OPEX_LINES || []).forEach((l) => { if (l.cat) t12Opex[l.key] = Math.round(cat[l.cat] || 0); });
        const opexSum = Object.keys(t12Opex).reduce((a, k) => a + t12Opex[k], 0);
        const rubs = Math.round(cat['RUBs'] || 0), oth = Math.round(cat['Other Income'] || 0);
        patch(dealId, {
          t12Lines: { fileName: file.name, parsedAt: new Date().toISOString(), period: (lp && lp.period) || '', lines },
          t12Opex, currentOpexTotal: opexSum, curRubs: rubs, otherIncome: rubs + oth,
          concessions: Math.round(Math.abs(cat['Concessions'] || 0) + Math.abs(cat['Bad Debt'] || 0)), badDebt: 0,
        });
      }
      if (lines.length) { parsed.applied = true; parsed.lineCount = lines.length; }
      setT12Map((m) => ({ ...m, [dealId]: { status: 'done', fileName: file.name, parsed } }));
      setOpenId(dealId);
    } catch (e) {
      setT12Map((m) => ({ ...m, [dealId]: { status: 'error', fileName: file.name, error: String(e) } }));
    }
  };

  const doSignIn = async (email, password) => {
    setAuthBusy(true);
    try { await cloud.signIn(email, password); }
    finally { setAuthBusy(false); }
  };

  // ---- Login gate (only when cloud + REQUIRE_LOGIN are on) ----
  if (cloud.requireLogin && session === undefined) return <CloudSplash text="Connecting…" />;
  if (cloud.requireLogin && !session) return <LoginGate onSignIn={doSignIn} busy={authBusy} />;
  // Cloud mode loads deals fresh from Supabase (no local cache) — show a splash until the
  // first reconcile lands so the pipeline never flashes empty on the way in.
  if (cloud.enabled && (!cloud.requireLogin || session) && !cloudReady) return <CloudSplash text="Loading your pipeline…" />;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: 'var(--navy)', color: '#fff', display: 'flex', alignItems: 'center',
        padding: '0 22px', height: 54, flex: 'none', gap: 24, boxShadow: '0 1px 0 rgba(0,0,0,.18)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--accent)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 15 }}>A</span>
          <span style={{ fontSize: 15.5, fontWeight: 600, letterSpacing: '-.01em' }}>
            Altus <span style={{ fontWeight: 300, color: '#8aaac8' }}>Pipeline</span>
          </span>
        </div>
        <nav style={{ display: 'flex', gap: 2 }}>
          {NAV.map((n) => {
            const on = view === n.key;
            return (
              <button key={n.key} onClick={() => { setView(n.key); setOpenId(null); }} style={{
                display: 'flex', alignItems: 'center', gap: 7, border: 'none',
                background: on ? 'rgba(255,255,255,.1)' : 'transparent',
                color: on ? '#fff' : '#7a9bbf', padding: '7px 13px', borderRadius: 7,
                fontSize: 13, fontWeight: on ? 500 : 400, transition: 'all .12s', cursor: 'pointer' }}
              onMouseEnter={(e) => {if (!on) e.currentTarget.style.color = '#c8ddf0';}}
              onMouseLeave={(e) => {if (!on) e.currentTarget.style.color = '#7a9bbf';}}>
                <Icon name={n.icon} size={15} />
                <span>{n.label}</span>
                {n.key === 'tasks' && todos.filter((t)=>!t.done).length > 0 && (
                  <span className="num" style={{ fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 999,
                    background: on ? 'rgba(255,255,255,.18)' : 'rgba(122,155,191,.22)', color: on ? '#fff' : '#9bb6d4' }}>{todos.filter((t)=>!t.done).length}</span>
                )}
                {n.key === 'dead' && deadDeals.length > 0 && (
                  <span className="num" style={{ fontSize: 11, fontWeight: 600, padding: '1px 6px', borderRadius: 999,
                    background: on ? 'rgba(255,255,255,.18)' : 'rgba(122,155,191,.22)', color: on ? '#fff' : '#9bb6d4' }}>{deadDeals.length}</span>
                )}
              </button>);

          })}
        </nav>
        <div style={{ flex: 1 }} />
        {cloud.enabled && (
          <SaveIndicator state={saveState} />
        )}
        <span className="num" style={{ fontSize: 12, color: '#5a7a96', fontWeight: 400 }}>{fmtDate(window.ALTUS_TODAY)}</span>
        <button onClick={() => setShowSettings(s => !s)} title="Settings" style={{
          background: showSettings ? 'rgba(255,255,255,.12)' : 'transparent',
          border: 'none', cursor: 'pointer', color: showSettings ? '#fff' : '#7a9bbf',
          width: 34, height: 34, borderRadius: 7, display: 'flex', alignItems: 'center',
          justifyContent: 'center', transition: 'all .12s', flexShrink: 0
        }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="8" cy="8" r="2.5"/>
            <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.89 11.89l1.06 1.06M3.05 12.95l1.06-1.06M11.89 4.11l1.06-1.06"/>
          </svg>
        </button>
      </header>

      <SaveErrorBanner state={saveState} onRetry={retrySaveNow} />

      {/* ── Settings Panel ── */}
      {showSettings && (
        <div style={{ position: 'fixed', top: 54, right: 0, bottom: 0, width: 300,
          background: '#fff', borderLeft: '1px solid #dde3ec', zIndex: 9999,
          display: 'flex', flexDirection: 'column', boxShadow: '-4px 0 18px rgba(0,0,0,.1)' }}>
          <div style={{ padding: '14px 18px 12px', borderBottom: '1px solid #edf0f7',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0d1f35', letterSpacing: '.04em', textTransform: 'uppercase' }}>Settings</span>
            <button onClick={() => setShowSettings(false)} style={{ background: 'none', border: 'none',
              cursor: 'pointer', color: '#8fa0b2', fontSize: 18, lineHeight: 1, padding: 2 }}>✕</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 20 }}>

            {/* Data Safety */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                color: '#1f57c4', marginBottom: 10 }}>Data Safety</div>
              <div style={{ background: '#f4f6fb', borderRadius: 7, padding: '10px 13px', marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: '#607080', marginBottom: 3 }}>Active deals in pipeline</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#0d1f35' }}>{deals.length}</div>
              </div>
            </div>

            {/* Appearance */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                color: '#1f57c4', marginBottom: 10 }}>Appearance</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
                {['#2f6df0','#0c7a43','#7c5cff','#b87214'].map(c => (
                  <button key={c} onClick={() => setTweak('accent', c)} style={{
                    width: 28, height: 28, borderRadius: '50%', background: c, border:
                    t.accent === c ? '3px solid #0d1f35' : '3px solid transparent',
                    cursor: 'pointer', transition: 'border .12s'
                  }} />
                ))}
              </div>
              <div style={{ fontSize: 11, color: '#8fa0b2', marginBottom: 8 }}>Accent color</div>
            </div>

            {/* Account */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                color: '#8fa0b2', marginBottom: 10 }}>Account</div>
              {cloud.enabled && session && (
                <button onClick={async () => { await cloud.signOut(); setSession(null); setShowSettings(false); }}
                  style={{ width: '100%', padding: '9px 0', borderRadius: 7, border: '1.5px solid #dde3ec',
                  background: '#fff', color: '#607080', fontWeight: 500, fontSize: 13, cursor: 'pointer' }}>
                  Sign out ({cloud.currentEmail(session)})
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <TopToast toast={toast} onClose={() => setToast(null)} />

      <ChangeFeedBar items={unseenActivity} open={feedOpen}
        onToggle={() => setFeedOpen((v) => !v)} onDismiss={markActivitySeen}
        onOpenDeal={(id) => { open(id); setView('pipeline'); }} />

      <main ref={mainRef} style={{ flex: 1, overflow: 'auto', position: 'relative', fontFamily: 'var(--font)' }} data-comment-anchor="922d83631c-main-640-7">
        {deal ? <DealDetail deal={deal} onBack={() => setOpenId(null)} onPatch={patch} contacts={contacts}
        omData={omMap[deal.id]} onAcceptOM={acceptOM}
        onOMUpload={handleOMUpload}
        t12Data={t12Map[deal.id]} rrData={rrMap[deal.id]}
        onT12Upload={handleT12Upload} onRRUpload={handleRentRollUpload}
        onClearOM={clearOM} onClearT12={clearT12} onClearRR={clearRR}
        onRunMarketReview={runMarketReview} onRunMemo={runMemoNarrative} onImportCoStar={importCoStar}
        todos={todos} onAddTodo={addTodo} onPatchTodo={patchTodo} onDeleteTodo={deleteTodo}
        onViewTasks={() => { setOpenId(null); setView('tasks'); }} /> :
        view === 'pipeline' ? <PipelineView deals={pipelineDeals} allDeals={deals} onOpen={open} onPatch={patch}
        onAdd={addDeal} onImport={importDeals} onOM={handleOMUpload} onT12={handleT12Upload} onRR={handleRentRollUpload}
        onBulkPatch={bulkPatch} onBulkDelete={bulkDelete} onReorder={reorderVisible}
        omMap={omMap} t12Map={t12Map} rrMap={rrMap}
        sortKey={pipeSortKey} sortDir={pipeSortDir} onSortKeyChange={setPipeSortKey} onSortDirChange={setPipeSortDir}
        taskApi={{ todos, add: addTodo, patch: patchTodo }}
        zebra={t.zebra} /> :
        view === 'loi' ? <LOIStatusView deals={loiDeals} onOpen={open} onPatch={patch} /> :
        view === 'metrics' ? <MetricsView deals={liveDeals} allDeals={deals} onOpen={open} /> :
        view === 'network' || view === 'brokercalls' || view === 'crm' ? (window.NetworkView
          ? <window.NetworkView contacts={contacts} deals={deals} onAddContact={addContact} onPatchContact={patchContact} onPatchDeal={patch}
              onOpenDeal={(id) => { open(id); setView('pipeline'); }} />
          : null) :
        view === 'assumptions' ? (window.AssumptionsView ? <window.AssumptionsView deals={deals} /> : null) :
        view === 'dead' ? <DeadDealsView deals={deadDeals} onOpen={open} onPatch={patch}
        onBulkPatch={bulkPatch} onBulkDelete={bulkDelete} onReorder={reorderVisible}
        onOM={handleOMUpload} onT12={handleT12Upload} onRR={handleRentRollUpload}
        omMap={omMap} t12Map={t12Map} rrMap={rrMap} /> :
        view === 'tasks'
          ? (window.TodoView
              ? <window.TodoView todos={todos} deals={deals} onAdd={addTodo} onPatch={patchTodo} onDelete={deleteTodo}
                  onOpenDeal={(id) => { open(id); setView('pipeline'); }} />
              : null)
          : <CRMView contacts={contacts} deals={deals} onAddContact={addContact}
        onPatchContact={patchContact}
        onOpenDeal={(id) => {open(id);setView('pipeline');}} />}
      </main>

      <TweaksPanel title="Tweaks">
        <TweakSection label="Appearance" />
        <TweakColor label="Accent" value={t.accent} options={['#2f6df0', '#0c7a43', '#7c5cff', '#b87214']} onChange={(v) => setTweak('accent', v)} />
        <TweakRadio label="Density" value={t.density} options={['compact', 'regular', 'comfy']} onChange={(v) => setTweak('density', v)} />
        {cloud.enabled && session && (
          <>
            <TweakSection label="Account" />
            <TweakButton label={'Sign out (' + (cloud.currentEmail(session) || 'account') + ')'} onClick={async () => { await cloud.signOut(); setSession(null); }} />
          </>
        )}
      </TweaksPanel>
    </div>);

}

/* color helpers */
function hexToRgb(h) {h = h.replace('#', '');return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];}
function rgbToHex(r, g, b) {return '#' + [r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, '0')).join('');}
function shade(hex, pct) {const [r, g, b] = hexToRgb(hex);const f = 1 + pct / 100;return rgbToHex(r * f, g * f, b * f);}
function tint(hex, amt) {const [r, g, b] = hexToRgb(hex);return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);}

window.OMBtn = OMBtn;
window.AltusApp = AltusApp;
