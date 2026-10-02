// app/network.jsx — Network: one place for broker and lender relationships, replacing the CRM
// and Broker Calls tabs. Contacts carry a type (investment sales, equity broker, debt broker,
// direct lender) and an A / B / C tier that sets a 30 / 60 / 90 day follow-up cadence. Every
// touch (call, email, meeting, note) lands on one timeline, merged with the call logs already
// kept on deals, and each contact shows the deals they sent and how far those got.
const { useState: useStateN, useMemo: useMemoN, useEffect: useEffectN, useRef: useRefN } = React;

const NET_TYPES = [
  { key: 'sales', label: 'Investment Sales', short: 'Sales', c: '#1b59c4', bg: '#e2ebfb' },
  { key: 'equity', label: 'Equity Broker', short: 'Equity', c: '#6b46e0', bg: '#ece6fd' },
  { key: 'debt', label: 'Debt Broker', short: 'Debt', c: '#0c7a43', bg: '#e0f2ea' },
  { key: 'lender', label: 'Direct Lender', short: 'Lender', c: '#b87214', bg: '#fdf0d8' },
  { key: 'other', label: 'Other', short: 'Other', c: '#5b7088', bg: '#eef1f5' },
];
const NET_TIERS = { A: 30, B: 60, C: 90 };
const ACT_TYPES = [
  { key: 'call', label: 'Call', icon: 'phone' },
  { key: 'email', label: 'Email', icon: 'mail' },
  { key: 'meeting', label: 'Meeting', icon: 'users' },
  { key: 'note', label: 'Note', icon: 'note' },
];
const LOI_PLUS = ['LOI Submitted', 'LOI Lost', 'Under Contract', 'Purchased'];
const typeMeta = (k) => NET_TYPES.find((t) => t.key === k) || null;

/* ── Activity store ──
   Touches not tied to a deal's call log. Sandbox: this browser's localStorage. At go-live this
   moves to a Supabase activities table so the team shares one timeline. */
const LS_ACT = 'altus_activities_v1';
const AltusActivities = (function () {
  let list = null;
  const subs = new Set();
  function load() {
    if (list) return list;
    try { list = JSON.parse(localStorage.getItem(LS_ACT)); } catch (e) { list = null; }
    if (!Array.isArray(list)) {
      // first run: bring over calls logged on the old Broker Calls tab with no deal attached
      let legacy = [];
      try { legacy = JSON.parse(localStorage.getItem('altus_standalone_calls_v1')) || []; } catch (e) {}
      list = (Array.isArray(legacy) ? legacy : []).map((c) => ({ id: c.id, ts: c.ts, type: 'call', contactId: null, dealId: null,
        note: c.note || '', brokerName: c.brokerName || '', brokerFirm: c.brokerFirm || '', market: c.market || '', propertyName: c.propertyName || '' }));
      save();
    }
    return list;
  }
  function save() { try { localStorage.setItem(LS_ACT, JSON.stringify(list)); } catch (e) {} subs.forEach((f) => { try { f(list); } catch (e) {} }); }
  return {
    all: load,
    add(a) { list = [a, ...load()]; save(); },
    remove(id) { list = load().filter((a) => a.id !== id); save(); },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
  };
})();
function useActivities() {
  const [list, setList] = useStateN(() => AltusActivities.all());
  useEffectN(() => AltusActivities.subscribe((l) => setList(l.slice())), []);
  return list;
}

/* ── helpers ── */
const nDay = 86400000;
const todayISO = () => window.ALTUS_TODAY;
const toDate = (s) => (s ? new Date(String(s).length <= 10 ? s + 'T12:00:00' : s) : null);
const isoDay = (d) => (d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : '');
const addDays = (iso, n) => isoDay(new Date(toDate(iso).getTime() + n * nDay));
const daysFrom = (d) => (d ? Math.round((toDate(todayISO()).getTime() - d.getTime()) / nDay) : null);
const fmtDay = (d) => (d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() === toDate(todayISO()).getFullYear() ? undefined : 'numeric' }) : '—');
const initials = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0] || '').join('').toUpperCase();
const nm = (s) => String(s || '').trim().toLowerCase();
const uid = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Deals a contact sent: explicit links first, then the broker field on the deal.
function dealsForContact(c, deals) {
  const ids = Array.isArray(c.dealIds) ? c.dealIds : [];
  const last = nm(c.name).split(' ').pop();
  const re = last.length > 2 ? new RegExp('\\b' + last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i') : null;
  return deals.filter((d) => ids.includes(d.id) || (d.contactId && d.contactId === c.id) ||
    (c.email && nm(d.broker).includes(nm(c.email))) || (re && re.test(d.broker || '')));
}
// Firm key for grouping: case, punctuation, legal suffixes and a few known aliases don't split a firm.
const FIRM_ALIAS = { 'jones lang lasalle': 'jll', 'jones lang lasalle americas': 'jll', 'marcus millichap': 'marcus millichap', 'walker dunlop': 'walker dunlop' };
function firmKey(f) {
  let k = nm(f).replace(/,?\s+a division of .*$/, '').replace(/&/g, ' ').replace(/[.,'’()]/g, ' ')
    .replace(/\b(llc|l l c|inc|ltd|lp|llp|co|corp|corporation|company|group|real estate advisors|real estate|advisors|investment sales|capital markets|americas)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  return FIRM_ALIAS[k] || k || 'no firm';
}
function dealFunnel(ds) {
  return { sent: ds.length, loi: ds.filter((d) => LOI_PLUS.includes(d.stage)).length,
    contract: ds.filter((d) => d.stage === 'Under Contract' || d.stage === 'Purchased').length, closed: ds.filter((d) => d.stage === 'Purchased').length };
}

// One timeline: the activity store plus every call logged on a deal.
function buildTimeline(acts, deals, contacts) {
  const byName = {};
  contacts.forEach((c) => { if (c.name) byName[nm(c.name)] = c.id; });
  const out = acts.map((a) => ({ ...a, source: 'store', contactId: a.contactId || byName[nm(a.brokerName)] || null }));
  deals.forEach((d) => (Array.isArray(d.callLog) ? d.callLog : []).forEach((e) => out.push({
    id: e.id, ts: e.ts, type: e.kind || 'call', note: e.note || '', brokerName: e.brokerName || '', brokerFirm: e.brokerFirm || '',
    contactId: e.contactId || byName[nm(e.brokerName)] || null, dealId: d.id, dealName: d.name, market: d.market || '', source: 'deal' })));
  const dealName = {};
  deals.forEach((d) => { dealName[d.id] = d.name; });
  out.forEach((a) => { if (a.dealId && !a.dealName) a.dealName = dealName[a.dealId] || ''; });
  return out.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
}

// Last touch and next follow-up for every contact.
function relationshipState(contacts, timeline) {
  const lastAct = {};
  timeline.forEach((a) => { if (a.contactId && !lastAct[a.contactId]) lastAct[a.contactId] = a; });
  const out = {};
  contacts.forEach((c) => {
    const a = lastAct[c.id];
    const tA = a && a.ts ? toDate(a.ts) : null;
    const tC = c.lastActivity ? toDate(c.lastActivity) : null;
    const last = tA && (!tC || tA >= tC) ? tA : tC;
    const cadence = NET_TIERS[c.tier] || null;
    const due = c.nextFollowUp ? toDate(c.nextFollowUp) : cadence && last ? new Date(last.getTime() + cadence * nDay) : cadence ? toDate(todayISO()) : null;
    out[c.id] = { last, lastType: a && tA === last ? a.type : null, cadence, due, dueIn: due ? -daysFrom(due) : null };
  });
  return out;
}

/* ── small UI pieces ── */
const N_BTN = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 32, padding: '0 12px', border: '1px solid var(--line-2)', borderRadius: 7,
  background: 'var(--panel)', color: 'var(--slate)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)', textDecoration: 'none', whiteSpace: 'nowrap' };
const N_PRIMARY = { ...N_BTN, border: 'none', background: 'var(--navy)', color: '#fff' };
const N_INPUT = { height: 34, border: '1px solid var(--line-2)', borderRadius: 7, padding: '0 10px', background: 'var(--panel)', fontSize: 13, color: 'var(--ink)', fontFamily: 'var(--font)', boxSizing: 'border-box', width: '100%' };
const N_LABEL = { fontSize: 10.5, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)', marginBottom: 4, display: 'block' };

function TypeChip({ type }) {
  const t = typeMeta(type);
  if (!t) return <span style={{ fontSize: 11, color: 'var(--faint)' }}>—</span>;
  return <span style={{ fontSize: 10.5, fontWeight: 700, padding: '2px 7px', borderRadius: 5, color: t.c, background: t.bg, whiteSpace: 'nowrap' }}>{t.short}</span>;
}
function TierChip({ tier }) {
  if (!NET_TIERS[tier]) return <span style={{ fontSize: 11, color: 'var(--faint)' }}>—</span>;
  const c = { A: 'var(--navy)', B: 'var(--accent)', C: 'var(--slate)' }[tier];
  return <span title={'Tier ' + tier + ' · every ' + NET_TIERS[tier] + ' days'} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, borderRadius: 6, fontSize: 11.5, fontWeight: 700, color: '#fff', background: c }}>{tier}</span>;
}
function NetAvatar({ name, size = 32 }) {
  return <span style={{ width: size, height: size, borderRadius: '50%', background: 'var(--accent-soft)', color: 'var(--accent-2)', fontSize: size * 0.38, fontWeight: 700,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{initials(name)}</span>;
}
function DueText({ st }) {
  if (!st || !st.due) return <span style={{ color: 'var(--faint)' }}>—</span>;
  const d = st.dueIn;
  const color = d < 0 ? 'var(--neg)' : d <= 7 ? 'var(--warn)' : 'var(--slate)';
  return <span style={{ color, fontWeight: d <= 7 ? 600 : 400 }}>{d < 0 ? Math.abs(d) + 'd overdue' : d === 0 ? 'Today' : fmtDay(st.due)}</span>;
}
function LastText({ st }) {
  if (!st || !st.last) return <span style={{ color: 'var(--faint)' }}>never</span>;
  const n = daysFrom(st.last);
  return <span>{n <= 0 ? 'today' : n + 'd ago'}{st.lastType ? ' · ' + st.lastType : ''}</span>;
}
function NetSeg({ value, options, onChange }) {
  return (
    <div style={{ display: 'inline-flex', border: '1px solid var(--line-2)', borderRadius: 7, overflow: 'hidden' }}>
      {options.map((o, i) => {
        const on = value === o.value;
        return <button key={String(o.value)} type="button" onClick={() => onChange(o.value)} title={o.title}
          style={{ border: 'none', borderLeft: i ? '1px solid var(--line-2)' : 'none', padding: '0 11px', height: 30, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            background: on ? 'var(--navy)' : 'var(--panel)', color: on ? '#fff' : 'var(--slate)', fontFamily: 'var(--font)' }}>{o.label}</button>;
      })}
    </div>);
}

function BulkTierBtn({ count, onConfirm }) {
  const [armed, setArmed] = useStateN(false);
  useEffectN(() => { if (!armed) return; const t = setTimeout(() => setArmed(false), 3500); return () => clearTimeout(t); }, [armed]);
  return <button type="button" onClick={() => { if (armed) { setArmed(false); onConfirm(); } else setArmed(true); }}
    style={{ ...N_BTN, height: 28, ...(armed ? { borderColor: 'var(--warn)', color: 'var(--warn)', background: 'var(--warn-soft)' } : {}) }}>
    {armed ? 'Set ' + count + ' to Tier C? Click again' : 'Set all to Tier C'}</button>;
}

/* ── Log an activity (drawer and quick-log) ── */
function LogForm({ contact, deals, contactDeals, onLog, onCancel, defaultType = 'call' }) {
  const [type, setType] = useStateN(defaultType);
  const [note, setNote] = useStateN('');
  const [dealId, setDealId] = useStateN('');
  const [next, setNext] = useStateN('cadence');
  const [nextDate, setNextDate] = useStateN('');
  const cadence = NET_TIERS[contact.tier];
  const active = deals.filter((d) => d.stage !== 'Dead');
  const others = active.filter((d) => !contactDeals.some((x) => x.id === d.id));
  const save = () => {
    const nf = next === 'cadence' ? null : next === 'date' ? (nextDate || null) : addDays(todayISO(), Number(next));
    onLog({ type, note: note.trim(), dealId: dealId || null, nextFollowUp: nf });
  };
  return (
    <div style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 12, background: 'var(--panel)' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <NetSeg value={type} onChange={setType} options={ACT_TYPES.map((t) => ({ value: t.key, label: t.label }))} />
        <select value={dealId} onChange={(e) => setDealId(e.target.value)} style={{ ...N_INPUT, width: 'auto', flex: 1, minWidth: 160, height: 32 }} aria-label="Deal">
          <option value="">No deal</option>
          {contactDeals.length > 0 && <optgroup label="Their deals">{contactDeals.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>}
          <optgroup label="Other active deals">{others.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</optgroup>
        </select>
      </div>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} autoFocus
        placeholder="What came up? Pricing guidance, new listings, lender appetite, next steps…"
        style={{ ...N_INPUT, height: 'auto', padding: '8px 10px', resize: 'vertical', lineHeight: 1.45 }} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Next follow-up</span>
        <select value={next} onChange={(e) => setNext(e.target.value)} style={{ ...N_INPUT, width: 'auto', height: 30, fontSize: 12.5 }} aria-label="Next follow-up">
          <option value="cadence">{cadence ? 'Tier ' + contact.tier + ' cadence (' + cadence + ' days)' : 'No cadence (set a tier)'}</option>
          <option value="7">In 1 week</option><option value="14">In 2 weeks</option><option value="30">In 1 month</option><option value="date">Pick a date…</option>
        </select>
        {next === 'date' && <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} style={{ ...N_INPUT, width: 150, height: 30 }} />}
        <span style={{ flex: 1 }} />
        {onCancel && <button type="button" style={N_BTN} onClick={onCancel}>Cancel</button>}
        <button type="button" style={N_PRIMARY} onClick={save}>Log {ACT_TYPES.find((t) => t.key === type).label.toLowerCase()}</button>
      </div>
      {dealId && type === 'call' && <div style={{ fontSize: 11, color: 'var(--faint)', marginTop: 6 }}>Also shows in that deal's broker call log.</div>}
    </div>);
}

function TimelineItem({ a, contactsById, showContact, onOpenDeal, onDelete }) {
  const t = ACT_TYPES.find((x) => x.key === a.type) || ACT_TYPES[0];
  const c = a.contactId ? contactsById[a.contactId] : null;
  const who = c ? c.name + (c.firm ? ' · ' + c.firm : '') : [a.brokerName, a.brokerFirm].filter(Boolean).join(' · ') || 'Unassigned';
  return (
    <div style={{ display: 'flex', gap: 10, padding: '10px 0', borderTop: '1px solid var(--line)' }}>
      <span style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--panel-3)', color: 'var(--slate)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
        <Icon name={t.icon} size={14} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 12 }}>
          <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{t.label}</b>
          {showContact && <span style={{ color: 'var(--slate)' }}>{who}</span>}
          {a.dealId && <button type="button" onClick={() => onOpenDeal && onOpenDeal(a.dealId)} style={{ border: 'none', background: 'none', padding: 0, color: 'var(--accent)', fontSize: 12, cursor: 'pointer', fontFamily: 'var(--font)' }}>{a.dealName || 'deal'}</button>}
          {!a.dealId && a.propertyName && <span style={{ color: 'var(--muted)' }}>{a.propertyName}</span>}
          <span style={{ color: 'var(--faint)', marginLeft: 'auto' }}>{a.ts ? new Date(a.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}</span>
          {onDelete && a.source === 'store' && <button type="button" aria-label="Delete activity" title="Delete" onClick={() => onDelete(a.id)}
            style={{ border: 'none', background: 'none', color: 'var(--faint)', cursor: 'pointer', padding: 0 }}><Icon name="close" size={11} /></button>}
        </div>
        {a.note && <div style={{ fontSize: 12.5, color: 'var(--slate)', marginTop: 3, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{a.note}</div>}
      </div>
    </div>);
}

/* ── Contact drawer ── */
function NetContactDrawer({ contact, deals, st, timeline, contactsById, onClose, onPatch, onLog, onOpenDeal, onDeleteActivity }) {
  const [logging, setLogging] = useStateN(null);
  const [emailed, setEmailed] = useStateN(false);
  useEffectN(() => { const esc = (e) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc); }, []);
  useEffectN(() => { setLogging(null); setEmailed(false); }, [contact.id]);
  const cDeals = dealsForContact(contact, deals);
  const f = dealFunnel(cDeals);
  const acts = timeline.filter((a) => a.contactId === contact.id);
  const set = (k, v) => onPatch(contact.id, { [k]: v });
  const field = (key, label, type) => (
    <label key={key} style={{ display: 'block' }}><span style={N_LABEL}>{label}</span>
      <input type={type || 'text'} defaultValue={contact[key] || ''} key={contact.id + key} onBlur={(e) => { if (e.target.value !== (contact[key] || '')) set(key, e.target.value); }} style={N_INPUT} /></label>);
  const stat = (l, v) => <div style={{ flex: 1, padding: '8px 10px', borderRadius: 8, background: 'var(--panel-2)', textAlign: 'center' }}>
    <div className="num" style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>{v}</div><div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.04em' }}>{l}</div></div>;
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60 }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(11,25,45,.18)', animation: 'scrimIn .2s both' }} />
      <div role="dialog" aria-label={contact.name} style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(560px,100vw)', background: 'var(--bg)', boxShadow: '-10px 0 36px rgba(11,25,45,.16)',
        animation: 'drawerIn .24s cubic-bezier(.2,.7,.2,1) both', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '18px 20px 14px', background: 'var(--panel)', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <NetAvatar name={contact.name} size={42} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }} className="clip">{contact.name || 'Unnamed contact'}</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }} className="clip">{[contact.title, contact.firm].filter(Boolean).join(' · ') || '—'}</div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 6 }}><Icon name="close" size={16} /></button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
            {contact.email
              ? <a href={'mailto:' + contact.email} onClick={() => setEmailed(true)} style={N_PRIMARY}><Icon name="mail" size={13} />Email in Outlook</a>
              : <span style={{ ...N_BTN, opacity: .5, cursor: 'default' }}><Icon name="mail" size={13} />No email</span>}
            {contact.phone && <a href={'tel:' + contact.phone.replace(/[^\d+]/g, '')} style={N_BTN}><Icon name="phone" size={13} />{contact.phone}</a>}
            <button type="button" style={N_BTN} onClick={() => setLogging('call')}><Icon name="plus" size={13} />Log activity</button>
          </div>
          {emailed && !logging && <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, padding: '8px 10px', borderRadius: 8, background: 'var(--accent-soft)', fontSize: 12.5, color: 'var(--ink)' }}>
            Sent the email? Log it so the follow-up clock resets.
            <button type="button" style={{ ...N_BTN, height: 26, marginLeft: 'auto' }} onClick={() => setLogging('email')}>Log email</button>
            <button type="button" aria-label="Dismiss" style={{ border: 'none', background: 'none', color: 'var(--muted)', cursor: 'pointer' }} onClick={() => setEmailed(false)}><Icon name="close" size={11} /></button>
          </div>}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 30px', display: 'flex', flexDirection: 'column', gap: 16 }}>
          {logging && <LogForm contact={contact} deals={deals} contactDeals={cDeals} defaultType={logging}
            onCancel={() => setLogging(null)} onLog={(a) => { onLog(contact, a); setLogging(null); setEmailed(false); }} />}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label><span style={N_LABEL}>Type</span>
              <select value={contact.type || ''} onChange={(e) => set('type', e.target.value || null)} style={N_INPUT}>
                <option value="">Not set</option>{NET_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
            <div><span style={N_LABEL}>Tier · follow-up cadence</span>
              <NetSeg value={contact.tier || ''} onChange={(v) => set('tier', v || null)}
                options={[{ value: 'A', label: 'A', title: 'Every 30 days' }, { value: 'B', label: 'B', title: 'Every 60 days' }, { value: 'C', label: 'C', title: 'Every 90 days' }, { value: '', label: 'None' }]} /></div>
            <div><span style={N_LABEL}>Last touch</span><div style={{ fontSize: 13, color: 'var(--ink)', paddingTop: 7 }}><LastText st={st} /></div></div>
            <div><span style={N_LABEL}>Next follow-up</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input type="date" value={st && st.due ? isoDay(st.due) : ''} onChange={(e) => set('nextFollowUp', e.target.value || null)} style={{ ...N_INPUT, width: 150 }} />
                {contact.nextFollowUp && <button type="button" title="Back to the tier cadence" onClick={() => set('nextFollowUp', null)}
                  style={{ border: 'none', background: 'none', color: 'var(--accent)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' }}>use cadence</button>}
              </div>
              <div style={{ fontSize: 11, marginTop: 3 }}><DueText st={st} /></div></div>
          </div>

          <div>
            <span style={N_LABEL}>Deals sent</span>
            <div style={{ display: 'flex', gap: 8 }}>{stat('Sent', f.sent)}{stat('LOI', f.loi)}{stat('Contract', f.contract)}{stat('Closed', f.closed)}
              {stat('LOI rate', f.sent ? Math.round(f.loi / f.sent * 100) + '%' : '—')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
              {cDeals.slice(0, 8).map((d) => (
                <button key={d.id} type="button" onClick={() => onOpenDeal(d.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--line)', borderLeft: '3px solid ' + ((STAGE_META[d.stage] || {}).c || 'var(--line-2)'),
                  borderRadius: 8, padding: '7px 10px', background: 'var(--panel)', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font)' }}>
                  <span style={{ flex: 1, minWidth: 0 }}><span className="clip" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>{d.name}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>{d.market || ''}</span></span>
                  <StageBadge stage={d.stage} size="sm" dot={false} />
                </button>))}
              {cDeals.length > 8 && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>+{cDeals.length - 8} more</span>}
            </div>
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center' }}><span style={N_LABEL}>Timeline · {acts.length}</span></div>
            {acts.length ? acts.slice(0, 40).map((a) => <TimelineItem key={a.source + a.id} a={a} contactsById={contactsById} onOpenDeal={onOpenDeal} onDelete={onDeleteActivity} />)
              : <div style={{ fontSize: 12.5, color: 'var(--muted)', padding: '6px 0' }}>Nothing logged yet.</div>}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {field('name', 'Name')}{field('firm', 'Firm')}{field('title', 'Title')}{field('phone', 'Phone', 'tel')}
            <div style={{ gridColumn: '1/-1' }}>{field('email', 'Email', 'email')}</div>
            {field('markets', 'Markets covered')}
            <label style={{ display: 'block' }}><span style={N_LABEL}>Tags</span>
              <input defaultValue={(contact.tags || []).join(', ')} key={contact.id + 'tags'} placeholder="e.g. Texas, value-add, HUD"
                onBlur={(e) => set('tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))} style={N_INPUT} /></label>
            <label style={{ display: 'block', gridColumn: '1/-1' }}><span style={N_LABEL}>Notes</span>
              <textarea defaultValue={contact.notes || ''} key={contact.id + 'notes'} rows={3} onBlur={(e) => { if (e.target.value !== (contact.notes || '')) set('notes', e.target.value); }}
                style={{ ...N_INPUT, height: 'auto', padding: '8px 10px', resize: 'vertical' }} /></label>
          </div>
        </div>
      </div>
    </div>);
}

/* ── Add contact ── */
function NetAddContact({ onAdd, onClose, contacts }) {
  const [c, setC] = useStateN({ name: '', firm: '', title: '', email: '', phone: '', markets: '', type: 'sales', tier: 'B' });
  const dupe = c.email && contacts.find((x) => nm(x.email) === nm(c.email));
  const up = (k) => (e) => setC({ ...c, [k]: e.target.value });
  const save = () => {
    if (!c.name.trim() && !c.email.trim()) return;
    onAdd({ ...c, id: uid('c-'), name: c.name.trim(), dealIds: [], tags: [], dateAdded: todayISO(), lastActivity: todayISO() });
    onClose();
  };
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 70, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '10vh' }}>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(11,25,45,.28)' }} />
      <div role="dialog" aria-label="Add contact" style={{ position: 'relative', width: 'min(520px,94vw)', background: 'var(--panel)', borderRadius: 12, boxShadow: 'var(--shadow-lg)', padding: 20, animation: 'modalIn .18s both' }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 14 }}>Add contact</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label><span style={N_LABEL}>Name</span><input value={c.name} onChange={up('name')} style={N_INPUT} autoFocus /></label>
          <label><span style={N_LABEL}>Firm</span><input value={c.firm} onChange={up('firm')} style={N_INPUT} /></label>
          <label><span style={N_LABEL}>Type</span><select value={c.type} onChange={up('type')} style={N_INPUT}>{NET_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></label>
          <label><span style={N_LABEL}>Tier</span><select value={c.tier} onChange={up('tier')} style={N_INPUT}>
            <option value="A">A · every 30 days</option><option value="B">B · every 60 days</option><option value="C">C · every 90 days</option><option value="">No cadence</option></select></label>
          <label><span style={N_LABEL}>Email</span><input type="email" value={c.email} onChange={up('email')} style={N_INPUT} /></label>
          <label><span style={N_LABEL}>Phone</span><input type="tel" value={c.phone} onChange={up('phone')} style={N_INPUT} /></label>
          <label><span style={N_LABEL}>Title</span><input value={c.title} onChange={up('title')} style={N_INPUT} /></label>
          <label><span style={N_LABEL}>Markets</span><input value={c.markets} onChange={up('markets')} style={N_INPUT} placeholder="e.g. DFW, Oklahoma" /></label>
        </div>
        {dupe && <div style={{ fontSize: 12, color: 'var(--warn)', marginTop: 10 }}>{dupe.name || 'A contact'} at {dupe.firm || 'another firm'} already uses this email.</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button type="button" style={N_BTN} onClick={onClose}>Cancel</button>
          <button type="button" style={N_PRIMARY} onClick={save}>Add contact</button>
        </div>
      </div>
    </div>);
}

/* ── CSV ── */
function netParseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  if (rows.length < 2) return [];
  const h = rows[0].map((x) => nm(x));
  return rows.slice(1).filter((r) => r.some((v) => v.trim())).map((r) => { const o = {}; h.forEach((k, i) => { o[k] = (r[i] || '').trim(); }); return o; });
}
function typeFromText(s) {
  const t = nm(s);
  if (!t) return null;
  if (/lender|bank|life co|agency|debt fund/.test(t) && !/broker/.test(t)) return 'lender';
  if (/debt|mortgage|capital markets|financ/.test(t)) return 'debt';
  if (/equity/.test(t)) return 'equity';
  if (/sales|investment|broker|listing/.test(t)) return 'sales';
  return 'other';
}

/* ── Main view ── */
function NetworkView({ contacts, deals, onAddContact, onPatchContact, onPatchDeal, onOpenDeal }) {
  const acts = useActivities();
  const [tab, setTab] = useStateN(() => { try { return localStorage.getItem('altus_network_tab') || 'followups'; } catch (e) { return 'followups'; } });
  useEffectN(() => { try { localStorage.setItem('altus_network_tab', tab); } catch (e) {} }, [tab]);
  const [q, setQ] = useStateN('');
  const [fType, setFType] = useStateN('');
  const [fTier, setFTier] = useStateN('');
  const [openId, setOpenId] = useStateN(null);
  const [adding, setAdding] = useStateN(false);
  const [quick, setQuick] = useStateN(null);
  const [sort, setSort] = useStateN({ key: 'due', dir: 1 });
  const [range, setRange] = useStateN(30);
  const [actType, setActType] = useStateN('');
  const [msg, setMsg] = useStateN('');
  const importRef = useRefN(null);

  const timeline = useMemoN(() => buildTimeline(acts, deals, contacts), [acts, deals, contacts]);
  const rs = useMemoN(() => relationshipState(contacts, timeline), [contacts, timeline]);
  const contactsById = useMemoN(() => { const m = {}; contacts.forEach((c) => { m[c.id] = c; }); return m; }, [contacts]);
  const dealsBy = useMemoN(() => { const m = {}; contacts.forEach((c) => { m[c.id] = dealsForContact(c, deals); }); return m; }, [contacts, deals]);

  const matches = (c) => {
    if (fType && (c.type || '') !== fType) return false;
    if (fTier && (fTier === 'none' ? NET_TIERS[c.tier] : c.tier !== fTier)) return false;
    if (q) {
      const s = nm(q);
      if (![c.name, c.firm, c.email, c.markets, c.title, (c.tags || []).join(' ')].some((v) => nm(v).includes(s))) return false;
    }
    return true;
  };
  const shown = contacts.filter(matches);

  const logActivity = (contact, a) => {
    const ts = new Date().toISOString();
    if (a.dealId && a.type === 'call' && onPatchDeal) {
      const d = deals.find((x) => x.id === a.dealId);
      const log = Array.isArray(d && d.callLog) ? d.callLog : [];
      onPatchDeal(a.dealId, { callLog: [{ id: uid('call_'), ts, note: a.note, brokerName: contact.name || '', brokerFirm: contact.firm || '', contactId: contact.id, kind: 'call' }, ...log] });
    } else {
      AltusActivities.add({ id: uid('act_'), ts, type: a.type, contactId: contact.id, dealId: a.dealId, note: a.note, brokerName: contact.name || '', brokerFirm: contact.firm || '' });
    }
    const ids = Array.isArray(contact.dealIds) ? contact.dealIds : [];
    onPatchContact(contact.id, { lastActivity: todayISO(), nextFollowUp: a.nextFollowUp || null,
      ...(a.dealId && !ids.includes(a.dealId) ? { dealIds: [...ids, a.dealId] } : {}) });
    setMsg(ACT_TYPES.find((t) => t.key === a.type).label + ' logged for ' + (contact.name || 'contact'));
  };
  useEffectN(() => { if (!msg) return; const t = setTimeout(() => setMsg(''), 3000); return () => clearTimeout(t); }, [msg]);
  const snooze = (c, days) => onPatchContact(c.id, { nextFollowUp: addDays(todayISO(), days) });

  const exportContacts = () => window.downloadCSV(shown.map((c) => {
    const s = rs[c.id], f = dealFunnel(dealsBy[c.id] || []);
    return { Name: c.name || '', Firm: c.firm || '', Title: c.title || '', Type: (typeMeta(c.type) || {}).label || '', Tier: c.tier || '', Email: c.email || '', Phone: c.phone || '',
      Markets: c.markets || '', Tags: (c.tags || []).join('; '), 'Last Touch': s && s.last ? isoDay(s.last) : '', 'Next Follow-Up': s && s.due ? isoDay(s.due) : '',
      'Deals Sent': f.sent, LOIs: f.loi, Closed: f.closed, Notes: c.notes || '' };
  }), 'altus-network.csv');
  const importCSV = (file) => {
    const r = new FileReader();
    r.onload = (e) => {
      const rows = netParseCSV(String(e.target.result || ''));
      const seen = new Set(contacts.map((c) => nm(c.email)).filter(Boolean));
      let n = 0;
      rows.forEach((row) => {
        const name = row['name'] || row['contact name'] || [row['first name'], row['last name']].filter(Boolean).join(' ');
        const email = row['email'] || row['e-mail address'] || row['email address'] || '';
        if (!name && !email) return;
        if (email && seen.has(nm(email))) return;
        seen.add(nm(email));
        const tier = String(row['tier'] || '').toUpperCase();
        onAddContact({ id: uid('c-'), name, email, firm: row['firm'] || row['company'] || row['company name'] || '', title: row['title'] || row['job title'] || '',
          phone: row['phone'] || row['business phone'] || row['mobile phone'] || '', markets: row['markets'] || row['markets covered'] || '',
          type: typeFromText(row['type'] || row['category'] || row['title'] || row['job title']), tier: NET_TIERS[tier] ? tier : null,
          tags: String(row['tags'] || '').split(/[;,]/).map((t) => t.trim()).filter(Boolean), notes: row['notes'] || '', dealIds: [], dateAdded: todayISO(), lastActivity: row['last touch'] || row['last activity'] || '' });
        n++;
      });
      setMsg('Imported ' + n + ' new contact' + (n === 1 ? '' : 's') + (rows.length - n ? ' · ' + (rows.length - n) + ' skipped (duplicate email or blank)' : ''));
    };
    r.readAsText(file);
  };

  // KPIs
  const tiered = contacts.filter((c) => NET_TIERS[c.tier]);
  const overdue = contacts.filter((c) => rs[c.id] && rs[c.id].due && rs[c.id].dueIn < 0);
  const dueWeek = contacts.filter((c) => rs[c.id] && rs[c.id].due && rs[c.id].dueIn >= 0 && rs[c.id].dueIn <= 7);
  const touched30 = contacts.filter((c) => rs[c.id] && rs[c.id].last && daysFrom(rs[c.id].last) <= 30);
  const untiered = contacts.filter((c) => !NET_TIERS[c.tier]);
  const kpi = (label, v, sub, color, onClick) => (
    <button type="button" onClick={onClick} style={{ flex: '1 1 150px', textAlign: 'left', padding: '12px 14px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--panel)', cursor: onClick ? 'pointer' : 'default', fontFamily: 'var(--font)' }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted)' }}>{label}</div>
      <div className="num" style={{ fontSize: 22, fontWeight: 700, color: color || 'var(--ink)', marginTop: 2 }}>{v}</div>
      <div style={{ fontSize: 11, color: 'var(--faint)' }}>{sub}</div>
    </button>);

  const quickRow = (c) => quick === c.id && (
    <div style={{ padding: '4px 14px 12px 56px' }}>
      <LogForm contact={c} deals={deals} contactDeals={dealsBy[c.id] || []} onCancel={() => setQuick(null)} onLog={(a) => { logActivity(c, a); setQuick(null); }} />
    </div>);

  const followRow = (c) => {
    const s = rs[c.id];
    return (
      <div key={c.id} style={{ borderTop: '1px solid var(--line)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,2fr) 70px 40px minmax(120px,1fr) 120px auto', gap: 10, alignItems: 'center', padding: '9px 14px' }}>
          <button type="button" onClick={() => setOpenId(c.id)} style={{ display: 'flex', gap: 10, alignItems: 'center', border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', minWidth: 0, fontFamily: 'var(--font)' }}>
            <NetAvatar name={c.name} />
            <span style={{ minWidth: 0 }}><span className="clip" style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{c.name || c.email}</span>
              <span className="clip" style={{ display: 'block', fontSize: 11.5, color: 'var(--muted)' }}>{c.firm || '—'}</span></span>
          </button>
          <TypeChip type={c.type} />
          <TierChip tier={c.tier} />
          <span style={{ fontSize: 12, color: 'var(--slate)' }}>Last: <LastText st={s} /></span>
          <span style={{ fontSize: 12 }}><DueText st={s} /></span>
          <span style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            {c.email && <a href={'mailto:' + c.email} title={'Email ' + c.email} onClick={() => setQuick(c.id)} style={{ ...N_BTN, height: 28, padding: '0 9px' }}><Icon name="mail" size={13} /></a>}
            <button type="button" style={{ ...N_BTN, height: 28 }} onClick={() => setQuick(quick === c.id ? null : c.id)}>Log</button>
            <select value="" onChange={(e) => e.target.value && snooze(c, Number(e.target.value))} aria-label="Snooze" style={{ ...N_INPUT, width: 'auto', height: 28, fontSize: 12, padding: '0 6px' }}>
              <option value="">Snooze</option><option value="7">1 week</option><option value="14">2 weeks</option><option value="30">1 month</option></select>
          </span>
        </div>
        {quickRow(c)}
      </div>);
  };

  const section = (title, list, empty, tone) => (
    <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', background: 'var(--panel-2)' }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: tone }} />
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{title}</span>
        <span className="num" style={{ fontSize: 12, color: 'var(--muted)' }}>{list.length}</span>
      </div>
      {list.length ? list.map(followRow) : <div style={{ padding: '12px 14px', fontSize: 12.5, color: 'var(--muted)', borderTop: '1px solid var(--line)' }}>{empty}</div>}
    </div>);

  const byDue = (a, b) => (rs[a.id].due || 0) - (rs[b.id].due || 0);
  const fu = shown.filter((c) => rs[c.id] && rs[c.id].due);
  const fOver = fu.filter((c) => rs[c.id].dueIn < 0).sort(byDue);
  const fWeek = fu.filter((c) => rs[c.id].dueIn >= 0 && rs[c.id].dueIn <= 7).sort(byDue);
  const fMonth = fu.filter((c) => rs[c.id].dueIn > 7 && rs[c.id].dueIn <= 30).sort(byDue);
  const [showUntiered, setShowUntiered] = useStateN(12);
  const fUntiered = shown.filter((c) => !NET_TIERS[c.tier] && !c.nextFollowUp);

  // contacts table
  const val = (c, k) => {
    const s = rs[c.id], f = dealFunnel(dealsBy[c.id] || []);
    if (k === 'due') return s && s.due ? s.due.getTime() : Infinity;
    if (k === 'last') return s && s.last ? -s.last.getTime() : Infinity;
    if (k === 'deals') return -f.sent;
    if (k === 'tier') return c.tier || 'Z';
    return nm(c[k]) || '~';
  };
  const sorted = shown.slice().sort((a, b) => { const x = val(a, sort.key), y = val(b, sort.key); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
  const th = (k, label, align) => (
    <button type="button" onClick={() => setSort({ key: k, dir: sort.key === k ? -sort.dir : 1 })}
      style={{ border: 'none', background: 'none', padding: '8px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: sort.key === k ? 'var(--accent)' : 'var(--muted)', cursor: 'pointer', textAlign: align || 'left', fontFamily: 'var(--font)' }}>
      {label}{sort.key === k ? (sort.dir > 0 ? ' ↑' : ' ↓') : ''}</button>);
  const tcols = 'minmax(200px,1.6fr) minmax(130px,1fr) 74px 50px minmax(110px,1fr) 92px 120px 110px';

  // firms
  const firms = useMemoN(() => {
    const m = {};
    shown.forEach((c) => {
      const k = firmKey(c.firm);
      const f = m[k] || (m[k] = { firm: k, names: {}, contacts: [], deals: new Map(), last: null, types: new Set() });
      const label = (c.firm || 'No firm').trim();
      f.names[label] = (f.names[label] || 0) + 1;
      f.contacts.push(c);
      if (c.type) f.types.add(c.type);
      (dealsBy[c.id] || []).forEach((d) => f.deals.set(d.id, d));
      const l = rs[c.id] && rs[c.id].last;
      if (l && (!f.last || l > f.last)) f.last = l;
    });
    // show the shortest common spelling of the firm's name
    return Object.values(m).map((f) => ({ ...f, firm: Object.keys(f.names).sort((a, b) => f.names[b] - f.names[a] || a.length - b.length)[0], funnel: dealFunnel([...f.deals.values()]) })).sort((a, b) => b.funnel.sent - a.funnel.sent || b.contacts.length - a.contacts.length);
  }, [shown, dealsBy, rs]);
  const [openFirm, setOpenFirm] = useStateN(null);

  // activity
  const cutoff = range ? Date.now() - range * nDay : 0;
  const actShown = timeline.filter((a) => (!range || (a.ts && new Date(a.ts).getTime() >= cutoff)) && (!actType || a.type === actType) &&
    (!q || [a.note, a.brokerName, a.brokerFirm, a.dealName, a.contactId && (contactsById[a.contactId] || {}).name].some((v) => nm(v).includes(nm(q)))));
  const exportActivity = () => window.downloadCSV(actShown.map((a) => {
    const c = a.contactId ? contactsById[a.contactId] : null;
    const name = (c && c.name) || a.brokerName || '';
    const parts = name.trim().split(/\s+/);
    return { 'First Name': parts[0] || '', 'Last Name': parts.slice(1).join(' '), Email: (c && c.email) || '', Phone: (c && c.phone) || '', 'Company Name': (c && c.firm) || a.brokerFirm || '',
      Type: a.type, 'Property Name': a.dealName || a.propertyName || '', Metro: a.market || '', Notes: a.note || '', Date: a.ts ? new Date(a.ts).toLocaleDateString() : '' };
  }), 'altus-network-activity.csv');

  const TABS = [{ k: 'followups', l: 'Follow-ups', n: overdue.length + dueWeek.length }, { k: 'contacts', l: 'Contacts', n: contacts.length }, { k: 'firms', l: 'Firms' }, { k: 'activity', l: 'Activity' }];
  const open = openId ? contactsById[openId] : null;

  return (
    <div className="fade" style={{ padding: '24px 30px 60px', maxWidth: 1320, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 21, fontWeight: 700, color: 'var(--ink)' }}>Network</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13.5, color: 'var(--muted)' }}>Brokers and lenders · {contacts.length} contacts · {tiered.length} on a follow-up cadence</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" style={N_PRIMARY} onClick={() => setAdding(true)}><Icon name="plus" size={13} />Add contact</button>
          <input ref={importRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) importCSV(f); e.target.value = ''; }} />
          <button type="button" style={N_BTN} onClick={() => importRef.current && importRef.current.click()} title="CSV with Name, Firm, Email, Phone, Type, Tier, Markets (an Outlook contacts export works)"><Icon name="upload" size={13} />Import CSV</button>
          <button type="button" style={N_BTN} onClick={tab === 'activity' ? exportActivity : exportContacts}><Icon name="download" size={13} />Export {tab === 'activity' ? 'activity' : 'contacts'}</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        {kpi('Overdue', overdue.length, 'past their cadence', overdue.length ? 'var(--neg)' : undefined, () => setTab('followups'))}
        {kpi('Due this week', dueWeek.length, 'next 7 days', dueWeek.length ? 'var(--warn)' : undefined, () => setTab('followups'))}
        {kpi('Touched · 30 days', touched30.length, contacts.length ? Math.round(touched30.length / contacts.length * 100) + '% of the network' : '', 'var(--pos)')}
        {kpi('No tier yet', untiered.length, 'assign A, B or C', undefined, () => { setTab('followups'); })}
        {kpi('Activity · 30 days', timeline.filter((a) => a.ts && Date.now() - new Date(a.ts).getTime() <= 30 * nDay).length, 'calls, emails, meetings', undefined, () => { setTab('activity'); setRange(30); })}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', borderBottom: '1px solid var(--line)', marginBottom: 14 }}>
        {TABS.map((t) => (
          <button key={t.k} type="button" onClick={() => setTab(t.k)} style={{ border: 'none', background: 'none', padding: '10px 4px', marginRight: 10, marginBottom: -1, cursor: 'pointer', fontFamily: 'var(--font)',
            borderBottom: tab === t.k ? '2px solid var(--accent)' : '2px solid transparent', color: tab === t.k ? 'var(--accent)' : 'var(--muted)', fontSize: 13.5, fontWeight: tab === t.k ? 600 : 500 }}>
            {t.l}{t.n ? <span className="num" style={{ marginLeft: 6, fontSize: 11, padding: '1px 6px', borderRadius: 9, background: tab === t.k ? 'var(--accent-soft)' : 'var(--panel-3)' }}>{t.n}</span> : null}</button>))}
        <span style={{ flex: 1 }} />
        <div style={{ position: 'relative', width: 240, marginBottom: 6 }}>
          <span style={{ position: 'absolute', left: 9, top: 9, color: 'var(--faint)' }}><Icon name="search" size={14} /></span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, firm, market, tag…" style={{ ...N_INPUT, height: 32, paddingLeft: 30 }} aria-label="Search" />
        </div>
        {tab !== 'activity' ? <>
          <select value={fType} onChange={(e) => setFType(e.target.value)} style={{ ...N_INPUT, width: 'auto', height: 32, marginBottom: 6 }} aria-label="Type">
            <option value="">All types</option>{NET_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
          <select value={fTier} onChange={(e) => setFTier(e.target.value)} style={{ ...N_INPUT, width: 'auto', height: 32, marginBottom: 6 }} aria-label="Tier">
            <option value="">All tiers</option><option value="A">Tier A</option><option value="B">Tier B</option><option value="C">Tier C</option><option value="none">No tier</option></select>
        </> : <>
          <select value={actType} onChange={(e) => setActType(e.target.value)} style={{ ...N_INPUT, width: 'auto', height: 32, marginBottom: 6 }} aria-label="Activity type">
            <option value="">All activity</option>{ACT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}s</option>)}</select>
          <select value={range} onChange={(e) => setRange(Number(e.target.value))} style={{ ...N_INPUT, width: 'auto', height: 32, marginBottom: 6 }} aria-label="Date range">
            <option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option><option value={0}>All time</option></select>
        </>}
      </div>

      {msg && <div role="status" style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: 'var(--pos-soft)', color: 'var(--pos)', fontSize: 12.5, fontWeight: 600 }}>{msg}</div>}

      {tab === 'followups' && <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {section('Overdue', fOver, 'Nobody is past their cadence.', 'var(--neg)')}
        {section('Due this week', fWeek, 'Nothing due in the next 7 days.', 'var(--warn)')}
        {section('Coming up · next 30 days', fMonth, 'Nothing else due this month.', 'var(--accent)')}
        {fUntiered.length > 0 && <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 14px', background: 'var(--panel-2)' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>No tier yet</span>
            <span className="num" style={{ fontSize: 12, color: 'var(--muted)' }}>{fUntiered.length}</span>
            <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 6 }}>Pick a type and tier to start a cadence: A every 30 days, B every 60, C every 90.</span>
            <span style={{ flex: 1 }} />
            <BulkTierBtn count={fUntiered.length} onConfirm={() => fUntiered.forEach((c) => onPatchContact(c.id, { tier: 'C' }))} />
          </div>
          {fUntiered.slice(0, showUntiered).map((c) => (
            <div key={c.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px,2fr) minmax(150px,1fr) auto', gap: 10, alignItems: 'center', padding: '8px 14px', borderTop: '1px solid var(--line)' }}>
              <button type="button" onClick={() => setOpenId(c.id)} style={{ display: 'flex', gap: 10, alignItems: 'center', border: 'none', background: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', minWidth: 0, fontFamily: 'var(--font)' }}>
                <NetAvatar name={c.name} size={28} />
                <span style={{ minWidth: 0 }}><span className="clip" style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>{c.name || c.email}</span>
                  <span className="clip" style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{[c.firm, c.markets].filter(Boolean).join(' · ') || '—'}</span></span>
              </button>
              <select value={c.type || ''} onChange={(e) => onPatchContact(c.id, { type: e.target.value || null })} style={{ ...N_INPUT, height: 28, fontSize: 12 }} aria-label={'Type for ' + c.name}>
                <option value="">Type…</option>{NET_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
              <NetSeg value={c.tier || ''} onChange={(v) => onPatchContact(c.id, { tier: v })} options={[{ value: 'A', label: 'A' }, { value: 'B', label: 'B' }, { value: 'C', label: 'C' }]} />
            </div>))}
          {fUntiered.length > showUntiered && <button type="button" onClick={() => setShowUntiered(showUntiered + 40)} style={{ ...N_BTN, margin: '10px 14px' }}>Show {Math.min(40, fUntiered.length - showUntiered)} more</button>}
        </div>}
      </div>}

      {tab === 'contacts' && <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, overflowX: 'auto' }}>
        <div style={{ minWidth: 960 }}>
          <div style={{ display: 'grid', gridTemplateColumns: tcols, background: 'var(--panel-2)', borderBottom: '1px solid var(--line)' }}>
            {th('name', 'Contact')}{th('firm', 'Firm')}{th('type', 'Type')}{th('tier', 'Tier')}{th('markets', 'Markets')}{th('deals', 'Deals')}{th('last', 'Last touch')}{th('due', 'Follow-up')}
          </div>
          {sorted.map((c) => {
            const f = dealFunnel(dealsBy[c.id] || []);
            return (
              <div key={c.id} onClick={() => setOpenId(c.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(c.id); }}
                style={{ display: 'grid', gridTemplateColumns: tcols, alignItems: 'center', borderTop: '1px solid var(--line)', cursor: 'pointer', fontSize: 12.5 }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--panel-2)'; }} onMouseLeave={(e) => { e.currentTarget.style.background = ''; }}>
                <div style={{ display: 'flex', gap: 9, alignItems: 'center', padding: '8px 10px', minWidth: 0 }}>
                  <NetAvatar name={c.name} size={28} />
                  <span style={{ minWidth: 0 }}><span className="clip" style={{ display: 'block', fontWeight: 600, color: 'var(--ink)' }}>{c.name || c.email}</span>
                    <span className="clip" style={{ display: 'block', fontSize: 11, color: 'var(--muted)' }}>{c.title || c.email || ''}</span></span>
                </div>
                <div className="clip" style={{ padding: '0 10px', color: 'var(--slate)' }}>{c.firm || '—'}</div>
                <div style={{ padding: '0 10px' }}><TypeChip type={c.type} /></div>
                <div style={{ padding: '0 10px' }}><TierChip tier={c.tier} /></div>
                <div className="clip" style={{ padding: '0 10px', color: 'var(--muted)' }}>{c.markets || '—'}</div>
                <div className="num" style={{ padding: '0 10px', color: 'var(--ink)' }}>{f.sent || '—'}{f.loi ? <span style={{ fontSize: 10.5, color: 'var(--warn)', marginLeft: 5 }}>{f.loi} LOI</span> : null}</div>
                <div style={{ padding: '0 10px', color: 'var(--slate)' }}><LastText st={rs[c.id]} /></div>
                <div style={{ padding: '0 10px' }}><DueText st={rs[c.id]} /></div>
              </div>);
          })}
          {!sorted.length && <div style={{ padding: 18, fontSize: 13, color: 'var(--muted)' }}>No contacts match.</div>}
        </div>
      </div>}

      {tab === 'firms' && <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,2fr) 90px minmax(140px,1.2fr) 80px 70px 80px 70px 110px', background: 'var(--panel-2)', borderBottom: '1px solid var(--line)' }}>
          {['Firm', 'Contacts', 'Coverage', 'Deals', 'LOIs', 'Contract', 'Closed', 'Last touch'].map((h) =>
            <div key={h} style={{ padding: '8px 10px', fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)' }}>{h}</div>)}
        </div>
        {firms.map((f) => (
          <div key={f.firm} style={{ borderTop: '1px solid var(--line)' }}>
            <div role="button" tabIndex={0} onClick={() => setOpenFirm(openFirm === f.firm ? null : f.firm)} onKeyDown={(e) => { if (e.key === 'Enter') setOpenFirm(openFirm === f.firm ? null : f.firm); }}
              style={{ display: 'grid', gridTemplateColumns: 'minmax(200px,2fr) 90px minmax(140px,1.2fr) 80px 70px 80px 70px 110px', alignItems: 'center', cursor: 'pointer', fontSize: 12.5 }}>
              <div style={{ padding: '10px', fontWeight: 600, color: 'var(--ink)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ display: 'inline-block', transform: openFirm === f.firm ? 'rotate(90deg)' : 'none', transition: 'transform .12s', color: 'var(--muted)', fontSize: 9 }}>▶</span>{f.firm}</div>
              <div className="num" style={{ padding: '0 10px' }}>{f.contacts.length}</div>
              <div style={{ padding: '0 10px', display: 'flex', gap: 4, flexWrap: 'wrap' }}>{[...f.types].map((t) => <TypeChip key={t} type={t} />)}{!f.types.size && <span style={{ color: 'var(--faint)' }}>—</span>}</div>
              <div className="num" style={{ padding: '0 10px' }}>{f.funnel.sent || '—'}</div>
              <div className="num" style={{ padding: '0 10px', color: f.funnel.loi ? 'var(--warn)' : undefined }}>{f.funnel.loi || '—'}</div>
              <div className="num" style={{ padding: '0 10px' }}>{f.funnel.contract || '—'}</div>
              <div className="num" style={{ padding: '0 10px', color: f.funnel.closed ? 'var(--pos)' : undefined }}>{f.funnel.closed || '—'}</div>
              <div style={{ padding: '0 10px', color: 'var(--slate)' }}>{f.last ? daysFrom(f.last) + 'd ago' : 'never'}</div>
            </div>
            {openFirm === f.firm && <div style={{ padding: '0 10px 10px 30px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {f.contacts.map((c) => (
                <button key={c.id} type="button" onClick={() => setOpenId(c.id)} style={{ display: 'flex', gap: 8, alignItems: 'center', border: '1px solid var(--line)', borderRadius: 8, padding: '6px 10px', background: 'var(--panel)', cursor: 'pointer', fontFamily: 'var(--font)' }}>
                  <NetAvatar name={c.name} size={24} /><span style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 600 }}>{c.name || c.email}</span><TierChip tier={c.tier} />
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}><DueText st={rs[c.id]} /></span>
                </button>))}
            </div>}
          </div>))}
      </div>}

      {tab === 'activity' && <div style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, padding: '4px 16px 10px' }}>
        {actShown.length ? actShown.slice(0, 300).map((a) => <TimelineItem key={a.source + a.id} a={a} contactsById={contactsById} showContact onOpenDeal={onOpenDeal} onDelete={(id) => AltusActivities.remove(id)} />)
          : <div style={{ padding: '14px 0', fontSize: 13, color: 'var(--muted)' }}>No activity in this range.</div>}
        {actShown.length > 300 && <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0' }}>Showing the latest 300 of {actShown.length}. Export for the full list.</div>}
      </div>}

      {open && <NetContactDrawer contact={open} deals={deals} st={rs[open.id]} timeline={timeline} contactsById={contactsById}
        onClose={() => setOpenId(null)} onPatch={onPatchContact} onLog={logActivity} onOpenDeal={(id) => { setOpenId(null); onOpenDeal(id); }}
        onDeleteActivity={(id) => AltusActivities.remove(id)} />}
      {adding && <NetAddContact contacts={contacts} onAdd={onAddContact} onClose={() => setAdding(false)} />}
    </div>);
}

Object.assign(window, { NetworkView, AltusActivities, NET_TYPES, NET_TIERS });
