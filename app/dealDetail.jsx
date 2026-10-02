// app/dealDetail.jsx — deal side panel: overview, cap-rate calculators, debt, notes, OM parsed results
const { useState: useStateD, useEffect: useEffectD, useRef: useRefD } = React;

/* ── Editable number/money field ── */
function FieldInput({ value, onChange, prefix, suffix, placeholder, align = 'right', width }) {
  const fmt = (v) => {
    if (v === '' || v == null) return '';
    const [int, dec] = String(v).split('.');
    const intF = int === '' || int === '-' ? int : Number(int).toLocaleString('en-US');
    return dec != null ? intF + '.' + dec : intF;
  };
  const [txt, setTxt] = useStateD(fmt(value));
  useEffectD(() => {
    const curNum = txt === '' ? '' : Number(txt.replace(/[^0-9.]/g, ''));
    const valNum = value === '' || value == null ? '' : Number(value);
    if (curNum !== valNum) setTxt(fmt(value));
  }, [value]);
  const handle = (e) => {
    let raw = e.target.value.replace(/[^0-9.]/g, '');
    const parts = raw.split('.');
    if (parts.length > 2) raw = parts[0] + '.' + parts.slice(1).join('');
    setTxt(fmt(raw));
    onChange(raw === '' ? '' : Number(raw));
  };
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 0, border: '1px solid var(--line-2)',
      borderRadius: 7, background: 'var(--panel)', overflow: 'hidden', height: 34, width: width || '100%',
      transition: 'border-color .12s, box-shadow .12s' }}
    onFocusCapture={(e) => {const w = e.currentTarget;w.style.borderColor = 'var(--accent)';w.style.boxShadow = '0 0 0 3px var(--accent-soft)';}}
    onBlurCapture={(e) => {const w = e.currentTarget;w.style.borderColor = 'var(--line-2)';w.style.boxShadow = 'none';}}>
      {prefix && <span style={{ padding: '0 0 0 10px', color: 'var(--faint)', fontSize: 12.5 }} className="num">{prefix}</span>}
      <input className="num" value={txt} placeholder={placeholder} inputMode="decimal"
      onChange={handle}
      style={{ border: 'none', outline: 'none', background: 'transparent', textAlign: align, width: '100%',
        padding: prefix ? '0 10px 0 4px' : '0 10px', fontSize: 13.5, color: 'var(--ink)', height: '100%' }} />
      {suffix && <span style={{ padding: '0 10px 0 0', color: 'var(--faint)', fontSize: 12.5 }}>{suffix}</span>}
    </div>);

}

/* ── Calculator row ── */
function CalcRow({ kind, label, hint, children, strong, accent }) {
  const isOut = kind === 'OUTPUT';
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr 180px', alignItems: 'center', gap: 12,
      padding: '10px 0', borderBottom: '1px solid var(--line)' }}>
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.06em',
        color: isOut ? 'var(--accent)' : 'var(--muted)',
        background: isOut ? 'var(--accent-soft)' : 'var(--panel-3)',
        padding: '2px 6px', borderRadius: 4, textAlign: 'center', justifySelf: 'start',
        textTransform: 'uppercase' }}>
        {kind}
      </span>
      <div>
        <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: strong ? 500 : 400 }}>{label}</div>
        {hint && <div style={{ fontSize: 11.5, color: 'var(--faint)', marginTop: 1 }}>{hint}</div>}
      </div>
      <div style={{ justifySelf: 'end', width: '100%', textAlign: 'right' }}>
        {isOut ?
        <span className="num" style={{ fontSize: strong ? 16 : 13.5, fontWeight: strong ? 700 : 500,
          color: accent || (strong ? 'var(--ink)' : 'var(--slate)') }}>{children}</span> :
        children}
      </div>
    </div>);

}

function SectionHead({ icon, title, desc, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 2 }}>
      <div style={{ display: 'flex', gap: 10 }}>
        <span style={{ width: 30, height: 30, borderRadius: 7, background: 'var(--navy)', color: '#fff', flex: 'none',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={icon} size={15} /></span>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{title}</div>
          {desc && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1, maxWidth: 540, fontWeight: 400 }}>{desc}</div>}
        </div>
      </div>
      {right}
    </div>);

}

function PerUnit({ total, units }) {
  if (!units || !(Number(total) > 0)) return null;
  return (
    <div className="num" style={{ display: 'block', fontSize: 15, fontWeight: 600, color: 'var(--slate)', marginTop: 8 }}>
      {fmtMoney(Number(total) / units)} <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)' }}>/ unit</span>
    </div>);

}

function OverviewItem({ label, children, edit }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 600, letterSpacing: '.04em',
        textTransform: 'uppercase', marginBottom: 5 }}>{label}</div>
      {edit ? children :
      <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>{children}</div>}
    </div>);

}

/* ── OM Parsed Results Banner ── */
/* ── Shared parsed-banner pieces ── */
function BannerShell({ title, sub, canApply, onApplyAll, onDismiss, onReupload, children }) {
  return (
    <div style={{ border: '1px solid var(--pos)', borderRadius: 'var(--radius-lg)',
      background: 'var(--pos-soft)', marginBottom: 16, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px',
        borderBottom: '1px solid rgba(12,122,67,.15)' }}>
        <span style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--pos)', color: '#fff',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
          <Icon name="check" size={14} />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--pos)' }}>{title}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 400, marginTop: 1 }}>{sub}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {canApply &&
          <button onClick={onApplyAll} style={{ border: 'none', background: 'var(--pos)',
            color: '#fff', borderRadius: 6, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              Apply All
            </button>
          }
          {onReupload &&
          <button onClick={onReupload} title="Clear and re-upload" style={{ border: '1px solid rgba(12,122,67,.25)',
            background: 'transparent', color: 'var(--muted)', borderRadius: 6, padding: '6px 10px',
            fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="refresh" size={12} /> Re-upload
          </button>}
          <button onClick={onDismiss} style={{ border: '1px solid rgba(12,122,67,.25)',
            background: 'transparent', color: 'var(--muted)', borderRadius: 6, padding: '6px 10px',
            fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
            <Icon name="close" size={13} />
          </button>
        </div>
      </div>
      <div style={{ padding: '10px 16px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {children}
      </div>
    </div>);

}

function FoundRow({ label, display, onUse }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10,
      background: 'var(--panel)', borderRadius: 7, padding: '7px 11px',
      border: '1px solid rgba(12,122,67,.12)' }}>
      <Icon name="check" size={12} style={{ color: 'var(--pos)', flex: 'none' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 11, color: 'var(--muted)', marginRight: 8 }}>{label}</span>
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>{display}</span>
      </div>
      {onUse &&
      <button onClick={onUse} style={{ border: 'none', background: 'var(--pos)', color: '#fff',
        borderRadius: 5, padding: '3px 9px', fontSize: 11, fontWeight: 600, cursor: 'pointer', flex: 'none' }}>
          Use
        </button>
      }
    </div>);

}

function MissingRow({ label, note }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10,
      background: 'var(--warn-soft)', borderRadius: 7, padding: '7px 11px',
      border: '1px solid rgba(184,114,20,.2)' }}>
      <Icon name="flag" size={12} style={{ color: 'var(--warn)', flex: 'none' }} />
      <div>
        <span style={{ fontSize: 11, color: 'var(--warn)', fontWeight: 500 }}>{label}</span>
        <span style={{ fontSize: 11.5, color: 'var(--muted)', marginLeft: 8, fontStyle: 'italic' }}>{note || 'not found — enter manually'}</span>
      </div>
    </div>);

}

const fmtMoneyRaw = (v) => v != null && v !== '' ? '$' + Number(v).toLocaleString() : null;

/* ── Parse error / empty-result banner ── */
function ParseErrorBanner({ label, error }) {
  const [dismissed, setDismissed] = useStateD(false);
  if (dismissed) return null;
  return (
    <div style={{ border: '1px solid var(--neg)', borderRadius: 'var(--radius-lg)', background: 'var(--neg-soft)',
      marginBottom: 16, padding: '12px 16px', display: 'flex', alignItems: 'flex-start', gap: 11 }}>
      <span style={{ width: 26, height: 26, borderRadius: 7, background: 'var(--neg)', color: '#fff', flex: 'none',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name="close" size={13} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--neg)' }}>{label} couldn’t be parsed</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3, lineHeight: 1.5 }}>
          {error || 'No data could be extracted from this file.'}
          <br />Re-upload it, or export the document as a PDF or Excel/CSV with a clear column-header row (e.g. Unit · Status · Market Rent · Rent).
        </div>
      </div>
      <button onClick={() => setDismissed(true)} style={{ border: '1px solid rgba(192,42,42,.25)',
        background: 'transparent', color: 'var(--muted)', borderRadius: 6, padding: '5px 9px', fontSize: 12, cursor: 'pointer', flex: 'none' }}>
        <Icon name="close" size={12} />
      </button>
    </div>);

}

/* ── OM Parsed Results Banner ── */
function OMParsedSection({ parsed, deal, properties, targetIdx, setTargetIdx, onAccept }) {
  const [dismissed, setDismissed] = useStateD(false);
  if (dismissed) return null;
  const isPortfolio = deal.isPortfolio && Array.isArray(properties) && properties.length > 1;

  const _rawC = Array.isArray(parsed.brokerContacts) ? parsed.brokerContacts :
  Array.isArray(parsed.isrContacts) ? parsed.isrContacts : [];
  const _named = _rawC.filter((c) => c && c.name);
  const _withInfo = _named.filter((c) => c.email || c.phone);
  const contacts = (_withInfo.length ? _withInfo : _named).slice(0, 6);
  const firstContact = contacts[0];
  const brokerStr = (name) => [parsed.brokerFirm, name].filter(Boolean).join(' — ');

  const FIELD_DEFS = [
  { key: 'name', label: 'Property Name', patch: (v) => ({ name: v }) },
  { key: 'market', label: 'Location', patch: (v) => ({ market: v }) },
  { key: 'units', label: 'Units', patch: (v) => ({ units: Number(v) || v }) },
  { key: 'vintage', label: 'Vintage (Year Built)', patch: (v) => ({ vintage: String(v) }) },
  { key: 'effectiveGrossIncome', label: 'Effective Gross Income (in-place)', patch: (v) => ({ trailingEGI: Number(v) || v }), fmt: fmtMoneyRaw },
  { key: 'totalOpex', label: 'Total Operating Expenses' + (parsed.opexBasis ? ' · ' + parsed.opexBasis : ''), patch: (v) => ({ currentOpexTotal: Number(v) || v }), fmt: fmtMoneyRaw },
  { key: 'brokerEGI', label: 'Pro Forma EGI (annual)', patch: (v) => ({ brokerEGI: Number(v) || v }), fmt: fmtMoneyRaw },
  { key: 'brokerFirm', label: 'Broker Firm', patch: (v) => ({ broker: brokerStr(firstContact?.name) }) }];


  // Current OpEx / Unit is DERIVED (total operating expenses ÷ units) — shown for confirmation,
  // not applied directly (the underwriting card recomputes it from the figures above).
  const opexUnits = deal && deal.units ? deal.units : Number(parsed.units) || null;
  const opexPerUnit = parsed.totalOpex != null && parsed.totalOpex !== '' && opexUnits ?
  Math.round(Number(parsed.totalOpex) / opexUnits) : null;

  const found = FIELD_DEFS.filter((f) => parsed[f.key] != null && parsed[f.key] !== '');
  const missing = FIELD_DEFS.filter((f) => parsed[f.key] == null || parsed[f.key] === '');
  const totalFields = FIELD_DEFS.length + 1; // +1 for broker contacts
  const foundCount = found.length + (contacts.length ? 1 : 0);

  const acceptAll = () => {
    let patch = {};
    found.forEach((f) => Object.assign(patch, f.patch(parsed[f.key])));
    if (firstContact) patch.broker = brokerStr(firstContact.name);
    onAccept(patch);
    setDismissed(true);
  };

  return (
    <BannerShell title="OM Parsed"
    sub={`${foundCount} of ${totalFields} fields extracted${foundCount < totalFields ? ` · ${totalFields - foundCount} need manual entry` : ''}`}
    canApply={foundCount > 0} onApplyAll={acceptAll} onDismiss={() => setDismissed(true)}>
      {isPortfolio &&
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>Apply to:</span>
        {properties.map((p, i) =>
        <button key={p.id || i} onClick={() => setTargetIdx(i)}
        style={{ border: '1px solid ' + (i === targetIdx ? 'var(--accent)' : 'var(--line-2)'), background: i === targetIdx ? 'var(--accent-soft)' : 'var(--panel)',
          color: i === targetIdx ? 'var(--accent)' : 'var(--ink)', borderRadius: 6, padding: '3px 9px', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
          {p.name || 'Property ' + (i + 1)}
        </button>
        )}
      </div>
      }
      {found.map((f) =>
      <FoundRow key={f.key} label={f.label}
      display={f.fmt ? f.fmt(parsed[f.key]) : String(parsed[f.key])}
      onUse={() => onAccept(f.patch(parsed[f.key]))} />
      )}
      {opexPerUnit != null &&
      <FoundRow label={'Current OpEx / Unit · ' + opexUnits + ' units'} display={fmtMoneyRaw(opexPerUnit)} />
      }
      {contacts.map((c, i) =>
      <FoundRow key={'c' + i} label="Broker Contact"
      display={[c.name, c.title, c.phone, c.email].filter(Boolean).join(' · ')}
      onUse={() => onAccept({ broker: brokerStr(c.name) })} />
      )}
      {missing.map((f) => <MissingRow key={f.key} label={f.label} />)}
      {contacts.length === 0 && <MissingRow label="Broker Contact" />}
    </BannerShell>);

}

/* ── full-page detail building blocks ── */
const Sep = () => <span style={{ color: 'var(--faint)', margin: '0 9px' }}>·</span>;

function DateInput({ value, onChange }) {
  return (
    <input type="date" value={value || ''} onChange={(e) => onChange(e.target.value || null)}
    style={{ border: '1px solid var(--line-2)', borderRadius: 7, padding: '0 10px',
      background: 'var(--panel)', fontSize: 13, height: 34, width: '100%', boxSizing: 'border-box',
      color: 'var(--ink)', fontFamily: 'var(--font)' }}
    onFocus={(e) => {e.target.style.borderColor = 'var(--accent)';e.target.style.boxShadow = '0 0 0 3px var(--accent-soft)';}}
    onBlur={(e) => {e.target.style.borderColor = 'var(--line-2)';e.target.style.boxShadow = 'none';}} />);

}

/* read-only labelled value used inside the Deal Information card */
function DField({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 600, letterSpacing: '.05em',
        textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{children}</div>
    </div>);

}
/* ── Broker Call Log — quick call notes with a broker autocomplete + timestamp, exportable for GHL ── */
function BrokerCallLog({ deal, contacts, onPatch }) {
  const log = Array.isArray(deal.callLog) ? deal.callLog : [];
  const [name, setName] = useStateD('');
  const [firm, setFirm] = useStateD('');
  const [note, setNote] = useStateD('');
  const [showSug, setShowSug] = useStateD(false);
  const [editId, setEditId] = useStateD(null);
  const [editDraft, setEditDraft] = useStateD(null);

  const matches = name.trim().length > 0
    ? (contacts || []).filter((c) => (c.name || '').toLowerCase().includes(name.toLowerCase())).slice(0, 5)
    : [];

  const pick = (c) => { setName(c.name); setFirm(c.firm || firm); setShowSug(false); };

  const logCall = () => {
    if (!name.trim() && !note.trim()) return;
    const entry = { id: 'call_' + Date.now().toString(36), ts: new Date().toISOString(),
      brokerName: name.trim(), brokerFirm: firm.trim(), note: note.trim() };
    onPatch(deal.id, { callLog: [entry, ...log] });
    setName(''); setFirm(''); setNote('');
  };

  const startEdit = (e) => { setEditId(e.id); setEditDraft({ brokerName: e.brokerName || '', brokerFirm: e.brokerFirm || '', note: e.note || '' }); };
  const saveEdit = () => {
    onPatch(deal.id, { callLog: log.map((e) => e.id === editId ? { ...e, ...editDraft } : e) });
    setEditId(null); setEditDraft(null);
  };
  const cancelEdit = () => { setEditId(null); setEditDraft(null); };

  const exportXLSX = () => {
    if (!log.length) return;
    const rows = log.map((e) => {
      const parts = (e.brokerName || '').trim().split(/\s+/);
      return {
        'First Name': parts[0] || '',
        'Last Name': parts.slice(1).join(' ') || '',
        'Email': e.brokerEmail || '',
        'Phone': e.brokerPhone || '',
        'Company Name': e.brokerFirm || '',
        'Property Name': deal.name,
        'Notes': e.note || '',
        'Call Date': e.ts ? fmtDate(e.ts) : '',
      };
    });
    window.downloadCSV(rows, deal.name.replace(/[^a-z0-9]+/gi, '_') + '_call_log.csv');
  };

  const inputStyle = { width: '100%', boxSizing: 'border-box', border: '1px solid var(--line-2)', borderRadius: 7,
    padding: '0 10px', height: 34, background: 'var(--panel)', fontSize: 13, color: 'var(--ink)', fontFamily: 'var(--font)', outline: 'none' };
  const smallInputStyle = { ...inputStyle, height: 30, fontSize: 12.5 };

  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow)' }}>
      <div style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 11, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 11 }}>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--ink)' }}>Broker Call Log</span>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>logged calls for {deal.name}</span>
        </div>
        <button onClick={exportXLSX} disabled={!log.length} title="Export as CSV for GoHighLevel import"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--line-2)', borderRadius: 7,
            padding: '5px 10px', background: 'var(--panel)', fontSize: 12, fontWeight: 600,
            color: log.length ? 'var(--slate)' : 'var(--faint)', cursor: log.length ? 'pointer' : 'default' }}>
          <Icon name="download" size={12} /> Export for GHL
        </button>
      </div>
      <div style={{ padding: '14px 20px 20px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.6fr auto', gap: 8, marginBottom: 14 }}>
          <div style={{ position: 'relative' }}>
            <input value={name} placeholder="Broker name…"
              onChange={(e) => { setName(e.target.value); setShowSug(true); }}
              onFocus={() => setShowSug(true)}
              onBlur={() => setTimeout(() => setShowSug(false), 120)}
              style={inputStyle} />
            {showSug && matches.length > 0 &&
              <div style={{ position: 'absolute', top: 38, left: 0, right: 0, zIndex: 5, background: 'var(--panel)',
                border: '1px solid var(--line-2)', borderRadius: 8, boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
                {matches.map((c) => (
                  <div key={c.id} onMouseDown={() => pick(c)}
                    style={{ padding: '7px 10px', fontSize: 12.5, cursor: 'pointer', borderBottom: '1px solid var(--line)' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--accent-soft)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                    <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{c.name}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 11 }}>{[c.firm, c.phone].filter(Boolean).join(' · ')}</div>
                  </div>
                ))}
              </div>}
          </div>
          <input value={firm} placeholder="Brokerage / firm…" onChange={(e) => setFirm(e.target.value)} style={inputStyle} />
          <input value={note} placeholder="What did they say? Pricing guidance, timeline, feedback…"
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') logCall(); }}
            style={inputStyle} />
          <button onClick={logCall} style={{ border: 'none', borderRadius: 7, background: 'var(--accent)', color: '#fff',
            fontSize: 12.5, fontWeight: 600, padding: '0 14px', cursor: 'pointer' }}>Log Call</button>
        </div>

        {log.length === 0 ? (
          <div style={{ fontSize: 12.5, color: 'var(--faint)', fontStyle: 'italic' }}>No calls logged yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {log.map((e, i) => (
              <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '96px 1fr auto', gap: 12,
                padding: '9px 0', borderTop: i > 0 ? '1px solid var(--line)' : 'none', alignItems: 'start' }}>
                <div className="num" style={{ fontSize: 11, color: 'var(--muted)', paddingTop: 1 }}>
                  {new Date(e.ts).toLocaleDateString([], { month: 'short', day: 'numeric' })}<br />{new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
                {editId === e.id ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      <input value={editDraft.brokerName} placeholder="Broker name"
                        onChange={(ev) => setEditDraft((d) => ({ ...d, brokerName: ev.target.value }))} style={smallInputStyle} />
                      <input value={editDraft.brokerFirm} placeholder="Brokerage / firm"
                        onChange={(ev) => setEditDraft((d) => ({ ...d, brokerFirm: ev.target.value }))} style={smallInputStyle} />
                    </div>
                    <input value={editDraft.note} placeholder="Note"
                      onChange={(ev) => setEditDraft((d) => ({ ...d, note: ev.target.value }))} style={smallInputStyle} />
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>
                      {e.brokerName || 'Unknown broker'}{e.brokerFirm ? <span style={{ color: 'var(--muted)', fontWeight: 400 }}> — {e.brokerFirm}</span> : null}
                    </div>
                    {e.note && <div style={{ fontSize: 12.5, color: 'var(--slate)', marginTop: 2 }}>{e.note}</div>}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 4 }}>
                  {editId === e.id ? (
                    <React.Fragment>
                      <button onClick={saveEdit} title="Save" style={{ border: 'none', background: 'none', padding: 3, cursor: 'pointer', color: 'var(--pos)' }}><Icon name="check" size={14} /></button>
                      <button onClick={cancelEdit} title="Cancel" style={{ border: 'none', background: 'none', padding: 3, cursor: 'pointer', color: 'var(--faint)' }}><Icon name="close" size={14} /></button>
                    </React.Fragment>
                  ) : (
                    <button onClick={() => startEdit(e)} title="Edit" style={{ border: 'none', background: 'none', padding: 3, cursor: 'pointer', color: 'var(--faint)' }}><Icon name="edit" size={14} /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>);
}

/* labelled editable field (input lives in children) */
function EField({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 600, letterSpacing: '.05em',
        textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      {children}
    </div>);

}

/* white card with an uppercase header + optional hint */
function PanelCard({ title, hint, children }) {
  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--line)',
      borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow)' }}>
      <div style={{ padding: '16px 20px 0', display: 'flex', alignItems: 'baseline', gap: 11, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--ink)' }}>{title}</span>
        {hint && <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>{hint}</span>}
      </div>
      <div style={{ padding: '16px 20px 20px' }}>{children}</div>
    </div>);

}

/* right-rail card */
function RailCard({ icon, title, children }) {
  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--line)',
      borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow)', overflow: 'hidden' }}>
      <div style={{ padding: '11px 16px', borderBottom: '1px solid var(--line)',
        display: 'flex', alignItems: 'center', gap: 8 }}>
        <Icon name={icon} size={13} style={{ color: 'var(--muted)' }} />
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--muted)' }}>{title}</span>
      </div>
      <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 13 }}>{children}</div>
    </div>);

}
function RailRow({ label, value, num = true, muted }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 2 }}>{label}</div>
      <div className={num ? 'num' : undefined} style={{ fontSize: 14, fontWeight: 600,
        color: muted ? 'var(--faint)' : 'var(--ink)' }}>{value}</div>
    </div>);

}

/* ── Portfolio: property count stepper ── */
function PropertyCountStepper({ count, onChange }) {
  const btn = { border: '1px solid var(--line-2)', background: 'var(--panel)', color: 'var(--ink)',
    width: 28, height: 28, borderRadius: 7, cursor: 'pointer', fontSize: 15, fontWeight: 600,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 };
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
      <button type="button" onClick={() => onChange(Math.max(2, count - 1))} style={btn}>−</button>
      <span className="num" style={{ width: 20, textAlign: 'center', fontSize: 14.5, fontWeight: 700, color: 'var(--ink)' }}>{count}</span>
      <button type="button" onClick={() => onChange(Math.min(30, count + 1))} style={btn}>+</button>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>properties</span>
    </div>);

}

const propInputSty = { border: '1px solid var(--line-2)', borderRadius: 7, padding: '0 10px', background: 'var(--panel)',
  fontSize: 13.5, height: 34, width: '100%', boxSizing: 'border-box', color: 'var(--ink)', fontFamily: 'var(--font)' };
const propFocus = (e) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--accent-soft)'; };
const propBlur = (e) => { e.target.style.borderColor = 'var(--line-2)'; e.target.style.boxShadow = 'none'; };

/* ── Portfolio: one section per property, generated from the property count ── */
function PropertySection({ property, index, onChange, onRemove, canRemove }) {
  const upd = (k, v) => onChange({ ...property, [k]: v });
  return (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--line)',
      borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '13px 20px', borderBottom: '1px solid var(--line)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, minWidth: 0 }}>
          <span className="num" style={{ width: 24, height: 24, borderRadius: 7, background: 'var(--navy)', color: '#fff',
            flex: 'none', fontSize: 11.5, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{index + 1}</span>
          <input value={property.name || ''} onChange={(e) => upd('name', e.target.value)}
            placeholder={'Property ' + (index + 1)}
            style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 14.5, fontWeight: 600,
              color: 'var(--ink)', fontFamily: 'var(--font)', padding: '4px 6px', borderRadius: 6, flex: 1, minWidth: 0 }}
            onFocus={(e) => { e.target.style.background = 'var(--panel-2)'; }}
            onBlur={(e) => { e.target.style.background = 'transparent'; }} />
        </div>
        {canRemove &&
        <button type="button" onClick={onRemove} title="Remove property"
          style={{ border: 'none', background: 'none', color: 'var(--faint)', cursor: 'pointer', padding: 4, flex: 'none' }}>
            <Icon name="close" size={14} />
          </button>
        }
      </div>
      <div style={{ padding: '16px 20px 20px', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '18px 20px' }}>
        <EField label="Market">
          <input value={property.market || ''} onChange={(e) => upd('market', e.target.value)} placeholder="City, State"
            style={propInputSty} onFocus={propFocus} onBlur={propBlur} />
        </EField>
        <EField label="Units"><FieldInput value={property.units} onChange={(v) => upd('units', v || 0)} align="left" /></EField>
        <EField label="Vintage">
          <input value={property.vintage || ''} onChange={(e) => upd('vintage', e.target.value)} placeholder="Year built"
            style={propInputSty} onFocus={propFocus} onBlur={propBlur} />
        </EField>
        <EField label="Ask Price"><FieldInput value={property.askPrice} onChange={(v) => upd('askPrice', v || 0)} prefix="$" /></EField>
        <EField label="UW Price"><FieldInput value={property.purchasePrice} onChange={(v) => upd('purchasePrice', v || 0)} prefix="$" /></EField>
        <EField label="Notes">
          <input value={property.notes || ''} onChange={(e) => upd('notes', e.target.value)} placeholder="Property-specific notes"
            style={propInputSty} onFocus={propFocus} onBlur={propBlur} />
        </EField>
      </div>
    </div>);

}

/* numbered stage stepper */
function StageStepper({ stage, onChange }) {
  const idx = STAGES.indexOf(stage);
  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {STAGES.map((s, i) => {
        const active = i === idx;
        return (
          <React.Fragment key={s}>
            {i > 0 && <div style={{ width: 34, height: 1, background: 'var(--line-2)' }} />}
            <button onClick={() => onChange(s)} style={{
              display: 'inline-flex', alignItems: 'center', gap: 9, padding: '6px 14px 6px 7px', borderRadius: 999,
              border: active ? '1px solid var(--accent)' : '1px solid transparent',
              background: active ? 'var(--accent-soft)' : 'transparent', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <span className="num" style={{ width: 21, height: 21, borderRadius: 999, flex: 'none',
                background: active ? 'var(--accent)' : 'var(--panel-3)', color: active ? '#fff' : 'var(--muted)',
                fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
              <span style={{ fontSize: 12.5, fontWeight: active ? 700 : 500, color: active ? 'var(--accent)' : 'var(--slate)' }}>{STAGE_META[s].label}</span>
            </button>
          </React.Fragment>);

      })}
    </div>);

}

/* full-bleed 5-up KPI strip + optional returns row */
function KpiStrip({ deal, m, propView, excluded }) {
  const isPortfolio = !!deal.isPortfolio && Array.isArray(deal.properties) && deal.properties.length > 1;
  const selIdx = isPortfolio && propView && propView.startsWith('p') ? Number(propView.slice(1)) : null;
  const selProperty = selIdx != null && deal.properties[selIdx] ? deal.properties[selIdx] : null;
  // Combined view respects the Full UW tab's property-inclusion selection so the strip
  // never disagrees with the combined model rendered in the body.
  const incProps = isPortfolio ? deal.properties.filter((p, i) => !(excluded || {})[p.id || i]) : [];
  const incDeal = isPortfolio ? { ...deal, properties: incProps } : deal;
  const selM = selProperty ? computeMetrics(selProperty) : null;
  // Portfolios: sum per-property Full UW into the combined model (each property is
  // underwritten independently), or show one selected property's own Full UW.
  // Single deals: Full UW (Yr1/Yr3 YOC) over Quick UW fallback.
  const combined = isPortfolio && !selProperty && window.computeCombinedUW ? window.computeCombinedUW(incDeal) : null;
  const selUw = selProperty && window.hasUWInputs && window.hasUWInputs(selProperty) && window.computeUW ? window.computeUW(selProperty) : null;
  const fullUW = isPortfolio ? (selProperty ? !!selUw : !!combined) : (window.hasUWInputs ? window.hasUWInputs(deal) : false);
  const uw = isPortfolio ? (selProperty ? selUw : combined) : (fullUW && window.computeUW ? window.computeUW(deal) : null);
  const y1 = uw && uw.rows[1] ? uw.rows[1].yieldOnCost : null;
  const y3row = uw ? (uw.rows[3] || uw.rows[uw.rows.length - 1]) : null;
  const y3 = y3row ? y3row.yieldOnCost : null;

  const mBase = selProperty ? selM : m;
  const goingIn = uw && y1 != null ? y1 : mBase.goingInCap;
  const stab = uw && y3 != null ? y3 : mBase.stabilizedCap;
  const capSrc = uw ? 'Full UW' : 'Quick UW';

  const askSum = selProperty ? Number(selProperty.askPrice) || 0
    : isPortfolio ? (incProps.reduce((s, p) => s + (Number(p.askPrice) || 0), 0) || (incProps.length === deal.properties.length ? Number(deal.askPrice) || 0 : 0)) : deal.askPrice;
  const uwSum = selProperty ? Number(selProperty.purchasePrice) || 0
    : isPortfolio ? (incProps.reduce((s, p) => s + (Number(p.purchasePrice) || 0), 0) || (incProps.length === deal.properties.length ? Number(deal.purchasePrice) || 0 : 0)) : deal.purchasePrice;
  const totalBasis = uw ? uw.basis : mBase.totalBasis;

  // Headline returns come from the linked Excel model when the deal has one (single deals
  // only; portfolios keep the combined Full-UW model). Everything is gated on `fromExcel`
  // so non-Excel deals render exactly as before.
  const fromExcel = !isPortfolio && window.hasExcelReturns ? window.hasExcelReturns(deal) : false;
  const R = fromExcel && window.dealReturns ? window.dealReturns(deal) : null;

  const priceCells = fromExcel ? [
  { label: 'Ask Price', value: askSum ? fmtShort(askSum) : '—' },
  { label: 'Offer Price', value: R.offerPrice ? fmtShort(R.offerPrice) : (uwSum ? fmtShort(uwSum) : '—'),
    color: 'var(--ink)', sub: R.offerToAsk != null ? R.offerToAsk.toFixed(2) + 'x ask' : null },
  { label: 'Going-In Cap*', value: fmtPct(R.goingInCap), color: R.goingInCap ? 'var(--accent)' : 'var(--faint)', sub: 'Excel model*' },
  { label: 'Total Basis', value: fmtShort(totalBasis), color: totalBasis ? 'var(--ink)' : 'var(--faint)' }] : [
  { label: 'Ask Price', value: askSum ? fmtShort(askSum) : '—' },
  { label: 'UW Price', value: uwSum ? fmtShort(uwSum) : '—' },
  { label: 'Going-In Cap*', value: fmtPct(goingIn), color: goingIn ? 'var(--accent)' : 'var(--faint)',
    sub: (uw ? 'Yr 1 YOC · ' : '') + capSrc + '*' },
  { label: 'Stabilized Cap*', value: fmtPct(stab), color: stab ? 'var(--pos)' : 'var(--faint)',
    sub: (uw ? 'Yr 3 YOC · ' : '') + capSrc + '*' },
  { label: 'Total Basis', value: fmtShort(totalBasis), color: totalBasis ? 'var(--ink)' : 'var(--faint)' }];

  // Returns render from the Excel model when present, else from the Full UW DCF once the
  // Income & Economic Vacancy section is populated.
  const retCells = fromExcel ? [
  { label: 'Levered IRR', value: R.irr == null ? '—' : fmtPct(R.irr, 2), color: R.irr == null ? 'var(--faint)' : 'var(--pos)', ret: true },
  { label: 'Equity Mult.', value: R.equityMultiple == null ? '—' : R.equityMultiple.toFixed(2) + 'x', color: 'var(--ink)', ret: true },
  { label: 'Stabilized YoC', value: R.stabYOC == null ? '—' : fmtPct(R.stabYOC, 2), color: R.stabYOC == null ? 'var(--faint)' : 'var(--accent)', ret: true },
  { label: 'Avg Yield', value: R.avgYield == null ? '—' : fmtPct(R.avgYield, 2), color: R.avgYield == null ? 'var(--faint)' : 'var(--accent)', ret: true },
  { label: 'Hold', value: R.holdYears == null ? '—' : R.holdYears + ' yrs', color: 'var(--ink)', ret: true }] :
  (uw ? [
  { label: 'Levered IRR', value: uw.irr == null ? '—' : (uw.irr * 100).toFixed(1) + '%', color: uw.irr == null ? 'var(--faint)' : 'var(--pos)', ret: true },
  { label: 'Equity Mult.', value: uw.equityMultiple == null ? '—' : uw.equityMultiple.toFixed(2) + 'x', color: 'var(--ink)', ret: true },
  { label: 'Avg Yield', value: uw.avgYield == null ? '—' : (uw.avgYield * 100).toFixed(1) + '%', color: uw.avgYield == null ? 'var(--faint)' : 'var(--accent)', ret: true }] :
  []);
  const cells = [...priceCells, ...retCells];

  return (
    <div>
      {isPortfolio &&
      <div style={{ padding: '8px 16px 0', fontSize: 11, fontWeight: 600, color: 'var(--muted)' }}>
        Showing: <span style={{ color: 'var(--accent)' }}>{selProperty ? selProperty.name || 'Property ' + (selIdx + 1) : 'Combined (' + incProps.length + (incProps.length === deal.properties.length ? '' : ' of ' + deal.properties.length) + ')'}</span>
      </div>}
      {fromExcel &&
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px 0', flexWrap: 'wrap' }}>
        {window.ExcelSourceTag && <window.ExcelSourceTag size="sm" syncedAt={R.syncedAt} />}
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>Reported returns are from the linked Excel model — the Full UW tab is a screening estimate.</span>
      </div>}
      <div style={{ display: 'flex', borderTop: '1px solid var(--line)', overflow: 'hidden' }}>
        {cells.map((c, i) =>
        <div key={i} style={{
          flex: '1 1 0', minWidth: 0, padding: '11px 16px',
          borderLeft: i === 0 ? 'none' : c.ret && !cells[i - 1].ret ? '2px solid var(--accent)' : '1px solid var(--line)',
          background: c.ret ? 'var(--panel-2)' : 'transparent' }}>
            <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.label}</div>
            <div className="num" style={{ fontSize: 19, fontWeight: 700, lineHeight: 1, color: c.color || 'var(--ink)' }}>{c.value}</div>
            {c.sub &&
            <div style={{ fontSize: 9.5, fontWeight: 500, color: 'var(--faint)', marginTop: 5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.sub}</div>}
          </div>
        )}
      </div>
    </div>);

}

/* tab bar */
function DetailTabs({ tab, setTab, showProperties }) {
  const tabs = [
  { key: 'summary', label: 'Summary', icon: 'deal' },
  ...(showProperties ? [{ key: 'properties', label: 'Properties', icon: 'bank' }] : []),
  { key: 'fulluw', label: 'Full UW', icon: 'calc' },
  ...(window.RentRollTab ? [{ key: 'rentroll', label: 'Rent Roll', icon: 'table' }] : []),
  { key: 'returns', label: 'Returns', icon: 'chart' },
  { key: 'location', label: 'Location', icon: 'search' },
  { key: 'notes', label: 'Notes', icon: 'note' }];

  return (
    <div style={{ display: 'flex', gap: 4, padding: '0 28px', borderTop: '1px solid var(--line)' }}>
      {tabs.map((t) => {
        const on = tab === t.key;
        return (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            display: 'inline-flex', alignItems: 'center', gap: 7, padding: '13px 12px', border: 'none', background: 'none',
            borderBottom: on ? '2px solid var(--accent)' : '2px solid transparent', marginBottom: -1,
            color: on ? 'var(--accent)' : 'var(--muted)', fontSize: 13.5, fontWeight: on ? 600 : 500, cursor: 'pointer' }}
          onMouseEnter={(e) => {if (!on) e.currentTarget.style.color = 'var(--slate)';}}
          onMouseLeave={(e) => {if (!on) e.currentTarget.style.color = 'var(--muted)';}}>
            <Icon name={t.icon} size={15} />{t.label}
          </button>);

      })}
    </div>);

}

/* shared notes editor */
function NotesEditor({ value, onChange, minHeight = 140 }) {
  return (
    <textarea value={value || ''} onChange={(e) => onChange(e.target.value)}
    placeholder="Add notes — underwriting rationale, broker conversations, pricing guidance, next steps…"
    style={{ width: '100%', minHeight, resize: 'vertical',
      border: '1px solid var(--line-2)', borderRadius: 8, padding: '12px 14px',
      fontSize: 13, lineHeight: 1.65, background: 'var(--panel-2)', outline: 'none',
      color: 'var(--ink)', fontWeight: 400, fontFamily: 'var(--font)', boxSizing: 'border-box' }}
    onFocus={(e) => {e.target.style.borderColor = 'var(--accent)';e.target.style.background = 'var(--panel)';}}
    onBlur={(e) => {e.target.style.borderColor = 'var(--line-2)';e.target.style.background = 'var(--panel-2)';}} />);

}

const GMAPS_KEY = 'AIzaSyAyKErMh7ozzT62GLwjdgUJscLeEJIlRv0';
window.GMAPS_KEY = GMAPS_KEY;

function LocationView({ deal, set }) {
  const seed = deal.locationQuery || [deal.name, deal.market].filter(Boolean).join(', ');
  const [q, setQ] = useStateD(seed);
  const [coords, setCoords] = useStateD(null); // {lat,lng}
  const [geo, setGeo] = useStateD('idle'); // idle | loading | ok | fail
  const [active, setActive] = useStateD(seed); // last submitted query
  const [svPano, setSvPano] = useStateD(null); // resolved Street View panorama id
  const [svStatus, setSvStatus] = useStateD('idle'); // idle | loading | ok | none

  /* Geocode via Google Geocoding API */
  useEffectD(() => {
    if (!active) {setGeo('idle');setCoords(null);return;}
    let cancelled = false;
    setGeo('loading');setCoords(null);
    fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(active)}&key=${GMAPS_KEY}`).
    then((r) => r.json()).
    then((data) => {
      if (cancelled) return;
      if (data.status === 'OK' && data.results[0]) {
        const loc = data.results[0].geometry.location;
        setCoords({ lat: loc.lat, lng: loc.lng });
        setGeo('ok');
      } else {setGeo('fail');}
    }).
    catch(() => {if (!cancelled) setGeo('fail');});
    return () => {cancelled = true;};
  }, [active]);

  const submit = () => {const v = q.trim();if (v) {setActive(v);set('locationQuery', v);}};

  /* Find the nearest OUTDOOR street panorama for the geocoded point. The embed alone
     snaps to any nearby photo (often a user photosphere, or nothing at a complex's
     rooftop centroid); the metadata lookup pins a real street-level pano within ~150m. */
  useEffectD(() => {
    if (!coords) {setSvStatus('idle');setSvPano(null);return;}
    let cancelled = false;
    setSvStatus('loading');setSvPano(null);
    fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?location=${coords.lat},${coords.lng}&source=outdoor&radius=160&key=${GMAPS_KEY}`).
    then((r) => r.json()).
    then((d) => {
      if (cancelled) return;
      if (d.status === 'OK' && d.pano_id) {setSvPano(d.pano_id);setSvStatus('ok');} else
      setSvStatus('none');
    }).
    catch(() => {if (!cancelled) setSvStatus('none');});
    return () => {cancelled = true;};
  }, [coords]);

  /* Maps Embed API v1 — requires key, never blocked */
  const mapSrc = active ?
  `https://www.google.com/maps/embed/v1/place?key=${GMAPS_KEY}&q=${encodeURIComponent(active)}&zoom=15` :
  null;
  const svSrc = svPano ?
  `https://www.google.com/maps/embed/v1/streetview?key=${GMAPS_KEY}&pano=${svPano}&heading=0&pitch=0&fov=80` :
  null;
  const extLink = coords ?
  `https://www.google.com/maps/@${coords.lat},${coords.lng},17z` :
  `https://www.google.com/maps/search/${encodeURIComponent(active || '')}`;

  const panel = { position: 'relative', height: 400, borderRadius: 8, overflow: 'hidden',
    border: '1px solid var(--line)', background: 'var(--panel-2)', width: '100%' };
  const ph = { ...panel, display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexDirection: 'column', gap: 9 };
  const cap = { fontSize: 10.5, fontWeight: 700, letterSpacing: '.07em', textTransform: 'uppercase',
    color: 'var(--muted)', marginBottom: 8 };

  return (
    <PanelCard title="Location" hint={deal.market || 'Market not set'}>
      <div style={{ display: 'flex', gap: 9, marginBottom: 18 }}>
        <input value={q} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {if (e.key === 'Enter') submit();}}
        placeholder="Property name + address, or city, state"
        style={{ flex: 1, border: '1px solid var(--line-2)', borderRadius: 8, padding: '0 13px',
          height: 38, background: 'var(--panel)', fontSize: 13.5, color: 'var(--ink)',
          fontFamily: 'var(--font)', boxSizing: 'border-box', outline: 'none' }}
        onFocus={(e) => {e.target.style.borderColor = 'var(--accent)';e.target.style.boxShadow = '0 0 0 3px var(--accent-soft)';}}
        onBlur={(e) => {e.target.style.borderColor = 'var(--line-2)';e.target.style.boxShadow = 'none';}} />
        <button onClick={submit}
        style={{ border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 8,
          padding: '0 20px', fontSize: 13, fontWeight: 600, cursor: 'pointer', height: 38,
          fontFamily: 'var(--font)', flex: 'none' }}>
          {geo === 'loading' ? 'Locating…' : 'Locate'}
        </button>
        <a href={extLink} target="_blank" rel="noreferrer"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--line-2)',
          borderRadius: 8, padding: '0 14px', fontSize: 13, fontWeight: 500, color: 'var(--slate)',
          textDecoration: 'none', height: 38, flex: 'none', whiteSpace: 'nowrap' }}>
          <Icon name="search" size={13} /> Open in Maps
        </a>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
        <div>
          <div style={cap}>Map View</div>
          {mapSrc ?
          <iframe title="map" src={mapSrc} style={panel} loading="lazy"
          referrerPolicy="no-referrer-when-downgrade" allowFullScreen></iframe> :

          <div style={ph}>
              <Icon name="search" size={26} style={{ color: 'var(--faint)' }} />
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Enter a location above</span>
            </div>
          }
        </div>
        <div>
          <div style={cap}>Street View</div>
          {svStatus === 'ok' && svSrc ?
          <iframe title="street-view" src={svSrc} style={panel} loading="lazy"
          referrerPolicy="no-referrer-when-downgrade" allowFullScreen></iframe> :
          geo === 'loading' || svStatus === 'loading' ?
          <div style={ph}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', border: '3px solid var(--accent)',
              borderTopColor: 'transparent', animation: 'spin .8s linear infinite' }} />
              <span style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4 }}>Finding street view…</span>
            </div> :
          svStatus === 'none' ?
          <div style={ph}>
              <Icon name="search" size={26} style={{ color: 'var(--faint)' }} />
              <span style={{ fontSize: 12.5, color: 'var(--muted)', textAlign: 'center',
              maxWidth: 260, lineHeight: 1.6 }}>
                No street-level imagery within ~150m of this point.<br />Try a more specific street address.
              </span>
            </div> :
          geo === 'fail' ?
          <div style={ph}>
              <Icon name="search" size={26} style={{ color: 'var(--faint)' }} />
              <span style={{ fontSize: 12.5, color: 'var(--muted)', textAlign: 'center',
              maxWidth: 260, lineHeight: 1.6 }}>
                No street-view panorama found.<br />Try a specific street address.
              </span>
            </div> :

          <div style={ph}>
              <Icon name="search" size={26} style={{ color: 'var(--faint)' }} />
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Locate a property to load street view</span>
            </div>
          }
        </div>
      </div>
      {coords &&
      <div className="num" style={{ marginTop: 10, fontSize: 11.5, color: 'var(--faint)', textAlign: 'right' }}>
          {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
        </div>
      }
    </PanelCard>);

}
/* Inline-editable deal title — click to edit, Enter or blur to save, Esc to cancel. */
function EditableTitle({ value, onCommit }) {
  const [editing, setEditing] = useStateD(false);
  const [draft, setDraft] = useStateD(value || '');
  const inputRef = React.useRef(null);
  useEffectD(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);
  const commit = () => { const v = draft.trim(); if (v && v !== value) onCommit(v); setEditing(false); };
  const cancel = () => { setDraft(value || ''); setEditing(false); };
  const titleStyle = { margin: 0, fontSize: 24, fontWeight: 700, color: 'var(--ink)', letterSpacing: '-.015em', textWrap: 'pretty', fontFamily: 'var(--font)' };
  if (editing) {
    return (
      <input ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') cancel(); }}
        style={{ ...titleStyle, width: '100%', boxSizing: 'border-box', background: 'var(--panel)',
          border: '1px solid var(--accent)', borderRadius: 8, padding: '3px 9px', outline: 'none',
          boxShadow: '0 0 0 3px var(--accent-soft)' }} />
    );
  }
  return (
    <h1 onClick={() => { setDraft(value || ''); setEditing(true); }} title="Click to rename"
      style={{ ...titleStyle, cursor: 'text', display: 'inline-flex', alignItems: 'center', gap: 9, borderRadius: 8, padding: '3px 9px', margin: '-3px -9px' }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--panel-2)'; const p = e.currentTarget.querySelector('[data-pen]'); if (p) p.style.opacity = '1'; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; const p = e.currentTarget.querySelector('[data-pen]'); if (p) p.style.opacity = '0'; }}>
      <span className="clip">{value || 'Untitled deal'}</span>
      <span data-pen style={{ opacity: 0, transition: 'opacity .12s', color: 'var(--faint)', flex: 'none', display: 'inline-flex' }}>
        <Icon name="edit" size={15} />
      </span>
    </h1>
  );
}
function DealDetail({ deal, onBack, onPatch, omData, onAcceptOM, contacts, onOMUpload,
  t12Data, rrData, onT12Upload, onRRUpload, onClearOM, onClearT12, onClearRR,
  onRunMarketReview, onRunMemo, onImportCoStar,
  todos, onAddTodo, onPatchTodo, onDeleteTodo, onViewTasks }) {
  const [tab, setTab] = useStateD('summary');
  const [propView, setPropView] = useStateD('combined');
  const [omTargetIdx, setOmTargetIdx] = useStateD(0);
  const [excluded, setExcluded] = useStateD({});
  const [sticky, setSticky] = useStateD(false);
  const titleSentinelRef = useRefD(null);
  useEffectD(() => {
    const el = titleSentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => setSticky(!e.isIntersecting), { threshold: 0 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const set = (k, v) => onPatch(deal.id, typeof k === 'object' ? k : { [k]: v });
  const patch = (obj) => onPatch(deal.id, obj);
  const makeProperty = (i) => ({ id: 'p' + Date.now() + '_' + i, name: 'Property ' + (i + 1),
    market: deal.market || '', units: '', vintage: '', askPrice: '', purchasePrice: '', notes: '' });
  // Roll per-property Ask/UW price + units up to deal-level fields, atomically alongside the
  // properties patch — every board/table/pipeline view reads d.askPrice/d.purchasePrice/d.units
  // directly and isn't portfolio-aware, so these must stay in sync whenever properties change.
  // Only roll a field up when at least one property actually carries a value for it —
  // otherwise a Full UW edit on a portfolio whose per-property prices are blank would
  // zero out the deal-level Ask/UW Price and Units the KPI strip and pipeline read.
  const rollupProperties = (arr) => {
    const out = { properties: arr };
    const roll = (key) => {
      if (!arr.some((p) => Number(p[key]) > 0)) return;
      out[key] = arr.reduce((s, p) => s + (Number(p[key]) || 0), 0);
    };
    roll('askPrice'); roll('purchasePrice'); roll('units');
    return out;
  };
  const setPropertyCount = (n) => {
    const cur = Array.isArray(deal.properties) ? deal.properties : [];
    const next = cur.slice(0, n);
    while (next.length < n) next.push(makeProperty(next.length));
    patch(rollupProperties(next));
  };
  const togglePortfolio = (on) => {
    if (on) {
      const cur = Array.isArray(deal.properties) ? deal.properties : [];
      const arr = cur.length >= 2 ? cur : [makeProperty(0), makeProperty(1)];
      patch({ isPortfolio: true, ...rollupProperties(arr) });
    } else {
      set('isPortfolio', false);
    }
  };
  const properties = Array.isArray(deal.properties) ? deal.properties : [];
  const propertyVintageRange = (() => {
    const vs = properties.map((p) => Number(p.vintage)).filter((v) => v > 0);
    if (!vs.length) return '—';
    const lo = Math.min(...vs), hi = Math.max(...vs);
    return lo === hi ? String(lo) : lo + '–' + hi;
  })();
  const UploadBtn = window.OMBtn;
  const T12Banner = window.T12ParsedSection;
  const RRBanner = window.RentRollParsedSection;
  const DOC_ACCEPT = '.pdf,.csv,.txt,.xlsx,.xls,.xlsm,application/pdf,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';
  // Broker contacts tied to THIS deal — explicit OM linkage (dealIds), assigned primary
  // contact, or a last-name match against the deal's broker field. This is the "who do I
  // reach out to for this deal" list.
  const dealContacts = (Array.isArray(contacts) ? contacts : []).filter((c) => {
    const ids = Array.isArray(c.dealIds) ? c.dealIds : [];
    const lastName = (c.name || '').trim().split(' ').pop().toLowerCase();
    const lastNameRe = lastName.length > 2 ? new RegExp('\\b' + lastName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i') : null;
    return ids.includes(deal.id) ||
    deal.contactId && deal.contactId === c.id ||
    (lastNameRe && lastNameRe.test(deal.broker || ''));
  });
  const m = computeMetrics(deal);
  // Excel-model returns + the Full UW screening numbers, for the source badge and the
  // side-by-side comparison card (both only surfaced when the deal has an _uw block).
  const dR = (window.hasExcelReturns && window.hasExcelReturns(deal)) ? window.dealReturns(deal) : null;
  const dScreenUW = (dR && window.hasUWInputs && window.hasUWInputs(deal) && window.computeUW) ? window.computeUW(deal) : null;
  const dScreenCaps = dR && window.displayCaps ? window.displayCaps(deal) : null;
  const capDelta = m.stabilizedCap - m.goingInCap;
  const hasDebt = !!deal.debt;
  const days = daysAgo(deal.dateEntered);
  const inputW = 'repeat(3,1fr)';

  const anyParsed = omData?.status === 'done' && omData.parsed ||
  t12Data?.status === 'done' && t12Data.parsed ||
  rrData?.status === 'done' && rrData.parsed;
  const anyError = omData?.status === 'error' || t12Data?.status === 'error' || rrData?.status === 'error';

  return (
    <div className="fade" style={{ height: '100%', overflow: 'auto', background: 'var(--bg)' }}>
      {/* Sticky deal-name bar — appears once you scroll past the title */}
      {sticky && (
        <div style={{ position: 'sticky', top: 0, zIndex: 20, background: 'var(--panel)',
          borderBottom: '1px solid var(--line)', padding: '8px 28px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14,
          boxShadow: '0 2px 8px rgba(15,23,32,.07)', animation: 'fadeIn .12s ease' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <button onClick={onBack} style={{ border: 'none', background: 'none', color: 'var(--accent)',
              fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: 12.5, flex: 'none' }}>Pipeline</button>
            <Icon name="chevR" size={12} style={{ color: 'var(--faint)', flex: 'none' }} />
            <span className="clip" style={{ fontWeight: 700, fontSize: 14, color: 'var(--ink)', maxWidth: 320, flex: 'none' }}>{deal.name}</span>
            <select value={deal.stage} onChange={(e) => set('stage', e.target.value)}
              style={{ border: '1px solid var(--line-2)', borderRadius: 7, padding: '5px 9px',
                background: 'var(--panel)', fontSize: 12.5, fontWeight: 600, flex: 'none',
                color: (STAGE_META[deal.stage] || STAGE_META['New Deal']).c, cursor: 'pointer' }}>
              {STAGE_ALL.map((s) => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
            </select>
            <span style={{ width: 1, height: 18, background: 'var(--line)', flex: 'none' }} />
            <div style={{ display: 'flex', alignItems: 'center', fontSize: 12, color: 'var(--muted)', minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>
              <span style={{ flex: 'none' }}>{deal.type}</span>
              <Sep /><span style={{ flex: 'none' }}>{deal.market || '—'}</span>
              {deal.units ? <><Sep /><span className="num" style={{ flex: 'none' }}>{fmtNum(deal.units)} units</span></> : null}
              {(deal.vintage || (deal.isPortfolio && propertyVintageRange !== '—')) ? <><Sep /><span className="num" style={{ flex: 'none' }}>Built {deal.vintage || propertyVintageRange}</span></> : null}
            </div>
          </div>
        </div>
      )}

      {/* ===== White header block ===== */}
      <div style={{ background: 'var(--panel)' }}>
        <div style={{ padding: '14px 28px 0' }}>
          {/* breadcrumb + stage select */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, minWidth: 0 }}>
              <button onClick={onBack} style={{ border: 'none', background: 'none', color: 'var(--accent)',
                fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: 12.5 }}>Pipeline</button>
              <Icon name="chevR" size={12} style={{ color: 'var(--faint)', flex: 'none' }} />
              <span className="clip" style={{ color: 'var(--muted)', maxWidth: 440 }}>{deal.name}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, flex: 'none' }}>
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Assignee</span>
              <AssigneePicker value={deal.assignees} onChange={(v) => set('assignees', v)} size={26} />
              <span style={{ width: 1, height: 18, background: 'var(--line)', flex: 'none' }} />
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Stage</span>
              <select value={deal.stage} onChange={(e) => set('stage', e.target.value)}
              style={{ border: '1px solid var(--line-2)', borderRadius: 7, padding: '6px 9px',
                background: 'var(--panel)', fontSize: 12.5, fontWeight: 600,
                color: (STAGE_META[deal.stage] || STAGE_META['New Deal']).c, cursor: 'pointer' }}>
                {STAGE_ALL.map((s) => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
              </select>
            </div>
          </div>

          {/* title + days pill */}
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ minWidth: 0 }}>
              <div ref={titleSentinelRef} style={{ position: 'absolute', top: 0, left: 0, height: 1, width: 1, pointerEvents: 'none' }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <EditableTitle value={deal.name} onCommit={(v)=>set('name', v)} />
                <button onClick={() => set('offMarket', !deal.offMarket)} title={deal.offMarket ? 'Marked off-market — click to remove' : 'Mark as an off-market deal'}
                  style={{ border: 'none', background: 'none', padding: 0, cursor: 'pointer', flex: 'none' }}>
                  {deal.offMarket
                    ? <OffMarketTag />
                    : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 9px', borderRadius: 999, fontSize: 11.5, fontWeight: 600, color: 'var(--faint)', border: '1px dashed var(--line-2)' }}>+ Off-Market</span>}
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', marginTop: 9, fontSize: 13, color: 'var(--muted)', flexWrap: 'wrap' }}>
                <TypeTag type={deal.type} />
                <Sep /><span>{deal.market || '—'}</span>
                {deal.units ? <><Sep /><span className="num">{fmtNum(deal.units)} units</span></> : null}
                {(deal.vintage || (deal.isPortfolio && propertyVintageRange !== '—')) ? <><Sep /><span className="num">Built {deal.vintage || propertyVintageRange}</span></> : null}
                {deal.broker ? <><Sep /><span className="clip" style={{ maxWidth: 280 }}>{deal.broker}</span></> : null}
              </div>
            </div>
            <div style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 7,
              border: '1px solid var(--line)', borderRadius: 999, padding: '7px 15px', background: 'var(--panel-2)' }}>
              <Icon name="clock" size={13} style={{ color: 'var(--muted)' }} />
              <span className="num" style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{days != null ? days : 0}</span>
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>days in pipeline</span>
            </div>
          </div>

          {/* documents */}
          {onOMUpload && UploadBtn &&
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase' }}>Documents</span>
              <UploadBtn dealId={deal.id} om={omData} onUpload={onOMUpload} onOpenDeal={() => {}} label="OM" accept=".pdf,application/pdf" />
              {onT12Upload && <UploadBtn dealId={deal.id} om={t12Data} onUpload={onT12Upload} onOpenDeal={() => {}} label="T-12" accept={DOC_ACCEPT} />}
              {onRRUpload && <UploadBtn dealId={deal.id} om={rrData} onUpload={onRRUpload} onOpenDeal={() => {}} label="Rent Roll" accept={DOC_ACCEPT} />}
            </div>
          }

          {/* stepper */}
          <div style={{ padding: '16px 0 15px' }}>
            <StageStepper stage={deal.stage} onChange={(s) => set('stage', s)} />
          </div>
        </div>

        {/* KPI strip */}
        <KpiStrip deal={deal} m={m} propView={propView} excluded={excluded} />

        {/* tabs */}
        <DetailTabs tab={tab} setTab={setTab} showProperties={!!deal.isPortfolio} />
      </div>

      {/* ===== Body ===== */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 28px 80px' }}>

        {/* parsed banners (always visible, regardless of tab) */}
        {(anyParsed || anyError) &&
        <div style={{ marginBottom: 18 }}>
            {omData?.status === 'done' && omData.parsed &&
          <OMParsedSection parsed={omData.parsed} deal={deal} properties={properties} targetIdx={omTargetIdx} setTargetIdx={setOmTargetIdx}
          onReupload={onClearOM ? () => onClearOM(deal.id) : null}
          onAccept={(fields) => {
            if (deal.isPortfolio && properties.length) {
              const arr = [...properties];
              arr[omTargetIdx] = { ...arr[omTargetIdx], ...fields };
              patch(rollupProperties(arr));
            } else {
              onAcceptOM && onAcceptOM(deal.id, fields);
            }
          }} />
          }
            {t12Data?.status === 'done' && t12Data.parsed && T12Banner &&
          <T12Banner parsed={t12Data.parsed}
          onReupload={onClearT12 ? () => onClearT12(deal.id) : null}
          onAccept={(fields) => onAcceptOM && onAcceptOM(deal.id, fields)} />
          }
            {rrData?.status === 'done' && rrData.parsed && RRBanner &&
          <RRBanner parsed={rrData.parsed}
          onReupload={onClearRR ? () => onClearRR(deal.id) : null}
          onAccept={(fields) => onAcceptOM && onAcceptOM(deal.id, fields)} />
          }
            {omData?.status === 'error' && <ParseErrorBanner label="OM" error={omData.error} />}
            {t12Data?.status === 'error' && <ParseErrorBanner label="T-12" error={t12Data.error} />}
            {rrData?.status === 'error' && <ParseErrorBanner label="Rent Roll" error={rrData.error} />}
          </div>
        }

        {/* ===== SUMMARY ===== */}
        {tab === 'summary' &&
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 318px', gap: 18, alignItems: 'start' }}>
            {/* main column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <PanelCard title="Deal Information" hint="Edit any field — underwriting recalculates live">
                <div style={{ display: 'grid', gridTemplateColumns: inputW, gap: '20px 24px' }}>
                  <EField label="Asset Type">
                    <select value={deal.type || 'Multifamily'} onChange={(e) => set('type', e.target.value)}
                  style={{ border: '1px solid var(--line-2)', borderRadius: 7, padding: '0 10px', background: 'var(--panel)',
                    fontSize: 13.5, height: 34, width: '100%', boxSizing: 'border-box', color: 'var(--ink)', fontFamily: 'var(--font)', cursor: 'pointer' }}>
                      {Object.keys(window.TYPE_META).map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </EField>
                  <EField label="Market">
                    <input value={deal.market || ''} onChange={(e) => set('market', e.target.value)} placeholder="City, State"
                  style={{ border: '1px solid var(--line-2)', borderRadius: 7, padding: '0 10px', background: 'var(--panel)',
                    fontSize: 13.5, height: 34, width: '100%', boxSizing: 'border-box', color: 'var(--ink)', fontFamily: 'var(--font)' }}
                  onFocus={(e) => {e.target.style.borderColor = 'var(--accent)';e.target.style.boxShadow = '0 0 0 3px var(--accent-soft)';}}
                  onBlur={(e) => {e.target.style.borderColor = 'var(--line-2)';e.target.style.boxShadow = 'none';}} />
                  </EField>
                  <EField label="Vintage">
                    <input value={deal.vintage || (deal.isPortfolio && propertyVintageRange !== '—' ? propertyVintageRange : '')} onChange={(e) => set('vintage', e.target.value)}
                  placeholder={deal.isPortfolio && propertyVintageRange !== '—' ? propertyVintageRange : 'Year built'}
                  style={{ border: '1px solid var(--line-2)', borderRadius: 7, padding: '0 10px', background: 'var(--panel)',
                    fontSize: 13.5, height: 34, width: '100%', boxSizing: 'border-box', color: 'var(--ink)', fontFamily: 'var(--font)' }}
                  onFocus={(e) => {e.target.style.borderColor = 'var(--accent)';e.target.style.boxShadow = '0 0 0 3px var(--accent-soft)';}}
                  onBlur={(e) => {e.target.style.borderColor = 'var(--line-2)';e.target.style.boxShadow = 'none';}} />
                  {deal.isPortfolio && !deal.vintage && propertyVintageRange !== '—' &&
                  <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 3 }}>From property vintages — edit to override</div>}
                  </EField>
                  <EField label="Broker Firm">
                    <input value={deal.broker || ''} onChange={(e) => set('broker', e.target.value)} placeholder="Brokerage / team"
                  style={{ border: '1px solid var(--line-2)', borderRadius: 7, padding: '0 10px', background: 'var(--panel)',
                    fontSize: 13.5, height: 34, width: '100%', boxSizing: 'border-box', color: 'var(--ink)', fontFamily: 'var(--font)' }}
                  onFocus={(e) => {e.target.style.borderColor = 'var(--accent)';e.target.style.boxShadow = '0 0 0 3px var(--accent-soft)';}}
                  onBlur={(e) => {e.target.style.borderColor = 'var(--line-2)';e.target.style.boxShadow = 'none';}} />
                  </EField>
                  <EField label={dealContacts.length > 1 ? 'Broker Contacts' : 'Broker Contact'}>
                    {dealContacts.length ?
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {dealContacts.map((c) =>
                    <div key={c.id} style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <span style={{ fontWeight: 600, color: 'var(--ink)' }}>
                              {c.name || '—'}{c.title ? <span style={{ fontWeight: 400, color: 'var(--muted)' }}> · {c.title}</span> : null}
                            </span>
                            {(c.email || c.phone) &&
                      <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>
                                {c.email ? <a href={`mailto:${c.email}`} style={{ color: 'var(--accent)', textDecoration: 'none' }}>{c.email}</a> : null}
                                {c.email && c.phone ? '   ·   ' : ''}
                                {c.phone || ''}
                              </span>
                      }
                          </div>
                    )}
                      </div> :

                  <input value={deal.brokerContact || ''} onChange={(e) => set('brokerContact', e.target.value)}
                  placeholder="Name · title · phone · email"
                  style={{ border: '1px solid var(--line-2)', borderRadius: 7, padding: '0 10px', background: 'var(--panel)',
                    fontSize: 13.5, height: 34, width: '100%', boxSizing: 'border-box', color: 'var(--ink)', fontFamily: 'var(--font)' }}
                  onFocus={(e) => {e.target.style.borderColor = 'var(--accent)';e.target.style.boxShadow = '0 0 0 3px var(--accent-soft)';}}
                  onBlur={(e) => {e.target.style.borderColor = 'var(--line-2)';e.target.style.boxShadow = 'none';}} />
                  }
                  </EField>
                  <EField label="Units"><FieldInput value={deal.units} onChange={(v) => set('units', v || 0)} align="left" /></EField>
                  <EField label="Portfolio">
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, color: 'var(--ink)', height: 34 }}>
                      <input type="checkbox" checked={!!deal.isPortfolio} onChange={(e) => togglePortfolio(e.target.checked)} style={{ width: 15, height: 15, cursor: 'pointer' }} />
                      Multiple properties
                    </label>
                  </EField>
                  {deal.isPortfolio &&
                  <EField label="Number of Properties">
                    <PropertyCountStepper count={properties.length || 2} onChange={setPropertyCount} />
                  </EField>
                  }
                </div>
              </PanelCard>

              <PanelCard title="Key Dates" hint="Pipeline milestones drive the Metrics & Analytics views">
                <div style={{ display: 'grid', gridTemplateColumns: inputW, gap: '20px 24px' }}>
                  <EField label="Date Entered"><DateInput value={deal.dateEntered} onChange={(v) => set('dateEntered', v)} /></EField>
                  <EField label="CFO Date"><DateInput value={deal.cfoDate} onChange={(v) => set('cfoDate', v)} /></EField>
                  <EField label="LOI Submitted"><DateInput value={deal.dateLOISubmitted} onChange={(v) => set('dateLOISubmitted', v)} /></EField>
                  <EField label="LOI Amount"><FieldInput value={deal.loiAmount} onChange={(v) => set('loiAmount', v || 0)} prefix="$" /></EField>
                  <EField label="Under Contract"><DateInput value={deal.dateUnderContract} onChange={(v) => set('dateUnderContract', v)} /></EField>
                  <EField label="Date Lost"><DateInput value={deal.dateLost} onChange={(v) => set('dateLost', v)} /></EField>
                </div>
              </PanelCard>

              <PanelCard title="Status" hint="current deal status — shown in the pipeline">
                <input value={deal.status || ''} onChange={(e) => set('status', e.target.value)}
                  placeholder="e.g. Awaiting BOV, call seller Mon, LOI at $14.2M…"
                  style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--line-2)', borderRadius: 8,
                    padding: '0 12px', height: 40, background: 'var(--panel)', fontSize: 13.5, color: 'var(--ink)', fontFamily: 'var(--font)', outline: 'none' }}
                  onFocus={(e) => { e.target.style.borderColor = 'var(--accent)'; e.target.style.boxShadow = '0 0 0 3px var(--accent-soft)'; }}
                  onBlur={(e) => { e.target.style.borderColor = 'var(--line-2)'; e.target.style.boxShadow = 'none'; }} />
              </PanelCard>

              {window.DealTodos && onAddTodo && (
                <PanelCard title="Tasks" hint="tasks linked to this deal">
                  <window.DealTodos
                    deal={deal}
                    todos={todos || []}
                    onAdd={onAddTodo}
                    onPatch={onPatchTodo}
                    onDelete={onDeleteTodo}
                    onViewAll={onViewTasks}
                  />
                </PanelCard>
              )}

              <PanelCard title="Notes" hint="UW thoughts, broker feedback, pricing guidance">
                {deal.isPortfolio && properties.length > 0 &&
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                  {properties.filter((p) => p.notes).map((p, i) =>
                  <div key={p.id || i} style={{ fontSize: 12.5, background: 'var(--panel-2)', borderRadius: 7, padding: '8px 10px' }}>
                    <span style={{ fontWeight: 700, color: 'var(--ink)' }}>{p.name || 'Property ' + (i + 1)}: </span>
                    <span style={{ color: 'var(--muted)' }}>{p.notes}</span>
                  </div>
                  )}
                </div>
                }
                <NotesEditor value={deal.notes} onChange={(v) => set('notes', v)} />
              </PanelCard>

              <BrokerCallLog deal={deal} contacts={contacts} onPatch={onPatch} />

              {window.DocumentVault && <window.DocumentVault deal={deal} set={set} />}
            </div>

            {/* right rail */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <RailCard icon="target" title="Key Metrics">
                <RailRow label="Ask Price" value={deal.askPrice ? fmtShort(deal.askPrice) : '—'} muted={!deal.askPrice} />
                <RailRow label="UW Price" value={deal.purchasePrice ? fmtShort(deal.purchasePrice) : '—'} muted={!deal.purchasePrice} />
                <RailRow label="Total Basis" value={fmtShort(m.totalBasis)} muted={!m.totalBasis} />
              </RailCard>

              {dR && dR.fromExcel && dScreenUW &&
              <RailCard icon="calc" title="Screening vs Excel">
                {[
                  { k: 'Levered IRR', s: dScreenUW.irr == null ? '—' : (dScreenUW.irr * 100).toFixed(1) + '%', e: dR.irr == null ? '—' : fmtPct(dR.irr, 1) },
                  { k: 'Equity Mult.', s: dScreenUW.equityMultiple == null ? '—' : dScreenUW.equityMultiple.toFixed(2) + 'x', e: dR.equityMultiple == null ? '—' : dR.equityMultiple.toFixed(2) + 'x' },
                  { k: 'Stab. YoC', s: dScreenCaps && dScreenCaps.stab != null ? fmtPct(dScreenCaps.stab, 1) : '—', e: dR.stabYOC == null ? '—' : fmtPct(dR.stabYOC, 1) },
                ].map((row, i) =>
                <div key={i} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, padding: '5px 0', borderTop: i ? '1px solid var(--line)' : 'none' }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{row.k}</span>
                  <span style={{ display: 'flex', gap: 12, alignItems: 'baseline' }}>
                    <span className="num" title="Full UW screening estimate" style={{ fontSize: 12.5, color: 'var(--slate)' }}>{row.s}</span>
                    <span className="num" title="Excel model — source of record" style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--accent-2)' }}>{row.e}</span>
                  </span>
                </div>
                )}
                <div style={{ fontSize: 10, color: 'var(--faint)', marginTop: 7 }}>Left: Full UW screening · Right: Excel model*</div>
              </RailCard>}

              <RailCard icon="clock" title="Timeline">
                <RailRow label="Date Entered" value={fmtDate(deal.dateEntered)} num={false} />
                <RailRow label="Days in Pipeline" value={(days != null ? days : 0) + ' days'} />
                <RailRow label="LOI Submitted" value={deal.dateLOISubmitted ? fmtDate(deal.dateLOISubmitted) : 'Not yet'} num={false} muted={!deal.dateLOISubmitted} />
                <RailRow label="Under Contract" value={deal.dateUnderContract ? fmtDate(deal.dateUnderContract) : 'Not yet'} num={false} muted={!deal.dateUnderContract} />
              </RailCard>

              <RailCard icon="flag" title="Origination">
                <RailRow label="Broker Firm" value={deal.broker || '—'} num={false} />
                <RailRow label="Market" value={deal.market || '—'} num={false} />
              </RailCard>
            </div>
          </div>
        }

        {/* ===== PROPERTIES (portfolio) ===== */}
        {tab === 'properties' &&
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                <span className="num" style={{ fontWeight: 700, color: 'var(--ink)' }}>{properties.length}</span> properties ·{' '}
                <span className="num" style={{ fontWeight: 700, color: 'var(--ink)' }}>{fmtNum(properties.reduce((s, p) => s + (Number(p.units) || 0), 0))}</span> total units
              </div>
              <PropertyCountStepper count={properties.length || 2} onChange={setPropertyCount} />
            </div>
            {properties.map((p, i) =>
            <PropertySection key={p.id || i} property={p} index={i}
            onChange={(next) => { const arr = [...properties]; arr[i] = next; patch(rollupProperties(arr)); }}
            onRemove={() => setPropertyCount(properties.length - 1)}
            canRemove={properties.length > 2} />
            )}
          </div>
        }

        {/* ===== FULL UNDERWRITING ===== */}
        {tab === 'fulluw' && window.FullUnderwritingTab && <window.FullUnderwritingTab deal={deal} set={set} propView={propView} setPropView={setPropView} setProperties={(arr) => patch(rollupProperties(arr))} excluded={excluded} setExcluded={setExcluded} stickyTop={sticky ? 44 : 0} onT12Upload={onT12Upload} t12Data={t12Data} />}

        {/* ===== RENT ROLL MATRIX ===== */}
        {tab === 'rentroll' && window.RentRollTab && <window.RentRollTab deal={deal} set={set} onRRUpload={onRRUpload} rrData={rrData} />}

        {/* ===== RETURN METRICS ===== */}
        {tab === 'returns' && window.ReturnsTab && <window.ReturnsTab deal={deal} set={set} />}

        {/* ===== LOCATION ===== */}
        {tab === 'location' &&
        <LocationView deal={deal} set={set} />
        }

        {/* ===== NOTES ===== */}
        {tab === 'notes' &&
        <PanelCard title="Notes" hint="UW thoughts, broker feedback, pricing guidance">
            <NotesEditor value={deal.notes} onChange={(v) => set('notes', v)} minHeight={360} />
          </PanelCard>
        }

      </div>
    </div>);

}

Object.assign(window, {
  DealDetail, FieldInput, SectionHead, CalcRow, PerUnit, OverviewItem,
  BannerShell, FoundRow, MissingRow, PanelCard
});