// app/vault.jsx — Document Vault on the deal page. Stores OMs, T-12s, Rent Rolls and
// any other deal documents in Supabase Storage (bucket "deal-docs"); metadata lives on
// deal.documents (jsonb, synced with the deal). Click a doc → right-side drawer viewer
// (PDF inline) with fullscreen + download. Drag-and-drop accepted any time.
const { useState: useSV, useEffect: useEffectV, useRef: useRefV } = React;

const DOC_CATS = ['OM', 'T-12', 'Rent Roll', 'CoStar', 'Other'];
const CAT_COLOR = { 'OM': '#2f6df0', 'T-12': '#6b46e0', 'Rent Roll': '#0c7a43', 'CoStar': '#b87214', 'Other': '#5b7088' };

function fmtBytes(n) {
  if (n == null) return '';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}
function docIcon(ext) {
  const e = (ext || '').toLowerCase();
  if (e === 'pdf') return 'doc';
  if (['xlsx', 'xls', 'xlsm', 'csv'].includes(e)) return 'chart';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(e)) return 'search';
  return 'doc';
}
const isPdf = (d) => (d.ext || '').toLowerCase() === 'pdf' || (d.type || '').includes('pdf');
const isImg = (d) => ['png', 'jpg', 'jpeg', 'gif', 'webp'].includes((d.ext || '').toLowerCase());
const isXls = (d) => ['xlsx','xls','xlsm','csv'].includes((d.ext || '').toLowerCase());

/* ---- Local file store (IndexedDB) ----
   Used when Supabase storage isn't connected, so documents can always be added.
   Files stay in this browser; metadata still travels with the deal. */
const LOCAL_DB = 'altus-docs', LOCAL_STORE = 'files';
function localDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(LOCAL_DB, 1);
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(LOCAL_STORE)) db.createObjectStore(LOCAL_STORE); };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error || new Error('IndexedDB unavailable'));
  });
}
// Live: every document goes to Supabase. The sandbox has no Supabase, so there (only) files are
// kept in this browser so the vault can be tried end to end.
const sandboxDocs = () => !!(window.ALTUS_CONFIG && window.ALTUS_CONFIG.SANDBOX);
async function localPut(file) {
  if (!sandboxDocs()) throw new Error('Local document storage is disabled — files must upload to Supabase.');
  const db = await localDB();
  const key = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  await new Promise((res, rej) => {
    const tx = db.transaction(LOCAL_STORE, 'readwrite');
    tx.objectStore(LOCAL_STORE).put(file, key);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
  return { path: 'local:' + key, local: true, name: file.name, ext, size: file.size, type: file.type || '', uploadedAt: new Date().toISOString() };
}
async function localGet(key) {
  const db = await localDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(LOCAL_STORE, 'readonly');
    const r = tx.objectStore(LOCAL_STORE).get(key);
    r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error);
  });
}
async function localDel(key) {
  try {
    const db = await localDB();
    const tx = db.transaction(LOCAL_STORE, 'readwrite');
    tx.objectStore(LOCAL_STORE).delete(key);
  } catch (e) {}
}
const isLocalDoc = (d) => !!d && (d.local || /^local:/.test(d.path || ''));
const localKey = (d) => (d.path || '').replace(/^local:/, '');

/* ---- Viewer drawer (half-window pop-out) ---- */
function DocViewer({ doc, onClose }) {
  const [url, setUrl] = useSV(null);
  const [err, setErr] = useSV(null);
  const [full, setFull] = useSV(false);
  const [excelSrc, setExcelSrc] = useSV(null);
  const cloud = window.AltusCloud;

  useEffectV(() => {
    let active = true, objUrl = null;
    setUrl(null); setErr(null);
    if (!doc) return;
    if (isLocalDoc(doc)) {
      localGet(localKey(doc)).then((blob) => {
        if (!active) return;
        if (!blob) { setErr('This file was added on another device or browser.'); return; }
        objUrl = URL.createObjectURL(blob); setUrl(objUrl);
      }).catch((e) => { if (active) setErr(String(e.message || e)); });
      return () => { active = false; if (objUrl) URL.revokeObjectURL(objUrl); };
    }
    if (!cloud || !cloud.signedDocUrl) { setErr('Cloud storage is not connected.'); return; }
    cloud.signedDocUrl(doc.path, 3600).then((u) => { if (active) setUrl(u); }).catch((e) => { if (active) setErr(String(e.message || e)); });
    return () => { active = false; };
  }, [doc && doc.path]);

  // Excel preview: once we have the signed URL, fetch + render via XLSX
  useEffectV(() => {
    if (!doc || !isXls(doc) || !url) { setExcelSrc(null); return; }
    let active = true;
    (async () => {
      try {
        if (!window.XLSX) return;
        const buf = await (await fetch(url)).arrayBuffer();
        const wb = window.XLSX.read(new Uint8Array(buf), { type: 'array' });
        const html = window.XLSX.utils.sheet_to_html(wb.Sheets[wb.SheetNames[0]], { id: 'xlp' });
        const srcdoc = `<!DOCTYPE html><html><head><style>*{box-sizing:border-box}body{font-family:-apple-system,sans-serif;font-size:12px;margin:0;padding:12px;color:#1a2433;overflow-x:auto}table{border-collapse:collapse;min-width:100%}td,th{border:1px solid #dde3ec;padding:4px 8px;white-space:nowrap;max-width:280px;overflow:hidden;text-overflow:ellipsis}tr:first-child td{background:#f0f4f8;font-weight:600;position:sticky;top:0;z-index:1}tr:nth-child(even) td{background:#f8fafc}</style></head><body>${html}</body></html>`;
        if (active) setExcelSrc(srcdoc);
      } catch(e) { /* fall through to download prompt */ }
    })();
    return () => { active = false; };
  }, [url]);

  useEffectV(() => {
    const onEsc = (e) => { if (e.key === 'Escape') { if (full) setFull(false); else onClose(); } };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [full]);

  const download = async () => {
    if (!url) return;
    try {
      const r = await fetch(url); const blob = await r.blob();
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = doc.name;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    } catch (e) { window.open(url, '_blank'); }
  };

  if (!doc) return null;
  const width = full ? '100vw' : 'min(52vw, 760px)';
  const cat = doc.category || 'Other';

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,32,.34)', zIndex: 80, animation: 'fadeIn .15s ease' }} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width, background: 'var(--panel)', zIndex: 81,
        boxShadow: '-12px 0 40px rgba(15,23,32,.22)', display: 'flex', flexDirection: 'column', transition: 'width .18s ease' }}>
        {/* header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderBottom: '1px solid var(--line)' }}>
          <span style={{ width: 30, height: 30, borderRadius: 7, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: (CAT_COLOR[cat] || '#5b7088') + '1a', color: CAT_COLOR[cat] || '#5b7088' }}>
            <Icon name={docIcon(doc.ext)} size={15} />
          </span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{doc.name}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{cat} · {fmtBytes(doc.size)}</div>
          </div>
          <button onClick={() => setFull((f) => !f)} title={full ? 'Exit full screen' : 'Full screen'} style={viewerBtn}>
            <Icon name={full ? 'close' : 'expand'} size={15} />
          </button>
          <button onClick={download} title="Download" style={viewerBtn}><Icon name="download" size={15} /></button>
          <button onClick={onClose} title="Close" style={viewerBtn}><Icon name="close" size={16} /></button>
        </div>
        {/* body */}
        <div style={{ flex: 1, minHeight: 0, background: 'var(--panel-3)', position: 'relative' }}>
          {err ?
            <Centered icon="close" title="Couldn’t open document" sub={err} /> :
          !url ?
            <Centered spinner title="Loading…" /> :
          isPdf(doc) ?
            <iframe title={doc.name} src={url} style={{ width: '100%', height: '100%', border: 'none' }} /> :
          isImg(doc) ?
            <div style={{ width: '100%', height: '100%', overflow: 'auto', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 18, boxSizing: 'border-box' }}>
                <img src={url} alt={doc.name} style={{ maxWidth: '100%', borderRadius: 8, boxShadow: 'var(--shadow)' }} />
              </div> :
          isXls(doc) ? (
            excelSrc
              ? <iframe title={doc.name} srcDoc={excelSrc} style={{ width:'100%', height:'100%', border:'none' }} />
              : <Centered spinner title="Loading spreadsheet…" />
          ) :
          <Centered icon="doc" title="Preview not available" sub="This file type can’t be shown inline — download to open it." action={<button onClick={download} style={primaryBtn}>Download file</button>} />}
        </div>
      </div>
    </>
  );
}
const viewerBtn = { width: 32, height: 32, flex: 'none', border: '1px solid var(--line-2)', background: 'var(--panel)', borderRadius: 7,
  cursor: 'pointer', color: 'var(--slate)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' };
const primaryBtn = { border: 'none', background: 'var(--accent)', color: '#fff', borderRadius: 8, padding: '9px 18px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font)' };
function Centered({ icon, spinner, title, sub, action }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 30, textAlign: 'center' }}>
      {spinner ?
        <div style={{ width: 26, height: 26, borderRadius: '50%', border: '3px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin .8s linear infinite' }} /> :
      <span style={{ width: 46, height: 46, borderRadius: 12, background: 'var(--panel)', color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}><Icon name={icon || 'doc'} size={22} /></span>}
      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{title}</div>
      {sub && <div style={{ fontSize: 12.5, color: 'var(--muted)', maxWidth: 360, lineHeight: 1.6 }}>{sub}</div>}
      {action}
    </div>
  );
}

/* ---- The vault panel ---- */
function DocumentVault({ deal, set }) {
  const docs = Array.isArray(deal.documents) ? deal.documents : [];
  const [dragOver, setDragOver] = useSV(false);
  const [uploads, setUploads] = useSV([]);      // [{name, status, error}]
  const [viewing, setViewing] = useSV(null);
  const [pendingCat, setPendingCat] = useSV(null);   // category to force on the next picker result
  const fileRef = useRefV(null);
  const cloud = window.AltusCloud;
  const cloudOn = !!(cloud && cloud.enabled && cloud.uploadDoc);
  const store = (file) => (cloudOn ? cloud.uploadDoc(deal.id, file) : localPut(file));

  const addDocs = async (fileList, category) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    if (!cloudOn && !sandboxDocs()) {
      setUploads(files.map((f, i) => ({ key: 'err' + i + Date.now(), name: f.name, status: 'error',
        error: 'Supabase storage isn’t connected — documents only upload to the cloud. Sign in on the live dashboard and add it there.' })));
      return;
    }
    // Track the running list locally rather than reading deal.documents inside the loop —
    // deal is a stale closure for the duration of this call, so appending off the prop on
    // each iteration made every file but the last overwrite the ones before it whenever
    // more than one file (e.g. a multi-file CoStar export) was added in the same batch.
    let current = Array.isArray(deal.documents) ? deal.documents : [];
    for (const file of files) {
      const key = file.name + '_' + Date.now() + Math.random();
      setUploads((u) => [...u, { key, name: file.name, status: 'uploading' }]);
      try {
        const meta = await store(file);
        const entry = { id: 'doc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          ...meta, category: category || guessCat(file.name) };
        current = [...current, entry];
        set('documents', current);
        setUploads((u) => u.map((x) => x.key === key ? { ...x, status: 'done' } : x));
        setTimeout(() => setUploads((u) => u.filter((x) => x.key !== key)), 1500);
      } catch (e) {
        setUploads((u) => u.map((x) => x.key === key ? { ...x, status: 'error', error: String(e.message || e) } : x));
      }
    }
  };
  const guessCat = (name) => {
    const n = (name || '').toLowerCase();
    if (/(costar|co-star|comp ?set|market analytics|submarket report|lease comps|sale comps)/.test(n)) return 'CoStar';
    if (/\b(om|offering|memorandum|marketing)\b/.test(n)) return 'OM';
    if (/(t-?12|t12|trailing|operating statement|income statement|p&l|profit)/.test(n)) return 'T-12';
    if (/(rent ?roll|rentroll|\brr\b)/.test(n)) return 'Rent Roll';
    return 'Other';
  };
  const removeDoc = async (doc) => {
    if (!window.confirm('Remove "' + doc.name + '" from the vault? This deletes the stored file.')) return;
    if (isLocalDoc(doc)) localDel(localKey(doc));
    else if (cloud && cloud.deleteDoc && doc.path) cloud.deleteDoc(doc.path);
    set('documents', docs.filter((d) => d.id !== doc.id));
  };
  const setCat = (doc, category) => set('documents', docs.map((d) => d.id === doc.id ? { ...d, category } : d));

  return (
    <PanelCard title="Document Vault" hint={cloudOn ? 'OMs, T-12s, CoStar files & more — stored on Supabase' : sandboxDocs() ? 'Sandbox: files stay in this browser (live stores them on Supabase)' : 'Supabase storage not connected here — upload from the live dashboard'}>
      {/* drop zone */}
      <input ref={fileRef} type="file" multiple style={{ display: 'none' }} accept=".pdf,.xlsx,.xls,.xlsm,.csv,.png,.jpg,.jpeg,.doc,.docx"
        onChange={(e) => { addDocs(e.target.files, pendingCat); setPendingCat(null); e.target.value = ''; }} />
      <div onClick={() => fileRef.current && fileRef.current.click()}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); }}
        onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOver(false); addDocs(e.dataTransfer.files, pendingCat); setPendingCat(null); }}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', marginTop: 4,
          border: '1.5px dashed ' + (dragOver ? 'var(--accent)' : 'var(--line-2)'), borderRadius: 10,
          background: dragOver ? 'var(--accent-soft)' : 'var(--panel-2)', cursor: 'pointer',
          transition: 'border-color .12s, background .12s' }}>
        <span style={{ width: 36, height: 36, borderRadius: 9, flex: 'none', background: 'var(--accent)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="upload" size={17} />
        </span>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{dragOver ? 'Drop to add to the vault' : 'Drag & drop documents, or click to browse'}</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 1 }}>PDF, Excel, CSV, images · multiple files supported · stored on Supabase</div>
        </div>
      </div>

      {/* CoStar quick-add — files downloaded from CoStar, filed under the CoStar category */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
        <button onClick={() => { setPendingCat('CoStar'); if (fileRef.current) fileRef.current.click(); }}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, height: 32, padding: '0 13px',
            border: '1px solid ' + CAT_COLOR.CoStar + '55', borderRadius: 8, background: CAT_COLOR.CoStar + '12',
            color: CAT_COLOR.CoStar, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
            fontFamily: 'var(--font)' }}>
          <Icon name="upload" size={13} /> Add CoStar file
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>PDF or Excel exports — market analytics, comp sets, sale &amp; lease comps</span>
      </div>

      {/* in-flight uploads */}
      {uploads.length > 0 &&
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
          {uploads.map((u) =>
        <div key={u.key} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5, color: u.status === 'error' ? 'var(--neg)' : 'var(--slate)' }}>
              {u.status === 'uploading' ?
          <span style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid var(--accent)', borderTopColor: 'transparent', animation: 'spin .8s linear infinite', flex: 'none' }} /> :
          <Icon name={u.status === 'error' ? 'close' : 'check'} size={14} style={{ color: u.status === 'error' ? 'var(--neg)' : 'var(--pos)' }} />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.name}{u.error ? ' — ' + u.error : ''}</span>
            </div>
        )}
        </div>
      }

      {/* document list */}
      {docs.length === 0 ?
      <div style={{ marginTop: 14, padding: '18px', textAlign: 'center', fontSize: 12.5, color: 'var(--muted)' }}>
          No documents yet. Parsed OMs, T-12s and rent rolls land here automatically.
        </div> :
      <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 7 }}>
          {docs.map((d) =>
        <div key={d.id} onClick={() => setViewing(d)}
          style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', borderRadius: 9,
            border: '1px solid var(--line)', background: 'var(--panel)', cursor: 'pointer' }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--panel-2)'; e.currentTarget.style.borderColor = 'var(--line-2)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--panel)'; e.currentTarget.style.borderColor = 'var(--line)'; }}>
              <span style={{ width: 32, height: 32, borderRadius: 8, flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            background: (CAT_COLOR[d.category] || '#5b7088') + '1a', color: CAT_COLOR[d.category] || '#5b7088' }}>
                <Icon name={docIcon(d.ext)} size={15} />
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.name}</div>
                <div style={{ fontSize: 11, color: 'var(--faint)' }}>{fmtBytes(d.size)} · {fmtDate(d.uploadedAt ? d.uploadedAt.slice(0, 10) : '')}{isLocalDoc(d) ? (sandboxDocs() ? ' · sandbox copy (this browser)' : ' · not in Supabase — re-add to sync') : ''}</div>
              </div>
              <select value={d.category || 'Other'} onClick={(e) => e.stopPropagation()} onChange={(e) => setCat(d, e.target.value)}
            style={{ flex: 'none', fontSize: 11, fontWeight: 600, color: CAT_COLOR[d.category] || '#5b7088', background: (CAT_COLOR[d.category] || '#5b7088') + '14',
              border: 'none', borderRadius: 999, padding: '4px 8px', cursor: 'pointer', fontFamily: 'var(--font)' }}>
                {DOC_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <button onClick={(e) => { e.stopPropagation(); removeDoc(d); }} title="Remove" style={{ ...viewerBtn, width: 28, height: 28, color: 'var(--faint)' }}>
                <Icon name="trash" size={13} />
              </button>
            </div>
        )}
        </div>
      }

      {viewing && <DocViewer doc={viewing} onClose={() => setViewing(null)} />}
    </PanelCard>
  );
}

window.DocumentVault = DocumentVault;
window.vaultLocalPut = localPut;
window.vaultLocalGet = (doc) => localGet(localKey(doc));