// supabase-config.js
// ─────────────────────────────────────────────────────────────────────────────
// One place to configure hosting add-ons. Leave everything blank to run exactly
// like today (data stored locally in the browser, AI parsing via the built-in
// bridge). Fill these in when you're ready to go multi-user / hosted.

// 1) CLOUD DATA + LOGIN (Supabase). Paste your project's values from
//    Supabase dashboard → Project Settings → API. Until both are filled, the app
//    keeps using local browser storage.
window.ALTUS_CONFIG = {
  SUPABASE_URL: 'https://twnvabiabnxfpjgrxgkg.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_FRgHESmXMP9xbt6c1JUHIg_TO2nDUSN',
};

// 2) AI DOCUMENT PARSING. The OM / T-12 / Rent Roll upload buttons call this.
//    The Anthropic key lives ONLY in the Cloudflare Pages Function at
//    functions/api/claude.js (set the ANTHROPIC_API_KEY env var in the Pages
//    dashboard) — never in the browser. This just points the app at that endpoint.
window.ALTUS_AI = {
  complete: async (prompt, maxTokens) => {
    // Only fail fast when window.claude exists as a fallback (Design Canvas preview) —
    // there, a fast abort just hands off to the fallback quickly. On a real deployment
    // there is no fallback, so a hard 4s cap here aborted every real document parse
    // before the Cloudflare Function (and Anthropic) could respond — large OMs/rent
    // rolls routinely take well past 4s. Give real parsing the time it actually needs.
    const hasFallback = window.claude && typeof window.claude.complete === 'function';
    const controller = new AbortController();
    // Large reads (T-12 line items, a PDF rent roll unit list) return many thousands of tokens,
    // so they get up to 5 minutes; ordinary parses keep the 60s cap.
    const tid = setTimeout(() => controller.abort(), hasFallback ? 4000 : (maxTokens && maxTokens > 4096 ? 300000 : 60000));
    let r;
    try {
      r = await fetch('/api/claude', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, ...(maxTokens ? { max_tokens: maxTokens } : {}) }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(tid);
    }
    if (!r.ok) {
      let msg = 'AI request failed (' + r.status + ')';
      try { const j = await r.json(); if (j && j.error) msg = j.error; } catch (e) {}
      throw new Error(msg);
    }
    const data = await r.json();
    if (data && data.error) throw new Error(data.error);
    return (data && data.text) || '';
  },
};
