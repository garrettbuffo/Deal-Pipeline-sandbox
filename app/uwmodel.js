// app/uwmodel.js — Altus underwriting DCF engine (pure functions, no JSX).
// computeUW(deal) returns the full multi-year cash-flow model: per-year EGI / OpEx /
// NOI / Debt Service / Net Income, plus yields, DSCR, equity, refi mechanics and IRR.
// All formatting stays in the UI; this file only does math.

(function () {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const numOr = (v, d) => (v == null || v === '' || isNaN(Number(v)) ? d : Number(v));

  // ---- Loan math -----------------------------------------------------------
  // Level monthly payment to fully amortize `principal` over n months at monthly rate r.
  function pmt(principal, r, n) {
    if (n <= 0) return 0;
    if (r === 0) return principal / n;
    return (principal * r) / (1 - Math.pow(1 + r, -n));
  }
  // Remaining balance after `monthsElapsed` months, given an interest-only period
  // (ioMonths) followed by amortization over `amMonths`.
  function balanceAfter(principal, annualRate, amMonths, ioMonths, monthsElapsed) {
    const r = annualRate / 12;
    if (monthsElapsed <= ioMonths) return principal;            // IO: no principal paydown
    const k = monthsElapsed - ioMonths;                          // amortizing months elapsed
    if (k >= amMonths) return 0;
    const p = pmt(principal, r, amMonths);
    if (r === 0) return Math.max(0, principal - p * k);
    const bal = principal * Math.pow(1 + r, k) - p * ((Math.pow(1 + r, k) - 1) / r);
    return Math.max(0, bal);
  }
  // Annual debt service for an ownership year whose first month is `startMonth`
  // (months since loan origination). IO year → interest only; otherwise level payment.
  function annualDS(principal, annualRate, amMonths, ioMonths, startMonth) {
    const r = annualRate / 12;
    if (startMonth < ioMonths) return principal * annualRate;    // interest-only year
    return 12 * pmt(principal, r, amMonths);
  }

  function monthsBetween(a, b) {
    if (!a || !b) return 0;
    const da = new Date(a + 'T12:00:00'), db = new Date(b + 'T12:00:00');
    if (isNaN(da) || isNaN(db)) return 0;
    return Math.max(0, (db.getFullYear() - da.getFullYear()) * 12 + (db.getMonth() - da.getMonth()));
  }

  // Build a loan handle from a spec. `origMonthsAtAcq` = months already elapsed at
  // acquisition (0 for new financing; >0 for assumed debt so we show the amortized
  // balance while keeping payments based on the original amount).
  function makeLoan({ principal, rate, amYears, ioYears, origMonthsAtAcq = 0 }) {
    const amMonths = Math.max(1, Math.round((amYears || 30) * 12));
    const ioMonths = Math.max(0, Math.round((ioYears || 0) * 12));
    const r = (rate || 0) / 100;
    return {
      principal,
      rate: r,
      amMonths,
      ioMonths,
      origMonthsAtAcq,
      balanceAtAcq: balanceAfter(principal, r, amMonths, ioMonths, origMonthsAtAcq),
      // ownership year y (1-based): DS for that 12-month window
      dsForYear(y) {
        const startMonth = origMonthsAtAcq + (y - 1) * 12;
        return annualDS(principal, r, amMonths, ioMonths, startMonth);
      },
      // balance at the END of ownership year y
      balanceAtYearEnd(y) {
        return balanceAfter(principal, r, amMonths, ioMonths, origMonthsAtAcq + y * 12);
      },
      monthlyPayment: pmt(principal, r, amMonths),
    };
  }

  // ---- IRR via bisection (robust for these monthly-free annual streams) -----
  function npv(rate, cfs) {
    let s = 0;
    for (let t = 0; t < cfs.length; t++) s += cfs[t] / Math.pow(1 + rate, t);
    return s;
  }
  function irr(cfs) {
    // need at least one sign change
    const hasNeg = cfs.some((c) => c < 0), hasPos = cfs.some((c) => c > 0);
    if (!hasNeg || !hasPos) return null;
    let lo = -0.9999, hi = 10;
    let fLo = npv(lo, cfs), fHi = npv(hi, cfs);
    if (fLo * fHi > 0) return null; // no root in range
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      const f = npv(mid, cfs);
      if (Math.abs(f) < 1e-6) return mid;
      if (fLo * f < 0) { hi = mid; fHi = f; } else { lo = mid; fLo = f; }
    }
    return (lo + hi) / 2;
  }

  // ---- The model -----------------------------------------------------------
  function computeUW(deal) {
    // Portfolios: each property is underwritten independently — the deal-level model IS
    // the combined roll-up of all properties, not a model of the deal's own (unset) fields.
    if (deal && deal.isPortfolio && Array.isArray(deal.properties) && deal.properties.length > 1) {
      const combined = computeCombinedUW(deal);
      if (combined) return combined;
    }
    const units = deal.units || 1;
    const price = numOr(deal.purchasePrice, 0);
    const capex = numOr(deal.capex, 0);
    const basis = price + capex;
    const hold = clamp(Math.round(numOr(deal.holdYears, 10)), 1, 10);

    const gprGrowth = numOr(deal.gprGrowth, 3) / 100;
    const opexGrowth = numOr(deal.opexGrowth, 2.5) / 100;
    const closingPct = numOr(deal.closingPct, 5) / 100;
    const sellingPct = numOr(deal.sellingPct, 4) / 100;
    const amFeePct = numOr(deal.amFeePct, 2) / 100;   // asset-mgmt fee, % of EGI

    // ---- In-place income (year 0 basis) ----
    const gpr0 = numOr(deal.gprAnnual, 0);
    const physVac = numOr(deal.physVacLoss, 0);
    const ltl = numOr(deal.lossToLease, 0);
    const badDebt = numOr(deal.badDebt, 0);
    const concessions = numOr(deal.concessions, 0);
    const otherIncome = numOr(deal.otherIncome, 0);
    const econLoss0 = physVac + ltl + badDebt + concessions;
    const inPlaceEconVac = gpr0 > 0 ? econLoss0 / gpr0 : 0;
    const egi0 = gpr0 > 0 ? gpr0 - econLoss0 + otherIncome : numOr(deal.trailingEGI, 0);

    // ---- Stabilized vacancy glide ----
    const stabVac = deal.stabEconVac == null || deal.stabEconVac === ''
      ? inPlaceEconVac : numOr(deal.stabEconVac, inPlaceEconVac) / 100;
    const stabYear = clamp(Math.round(numOr(deal.stabYear, 3)), 1, hold);
    const vacOv = deal.vacOverride || {};
    function defaultVac(y) {
      if (stabYear <= 1 || y >= stabYear) return stabVac;
      return inPlaceEconVac + (stabVac - inPlaceEconVac) * (y - 1) / (stabYear - 1);
    }
    function econVacForYear(y) {
      const o = vacOv[y];
      return (o != null && o !== '') ? Number(o) / 100 : defaultVac(y);
    }

    // ---- OpEx base (UW assumption × units) ----
    const opexBase = numOr(deal.marketOpexPerUnit, 0) * units || numOr(deal.currentOpexTotal, 0);

    // ---- Acquisition financing ----
    const fin = deal.acqFin || { mode: 'none' };
    let acqLoan = null, acqProceeds = 0, acqLabel = 'All cash';
    if (fin.mode === 'new') {
      const n = fin.new || {};
      const basisForLtv = (n.basis === 'LTC') ? basis : price;
      acqProceeds = basisForLtv * (numOr(n.pct, 65) / 100);
      acqLoan = makeLoan({ principal: acqProceeds, rate: numOr(n.rate, 6), amYears: numOr(n.amYears, 30), ioYears: numOr(n.ioYears, 0) });
      acqLabel = 'New ' + (n.basis === 'LTC' ? 'LTC' : 'LTV') + ' loan';
    } else if (fin.mode === 'assumable') {
      const a = fin.assumable || {};
      const orig = numOr(a.origAmount, 0);
      const acqDate = deal.dateUnderContract || window.ALTUS_TODAY;
      const elapsed = monthsBetween(a.origDate, acqDate);
      acqLoan = makeLoan({ principal: orig, rate: numOr(a.rate, 5), amYears: numOr(a.amYears, 30), ioYears: numOr(a.ioYears, 0), origMonthsAtAcq: elapsed });
      acqProceeds = acqLoan.balanceAtAcq;  // you assume the amortized balance
      acqLabel = 'Assumed debt';
    }

    // ---- Refinance ----
    const refi = deal.refi || { enabled: false };
    const refiOn = !!refi.enabled && refi.year > 0 && refi.year <= hold;
    const refiYear = refiOn ? clamp(Math.round(numOr(refi.year, 3)), 1, hold) : null;

    // ---- Build year rows (0 = acquisition snapshot, 1..hold = projection) ----
    // Year 1 holds at in-place GPR/OpEx/other (no growth); growth compounds from year 2 on.
    const otherIncomeStab = (deal.stabOtherIncome == null || deal.stabOtherIncome === '')
      ? otherIncome : numOr(deal.stabOtherIncome, otherIncome);
    const rows = [];
    for (let y = 0; y <= hold; y++) {
      const g = Math.max(0, y - 1);                       // growth exponent: 0 for acq yr & yr 1
      const gpr = gpr0 * Math.pow(1 + gprGrowth, g);
      const opex = opexBase * Math.pow(1 + opexGrowth, g);
      const vac = y === 0 ? inPlaceEconVac : econVacForYear(y);
      const baseOther = y === 0 ? otherIncome : otherIncomeStab;  // stabilized other income carries/overrides
      const otherInc = baseOther * Math.pow(1 + gprGrowth, g);
      const egi = gpr > 0 ? gpr * (1 - vac) + otherInc : (y === 0 ? egi0 : egi0 * Math.pow(1 + gprGrowth, g));
      const noi = egi - opex;
      rows.push({ year: y, gpr, vac, egi, opex, noi });
    }

    // ---- Refi sizing (uses refi-year NOI) ----
    let refiLoan = null, refiValue = 0, refiProceeds = 0, refiPayoff = 0, refiCashOut = 0, refiCost = 0;
    if (refiOn) {
      const refiCap = numOr(refi.cap, 0) / 100;
      const noiR = rows[refiYear].noi;
      refiValue = refiCap > 0 ? noiR / refiCap : 0;
      refiProceeds = refiValue * (numOr(refi.ltv, 80) / 100);
      refiPayoff = acqLoan ? acqLoan.balanceAtYearEnd(refiYear) : 0;
      refiCost = refiProceeds * (numOr(refi.costPct, 2) / 100);   // refinance closing cost, out of proceeds
      refiCashOut = refiProceeds - refiPayoff - refiCost;
      refiLoan = makeLoan({ principal: refiProceeds, rate: numOr(refi.rate, 6), amYears: numOr(refi.amYears, 35), ioYears: numOr(refi.ioYears, 0) });
    }

    // ---- Debt service / balance by year ----
    function dsForYear(y) {
      if (y === 0) return acqLoan ? acqLoan.dsForYear(1) : 0;       // going-in snapshot
      if (refiOn && y > refiYear) return refiLoan.dsForYear(y - refiYear);
      return acqLoan ? acqLoan.dsForYear(y) : 0;
    }
    function loanBalanceAtYearEnd(y) {
      if (refiOn && y > refiYear) return refiLoan.balanceAtYearEnd(y - refiYear);
      return acqLoan ? acqLoan.balanceAtYearEnd(y) : 0;
    }
    // Scheduled principal paydown during ownership year y (amortization only — the refi
    // payoff / new origination is a financing event, not amortization, so it's excluded).
    function principalPaydownForYear(y) {
      if (y === 0) return 0;
      if (refiOn && y > refiYear) {
        const k = y - refiYear;
        return refiLoan.balanceAtYearEnd(k - 1) - refiLoan.balanceAtYearEnd(k);
      }
      return acqLoan ? acqLoan.balanceAtYearEnd(y - 1) - acqLoan.balanceAtYearEnd(y) : 0;
    }

    // ---- Equity ----
    const closingCosts = price * closingPct;
    const initialEquity = price + closingCosts + capex - acqProceeds;
    function equityBalance(y) {
      // capital returned at end of refiYear reduces the invested balance thereafter
      return initialEquity - (refiOn && y > refiYear ? refiCashOut : 0);
    }

    // ---- Per-year line items ----
    rows.forEach((row) => {
      const y = row.year;
      row.ds = dsForYear(y);
      row.amFee = row.egi * amFeePct;                       // asset-mgmt fee on EGI
      row.netIncome = row.noi - row.ds - row.amFee;         // net cash flow after fee
      row.loanBalance = loanBalanceAtYearEnd(y);
      row.yieldOnCost = basis > 0 ? row.noi / basis : 0;
      row.dscr = row.ds > 0 ? row.noi / row.ds : null;
      const eq = equityBalance(y);
      row.cashOnCash = eq > 0 ? row.netIncome / eq : null;
      row.equityBalance = eq;
      // net revenue growth = YoY change in EGI (captures both organic rent growth and the
      // change in economic vacancy as occupancy stabilizes)
      row.netRevGrowth = y === 0 ? null : (rows[y - 1].egi > 0 ? row.egi / rows[y - 1].egi - 1 : null);
      // principal paydown as a % of the current equity balance, and total yield incl. paydown
      row.principalPaydown = principalPaydownForYear(y);
      row.principalPaydownPct = eq > 0 ? row.principalPaydown / eq : null;
      row.yieldPlusPaydown = (row.cashOnCash == null && row.principalPaydownPct == null)
        ? null : (row.cashOnCash || 0) + (row.principalPaydownPct || 0);
    });

    // ---- Sale (end of hold) ----
    const exitCap = numOr(deal.exitCap, 6) / 100;
    const finalNOI = rows[hold].noi;
    const salePrice = exitCap > 0 ? finalNOI / exitCap : 0;
    const sellingCosts = salePrice * sellingPct;
    const saleLoanPayoff = loanBalanceAtYearEnd(hold);
    const netSaleProceeds = salePrice - sellingCosts - saleLoanPayoff;

    // ---- IRR cash-flow stream ----
    const cfs = [-initialEquity];
    for (let y = 1; y <= hold; y++) {
      let cf = rows[y].netIncome;
      if (refiOn && y === refiYear) cf += refiCashOut;
      if (y === hold) cf += netSaleProceeds;
      cfs.push(cf);
    }

    // ---- Per-row capital events + total cash flow to equity ----
    rows.forEach((row) => {
      const y = row.year;
      row.refiDistribution = (refiOn && y === refiYear) ? refiCashOut : 0;  // ROC / cash-out from refi
      row.saleProceeds = (y === hold && y > 0) ? netSaleProceeds : 0;       // net proceeds at exit
      row.totalCashFlow = row.netIncome + row.refiDistribution + row.saleProceeds;
    });
    const dealIRR = exitCap > 0 ? irr(cfs) : null;
    const totalDistributions = cfs.slice(1).reduce((s, c) => s + c, 0);
    const equityMultiple = initialEquity > 0 ? (totalDistributions) / initialEquity : null;
    const profit = totalDistributions - initialEquity;

    // average operating cash-on-cash yield across the hold (years 1..hold)
    let cocSum = 0, cocN = 0;
    for (let y = 1; y <= hold; y++) { if (rows[y].cashOnCash != null) { cocSum += rows[y].cashOnCash; cocN++; } }
    const avgYield = cocN ? cocSum / cocN : null;

    return {
      units, price, capex, basis, hold,
      gprGrowth, opexGrowth, closingPct, sellingPct,
      gpr0, physVac, ltl, badDebt, concessions, otherIncome,
      econLoss0, inPlaceEconVac, egi0,
      stabVac, stabYear,
      opexBase,
      fin, acqLoan, acqProceeds, acqLabel,
      refiOn, refiYear, refiValue, refiProceeds, refiPayoff, refiCashOut, refiCost, refiLoan,
      closingCosts, initialEquity, equityBalance,
      rows, exitCap, finalNOI, salePrice, sellingCosts, saleLoanPayoff, netSaleProceeds,
      cfs, irr: dealIRR, equityMultiple, profit, totalDistributions, avgYield, amFeePct,
      econVacForYear, defaultVac,
    };
  }

  // ---- LP / GP waterfall -----------------------------------------------------
  // Non-accruing annual preferred return on unreturned LP capital, then profit split.
  // LP funds 100% of equity; GP earns the promote. Order each year:
  //   1) Preferred return (non-accruing) on unreturned capital from operating cash flow
  //   2) Return of capital from capital events (refi cash-out, sale)
  //   3) Residual / profit split (LP share vs GP promote) on everything above
  function computeLP(uw, opts) {
    opts = opts || {};
    const pref = numOr(opts.pref, 7) / 100;
    const lpShare = numOr(opts.split, 75) / 100;   // LP share of profit above pref
    const gpShare = 1 - lpShare;
    const LPcap = uw.initialEquity;
    let cap = LPcap;
    const years = [];
    for (let y = 1; y <= uw.hold; y++) {
      const opCF = uw.rows[y].netIncome;
      // Tier 1 — preferred (non-accruing) from operating cash flow
      const prefAmt = pref * cap;
      let lpPref, excess, lpOp, gpOp;
      if (opCF <= 0) { lpPref = opCF; excess = 0; lpOp = opCF; gpOp = 0; }
      else { lpPref = Math.min(opCF, prefAmt); excess = Math.max(0, opCF - prefAmt); lpOp = lpPref + lpShare * excess; gpOp = gpShare * excess; }
      // Capital events this year (refi cash-out + sale)
      // Read capital events off the per-year rows (refiDistribution/saleProceeds) rather than
      // the single refiYear/refiCashOut fields — this generalizes to combined portfolio models
      // where each property may refinance in a different year.
      const capEvent = (uw.rows[y].refiDistribution || 0) + (uw.rows[y].saleProceeds || 0);
      const roc = Math.min(Math.max(capEvent, 0), cap);
      cap -= roc;
      const capProfit = Math.max(0, capEvent - roc);
      const lpCapDist = roc + lpShare * capProfit;
      const gpCapDist = gpShare * capProfit;
      const lpTotal = lpOp + lpCapDist;
      const gpTotal = gpOp + gpCapDist;
      years.push({
        year: y, opCF, prefAmt, lpPref, lpOp, gpOp, capEvent, roc, lpCapDist, gpCapDist,
        lpTotal, gpTotal, lpYield: LPcap > 0 ? lpOp / LPcap : null,
      });
    }
    const lpStream = [-LPcap, ...years.map((yr) => yr.lpTotal)];
    const lpIRR = irr(lpStream);
    const gpPromote = years.reduce((s, yr) => s + yr.gpOp + yr.gpCapDist, 0);
    const lpDistTotal = years.reduce((s, yr) => s + yr.lpTotal, 0);
    const lpMultiple = LPcap > 0 ? lpDistTotal / LPcap : null;
    let ys = 0, yn = 0;
    years.forEach((yr) => { if (yr.lpYield != null) { ys += yr.lpYield; yn++; } });
    const avgLpYield = yn ? ys / yn : null;
    return { LPcap, years, lpIRR, gpPromote, lpDistTotal, lpMultiple, avgLpYield, lpStream, pref, lpShare, gpShare };
  }

  // ---- Scenario runner -------------------------------------------------------
  // Runs computeUW + computeLP on a deal variant and returns headline averages.
  function computeScenario(deal, overrides) {
    const variant = Object.assign({}, deal, overrides || {});
    const uw = computeUW(variant);
    const lp = computeLP(uw, { pref: deal.lpPref, split: deal.lpSplit });
    return {
      uw, lp,
      dealIRR: uw.irr, avgDealYield: uw.avgYield, equityMultiple: uw.equityMultiple,
      lpIRR: lp.lpIRR, avgLpYield: lp.avgLpYield, lpMultiple: lp.lpMultiple, gpPromote: lp.gpPromote,
    };
  }

  // In-place economic vacancy as a percent number (for the weak-case override).
  function inPlaceVacPct(deal) {
    const gpr = numOr(deal.gprAnnual, 0);
    if (gpr <= 0) return 0;
    const loss = numOr(deal.physVacLoss, 0) + numOr(deal.lossToLease, 0) + numOr(deal.badDebt, 0) + numOr(deal.concessions, 0);
    return (loss / gpr) * 100;
  }

  // True once the Income & Economic Vacancy section is filled enough to project
  // returns — gross potential rent is the required driver of the cash-flow model.
  function hasUWInputs(deal) {
    if (!deal) return false;
    if (deal.isPortfolio && Array.isArray(deal.properties) && deal.properties.length > 1) {
      return deal.properties.some((p) => Number(p.gprAnnual) > 0);
    }
    return Number(deal.gprAnnual) > 0;
  }

  // Display cap rates used across cards/tables. When the Full UW income section is
  // filled, going-in = Year 1 YOC and stabilized = Year 3 YOC (stabilization year);
  // otherwise fall back to the Quick UW cap-rate math (computeMetrics). `source` is
  // 'Full UW' or 'Quick UW' for labeling.
  function displayCaps(deal) {
    const m = window.computeMetrics ? window.computeMetrics(deal) : { goingInCap: 0, stabilizedCap: 0 };
    if (hasUWInputs(deal)) {
      const uw = computeUW(deal);
      const y1 = uw.rows[1] ? uw.rows[1].yieldOnCost : null;
      const y3row = uw.rows[3] || uw.rows[uw.rows.length - 1];
      const y3 = y3row ? y3row.yieldOnCost : null;
      return {
        goingIn: y1 != null ? y1 : m.goingInCap,
        stab: y3 != null ? y3 : m.stabilizedCap,
        source: 'Full UW',
      };
    }
    return { goingIn: m.goingInCap, stab: m.stabilizedCap, source: 'Quick UW' };
  }

  // ---- Excel-model returns bridge -----------------------------------------
  // A deal underwritten in the linked Excel model carries its outputs in data._uw
  // (whole-number percents, plain multiples, integer dollars — written by the acquisition
  // pipeline sync). These helpers expose those as the deal's HEADLINE returns, normalized
  // into the app's native convention (percentages as decimal fractions, so the existing
  // fmtPct/(*100) formatters render them unchanged). Everything is additive and gated on
  // the presence of _uw: deals without it keep today's Full-UW behavior untouched.
  function hasExcelReturns(d){ return !!(d && d._uw && d._uw.metrics && d._uw.metrics.dealIRR != null); }
  function returnsSource(d){
    if (d && (d.returnsSource === 'Excel Model' || d.returnsSource === 'Full UW')) return d.returnsSource;
    return hasExcelReturns(d) ? 'Excel Model' : 'Full UW';
  }
  const _pctFrac = (v) => (v == null ? null : Number(v) / 100); // whole-percent -> decimal fraction
  // Normalized headline returns for a deal, tagged by source. Excel numbers win when the
  // deal has an _uw block (unless data.returnsSource explicitly forces 'Full UW').
  function dealReturns(d){
    const source = returnsSource(d);
    const ask = Number(d && d.askPrice) || null;
    if (source === 'Excel Model' && hasExcelReturns(d)) {
      const u = d._uw, m = u.metrics, c = u.criteria || {};
      const offer = u.offerPrice != null ? Number(u.offerPrice) : (Number(d.purchasePrice) || null);
      return {
        source: 'Excel Model', fromExcel: true,
        irr: _pctFrac(m.dealIRR),
        equityMultiple: m.equityMultiple != null ? Number(m.equityMultiple) : null,
        goingInYOC: _pctFrac(m.goingInYOC),
        stabYOC: _pctFrac(m.stabilizedYOC),
        dscr: m.dscrY1 != null ? Number(m.dscrY1) : null,
        goingInCap: _pctFrac(m.goingInCap),
        holdYears: m.holdYears != null ? Number(m.holdYears) : null,
        offerPrice: offer,
        offerToAsk: c.offerToAsk != null ? Number(c.offerToAsk) : (ask && offer != null ? offer / ask : null),
        rankable: c.rankable === true,
        syncedAt: u.syncedAt || null,
        modelStatus: u.modelStatus || null,
      };
    }
    // Full UW (today's behavior) — derived from the DCF engine + cap bridge.
    const uw = hasUWInputs(d) ? computeUW(d) : null;
    const caps = displayCaps(d);
    const offer = Number(d && d.purchasePrice) || null;
    return {
      source: caps.source, fromExcel: false,
      irr: uw ? uw.irr : null,
      equityMultiple: uw && uw.equityMultiple != null ? uw.equityMultiple : null,
      goingInYOC: caps.goingIn,
      stabYOC: caps.stab,
      dscr: uw && uw.rows && uw.rows[1] ? uw.rows[1].dscr : null,
      goingInCap: caps.goingIn,
      holdYears: uw ? uw.hold : null,
      offerPrice: offer,
      offerToAsk: ask ? ((offer || 0) / ask) : null,
      rankable: !!ask,
      syncedAt: null, modelStatus: null,
    };
  }

  // ---- Portfolio combine: sum per-property UW models into one aggregate model ----
  // Each property is underwritten independently (own income/opex/financing/refi/assumptions);
  // this sums their year rows and re-derives portfolio-level IRR/equity multiple from the
  // combined cash-flow stream (summed property-by-property, not an average of IRRs).
  function computeCombinedUW(deal) {
    const props = (Array.isArray(deal.properties) ? deal.properties : []).filter((p) => hasUWInputs(p));
    if (!props.length) return null;
    const uws = props.map((p) => computeUW(p));
    const hold = Math.max(...uws.map((u) => u.hold));
    const rows = [];
    const sumField = (y, f) => uws.reduce((s, u) => s + ((u.rows[y] && u.rows[y][f]) || 0), 0);
    for (let y = 0; y <= hold; y++) {
      const noi = sumField(y, 'noi'), ds = sumField(y, 'ds');
      const basisY = uws.reduce((s, u) => s + (y <= u.hold ? u.basis : 0), 0);
      const eqBal = uws.reduce((s, u) => s + (u.rows[y] ? u.rows[y].equityBalance : 0), 0);
      const netIncome = sumField(y, 'netIncome');
      rows.push({
        year: y,
        gpr: sumField(y, 'gpr'), egi: sumField(y, 'egi'), opex: sumField(y, 'opex'),
        noi, ds, amFee: sumField(y, 'amFee'), netIncome,
        loanBalance: sumField(y, 'loanBalance'),
        refiDistribution: sumField(y, 'refiDistribution'), saleProceeds: sumField(y, 'saleProceeds'),
        totalCashFlow: sumField(y, 'totalCashFlow'),
        yieldOnCost: basisY > 0 ? noi / basisY : 0,
        dscr: ds > 0 ? noi / ds : null,
        cashOnCash: eqBal > 0 ? netIncome / eqBal : null,
        equityBalance: eqBal,
        netRevGrowth: y === 0 ? null : (rows[y - 1].egi > 0 ? sumField(y, 'egi') / rows[y - 1].egi - 1 : null),
        principalPaydown: sumField(y, 'principalPaydown'),
        principalPaydownPct: eqBal > 0 ? sumField(y, 'principalPaydown') / eqBal : null,
      });
      rows[y].yieldPlusPaydown = (rows[y].cashOnCash || 0) + (rows[y].principalPaydownPct || 0);
    }
    const initialEquity = uws.reduce((s, u) => s + u.initialEquity, 0);
    const basis = uws.reduce((s, u) => s + u.basis, 0);
    const salePrice = uws.reduce((s, u) => s + (u.hold === hold ? u.salePrice : 0), 0);
    const netSaleProceeds = uws.reduce((s, u) => s + (u.hold === hold ? u.netSaleProceeds : 0), 0);
    // combined IRR from the summed cash-flow stream across all properties (pad to common length)
    const cfs = [];
    for (let t = 0; t <= hold; t++) {
      cfs.push(uws.reduce((s, u) => s + (u.cfs[t] || 0), 0));
    }
    const dealIRR = irr(cfs);
    const totalDistributions = cfs.slice(1).reduce((s, c) => s + c, 0);
    const equityMultiple = initialEquity > 0 ? totalDistributions / initialEquity : null;
    let cocSum = 0, cocN = 0;
    for (let y = 1; y <= hold; y++) { if (rows[y].cashOnCash != null) { cocSum += rows[y].cashOnCash; cocN++; } }
    const avgYield = cocN ? cocSum / cocN : null;
    const price = uws.reduce((s, u) => s + u.price, 0);
    const acqProceeds = uws.reduce((s, u) => s + (u.acqProceeds || 0), 0);
    const closingCosts = uws.reduce((s, u) => s + (u.closingCosts || 0), 0);
    const capex = uws.reduce((s, u) => s + (u.capex || 0), 0);
    // ---- Income-statement + assumption roll-up (dollar fields sum; rate/assumption
    // fields blend basis-weighted) so the KPI strip and IC memo can show combined
    // physical vacancy, loss-to-lease, bad debt/concessions, and UW assumptions for
    // portfolios instead of reading these off a single-property-only computeUW result.
    const gpr0 = uws.reduce((s, u) => s + (u.gpr0 || 0), 0);
    const physVac = uws.reduce((s, u) => s + (u.physVac || 0), 0);
    const ltl = uws.reduce((s, u) => s + (u.ltl || 0), 0);
    const badDebt = uws.reduce((s, u) => s + (u.badDebt || 0), 0);
    const concessions = uws.reduce((s, u) => s + (u.concessions || 0), 0);
    const otherIncome = uws.reduce((s, u) => s + (u.otherIncome || 0), 0);
    const econLoss0 = physVac + ltl + badDebt + concessions;
    const inPlaceEconVac = gpr0 > 0 ? econLoss0 / gpr0 : 0;
    const wavg = (f) => basis > 0
      ? uws.reduce((s, u) => s + (u[f] || 0) * u.basis, 0) / basis
      : (uws.reduce((s, u) => s + (u[f] || 0), 0) / uws.length);
    const gprGrowth = wavg('gprGrowth'), opexGrowth = wavg('opexGrowth');
    const stabVac = wavg('stabVac'), exitCap = wavg('exitCap'), closingPct = wavg('closingPct');
    return {
      units: uws.reduce((s, u) => s + u.units, 0), price, capex, basis, hold, rows, initialEquity,
      acqProceeds, closingCosts,
      gpr0, physVac, ltl, badDebt, concessions, otherIncome, econLoss0, inPlaceEconVac,
      gprGrowth, opexGrowth, stabVac, exitCap, closingPct,
      salePrice, netSaleProceeds, cfs, irr: dealIRR, equityMultiple, totalDistributions, avgYield,
      propertyCount: props.length, refiOn: uws.some((u) => u.refiOn),
    };
  }

  Object.assign(window, { computeUW, computeLP, computeScenario, computeCombinedUW, inPlaceVacPct, hasUWInputs, displayCaps, dealReturns, returnsSource, hasExcelReturns, irr, makeLoan, balanceAfter, pmt });
})();
