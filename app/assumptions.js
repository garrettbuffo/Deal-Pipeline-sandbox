// app/assumptions.js — firm-wide underwriting inputs shared by every deal's Full UW:
// current debt quotes, the acquisition-fee schedule and the other closing costs.
// Plain JS (no JSX), loaded before uwmodel.js. Exposes window.AltusAssumptions.
(function () {
  const LS = 'altus_assumptions_v1';

  // Quote defaults equal the financing presets the Full UW tab shipped with, so any deal
  // still on a preset's rate keeps identical numbers until a quote is changed here.
  const VERSION = 3;
  const DEFAULTS = {
    version: VERSION,
    updatedAt: null,
    quotes: {
      hudAcq:     { label: 'HUD 223(f)',                use: 'acquisition', rate: 5.75, amYears: 35, ioYears: 0, maxLev: 85, basis: 'LTV', minDscr: 1.176, loanFeePct: 2, dscrBasis: 'amortizing' },
      agencyAcq:  { label: 'Agency (Fannie / Freddie)', use: 'acquisition', rate: 5.5,  amYears: 30, ioYears: 2, maxLev: 70, basis: 'LTV', minDscr: 1.25, loanFeePct: 1.5, dscrBasis: 'amortizing' },
      bridge:     { label: 'Bridge / bank',             use: 'acquisition', rate: 6.25, amYears: 30, ioYears: 3, maxLev: 70, basis: 'LTC', minDscr: null, loanFeePct: 1.5, dscrBasis: 'io' },
      hudRefi:    { label: 'HUD 223(f) takeout',        use: 'refinance',   rate: 6.0,  amYears: 35, ioYears: 0, maxLev: 80, basis: 'LTV', minDscr: 1.176, loanFeePct: 2, dscrBasis: 'amortizing' },
      agencyRefi: { label: 'Agency takeout',            use: 'refinance',   rate: 5.75, amYears: 30, ioYears: 0, maxLev: 75, basis: 'LTV', minDscr: 1.25, loanFeePct: 1.5, dscrBasis: 'amortizing' },
    },
    // Acquisition fee by purchase price. 'band' = the whole price at its band's rate;
    // 'blended' = each slice of price at its own band's rate (no drop at a breakpoint).
    acqFee: {
      method: 'band',
      tiers: [{ upTo: 10000000, pct: 3 }, { upTo: 20000000, pct: 2 }, { upTo: null, pct: 1.5 }],
    },
    // Loan fees for debt with no quote (custom terms or an assumed loan), % of loan.
    otherLoanFeePct: 1.5,
    // Other closing costs. basis: 'flat' ($), 'price' (% of purchase price), 'loan' (% of loan).
    // Lender / loan fees are not listed here: they come from each debt quote's loan fee.
    closing: [
      { id: 'legal',   label: 'Legal & entity formation',                          basis: 'flat',  value: 20000 },
      { id: 'title',   label: 'Title, escrow & recording',                         basis: 'price', value: 0.4 },
      { id: 'reports', label: 'Third-party reports (appraisal, PCA, Phase I, survey)', basis: 'flat',  value: 12000 },
      { id: 'other',   label: 'Contingency / other',                               basis: 'price', value: 0.25 },
    ],
  };

  // Which quote each Full UW financing preset draws from.
  const SCENARIO_QUOTE = { 'HUD at Acquisition': 'hudAcq', 'Agency at Acquisition': 'agencyAcq', 'Bridge to HUD': 'bridge' };
  // The rate each preset hard-coded before this tab existed. A loan with no explicit
  // rateMode that still carries exactly this rate is treated as linked to the quote.
  const LEGACY_RATE = { hudAcq: 5.75, agencyAcq: 5.5, bridge: 6.25, hudRefi: 6.0, agencyRefi: null };

  const clone = (o) => JSON.parse(JSON.stringify(o));
  function merge(saved) {
    const base = clone(DEFAULTS);
    if (!saved || typeof saved !== 'object') return base;
    // v1 kept loan fees as a generic closing-cost line; v2 prices them per debt quote.
    if (!saved.version || saved.version < 2) saved = { ...saved, closing: (saved.closing || base.closing).filter((c) => c.id !== 'lender') };
    // v3: bridge loans size on loan-to-cost only by default (bridge lenders fund an interest
    // reserve rather than require in-place DSCR), so clear the old 1.10x placeholder.
    if (!saved.version || saved.version < 3) {
      const b = ((saved.quotes || {}).bridge) || null;
      if (b && Number(b.minDscr) === 1.1) saved = { ...saved, quotes: { ...saved.quotes, bridge: { ...b, minDscr: null } } };
    }
    const out = { ...base, ...saved, version: VERSION };
    out.quotes = { ...base.quotes };
    Object.keys(base.quotes).forEach((k) => { out.quotes[k] = { ...base.quotes[k], ...((saved.quotes || {})[k] || {}) }; });
    out.acqFee = { ...base.acqFee, ...(saved.acqFee || {}) };
    if (!Array.isArray(out.acqFee.tiers) || !out.acqFee.tiers.length) out.acqFee.tiers = base.acqFee.tiers;
    if (!Array.isArray(out.closing)) out.closing = base.closing;
    return out;
  }
  function load() {
    try { return merge(JSON.parse(localStorage.getItem(LS))); } catch (e) { return merge(null); }
  }

  let state = load();
  const subs = new Set();
  function notify() { subs.forEach((fn) => { try { fn(state); } catch (e) {} }); }
  function persist() { try { localStorage.setItem(LS, JSON.stringify(state)); } catch (e) {} }

  function get() { return state; }
  function set(next) {
    state = merge({ ...(typeof next === 'function' ? next(state) : next), updatedAt: new Date().toISOString() });
    persist(); notify(); pushCloud();
  }
  function reset() { state = merge(null); persist(); notify(); pushCloud(); }

  // ── Shared copy on Supabase (settings row "assumptions") so the whole team edits one set. ──
  let cloud = null, pushTimer = null, lastCloudJson = null;
  function pushCloud() {
    if (!cloud) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      const json = JSON.stringify(state);
      if (json === lastCloudJson) return;
      lastCloudJson = json;
      cloud.putRow('settings', 'assumptions', state).catch((e) => console.warn('[assumptions] cloud save failed', e));
    }, 500);
  }
  function applyRemote(data) {
    if (!data || typeof data !== 'object') return;
    const json = JSON.stringify(merge(data));
    if (json === JSON.stringify(state)) { lastCloudJson = json; return; }
    state = merge(data); lastCloudJson = JSON.stringify(state);
    persist(); notify();
  }
  async function connect(c) {
    if (!c || cloud) return;
    cloud = c;
    try {
      const row = await c.getRow('settings', 'assumptions');
      if (row && row.data) applyRemote(row.data);
      else { lastCloudJson = null; pushCloud(); }   // first time: publish the current set
    } catch (e) { console.warn('[assumptions] cloud load failed, using local', e); }
    c.subscribeTable('settings', (payload) => {
      const r = payload && payload.new;
      if (r && r.id === 'assumptions') applyRemote(r.data);
    });
  }
  function subscribe(fn) { subs.add(fn); return () => subs.delete(fn); }

  const n = (v) => (v == null || v === '' || isNaN(Number(v)) ? 0 : Number(v));

  // Every calculation runs against an assumptions set S: the live firm-wide set, or the copy a
  // deal locked in when it was first underwritten (see forDeal / withSnapshot below).
  function makeApi(getS) {
    // Acquisition fee for a purchase price under the schedule.
    function acqFee(price) {
      const S = getS();
      const p = n(price);
      const tiers = (S.acqFee.tiers || []).slice().sort((a, b) => (a.upTo == null ? 1 : b.upTo == null ? -1 : a.upTo - b.upTo));
      if (p <= 0 || !tiers.length) return { fee: 0, pct: 0 };
      if (S.acqFee.method === 'blended') {
        let fee = 0, floor = 0;
        for (const t of tiers) {
          const cap = t.upTo == null ? Infinity : n(t.upTo);
          if (p > floor) fee += (Math.min(p, cap) - floor) * n(t.pct) / 100;
          floor = cap;
          if (p <= cap) break;
        }
        return { fee, pct: fee / p };
      }
      const t = tiers.find((x) => x.upTo == null || p <= n(x.upTo)) || tiers[tiers.length - 1];
      return { fee: p * n(t.pct) / 100, pct: n(t.pct) / 100 };
    }

    // Loan-fee % for the acquisition loan: its quote's fee, else the other-debt fee.
    function acqLoanFeePct(rr) {
      return rr && rr.quote && rr.quote.loanFeePct != null ? n(rr.quote.loanFeePct) : n(getS().otherLoanFeePct);
    }
    // Refi loan fees: the takeout quote's fee unless the deal entered its own % (2% was the
    // refi section's old default, so a legacy 2% with no explicit mode still follows the quote).
    function refiCostPct(refi, rr) {
      const r = refi || {};
      const stored = r.costPct == null || r.costPct === '' ? null : Number(r.costPct);
      const custom = r.costMode === 'custom' || (r.costMode == null && stored != null && stored !== 2);
      if (custom) return { pct: stored == null ? 2 : stored, linked: false };
      return { pct: rr && rr.quote && rr.quote.loanFeePct != null ? n(rr.quote.loanFeePct) : n(getS().otherLoanFeePct), linked: !!(rr && rr.quote) };
    }

    // Full closing-cost build for a deal: acquisition fee, loan fees and each other line item.
    // opts: { loan, loanFeePct, feeOverride } — feeOverride lets a portfolio pass in its share
    // of a fee tiered on the total portfolio price.
    function closingCosts(price, opts) {
      const S = getS();
      const o = typeof opts === 'number' ? { loan: opts } : (opts || {});
      const p = n(price), L = n(o.loan);
      const fee = o.feeOverride != null ? { fee: n(o.feeOverride), pct: p > 0 ? n(o.feeOverride) / p : 0 } : acqFee(p);
      const items = [{ id: 'acqFee', label: 'Acquisition fee', amount: fee.fee, note: (fee.pct * 100).toFixed(2) + '% of price' + (o.feeOverride != null ? ' (portfolio tier)' : '') }];
      const feePct = o.loanFeePct == null ? n(S.otherLoanFeePct) : n(o.loanFeePct);
      if (L > 0) items.push({ id: 'loanFees', label: 'Loan fees', amount: L * feePct / 100, note: feePct + '% of loan' });
      (S.closing || []).forEach((c) => {
        const v = n(c.value);
        const amount = c.basis === 'price' ? p * v / 100 : c.basis === 'loan' ? L * v / 100 : v;
        items.push({ id: c.id, label: c.label, amount, note: c.basis === 'price' ? v + '% of price' : c.basis === 'loan' ? v + '% of loan' : 'flat' });
      });
      const total = items.reduce((s, i) => s + i.amount, 0);
      return { total, fee: fee.fee, items, pctOfPrice: p > 0 ? total / p : 0 };
    }

    // Effective rate for a loan spec. Linked loans follow the quote; a hand-entered rate
    // (rateMode 'custom', or a legacy rate that differs from its preset) stays as entered.
    function resolveRate(spec, quoteKey, fallback) {
      const s = spec || {};
      const q = quoteKey ? getS().quotes[quoteKey] : null;
      const stored = s.rate == null || s.rate === '' ? null : Number(s.rate);
      if (!q) return { rate: stored == null ? fallback : stored, linked: false, quoteKey: null, quote: null };
      const legacy = LEGACY_RATE[quoteKey];
      const linked = s.rateMode === 'linked' || (s.rateMode == null && (stored == null || stored === legacy));
      return { rate: linked ? n(q.rate) : (stored == null ? fallback : stored), linked, quoteKey, quote: q };
    }

    return { get: getS, SCENARIO_QUOTE, acqFee, closingCosts, resolveRate, acqLoanFeePct, refiCostPct };
  }

  const live = makeApi(() => state);

  // ── Per-deal lock ──
  // A deal takes a copy of the firm-wide assumptions the first time it is underwritten (its GPR
  // is entered) and keeps using that copy, so editing the Assumptions tab only moves deals
  // underwritten afterwards. A locked deal can be moved onto the current set from its Full UW tab.
  const KEYS = ['quotes', 'acqFee', 'otherLoanFeePct', 'closing'];
  function snapshot() {
    const o = { version: VERSION, takenAt: new Date().toISOString() };
    KEYS.forEach((k) => { o[k] = clone(state[k]); });
    return o;
  }
  const lockedApis = new WeakMap();
  function forDeal(deal) {
    const snap = deal && deal.uwAssumptions;
    if (!snap || typeof snap !== 'object') return live;
    let api = lockedApis.get(snap);
    if (!api) { const S = merge(snap); api = makeApi(() => S); api.locked = true; api.takenAt = snap.takenAt || null; lockedApis.set(snap, api); }
    return api;
  }
  // True when a deal's locked copy differs from the current firm-wide assumptions.
  function isStale(deal) {
    const snap = deal && deal.uwAssumptions;
    if (!snap) return false;
    const S = merge(snap);
    return KEYS.some((k) => JSON.stringify(S[k]) !== JSON.stringify(state[k]));
  }
  // Lock a deal (and its portfolio properties) once it has underwriting inputs.
  function withSnapshot(d) {
    if (!d || typeof d !== 'object') return d;
    const has = window.hasUWInputs ? window.hasUWInputs(d) : Number(d.gprAnnual) > 0;
    let out = d;
    if (!out.uwAssumptions && has) out = { ...out, uwAssumptions: snapshot() };
    if (out.uwAssumptions && Array.isArray(out.properties) && out.properties.some((p) => p && p.uwAssumptions !== out.uwAssumptions)) {
      out = { ...out, properties: out.properties.map((p) => (p && p.uwAssumptions !== out.uwAssumptions ? { ...p, uwAssumptions: out.uwAssumptions } : p)) };
    }
    return out;
  }
  // Move a deal onto the current firm-wide assumptions.
  function refreshSnapshot(d) {
    const snap = snapshot();
    return { ...d, uwAssumptions: snap, ...(Array.isArray(d.properties) ? { properties: d.properties.map((p) => ({ ...p, uwAssumptions: snap })) } : {}) };
  }

  window.AltusAssumptions = { DEFAULTS, SCENARIO_QUOTE, get, set, reset, subscribe, connect, acqFee: live.acqFee, closingCosts: live.closingCosts, resolveRate: live.resolveRate,
    acqLoanFeePct: live.acqLoanFeePct, refiCostPct: live.refiCostPct, forDeal, snapshot, isStale, withSnapshot, refreshSnapshot };
})();
