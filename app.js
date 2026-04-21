// ── Divy App ──────────────────────────────────────────

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const FREQ_N = { monthly: 12, quarterly: 4, semiannual: 2, annual: 1 };
const FREQ_LABELS = { monthly: 'Monthly', quarterly: 'Quarterly', semiannual: 'Semiannual', annual: 'Annual' };

let portfolio = [];
let nextId = 1;
let editingId = null;
let calYear = new Date().getFullYear();
let calMonth = new Date().getMonth();
const today = new Date();

let timerInterval = null;
let timerStart = null;
let timerElapsed = 0;
let timerRunning = false;

// ── Persistence ───────────────────────────────────────

function savePortfolio() {
  try {
    localStorage.setItem('divy_portfolio', JSON.stringify(portfolio));
    localStorage.setItem('divy_nextId', String(nextId));
    localStorage.setItem('divy_updated', new Date().toISOString());
  } catch(e) { console.warn('Could not save to localStorage:', e); }
}

function loadPortfolio() {
  try {
    const saved = localStorage.getItem('divy_portfolio');
    const savedId = localStorage.getItem('divy_nextId');
    const updated = localStorage.getItem('divy_updated');
    if (saved) portfolio = JSON.parse(saved);
    if (savedId) nextId = parseInt(savedId);
    if (updated) {
      const d = new Date(updated);
      document.getElementById('last-updated').textContent =
        'Saved ' + d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
    }
  } catch(e) { console.warn('Could not load from localStorage:', e); portfolio = []; }
}

// ── Helpers ───────────────────────────────────────────

function f$(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fp(n) { return Number(n).toFixed(2) + '%'; }
function adiv(s) { return s.shares * (s.divPerShare || 0); }
function tval(s) { return s.shares * (s.currentPrice || s.price || 0); }
function costBasis(s) { return s.shares * (s.price || 0); }
function gl(s) {
  if (!s.price || !s.currentPrice) return null;
  return (s.currentPrice - s.price) * s.shares;
}
function glPct(s) {
  if (!s.price || !s.currentPrice || s.price === 0) return null;
  return (s.currentPrice - s.price) / s.price * 100;
}
function yld(s) {
  const v = tval(s);
  return v > 0 ? adiv(s) / v * 100 : 0;
}

function showToast(msg, duration = 2800) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), duration);
}

// ── Add / Remove / Edit ───────────────────────────────

let pendingAdd = null; // holds fetched data while user reviews

async function fetchAndPreview() {
  const ticker = document.getElementById('a-ticker').value.trim().toUpperCase();
  const shares = parseFloat(document.getElementById('a-shares').value);

  if (!ticker) { showFormError('Please enter a ticker symbol.'); return; }
  if (!shares || isNaN(shares) || shares <= 0) { showFormError('Please enter a number of shares.'); return; }
  if (portfolio.find(s => s.ticker === ticker)) { showFormError(ticker + ' is already in your portfolio.'); return; }

  const btn = document.getElementById('fetch-btn');
  btn.disabled = true;
  btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 0.7s linear infinite"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg> Looking up...';
  document.getElementById('add-err').style.display = 'none';

  let currentPrice = 0, divPerShare = 0, name = ticker, freq = 'quarterly';
  let exDay = 15, payDay = 25, divYield = 0;
  let fetchFailed = false, note = '';

  try {
    const data = await fetchFinnhubFull(ticker);
    if (!data) throw new Error('No data returned');

    currentPrice = data.currentPrice;
    name = data.name;
    divPerShare = data.annualDiv;
    divYield = parseFloat(data.divYield);
    freq = data.freq;
    exDay = data.exDay;
    payDay = data.payDay;

    note = divPerShare > 0
      ? `Yield: ${data.divYield}%  ·  $${divPerShare.toFixed(2)}/sh annually  ·  ${freq}`
      : `No dividend history found — enter one manually if applicable.`;

  } catch(e) {
    fetchFailed = true;
    note = 'Could not fetch data — fill in the fields manually below.';
    console.warn('Finnhub fetch error:', e);
  }

  pendingAdd = {
    ticker, shares, name, freq, exDay, payDay,
    price: parseFloat(document.getElementById('a-price').value) || 0,
    currentPrice, divPerShare, divYield,
  };

  document.getElementById('preview-name').textContent = name;
  document.getElementById('preview-ticker').textContent = ticker;
  document.getElementById('p-cprice').value = currentPrice ? currentPrice.toFixed(2) : '';
  document.getElementById('p-div').value = divPerShare ? divPerShare.toFixed(4) : '';
  document.getElementById('p-freq').value = freq;
  document.getElementById('p-exday').value = exDay;
  document.getElementById('p-payday').value = payDay;
  document.getElementById('preview-note').textContent = note;
  document.getElementById('preview-note').style.color = fetchFailed ? 'var(--amber)' : '';
  document.getElementById('add-preview').style.display = 'block';

  btn.disabled = false;
  btn.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Look up ticker';
}

function confirmAdd() {
  if (!pendingAdd) return;
  const s = {
    id: nextId++,
    ticker: pendingAdd.ticker,
    name: pendingAdd.name,
    shares: pendingAdd.shares,
    price: pendingAdd.price,
    currentPrice: parseFloat(document.getElementById('p-cprice').value) || pendingAdd.currentPrice,
    divPerShare: parseFloat(document.getElementById('p-div').value) || 0,
    freq: document.getElementById('p-freq').value,
    exDay: parseInt(document.getElementById('p-exday').value) || 15,
    payDay: parseInt(document.getElementById('p-payday').value) || 25,
  };
  portfolio.push(s);
  savePortfolio();
  cancelPreview();
  renderAll();
  showToast(s.ticker + ' added — ' + s.shares + ' shares');
}

function cancelPreview() {
  pendingAdd = null;
  document.getElementById('add-preview').style.display = 'none';
  document.getElementById('a-ticker').value = '';
  document.getElementById('a-shares').value = '';
  document.getElementById('a-price').value = '';
  document.getElementById('add-err').style.display = 'none';
}

function showFormError(msg) {
  const err = document.getElementById('add-err');
  err.textContent = msg;
  err.style.display = 'block';
  setTimeout(() => { err.style.display = 'none'; }, 5000);
}

function removeStock(id) {
  const s = portfolio.find(s => s.id === id);
  if (!s) return;
  if (!confirm('Remove ' + s.ticker + ' from your portfolio?')) return;
  portfolio = portfolio.filter(s => s.id !== id);
  if (editingId === id) editingId = null;
  savePortfolio();
  renderAll();
  showToast(s.ticker + ' removed');
}

function startEdit(id) {
  editingId = (editingId === id ? null : id);
  renderHoldings();
}

function saveEdit(id) {
  const s = portfolio.find(s => s.id === id);
  if (!s) return;
  s.name = document.getElementById('e-name-' + id).value || s.ticker;
  s.shares = parseFloat(document.getElementById('e-shares-' + id).value) || s.shares;
  s.price = parseFloat(document.getElementById('e-price-' + id).value) || 0;
  s.currentPrice = parseFloat(document.getElementById('e-cprice-' + id).value) || s.currentPrice;
  s.divPerShare = parseFloat(document.getElementById('e-div-' + id).value) || 0;
  s.freq = document.getElementById('e-freq-' + id).value;
  s.exDay = parseInt(document.getElementById('e-exday-' + id).value) || s.exDay;
  s.payDay = parseInt(document.getElementById('e-payday-' + id).value) || s.payDay;
  editingId = null;
  savePortfolio();
  renderAll();
  showToast(s.ticker + ' updated');
}

function cancelEdit() {
  editingId = null;
  renderHoldings();
}

// ── Finnhub API ───────────────────────────────────────

const FINNHUB_KEY = 'd7junu1r01qnk4ocuts0d7junu1r01qnk4ocutsg';
const FH_BASE = 'https://finnhub.io/api/v1';

async function fhGet(path, params = {}) {
  const p = new URLSearchParams({ ...params, token: FINNHUB_KEY });
  const res = await fetch(`${FH_BASE}${path}?${p}`);
  if (!res.ok) throw new Error(`Finnhub ${res.status}: ${path}`);
  return res.json();
}

// Fetch everything needed to add a stock: quote + profile + dividend history
async function fetchFinnhubFull(ticker) {
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 2 * 365 * 86400000).toISOString().slice(0, 10);

  const [quoteRes, profileRes, divRes] = await Promise.allSettled([
    fhGet('/quote', { symbol: ticker }),
    fhGet('/stock/profile2', { symbol: ticker }),
    fhGet('/stock/dividend', { symbol: ticker, from, to }),
  ]);

  const quote   = quoteRes.status   === 'fulfilled' ? quoteRes.value   : null;
  const profile = profileRes.status === 'fulfilled' ? profileRes.value : null;
  const divs    = divRes.status     === 'fulfilled' ? (Array.isArray(divRes.value) ? divRes.value : []) : [];

  if (!quote || !quote.c || quote.c === 0) return null;

  // Sort dividends newest-first
  divs.sort((a, b) => new Date(b.exDate || b.date) - new Date(a.exDate || a.date));
  const latest = divs[0] || null;

  // Infer frequency from how many dividends in the past 12 months
  const oneYearAgo = Date.now() - 365 * 86400000;
  const recent = divs.filter(d => new Date(d.exDate || d.date) > oneYearAgo);
  let freq = 'quarterly';
  if (recent.length >= 10) freq = 'monthly';
  else if (recent.length <= 1) freq = 'annual';
  else if (recent.length === 2) freq = 'semiannual';

  const freqN = FREQ_N[freq] || 4;
  const divAmount = latest?.amount || 0;
  const annualDiv = divAmount * freqN;

  let exDay = 15, payDay = 25;
  if (latest?.exDate) exDay = new Date(latest.exDate).getDate();
  if (latest?.payDate) payDay = new Date(latest.payDate).getDate();

  const currentPrice = quote.c;

  return {
    name: profile?.name || ticker,
    currentPrice,
    annualDiv,
    freq,
    exDay,
    payDay,
    divYield: currentPrice > 0 ? (annualDiv / currentPrice * 100).toFixed(2) : '0.00',
  };
}

// ── Refresh all prices ────────────────────────────────

async function refreshPrices() {
  if (portfolio.length === 0) { showToast('No stocks to refresh'); return; }
  const btn = document.getElementById('refresh-prices-btn');
  const ICON_SPIN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="animation:spin 0.7s linear infinite"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';
  const ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>';
  btn.disabled = true;
  btn.innerHTML = ICON_SPIN + ' Refreshing...';

  let updated = 0;
  for (const s of portfolio) {
    try {
      const q = await fhGet('/quote', { symbol: s.ticker });
      if (q.c && q.c > 0) { s.currentPrice = q.c; updated++; }
      await new Promise(r => setTimeout(r, 200)); // respect 60 req/min free tier
    } catch(e) { console.warn('Refresh failed for', s.ticker, e); }
  }
  savePortfolio();
  renderAll();
  showToast(`Updated ${updated} stock${updated !== 1 ? 's' : ''}`);
  btn.disabled = false;
  btn.innerHTML = ICON + ' Refresh prices';
}

// ── Dividend date logic ───────────────────────────────

function getDivDates(s, year, month) {
  const evs = [];
  if (!s.divPerShare || s.divPerShare === 0) return evs;
  const freq = s.freq;
  let ok = false;
  if (freq === 'monthly') ok = true;
  else if (freq === 'quarterly') ok = [1, 4, 7, 10].includes(month + 1);
  else if (freq === 'semiannual') ok = [1, 7].includes(month + 1);
  else if (freq === 'annual') ok = (month === 0);
  if (ok) {
    const n = FREQ_N[freq] || 4;
    const maxDay = new Date(year, month + 1, 0).getDate();
    const exD = Math.min(s.exDay || 15, maxDay);
    const payD = Math.min(s.payDay || 25, maxDay);
    evs.push({ type: 'ex', day: exD, ticker: s.ticker });
    evs.push({ type: 'pay', day: payD, ticker: s.ticker, amount: s.divPerShare * s.shares / n });
  }
  return evs;
}

function getNextPayments(days) {
  const result = [];
  for (let d = 0; d <= days; d++) {
    const date = new Date(today);
    date.setDate(today.getDate() + d);
    const y = date.getFullYear(), m = date.getMonth(), day = date.getDate();
    portfolio.forEach(s => {
      getDivDates(s, y, m).forEach(ev => {
        if (ev.type === 'pay' && ev.day === day) result.push({ ...ev, date: new Date(date), stock: s });
      });
    });
  }
  return result.sort((a, b) => a.date - b.date);
}

// ── Render: Portfolio ─────────────────────────────────

function renderPortfolio() {
  const totA = portfolio.reduce((a, s) => a + adiv(s), 0);
  const totV = portfolio.reduce((a, s) => a + tval(s), 0);
  const totCost = portfolio.reduce((a, s) => a + costBasis(s), 0);
  const totGL = totV - totCost;
  const avgY = totV > 0 ? totA / totV * 100 : 0;

  document.getElementById('port-metrics').innerHTML = `
    <div class="metric">
      <div class="metric-label">Holdings</div>
      <div class="metric-value">${portfolio.length}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Portfolio value</div>
      <div class="metric-value">${f$(totV)}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Annual dividends</div>
      <div class="metric-value green">${f$(totA)}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Avg yield</div>
      <div class="metric-value green">${fp(avgY)}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Gain / loss</div>
      <div class="metric-value ${totGL >= 0 ? 'green' : ''}" style="${totGL < 0 ? 'color:var(--red)' : ''}">${totGL >= 0 ? '+' : ''}${f$(totGL)}</div>
    </div>
  `;

  document.getElementById('header-annual').textContent = portfolio.length ? f$(totA) + '/yr' : '';
  document.getElementById('port-yield').textContent = 'Avg yield: ' + fp(avgY);
}

function renderHoldings() {
  const tbody = document.getElementById('holdings-body');
  const empty = document.getElementById('holdings-empty');

  if (!portfolio.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  tbody.innerHTML = portfolio.map(s => {
    const isEditing = editingId === s.id;
    const gainLoss = gl(s);
    const gainLossPct = glPct(s);

    if (isEditing) {
      return `<tr class="edit-row">
        <td><span class="ticker-mono">${s.ticker}</span></td>
        <td><input id="e-name-${s.id}" value="${s.name}" placeholder="Company name" style="min-width:100px"></td>
        <td><input id="e-shares-${s.id}" type="number" value="${s.shares}" step="any" style="width:70px"></td>
        <td><input id="e-price-${s.id}" type="number" value="${s.price}" step="any" style="width:80px"></td>
        <td><input id="e-cprice-${s.id}" type="number" value="${s.currentPrice}" step="any" style="width:80px"></td>
        <td><input id="e-div-${s.id}" type="number" value="${s.divPerShare}" step="any" style="width:80px"></td>
        <td><select id="e-freq-${s.id}" style="width:110px">
          <option value="monthly"${s.freq==='monthly'?' selected':''}>Monthly</option>
          <option value="quarterly"${s.freq==='quarterly'?' selected':''}>Quarterly</option>
          <option value="semiannual"${s.freq==='semiannual'?' selected':''}>Semiannual</option>
          <option value="annual"${s.freq==='annual'?' selected':''}>Annual</option>
        </select></td>
        <td><input id="e-exday-${s.id}" type="number" value="${s.exDay}" min="1" max="28" style="width:55px"></td>
        <td><input id="e-payday-${s.id}" type="number" value="${s.payDay}" min="1" max="31" style="width:55px"></td>
        <td colspan="3" style="color:var(--text-muted);font-size:12px">${f$(adiv(s))}/yr &nbsp; ${fp(yld(s))} yield</td>
        <td>
          <div class="actions-cell">
            <button class="btn btn-sm btn-primary" onclick="saveEdit(${s.id})">Save</button>
            <button class="btn btn-sm btn-ghost" onclick="cancelEdit()">Cancel</button>
          </div>
        </td>
      </tr>`;
    }

    const glStr = gainLoss !== null
      ? `<span class="${gainLoss >= 0 ? 'gl-positive' : 'gl-negative'}">${gainLoss >= 0 ? '+' : ''}${f$(gainLoss)}<br><span style="font-size:10px">${gainLoss >= 0 ? '+' : ''}${gainLossPct.toFixed(1)}%</span></span>`
      : '<span style="color:var(--text-faint)">—</span>';

    return `<tr>
      <td><span class="ticker-mono">${s.ticker}</span></td>
      <td><span class="name-cell" title="${s.name}">${s.name}</span></td>
      <td>${s.shares.toLocaleString()}</td>
      <td style="font-family:var(--mono);font-size:12px;color:var(--text-muted)">${s.price ? f$(s.price) : '—'}</td>
      <td><span class="price-cell">${s.currentPrice ? f$(s.currentPrice) : '—'}</span></td>
      <td style="font-family:var(--mono);font-size:12px">${f$(s.divPerShare)}</td>
      <td><span class="freq-badge ${s.freq}">${FREQ_LABELS[s.freq]}</span></td>
      <td style="color:var(--text-faint);font-size:12px">${s.exDay}</td>
      <td style="color:var(--text-faint);font-size:12px">${s.payDay}</td>
      <td><span class="total-cell">${f$(adiv(s))}</span></td>
      <td><span class="yield-cell">${fp(yld(s))}</span></td>
      <td>${glStr}</td>
      <td>
        <div class="actions-cell">
          <button class="btn btn-sm btn-edit" onclick="startEdit(${s.id})">Edit</button>
          <button class="btn btn-sm btn-danger" onclick="removeStock(${s.id})">✕</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ── Render: Calendar ──────────────────────────────────

function renderCalendar() {
  document.getElementById('cal-title').textContent = MONTHS[calMonth] + ' ' + calYear;

  const hds = document.getElementById('cal-hds');
  hds.innerHTML = DAYS.map(d => `<div class="cal-day-header">${d}</div>`).join('');

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const dim = new Date(calYear, calMonth + 1, 0).getDate();

  const evMap = {};
  portfolio.forEach(s => getDivDates(s, calYear, calMonth).forEach(ev => {
    if (!evMap[ev.day]) evMap[ev.day] = [];
    evMap[ev.day].push(ev);
  }));

  let html = '';
  for (let i = 0; i < firstDay; i++) html += '<div class="cal-day empty"></div>';
  for (let d = 1; d <= dim; d++) {
    const isToday = calYear === today.getFullYear() && calMonth === today.getMonth() && d === today.getDate();
    const evs = evMap[d] || [];
    html += `<div class="cal-day${isToday ? ' today' : ''}">
      <div class="cal-day-num">${d}</div>
      ${evs.map(ev => `<div class="cal-event ${ev.type === 'pay' ? 'pay' : 'ex'}">${ev.ticker} ${ev.type === 'pay' ? 'pay' : 'ex'}</div>`).join('')}
    </div>`;
  }
  document.getElementById('cal-days').innerHTML = html;
}

function calMove(dir) {
  calMonth += dir;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  if (calMonth < 0) { calMonth = 11; calYear--; }
  renderCalendar();
}

// ── Render: Income ────────────────────────────────────

function renderIncome() {
  const totA = portfolio.reduce((a, s) => a + adiv(s), 0);

  document.getElementById('inc-metrics').innerHTML = `
    <div class="metric"><div class="metric-label">Daily avg</div><div class="metric-value green">${f$(totA / 365)}</div><div class="metric-sub">per day</div></div>
    <div class="metric"><div class="metric-label">Monthly avg</div><div class="metric-value green">${f$(totA / 12)}</div><div class="metric-sub">per month</div></div>
    <div class="metric"><div class="metric-label">Quarterly avg</div><div class="metric-value green">${f$(totA / 4)}</div><div class="metric-sub">per quarter</div></div>
    <div class="metric"><div class="metric-label">Annual total</div><div class="metric-value green">${f$(totA)}</div><div class="metric-sub">per year</div></div>
  `;

  // Monthly chart
  const mi = Array(12).fill(0);
  portfolio.forEach(s => {
    for (let m = 0; m < 12; m++) {
      getDivDates(s, today.getFullYear(), m).filter(e => e.type === 'pay').forEach(e => { mi[m] += e.amount; });
    }
  });
  const mx = Math.max(...mi, 1);
  document.getElementById('inc-chart').innerHTML = mi.map((v, i) => {
    const h = Math.max(3, Math.round(v / mx * 110));
    const isCurrent = i === today.getMonth();
    return `<div class="bar-col">
      <div class="bar-val">${v > 0 ? '$' + Math.round(v) : ''}</div>
      <div class="bar-body${isCurrent ? ' current-month' : ''}" style="height:${h}px"></div>
    </div>`;
  }).join('');
  document.getElementById('inc-labels').innerHTML = MS.map(m =>
    `<div class="month-label">${m}</div>`).join('');

  // Upcoming payments
  const upcoming = getNextPayments(90);
  const ul = document.getElementById('upcoming-list');
  const ue = document.getElementById('upcoming-empty');
  if (!upcoming.length) {
    ul.innerHTML = '';
    ue.style.display = 'block';
  } else {
    ue.style.display = 'none';
    const grp = {};
    upcoming.forEach(p => {
      const k = p.date.toDateString();
      if (!grp[k]) grp[k] = { date: p.date, items: [] };
      grp[k].items.push(p);
    });
    ul.innerHTML = Object.values(grp).map(g => {
      const tot = g.items.reduce((a, i) => a + (i.amount || 0), 0);
      const du = Math.round((g.date - today) / 86400000);
      return `<div class="upcoming-row">
        <div class="upcoming-info">
          <div class="upcoming-date">${g.date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</div>
          <div class="upcoming-meta">${g.items.map(i => i.ticker).join(', ')} &nbsp;·&nbsp; in ${du} day${du === 1 ? '' : 's'}</div>
        </div>
        <div class="upcoming-amount">${f$(tot)}</div>
      </div>`;
    }).join('');
  }

  // By holding chart
  const byHolding = portfolio.map(s => ({ ticker: s.ticker, amount: adiv(s) }))
    .sort((a, b) => b.amount - a.amount);
  const maxH = byHolding.length ? byHolding[0].amount : 1;
  document.getElementById('by-holding-chart').innerHTML = byHolding.length
    ? byHolding.map((h, i) => `
      <div class="holding-bar-row">
        <div class="holding-bar-ticker">${h.ticker}</div>
        <div class="holding-bar-track"><div class="holding-bar-fill${i === 0 ? ' top' : ''}" style="width:${Math.round(h.amount / maxH * 100)}%"></div></div>
        <div class="holding-bar-amount">${f$(h.amount)}</div>
      </div>`).join('')
    : '<p style="color:var(--text-faint);font-size:13px;padding:12px 0">No holdings yet.</p>';
}

// ── Render: Timer ─────────────────────────────────────

function renderTimer() {
  const totA = portfolio.reduce((a, s) => a + adiv(s), 0);
  const perSec = totA / (365 * 24 * 3600);
  document.getElementById('trate').textContent = totA > 0
    ? f$(perSec) + '/sec  ·  ' + f$(perSec * 3600) + '/hr'
    : '';

  const upcoming = getNextPayments(365);
  const seen = {};
  const filtered = upcoming.filter(p => { if (seen[p.ticker]) return false; seen[p.ticker] = true; return true; }).slice(0, 6);
  const list = document.getElementById('next-divs-list');
  if (!filtered.length) {
    list.innerHTML = '<p style="color:var(--text-faint);font-size:13px;padding:8px 0">Add stocks to see upcoming dividends.</p>';
    return;
  }
  list.innerHTML = filtered.map(p => {
    const du = Math.max(0, Math.round((p.date - today) / 86400000));
    const period = 365 / (FREQ_N[p.stock.freq] || 4);
    const pct = Math.min(100, Math.max(0, 100 - du / period * 100));
    return `<div class="next-div-row">
      <div class="next-div-top">
        <div>
          <span class="next-div-name">${p.ticker}</span>
          <span style="font-size:12px;color:var(--text-faint);margin-left:8px">${p.stock.name}</span>
        </div>
        <div class="next-div-amount">${f$(p.amount)}</div>
      </div>
      <div class="next-div-meta">
        <span>${p.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        <span>${du} day${du === 1 ? '' : 's'} away</span>
      </div>
      <div class="progress-bar"><div class="progress-fill" style="width:${pct.toFixed(1)}%"></div></div>
    </div>`;
  }).join('');
}

function timerToggle() {
  if (!timerRunning) {
    timerStart = Date.now() - timerElapsed;
    timerInterval = setInterval(() => {
      timerElapsed = Date.now() - timerStart;
      const totA = portfolio.reduce((a, s) => a + adiv(s), 0);
      const earned = (timerElapsed * totA / (365 * 24 * 3600 * 1000)).toFixed(6);
      const h = Math.floor(timerElapsed / 3600000);
      const m = Math.floor((timerElapsed % 3600000) / 60000);
      const sec = Math.floor((timerElapsed % 60000) / 1000);
      document.getElementById('tclk').textContent =
        String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0') + ':' + String(sec).padStart(2,'0');
      document.getElementById('tearn').textContent = '$' + earned + ' earned this session';
    }, 100);
    timerRunning = true;
    document.getElementById('tbtn').textContent = 'Pause';
    document.getElementById('tlabel').textContent = 'Dividends accumulating...';
  } else {
    clearInterval(timerInterval);
    timerRunning = false;
    document.getElementById('tbtn').textContent = 'Resume';
    document.getElementById('tlabel').textContent = 'Paused';
  }
}

function timerReset() {
  clearInterval(timerInterval);
  timerRunning = false;
  timerElapsed = 0;
  document.getElementById('tclk').textContent = '00:00:00';
  document.getElementById('tearn').textContent = '$0.000000 earned this session';
  document.getElementById('tbtn').textContent = 'Start';
  document.getElementById('tlabel').textContent = 'Track time & dividends accumulating in real time';
}

// ── Tab switching ─────────────────────────────────────

function showTab(name, el) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  el.classList.add('active');
  if (name === 'calendar') renderCalendar();
  if (name === 'income') renderIncome();
  if (name === 'timer') renderTimer();
}

// ── Render all ────────────────────────────────────────

function renderAll() {
  renderPortfolio();
  renderHoldings();
  if (document.getElementById('tab-calendar').classList.contains('active')) renderCalendar();
  if (document.getElementById('tab-income').classList.contains('active')) renderIncome();
  if (document.getElementById('tab-timer').classList.contains('active')) renderTimer();
}

// ── Spin animation for refresh button ─────────────────
const style = document.createElement('style');
style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
document.head.appendChild(style);

// ── Init ──────────────────────────────────────────────
loadPortfolio();
renderAll();
