// app/cloud.js — Supabase integration (plain JS, loaded before app.jsx).
// Provides auth + deal sync. Degrades gracefully: if Supabase isn't configured or
// the library/network is unavailable, AltusCloud.enabled is false and the app falls
// back to local browser storage exactly as before.
(function () {
  const cfg = (window.ALTUS_CONFIG || {});
  const hasCfg = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase && window.supabase.createClient);

  let client = null;
  if (hasCfg) {
    try {
      client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
    } catch (e) { console.warn('[AltusCloud] init failed:', e); client = null; }
  }

  const enabled = !!client;
  // Login is required whenever cloud is live (Row-Level Security needs an authenticated
  // session). Set window.ALTUS_CONFIG.REQUIRE_LOGIN = false to disable the gate (the app
  // then runs on local storage only, since RLS blocks anonymous reads/writes).
  const requireLogin = enabled && (cfg.REQUIRE_LOGIN !== false);

  // ---- Auth ----
  async function getSession() {
    if (!client) return null;
    try { const { data } = await client.auth.getSession(); return data.session || null; }
    catch (e) { console.warn('[AltusCloud] getSession failed:', e); return null; }
  }
  async function signIn(email, password) {
    if (!client) throw new Error('Cloud not configured');
    const { data, error } = await client.auth.signInWithPassword({ email: (email || '').trim(), password });
    if (error) throw error;
    return data;
  }
  async function signOut() { if (client) { try { await client.auth.signOut(); } catch (e) {} } }
  function onAuthChange(cb) {
    if (!client) return () => {};
    const { data } = client.auth.onAuthStateChange((_evt, session) => cb(session || null));
    return () => { try { data.subscription.unsubscribe(); } catch (e) {} };
  }
  function currentEmail(session) { return session && session.user ? session.user.email : null; }

  // ---- Persisted sync bookkeeping ----
  // Remembers, per table and per row id, the exact fingerprint we last confirmed both
  // sides agree on. This is the "base" in a 3-way merge (base/ours/theirs) and MUST
  // survive page reloads — an in-memory-only cache resets on every load, which is what
  // let a single bad read blow away the whole pipeline on 2026-07-08 (see reconcileTable).
  const SNAP_KEY = 'altus_cloud_sync_v1';
  function loadSnapshots() {
    try { return JSON.parse(localStorage.getItem(SNAP_KEY)) || {}; } catch (e) { return {}; }
  }
  const snapshots = loadSnapshots(); // { deals: {id: fp}, contacts: {id: fp}, todos: {id: fp} }
  function persistSnapshots() {
    try { localStorage.setItem(SNAP_KEY, JSON.stringify(snapshots)); } catch (e) {}
  }
  function synced(table) { return snapshots[table] || (snapshots[table] = {}); }
  function commitSynced(table, updates) { Object.assign(synced(table), updates); persistSnapshots(); }
  function forgetSynced(table, ids) {
    const s = synced(table);
    ids.forEach((id) => { delete s[id]; });
    persistSnapshots();
  }

  // Cloud is the single, unconditional source of truth on every load: local state is
  // always fully replaced with whatever cloud says, no exceptions, no "keep local
  // because it looks unsynced." Saves are already reliable and immediate, so trying to
  // preserve a local guess is what kept causing stale data to win in edge cases (array
  // position drift, unbaselined rows, bundled sample data, sign-out/sign-in) — every one
  // of those was a different symptom of the same root cause: local ever having a vote.
  // The only thing this keeps is a circuit breaker that refuses to act on a read that
  // looks broken (e.g. empty) rather than blindly trusting it — without that, this is
  // exactly the 2026-07-08 failure mode. `fp` fingerprints an item so the breaker can
  // tell "genuinely deleted" apart from "read looks broken"; `fromRow` turns a raw cloud
  // row into the app's item shape.
  function reconcileTable(table, localItems, rows, { fp, fromRow }) {
    const base = synced(table);
    const cloudById = new Map(rows.map((row) => [String(row.id), row]));

    // Circuit breaker: if this browser has previously confirmed rows existed and the
    // cloud now looks like it lost most/all of them, refuse to touch anything rather
    // than blindly applying a bad/partial read. A real, intentional bulk delete goes
    // through deleteCloudXxx, which forgets the affected ids immediately — so it never
    // trips this breaker.
    const knownIds = Object.keys(base);
    // Circuit breaker (tightened 2026-08): only refuse a read that came back COMPLETELY
    // EMPTY while this browser had previously confirmed rows existed — the genuine
    // broken/failed-read catastrophe (2026-07-08, e.g. an auth/RLS drop returning zero rows).
    // A populated read that merely differs from a stale local baseline (after a data
    // migration or id change) is trusted and adopted, since cloud is the single source of
    // truth and the browser no longer holds a deal copy that could overwrite it — this also
    // stops the false-positive "sync paused" banner a post-migration baseline used to trigger.
    if (knownIds.length && rows.length === 0) {
      return { items: localItems, changed: false, suspicious: true, dropped: knownIds.length, total: knownIds.length };
    }

    const result = rows.map((row) => fromRow(row));
    const toCommit = {};
    // Fingerprint position by ARRAY INDEX (matching saveDeals), so a freshly adopted read
    // isn't mistaken for "changed" and bounced back as a full re-upsert on the next save.
    rows.forEach((row, i) => { toCommit[String(row.id)] = fp(fromRow(row), i); });
    const toForget = knownIds.filter((id) => !cloudById.has(id));

    if (Object.keys(toCommit).length) commitSynced(table, toCommit);
    if (toForget.length) forgetSynced(table, toForget);

    const changed = JSON.stringify(result) !== JSON.stringify(localItems);
    return { items: result, changed, suspicious: false };
  }

  // ---- Deals ----  rows: { id text pk, data jsonb, position int, updated_at }
  async function loadDeals() {
    if (!client) return null;
    const { data, error } = await client.from('deals').select('id,data,position').order('position', { ascending: true });
    if (error) throw error;
    return data || [];
  }
  const dealFp = (d, i) => JSON.stringify({ data: d, position: i });
  async function saveDeals(deals) {
    if (!client) return;
    const base = synced('deals');
    const changedRows = [];
    const changedSnapshots = {};
    const currentIds = new Set();

    deals.forEach((d, i) => {
      const id = String(d.id);
      currentIds.add(id);
      const snapshot = dealFp(d, i);
      if (base[id] !== snapshot) {
        changedRows.push({ id, data: d, position: i, updated_at: new Date().toISOString() });
        changedSnapshots[id] = snapshot;
      }
    });

    if (changedRows.length) {
      const { error: upErr } = await client.from('deals').upsert(changedRows, { onConflict: 'id' });
      if (upErr) throw upErr; // don't mark as saved if the request failed — will retry next save
      commitSynced('deals', changedSnapshots); // only now mark them synced
    }

    const stale = Object.keys(base).filter((id) => !currentIds.has(id));
    if (stale.length) forgetSynced('deals', stale); // bookkeeping only — never deletes cloud rows
  }

  // Fetches cloud deals and replaces localDeals with them (see reconcileTable).
  // Returns { items, changed, suspicious }. On `suspicious`, localDeals is returned
  // untouched — the caller should surface a warning instead of applying anything.
  //
  // Before applying the cloud read, give any deal that exists only in this tab's local
  // state — and has NEVER been confirmed saved (not in `synced`, not in the cloud read
  // either) — one more explicit save attempt. Without this, a deal whose debounced
  // auto-save simply hadn't fired yet (or had silently been failing) gets treated as
  // "cloud doesn't have it, so it doesn't exist" and is discarded with no warning the
  // moment ANY tab reconciles — the exact way "Triad 3 Portfolio" was lost on 2026-07-22.
  // The existing circuit breaker only protects previously-synced rows from a bad read;
  // it does nothing for a deal that was never synced in the first place.
  async function reconcileDeals(localDeals) {
    const rows = await loadDeals();
    if (rows === null) return { items: localDeals, changed: false, suspicious: false };
    const base = synced('deals');
    const cloudById = new Map(rows.map((row) => [String(row.id), row]));
    const neverSynced = localDeals.filter((d) => !base[String(d.id)] && !cloudById.has(String(d.id)));
    if (neverSynced.length) {
      try {
        await saveDeals(neverSynced);
      } catch (e) {
        return { items: localDeals, changed: false, suspicious: true, dropped: neverSynced.length, total: neverSynced.length };
      }
    }
    const result = reconcileTable('deals', localDeals, rows, {
      fp: dealFp,
      fromRow: (row) => ({ ...(row.data || {}), id: row.id }),
    });
    if (neverSynced.length && !result.suspicious) {
      const resultIds = new Set(result.items.map((d) => String(d.id)));
      const toAppend = neverSynced.filter((d) => !resultIds.has(String(d.id)));
      if (toAppend.length) return { ...result, items: [...result.items, ...toAppend], changed: true };
    }
    return result;
  }

  // Explicitly remove specific deal IDs from cloud. Called only when the user
  // deliberately deletes deal(s) — never triggered by auto-save.
  async function deleteCloudDeals(ids) {
    if (!client || !ids || !ids.length) return;
    const strIds = ids.map(String);
    const { error } = await client.from('deals').delete().in('id', strIds);
    if (error) throw error;
    forgetSynced('deals', strIds);
  }

  // ---- Contacts ----  rows: { id text pk, data jsonb, updated_at }
  async function loadContacts() {
    if (!client) return null;
    const { data, error } = await client.from('contacts').select('id,data').order('id', { ascending: true });
    if (error) throw error;
    return data || [];
  }
  const itemFp = (item) => JSON.stringify(item);
  async function saveContacts(contacts) {
    if (!client) return;
    const base = synced('contacts');
    const changedRows = [];
    const changedSnapshots = {};
    const currentIds = new Set();
    contacts.forEach((c) => {
      const id = String(c.id);
      currentIds.add(id);
      const snapshot = itemFp(c);
      if (base[id] !== snapshot) {
        changedRows.push({ id, data: c, updated_at: new Date().toISOString() });
        changedSnapshots[id] = snapshot;
      }
    });
    if (changedRows.length) {
      const { error } = await client.from('contacts').upsert(changedRows, { onConflict: 'id' });
      if (error) throw error;
      commitSynced('contacts', changedSnapshots);
    }
    const stale = Object.keys(base).filter((id) => !currentIds.has(id));
    if (stale.length) forgetSynced('contacts', stale);
    // NOTE: No auto-delete here — deletion is explicit via deleteCloudContacts, so an
    // incomplete/stale local array can never silently prune real cloud rows.
  }
  async function reconcileContacts(localContacts) {
    const rows = await loadContacts();
    if (rows === null) return { items: localContacts, changed: false, suspicious: false };
    return reconcileTable('contacts', localContacts, rows, {
      fp: itemFp,
      fromRow: (row) => ({ ...(row.data || {}), id: row.id }),
    });
  }
  async function deleteCloudContacts(ids) {
    if (!client || !ids || !ids.length) return;
    const strIds = ids.map(String);
    const { error } = await client.from('contacts').delete().in('id', strIds);
    if (error) throw error;
    forgetSynced('contacts', strIds);
  }

  // ---- Tasks / Todos ----  rows: { id text pk, data jsonb, updated_at }
  async function loadTodos() {
    if (!client) return null;
    const { data, error } = await client.from('todos').select('id,data').order('id', { ascending: true });
    if (error) throw error;
    return data || [];
  }
  async function saveTodos(todos) {
    if (!client) return;
    const base = synced('todos');
    const changedRows = [];
    const changedSnapshots = {};
    const currentIds = new Set();
    todos.forEach((t) => {
      const id = String(t.id);
      currentIds.add(id);
      const snapshot = itemFp(t);
      if (base[id] !== snapshot) {
        changedRows.push({ id, data: t, updated_at: new Date().toISOString() });
        changedSnapshots[id] = snapshot;
      }
    });
    if (changedRows.length) {
      const { error } = await client.from('todos').upsert(changedRows, { onConflict: 'id' });
      if (error) throw error;
      commitSynced('todos', changedSnapshots);
    }
    const stale = Object.keys(base).filter((id) => !currentIds.has(id));
    if (stale.length) forgetSynced('todos', stale);
    // NOTE: No auto-delete here — deletion is explicit via deleteCloudTodos, so an
    // incomplete/stale local array can never silently prune real cloud rows.
  }
  async function reconcileTodos(localTodos) {
    const rows = await loadTodos();
    if (rows === null) return { items: localTodos, changed: false, suspicious: false };
    return reconcileTable('todos', localTodos, rows, {
      fp: itemFp,
      fromRow: (row) => ({ ...(row.data || {}), id: row.id }),
    });
  }
  async function deleteCloudTodos(ids) {
    if (!client || !ids || !ids.length) return;
    const strIds = ids.map(String);
    const { error } = await client.from('todos').delete().in('id', strIds);
    if (error) throw error;
    forgetSynced('todos', strIds);
  }

  // ---- Document storage (Supabase Storage bucket "deal-docs") ----
  // Files live at deal-docs/<dealId>/<uuid>.<ext>; metadata is kept on the deal's
  // `documents` array (jsonb) so it syncs with the rest of the deal record.
  const DOC_BUCKET = 'deal-docs';
  async function uploadDoc(dealId, file, onProgress) {
    if (!client) throw new Error('Cloud storage is not connected.');
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const uid = (crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
    const path = String(dealId) + '/' + uid + '.' + ext;
    const { error } = await client.storage.from(DOC_BUCKET).upload(path, file, {
      cacheControl: '3600', upsert: false, contentType: file.type || undefined,
    });
    if (error) throw error;
    return { path, name: file.name, ext, size: file.size, type: file.type || '', uploadedAt: new Date().toISOString() };
  }
  // Short-lived signed URL for viewing/downloading a private object.
  async function signedDocUrl(path, expiresIn) {
    if (!client) throw new Error('Cloud storage is not connected.');
    const { data, error } = await client.storage.from(DOC_BUCKET).createSignedUrl(path, expiresIn || 3600);
    if (error) throw error;
    return data.signedUrl;
  }
  async function deleteDoc(path) {
    if (!client) return;
    const { error } = await client.storage.from(DOC_BUCKET).remove([path]);
    if (error) console.warn('[AltusCloud] doc delete failed:', error);
  }

  // ---- Realtime ----
  // Subscribes to Postgres changes on `table` and invokes `handler(payload)` for
  // every INSERT/UPDATE/DELETE. Returns an unsubscribe function.
  function subscribeTable(table, handler) {
    if (!client) return () => {};
    const channel = client
      .channel('public:' + table)
      .on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => handler(payload))
      .subscribe();
    return () => { client.removeChannel(channel); };
  }

  window.AltusCloud = {
    enabled, requireLogin, client, getSession, signIn, signOut, onAuthChange, currentEmail,
    loadDeals, saveDeals, deleteCloudDeals, reconcileDeals,
    loadContacts, saveContacts, deleteCloudContacts, reconcileContacts,
    loadTodos, saveTodos, deleteCloudTodos, reconcileTodos,
    uploadDoc, signedDocUrl, deleteDoc, subscribeTable,
  };
  if (enabled) console.info('[AltusCloud] connected to', cfg.SUPABASE_URL);
})();
