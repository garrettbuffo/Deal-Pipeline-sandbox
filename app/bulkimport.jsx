// app/bulkimport.jsx — "Import deals from folder": pick (or drop) a folder holding one subfolder
// per deal. Each deal's OM, T-12 and rent roll are recognized by file name (adjustable before
// importing), then imported one deal at a time: the deal is created from its OM, the rent roll and
// T-12 are applied, the expense playbook is filled, every file goes to the deal's Document Vault,
// and the deal lands in the Claude Underwrite stage for review. The work itself is done by
// importDealFromFiles in app.jsx (passed in as onImportDeal).
const { useState: useStateB, useRef: useRefB } = React;

const BI_OK = /\.(pdf|xlsx|xls|xlsm|csv|txt|docx?|png|jpe?g)$/i;
const BI_SKIP = /(^|\/)(\.|~\$|thumbs\.db$|desktop\.ini$)/i;
function biGuess(name) {
  const n = String(name || '').toLowerCase();
  if (/(rent ?roll|rentroll|\brr\b|unit ?mix|tenant list)/.test(n)) return 'Rent Roll';
  if (/(t-?12|t12|trailing|operating statement|income statement|p&l|p & l|profit|operating history|financials?)/.test(n)) return 'T-12';
  if (/(\bom\b|offering|memorandum|marketing|flyer|brochure|package|teaser)/.test(n)) return 'OM';
  if (/(costar|comp ?set|sale comps|lease comps)/.test(n)) return 'CoStar';
  return 'Other';
}
const biExt = (f) => (String(f.name).split('.').pop() || '').toLowerCase();
const biIsSheet = (f) => /^(xlsx|xls|xlsm|csv)$/.test(biExt(f));

// Files (with relative paths) → one group per deal folder, with the OM / T-12 / rent roll picked.
function biGroup(entries) {
  const files = entries.filter((e) => BI_OK.test(e.file.name) && !BI_SKIP.test(e.path));
  const split = files.map((e) => ({ ...e, parts: e.path.split('/').filter(Boolean) }));
  const hasSub = split.some((e) => e.parts.length >= 3);
  const groups = {};
  split.forEach((e) => {
    // root/deal/file → deal; root/file (no subfolders anywhere) → root is the deal
    const key = hasSub ? (e.parts.length >= 3 ? e.parts[1] : '(loose files)') : (e.parts.length >= 2 ? e.parts[0] : 'Deal');
    (groups[key] = groups[key] || []).push(e.file);
  });
  return Object.keys(groups).sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).map((key) => {
    const fs = groups[key].map((f) => ({ file: f, category: biGuess(f.name) }));
    const pick = (cat, prefer) => {
      const c = fs.filter((x) => x.category === cat);
      c.sort((a, b) => (prefer(b.file) - prefer(a.file)) || (b.file.size - a.file.size));
      return c[0] ? c[0].file : null;
    };
    let om = pick('OM', (f) => (biExt(f) === 'pdf' ? 1 : 0));
    if (!om) { const pdfs = fs.filter((x) => x.category === 'Other' && biExt(x.file) === 'pdf').sort((a, b) => b.file.size - a.file.size); om = pdfs[0] ? pdfs[0].file : null; }
    const t12 = pick('T-12', (f) => (biIsSheet(f) ? 1 : 0));
    const rr = pick('Rent Roll', (f) => (biIsSheet(f) ? 1 : 0));
    return { key, folder: key, name: key === '(loose files)' ? 'Loose files' : key, nameEdited: false, include: key !== '(loose files)', files: fs.map((x) => x.file), om, t12, rr, status: 'ready', step: '', id: null };
  });
}

// Drag-and-drop folders: walk the dropped entries into { file, path }.
async function biWalk(items) {
  const out = [];
  const readAll = (reader) => new Promise((res) => { const acc = []; const next = () => reader.readEntries((ents) => { if (!ents.length) res(acc); else { acc.push(...ents); next(); } }, () => res(acc)); next(); });
  const walk = async (entry, prefix) => {
    if (!entry) return;
    if (entry.isFile) { await new Promise((res) => entry.file((f) => { out.push({ file: f, path: prefix + f.name }); res(); }, () => res())); return; }
    if (entry.isDirectory) { const kids = await readAll(entry.createReader()); for (const k of kids) await walk(k, prefix + entry.name + '/'); }
  };
  for (const it of Array.from(items || [])) await walk(it.webkitGetAsEntry ? it.webkitGetAsEntry() : null, '');
  return out;
}

const BI_BTN = { display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 14px', border: '1px solid var(--line-2)', borderRadius: 8,
  background: 'var(--panel)', color: 'var(--slate)', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' };
const BI_PRIMARY = { ...BI_BTN, border: 'none', background: 'var(--accent)', color: '#fff' };
const BI_SEL = { height: 30, border: '1px solid var(--line-2)', borderRadius: 6, padding: '0 6px', background: 'var(--panel)', fontSize: 12, color: 'var(--ink)', fontFamily: 'var(--font)', maxWidth: '100%' };

function BulkImportModal({ onClose, onImportDeal, onOpen }) {
  const [groups, setGroups] = useStateB([]);
  const [running, setRunning] = useStateB(false);
  const [done, setDone] = useStateB(false);
  const [drag, setDrag] = useStateB(false);
  const dirRef = useRefB(null);
  const upd = (key, ch) => setGroups((gs) => gs.map((g) => (g.key === key ? { ...g, ...ch } : g)));
  const load = (entries) => { setGroups(biGroup(entries)); setDone(false); };
  const chosen = groups.filter((g) => g.include);

  const run = async () => {
    setRunning(true);
    for (const g of groups) {
      if (!g.include) continue;
      upd(g.key, { status: 'working', step: 'Starting' });
      try {
        const others = g.files.filter((f) => f !== g.om && f !== g.t12 && f !== g.rr).map((f) => ({ file: f, category: biGuess(f.name) === 'OM' ? 'Other' : biGuess(f.name) }));
        const id = await onImportDeal({ name: g.name, nameEdited: g.nameEdited, folder: g.folder, om: g.om, t12: g.t12, rr: g.rr, others }, (step) => upd(g.key, { step }));
        upd(g.key, { status: 'done', step: 'Imported', id });
      } catch (e) {
        upd(g.key, { status: 'error', step: String((e && e.message) || e).slice(0, 140) });
      }
    }
    setRunning(false); setDone(true);
  };

  const fileSel = (g, field, cat) => (
    <select value={g[field] ? g.files.indexOf(g[field]) : -1} disabled={running || done} onChange={(e) => upd(g.key, { [field]: Number(e.target.value) >= 0 ? g.files[Number(e.target.value)] : null })} style={BI_SEL} aria-label={cat + ' for ' + g.name}>
      <option value={-1}>None</option>
      {g.files.map((f, i) => <option key={i} value={i}>{f.name}</option>)}
    </select>);
  const badge = (g) => {
    const m = { ready: ['Ready', 'var(--slate)', 'var(--panel-3)'], working: [g.step || 'Working', 'var(--accent-2)', 'var(--accent-soft)'], done: ['Imported', 'var(--pos)', 'var(--pos-soft)'], error: ['Error', 'var(--neg)', 'var(--neg-soft)'] }[g.status];
    return <span title={g.status === 'error' ? g.step : undefined} style={{ fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 999, color: m[1], background: m[2], whiteSpace: 'nowrap' }}>{g.status === 'working' ? '… ' + m[0] : m[0]}</span>;
  };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '6vh' }}>
      <div onClick={() => { if (!running) onClose(); }} style={{ position: 'absolute', inset: 0, background: 'rgba(11,25,45,.32)' }} />
      <div role="dialog" aria-label="Import deals from folder" style={{ position: 'relative', width: 'min(1040px,96vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column',
        background: 'var(--panel)', borderRadius: 14, boxShadow: 'var(--shadow-lg)', animation: 'modalIn .18s both' }}>
        <div style={{ padding: '18px 22px 12px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--ink)' }}>Import deals from folder</div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
            Choose a folder with one subfolder per deal. Each deal is created from its OM, its rent roll and T-12 are applied, the expense playbook is filled in, every file is saved to the deal's Document Vault and the deal goes to the <b style={{ color: '#c15f3c' }}>Claude UW</b> (Claude underwrite) stage for your review.
          </div>
        </div>

        <div style={{ padding: '14px 22px', overflowY: 'auto', flex: 1 }}>
          {!groups.length ? (
            <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
              onDrop={async (e) => { e.preventDefault(); setDrag(false); load(await biWalk(e.dataTransfer.items)); }}
              style={{ border: '2px dashed ' + (drag ? 'var(--accent)' : 'var(--line-2)'), borderRadius: 12, padding: '40px 20px', textAlign: 'center', background: drag ? 'var(--accent-soft)' : 'var(--panel-2)' }}>
              <Icon name="upload" size={22} style={{ color: 'var(--accent)' }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginTop: 8 }}>Drop a deals folder here</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 14px' }}>e.g. "Deals to UW" with a subfolder per property · PDF, Excel and CSV files</div>
              <input ref={dirRef} type="file" multiple webkitdirectory="" directory="" style={{ display: 'none' }}
                onChange={(e) => { const fl = Array.from(e.target.files || []); load(fl.map((f) => ({ file: f, path: f.webkitRelativePath || f.name }))); e.target.value = ''; }} />
              <button type="button" style={BI_PRIMARY} onClick={() => dirRef.current && dirRef.current.click()}>Choose folder</button>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5, minWidth: 860 }}>
                <thead><tr>{['', 'Deal', 'OM', 'T-12', 'Rent Roll', 'Other files', 'Status'].map((h, i) =>
                  <th key={i} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 10, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted)', borderBottom: '1px solid var(--line)' }}>{h}</th>)}</tr></thead>
                <tbody>{groups.map((g) => {
                  const others = g.files.filter((f) => f !== g.om && f !== g.t12 && f !== g.rr).length;
                  return (
                    <tr key={g.key} style={{ borderBottom: '1px solid var(--line)', opacity: g.include ? 1 : 0.5 }}>
                      <td style={{ padding: '6px 8px' }}><input type="checkbox" checked={g.include} disabled={running || done} onChange={(e) => upd(g.key, { include: e.target.checked })} aria-label={'Import ' + g.name} /></td>
                      <td style={{ padding: '6px 8px', minWidth: 180 }}>
                        <input value={g.name} disabled={running || done} onChange={(e) => upd(g.key, { name: e.target.value, nameEdited: true })}
                          style={{ width: '100%', height: 30, border: '1px solid var(--line-2)', borderRadius: 6, padding: '0 8px', fontSize: 12.5, fontFamily: 'var(--font)', boxSizing: 'border-box' }} />
                        <div style={{ fontSize: 10.5, color: 'var(--faint)', marginTop: 2 }}>{g.nameEdited ? 'your name' : 'name from the OM if it has one'}</div>
                      </td>
                      <td style={{ padding: '6px 8px', maxWidth: 190 }}>{fileSel(g, 'om', 'OM')}</td>
                      <td style={{ padding: '6px 8px', maxWidth: 190 }}>{fileSel(g, 't12', 'T-12')}</td>
                      <td style={{ padding: '6px 8px', maxWidth: 190 }}>{fileSel(g, 'rr', 'Rent roll')}</td>
                      <td style={{ padding: '6px 8px', color: 'var(--muted)' }}>{others ? others + ' to vault' : '—'}</td>
                      <td style={{ padding: '6px 8px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{badge(g)}
                          {g.status === 'done' && g.id && <button type="button" onClick={() => onOpen(g.id)} style={{ border: 'none', background: 'none', color: 'var(--accent)', fontWeight: 600, cursor: 'pointer', fontSize: 12, fontFamily: 'var(--font)' }}>Open</button>}
                        </div>
                        {g.status === 'error' && <div style={{ fontSize: 10.5, color: 'var(--neg)', marginTop: 2 }}>{g.step}</div>}
                      </td>
                    </tr>);
                })}</tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 22px', borderTop: '1px solid var(--line)' }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>
            {running ? 'Importing one deal at a time. Keep this window open.'
              : done ? groups.filter((g) => g.status === 'done').length + ' imported' + (groups.some((g) => g.status === 'error') ? ' · ' + groups.filter((g) => g.status === 'error').length + ' with errors' : '') + '. They are in the Claude UW stage.'
              : groups.length ? chosen.length + ' of ' + groups.length + ' deals selected. Documents are read by Claude.' : ''}
          </span>
          {groups.length > 0 && !running && !done && <button type="button" style={BI_BTN} onClick={() => setGroups([])}>Choose another folder</button>}
          <button type="button" style={BI_BTN} disabled={running} onClick={onClose}>{done ? 'Close' : 'Cancel'}</button>
          {groups.length > 0 && !done && <button type="button" style={{ ...BI_PRIMARY, opacity: running || !chosen.length ? 0.6 : 1 }} disabled={running || !chosen.length} onClick={run}>
            {running ? 'Importing…' : 'Import ' + chosen.length + ' deal' + (chosen.length === 1 ? '' : 's')}</button>}
        </div>
      </div>
    </div>);
}

Object.assign(window, { BulkImportModal, biGroup });
