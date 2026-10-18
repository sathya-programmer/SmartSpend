/* SmartSpend admin pages + the customer "Help & feedback" page. Loaded before the main script; uses its helpers ($, api, esc, tbl, empty, mk, modal, hide, run, toast, go, charts) at call time. */
(() => {
  const ST = {}, RL = {}, A = (p, o) => api('/admin' + p, o);
  const qs = o => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  const money = (n, c) => { try { return new Intl.NumberFormat(c === 'INR' ? 'en-IN' : undefined, { style: 'currency', currency: c }).format(n || 0) } catch (e) { return (n || 0).toLocaleString() + ' ' + c } };
  const when = s => { const d = new Date(String(s).replace(' ', 'T') + 'Z'); return isNaN(d) ? esc(s) : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) };
  const SPIN = '<div class="text-center p-4"><span class="spinner-border text-primary"></span></div>';
  const fail = (e, retry) => `<div class="text-center p-4"><i class="bi bi-exclamation-triangle fs-1 text-danger"></i><div class="my-2">${esc(e.message)}</div><button class="btn btn-primary btn-sm" onclick="${retry}"><i class="bi bi-arrow-clockwise"></i> Try again</button></div>`;
  const tile = (i, t, v, c, s) => `<div class="col-6 col-xl-3"><div class="cx st h-100"><div class="ic" style="background:${c};flex:none"><i class="bi bi-${i}"></i></div><div><div class="small text-muted">${t}</div><div class="fw-bold fs-5 text-truncate">${v}</div>${s ? `<div class="small text-muted">${s}</div>` : ''}</div></div></div>`;
  const head = (i, t, a, b) => `<div class="ch"><i class="bi bi-${i}" style="--a:${a || '#1a66ff'};--b:${b || '#8b5cf6'}"></i><h6>${t}</h6></div>`;
  const chartBox = (id, h = 260) => `<div style="position:relative;height:${h}px"><canvas id="${id}"></canvas></div>`;
  const dead = () => charts.splice(0).forEach(c => c.destroy());
  const opt = { responsive: true, maintainAspectRatio: false };
  const gridY = { y: { beginAtZero: true, grid: { color: '#eef2f9' }, border: { display: false } }, x: { grid: { display: false } } };
  const anyData = m => m.some(x => x.income || x.expense);
  const badge = (t, c) => `<span class="badge text-bg-${c}">${t}</span>`;
  const RES = { SUCCESS: 'success', FAILED: 'danger', DENIED: 'warning' }, STAT = { OPEN: ['Open', 'warning'], IN_PROGRESS: ['In progress', 'info'], RESOLVED: ['Resolved', 'success'] };

  /* ---------- generic filter + table + pagination page ---------- */
  function list(c) {
    const S = ST[c.key] = ST[c.key] || { page: 1, ...c.init };
    const inp = f => f.t === 'select' ? `<select class="form-select" data-k="${f.k}" aria-label="${esc(f.p)}">${f.o.map(o => `<option value="${esc(o[0])}"${String(S[f.k] ?? '') === String(o[0]) ? ' selected' : ''}>${esc(o[1])}</option>`).join('')}</select>` : `<input class="form-control" data-k="${f.k}" type="${f.t}" placeholder="${esc(f.p || '')}" aria-label="${esc(f.p || '')}" title="${esc(f.p || '')}" value="${esc(S[f.k] || '')}">`;
    $('#pg').innerHTML = `<div class="cx"><div class="d-flex flex-wrap gap-2 align-items-center mb-3"><h5 class="mb-0 me-auto">${c.title} <span id="cnt" class="badge bg-primary-subtle text-primary-emphasis align-middle"></span></h5>${c.extra || ''}</div><div class="row g-2 mb-3">${c.filters.map(f => `<div class="${f.w || 'col-6 col-lg-3'}">${inp(f)}</div>`).join('')}</div><div id="lst" class="lst-${c.key}"></div></div>`;
    let tm; document.querySelectorAll('#pg [data-k]').forEach(el => el.addEventListener(el.type === 'text' ? 'input' : 'change', () => { S[el.dataset.k] = el.value; clearTimeout(tm); tm = setTimeout(() => { S.page = 1; load() }, el.type === 'text' ? 350 : 0) }));
    async function load() {
      const L = $('#lst'); if (!L) return; L.innerHTML = SPIN;
      try {
        const d = await A(c.ep + '?' + qs({ ...S, size: c.size })); if (!$('#lst')) return;
        if (c.onData) c.onData(d); $('#cnt').textContent = d.total;
        const pager = d.pages > 1 ? `<div class="d-flex justify-content-between align-items-center mt-3"><small class="text-muted">Page ${d.page} of ${d.pages}</small><div class="btn-group"><button class="btn btn-sm btn-light" ${d.page <= 1 ? 'disabled' : ''} onclick="ADMPG('${c.key}',${d.page - 1})"><i class="bi bi-chevron-left"></i> Prev</button><button class="btn btn-sm btn-light" ${d.page >= d.pages ? 'disabled' : ''} onclick="ADMPG('${c.key}',${d.page + 1})">Next <i class="bi bi-chevron-right"></i></button></div></div>` : '';
        $('#lst').innerHTML = (d.rows.length ? c.table(d) : empty(c.empty, c.icon || 'inbox')) + pager;
      } catch (e) { if ($('#lst')) $('#lst').innerHTML = fail(e, `ADMRL.${c.key}()`) }
    }
    RL[c.key] = load; load();
  }
  window.ADMRL = RL; window.ADMPG = (k, p) => { ST[k].page = p; RL[k]() };
  const selOpts = (el, arr, all) => { if (!el || el.dataset.f) return; el.dataset.f = 1; const v = el.value; el.innerHTML = `<option value="">${all}</option>` + arr.map(x => `<option${x === v ? ' selected' : ''}>${esc(x)}</option>`).join('') };

  /* ---------- overview ---------- */
  async function overview() {
    $('#pg').innerHTML = SPIN;
    try {
      const s = await A('/stats'), cur = s.currency, empt = !s.users && !s.transactions;
      $('#pg').innerHTML = `<div class="d-flex flex-wrap align-items-center gap-2 mb-3"><span class="badge text-bg-light border"><i class="bi bi-database"></i> ${esc(s.source.file)} · live data</span><button class="btn btn-sm btn-light ms-auto" onclick="go('admin')"><i class="bi bi-arrow-clockwise"></i> Refresh</button></div>
      ${empt ? `<div class="alert alert-info"><b>This database has no customer records yet.</b> Zeros here are real. If you expected data, make sure the server was started from the right folder (or with the right <code>DB_FILE</code>) — the file in use is <code>${esc(s.source.file)}</code>.</div>` : ''}
      <div class="row g-3 mb-3">${tile('people', 'Registered users', s.users, '#2563eb')}${tile('person-check', 'Active users', s.active, '#16a34a')}${tile('person-slash', 'Deactivated users', s.blocked, '#dc2626')}${tile('person-plus', 'New registrations', s.newWeek, '#0ea5e9', `${s.newMonth} in the last 30 days · ${s.newWeek} in 7 days`)}
      ${tile('arrow-left-right', 'Transactions', s.transactions, '#6366f1')}${tile('pie-chart', 'Budgets', s.budgets, '#f59e0b')}${tile('bullseye', 'Savings goals', s.goals, '#8b5cf6')}${tile('graph-up-arrow', 'Investments', s.investments, '#ec4899')}
      ${tile('arrow-down-circle', 'Total income', money(s.income, cur), '#10b981', cur)}${tile('arrow-up-circle', 'Total expenses', money(s.expense, cur), '#f43f5e', cur)}${tile('cash-stack', 'Net', money(s.income - s.expense, cur), '#0d9488')}${tile('life-preserver', 'Open support requests', s.openSupport, '#f97316')}</div>
      ${s.currencies.length > 1 ? `<div class="small text-muted mb-3"><i class="bi bi-info-circle"></i> Customers use different currencies, so income and expenses are shown for <b>${cur}</b> (the most used). Other currencies: ${s.currencies.filter(x => x.cur !== cur).map(x => `${x.cur} (${money(x.income, x.cur)} in / ${money(x.expense, x.cur)} out)`).join(', ')}. See Analytics to switch.</div>` : ''}
      <div class="row g-3"><div class="col-lg-7"><div class="cx h-100">${head('bar-chart-fill', 'Income vs expenses, last 6 months (' + cur + ')', '#10b981', '#06b6d4')}${anyData(s.months) ? chartBox('o1') : empty('No transactions yet', 'bar-chart')}</div></div><div class="col-lg-5"><div class="cx h-100">${head('person-plus-fill', 'New users, last 6 months', '#6366f1', '#a855f7')}${s.signups.some(x => x.n) ? chartBox('o2') : empty('No registrations in this period', 'people')}</div></div></div>`;
      if (anyData(s.months)) mk('#o1', { type: 'bar', data: { labels: s.months.map(x => x.m), datasets: [{ label: 'Income', data: s.months.map(x => x.income), backgroundColor: '#10b981', borderRadius: 6 }, { label: 'Expenses', data: s.months.map(x => x.expense), backgroundColor: '#f43f5e', borderRadius: 6 }] }, options: { ...opt, scales: gridY } });
      if (s.signups.some(x => x.n)) mk('#o2', { type: 'bar', data: { labels: s.signups.map(x => x.m), datasets: [{ label: 'New users', data: s.signups.map(x => x.n), backgroundColor: '#1a66ff', borderRadius: 6 }] }, options: { ...opt, plugins: { legend: { display: false } }, scales: { ...gridY, y: { ...gridY.y, ticks: { precision: 0 } } } } });
    } catch (e) { $('#pg').innerHTML = `<div class="cx">${fail(e, "go('admin')")}</div>` }
  }

  /* ---------- users ---------- */
  window.ADMU = {};
  const X = window.ADMX = {
    view: id => run(async () => {
      const u = await A('/users/' + id), c = u.counts;
      modal(`<div class="modal-header"><h5>${esc(u.full_name)}</h5><button class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><div class="row g-2 small mb-3"><div class="col-6"><div class="text-muted">Account ID</div><b class="font-monospace">${esc(u.account_id || '—')}</b></div><div class="col-6"><div class="text-muted">Status</div>${u.is_blocked ? badge('Deactivated', 'danger') : badge('Active', 'success')}</div><div class="col-6"><div class="text-muted">Registered</div><b>${when(u.created_at)}</b></div><div class="col-6"><div class="text-muted">Currency</div><b>${esc(u.preferred_currency)}</b></div><div class="col-6"><div class="text-muted">Last transaction</div><b>${u.last_tx || '—'}</b></div><div class="col-6"><div class="text-muted">Open support requests</div><b>${u.open_support}</b></div></div>
      <table class="table table-sm mb-2"><tbody><tr><td>Transactions</td><td class="text-end fw-semibold">${c.transactions}</td></tr><tr><td class="ps-4 text-muted">Income / expense</td><td class="text-end text-muted">${u.income_tx} / ${u.expense_tx}</td></tr><tr><td>Budgets</td><td class="text-end fw-semibold">${c.budgets}</td></tr><tr><td>Savings goals</td><td class="text-end fw-semibold">${c.goals}</td></tr><tr><td>Investments</td><td class="text-end fw-semibold">${c.investments}</td></tr></tbody></table><div class="small text-muted"><i class="bi bi-shield-lock"></i> Passwords and individual amounts are never shown to administrators.</div></div>`);
    }),
    toggle: id => { const u = ADMU[id], on = !!u.is_blocked; if (!on && !confirm(`Deactivate ${u.full_name} (${u.account_id})? They will be signed out and cannot log in until reactivated. Their data is kept.`)) return; run(async () => { await A('/users/' + id + '/status', { method: 'POST', body: { active: on } }); toast(on ? 'Account activated' : 'Account deactivated'); RL.users() }) },
    pw: id => { const u = ADMU[id]; modal(`<div class="modal-header"><h5>Reset password</h5><button class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><p class="small text-muted">Set a new password for <b>${esc(u.full_name)}</b>. They will be signed out on all devices.</p><input id="np" type="password" class="form-control" placeholder="New password" autocomplete="new-password"></div><div class="modal-footer"><button class="btn btn-primary" id="npb">Reset password</button></div>`); $('#npb').onclick = () => run(async () => { await A('/users/' + id + '/password', { method: 'POST', body: { password: $('#np').value } }); hide(); toast('Password reset') }, $('#npb')) },
    del: id => { const u = ADMU[id]; modal(`<div class="modal-header"><h5 class="text-danger">Delete account</h5><button class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><p>This permanently deletes <b>${esc(u.full_name)}</b> and all their transactions, budgets, goals, investments and notifications. <b>It cannot be undone.</b></p><label class="small">Type the Account ID <b class="font-monospace">${esc(u.account_id)}</b> to confirm</label><input id="dc" class="form-control font-monospace" autocomplete="off"></div><div class="modal-footer"><button class="btn btn-light" data-bs-dismiss="modal">Cancel</button><button class="btn btn-danger" id="udb" disabled>Delete account</button></div>`); $('#dc').oninput = () => $('#udb').disabled = $('#dc').value.trim() !== u.account_id; $('#udb').onclick = () => run(async () => { await A('/users/' + id, { method: 'DELETE', body: { confirm: $('#dc').value.trim() } }); hide(); toast('Account deleted'); RL.users() }, $('#udb')) },
    csv: () => run(async () => { const S = ST.tx, t = await api('/admin/transactions/export?' + qs({ q: S.q, type: S.type, category: S.category, from: S.from, to: S.to })), l = document.createElement('a'); l.href = URL.createObjectURL(new Blob([t], { type: 'text/csv' })); l.download = 'smartspend-admin-transactions.csv'; l.click(); toast('CSV exported') }),
    sup: id => { const r = ADMX.sr[id]; modal(`<div class="modal-header"><h5>${esc(r.subject)}</h5><button class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body"><div class="small text-muted mb-2">${esc(r.kind === 'FEEDBACK' ? 'Feedback' : 'Support')} · ${esc(r.account_id || 'deleted account')} · ${when(r.created_at)}</div><div class="p-3 rounded bg-light mb-3" style="white-space:pre-wrap;word-break:break-word">${esc(r.message)}</div><label class="small">Status</label><select id="ss" class="form-select mb-2">${Object.entries(STAT).map(([k, v]) => `<option value="${k}"${k === r.status ? ' selected' : ''}>${v[0]}</option>`).join('')}</select><label class="small">Internal note</label><textarea id="sn" class="form-control" rows="3" maxlength="500">${esc(r.admin_note)}</textarea></div><div class="modal-footer"><button class="btn btn-primary" id="sb2">Save</button></div>`); $('#sb2').onclick = () => run(async () => { await A('/support/' + id, { method: 'PUT', body: { status: $('#ss').value, admin_note: $('#sn').value } }); hide(); toast('Request updated'); RL.support() }, $('#sb2')) }, sr: {}
  };
  const users = () => list({
    key: 'users', title: 'Users', ep: '/users', size: 15, init: { sort: 'newest' }, icon: 'people', empty: 'No users match your search',
    filters: [{ k: 'q', t: 'text', p: 'Search by Account ID or name', w: 'col-12 col-lg-5' }, { k: 'status', t: 'select', p: 'Status', o: [['', 'All statuses'], ['active', 'Active'], ['inactive', 'Deactivated']], w: 'col-6 col-lg-3' }, { k: 'sort', t: 'select', p: 'Sort', o: [['newest', 'Newest first'], ['oldest', 'Oldest first'], ['name', 'Name A–Z'], ['account', 'Account ID'], ['tx', 'Most transactions']], w: 'col-6 col-lg-4' }],
    table: d => { d.rows.forEach(u => ADMU[u.user_id] = u); return tbl(['Account ID', 'Name', 'Registered', 'Transactions', 'Status', ''], d.rows.map(u => `<tr><td><span class="badge text-bg-light border font-monospace">${esc(u.account_id || '—')}</span></td><td>${esc(u.full_name)}<div class="small text-muted">${esc(u.preferred_currency)}</div></td><td>${esc(u.created_at.slice(0, 10))}</td><td>${u.tx_count}</td><td>${u.is_blocked ? badge('Deactivated', 'danger') : badge('Active', 'success')}</td><td class="text-nowrap text-end"><button class="btn btn-sm btn-light" title="View details" onclick="ADMX.view(${u.user_id})"><i class="bi bi-eye"></i></button> <button class="btn btn-sm btn-light" title="${u.is_blocked ? 'Activate' : 'Deactivate'} account" onclick="ADMX.toggle(${u.user_id})"><i class="bi bi-${u.is_blocked ? 'person-check' : 'person-slash'}"></i></button> <button class="btn btn-sm btn-light" title="Reset password" onclick="ADMX.pw(${u.user_id})"><i class="bi bi-key"></i></button> <button class="btn btn-sm btn-light text-danger" title="Delete account" onclick="ADMX.del(${u.user_id})"><i class="bi bi-trash"></i></button></td></tr>`).join('')) }
  });

  /* ---------- transactions ---------- */
  const transactions = () => list({
    key: 'tx', title: 'Transactions', ep: '/transactions', size: 20, init: { sort: 'date_desc' }, icon: 'receipt', empty: 'No transactions match these filters',
    extra: '<button class="btn btn-primary btn-sm" onclick="ADMX.csv()"><i class="bi bi-download"></i> Export CSV</button>',
    filters: [{ k: 'q', t: 'text', p: 'Transaction ID or Account ID', w: 'col-12 col-lg-4' }, { k: 'type', t: 'select', p: 'Type', o: [['', 'All types'], ['INCOME', 'Income'], ['EXPENSE', 'Expense']], w: 'col-6 col-lg-2' }, { k: 'category', t: 'select', p: 'Category', o: [['', 'All categories']], w: 'col-6 col-lg-3' }, { k: 'sort', t: 'select', p: 'Sort', o: [['date_desc', 'Newest first'], ['date_asc', 'Oldest first'], ['amt_desc', 'Highest amount'], ['amt_asc', 'Lowest amount']], w: 'col-12 col-lg-3' }, { k: 'from', t: 'date', p: 'From date', w: 'col-6 col-lg-3' }, { k: 'to', t: 'date', p: 'To date', w: 'col-6 col-lg-3' }],
    onData: d => selOpts(document.querySelector('[data-k=category]'), d.categories, 'All categories'),
    table: d => tbl(['ID', 'Account ID', 'Date', 'Type', 'Category', 'Amount'], d.rows.map(t => `<tr><td>${t.transaction_id}</td><td><span class="badge text-bg-light border font-monospace">${esc(t.account_id)}</span></td><td>${t.transaction_date}</td><td>${t.transaction_type === 'INCOME' ? badge('Income', 'success') : badge('Expense', 'danger')}</td><td>${ic(t.category_name)}${esc(t.category_name)}</td><td class="fw-semibold ${t.transaction_type === 'INCOME' ? 'inc' : 'exp'}">${t.transaction_type === 'INCOME' ? '+' : '−'}${money(t.amount, t.cur)}</td></tr>`).join(''))
  });

  /* ---------- analytics ---------- */
  async function analytics(a) {
    const S = ST.an = ST.an || { currency: '', months: 6 }; if (a) Object.assign(S, a);
    $('#pg').innerHTML = SPIN; dead();
    try {
      const d = await A('/analytics?' + qs(S)), has = anyData(d.months);
      $('#pg').innerHTML = `<div class="d-flex flex-wrap gap-2 align-items-center mb-3"><h5 class="mb-0 me-auto">Financial analytics</h5>${d.currencies.length ? `<select class="form-select w-auto" onchange="ADMX.an({currency:this.value})" aria-label="Currency">${d.currencies.map(c => `<option${c === d.currency ? ' selected' : ''}>${c}</option>`).join('')}</select>` : ''}<select class="form-select w-auto" onchange="ADMX.an({months:+this.value})" aria-label="Period">${[3, 6, 12, 24].map(m => `<option value="${m}"${m === S.months ? ' selected' : ''}>Last ${m} months</option>`).join('')}</select></div>
      <div class="row g-3"><div class="col-lg-7"><div class="cx h-100">${head('bar-chart-fill', 'Monthly income vs expenses (' + d.currency + ')', '#10b981', '#06b6d4')}${has ? chartBox('a1', 300) : empty('No income or expense records in this period', 'bar-chart')}</div></div><div class="col-lg-5"><div class="cx h-100">${head('pie-chart-fill', 'Expense categories', '#f97316', '#f43f5e')}${d.categories.length ? chartBox('a2', 300) : empty('No expenses in this period', 'pie-chart')}</div></div><div class="col-12"><div class="cx">${head('graph-up', 'Transaction volume (number of transactions per month)', '#6366f1', '#a855f7')}${d.trend.some(x => x.n) ? chartBox('a3', 240) : empty('No transactions in this period', 'graph-up')}</div></div></div>`;
      if (has) mk('#a1', { type: 'bar', data: { labels: d.months.map(x => x.m), datasets: [{ label: 'Income', data: d.months.map(x => x.income), backgroundColor: '#10b981', borderRadius: 6 }, { label: 'Expenses', data: d.months.map(x => x.expense), backgroundColor: '#f43f5e', borderRadius: 6 }] }, options: { ...opt, scales: gridY } });
      if (d.categories.length) mk('#a2', { type: 'doughnut', data: { labels: d.categories.map(x => x.n), datasets: [{ data: d.categories.map(x => x.s), backgroundColor: ['#6366f1', '#f97316', '#10b981', '#f43f5e', '#0ea5e9', '#eab308', '#a855f7', '#14b8a6'] }] }, options: { ...opt, plugins: { legend: { position: 'bottom' } } } });
      if (d.trend.some(x => x.n)) mk('#a3', { type: 'line', data: { labels: d.trend.map(x => x.m), datasets: [{ label: 'Transactions', data: d.trend.map(x => x.n), borderColor: '#6366f1', backgroundColor: '#6366f133', fill: true, tension: .3 }] }, options: { ...opt, plugins: { legend: { display: false } }, scales: { ...gridY, y: { ...gridY.y, ticks: { precision: 0 } } } } });
    } catch (e) { $('#pg').innerHTML = `<div class="cx">${fail(e, "go('adminanalytics')")}</div>` }
  }
  X.an = o => analytics(o);

  /* ---------- activity logs, support ---------- */
  const logs = () => list({
    key: 'logs', title: 'Activity logs', ep: '/logs', size: 20, icon: 'journal-text', empty: 'No administrator activity recorded yet',
    filters: [{ k: 'action', t: 'select', p: 'Action', o: [['', 'All actions']], w: 'col-6 col-lg-4' }, { k: 'result', t: 'select', p: 'Result', o: [['', 'All results'], ['SUCCESS', 'Success'], ['FAILED', 'Failed'], ['DENIED', 'Denied']], w: 'col-6 col-lg-3' }],
    onData: d => selOpts(document.querySelector('[data-k=action]'), d.actions, 'All actions'),
    table: d => tbl(['Time', 'Admin', 'Action', 'Target', 'Result', 'Details'], d.rows.map(r => `<tr><td class="text-nowrap">${when(r.created_at)}</td><td>${esc(r.admin_name)}<div class="small text-muted">ID ${r.admin_id ?? '—'}</div></td><td class="font-monospace small">${esc(r.action)}</td><td>${esc(r.target) || '—'}</td><td>${badge(r.result, RES[r.result])}</td><td class="small text-muted">${esc(r.detail) || '—'}</td></tr>`).join(''))
  });
  const support = () => list({
    key: 'support', title: 'Support & feedback', ep: '/support', size: 15, icon: 'life-preserver', empty: 'No support requests or feedback yet',
    filters: [{ k: 'q', t: 'text', p: 'Search Account ID or subject', w: 'col-12 col-lg-5' }, { k: 'kind', t: 'select', p: 'Type', o: [['', 'Support & feedback'], ['SUPPORT', 'Support'], ['FEEDBACK', 'Feedback']], w: 'col-6 col-lg-3' }, { k: 'status', t: 'select', p: 'Status', o: [['', 'All statuses'], ['OPEN', 'Open'], ['IN_PROGRESS', 'In progress'], ['RESOLVED', 'Resolved']], w: 'col-6 col-lg-4' }],
    table: d => { d.rows.forEach(r => ADMX.sr[r.request_id] = r); return tbl(['#', 'Account', 'Type', 'Subject', 'Status', 'Received', ''], d.rows.map(r => `<tr><td>${r.request_id}</td><td><span class="badge text-bg-light border font-monospace">${esc(r.account_id || '—')}</span></td><td>${r.kind === 'FEEDBACK' ? badge('Feedback', 'primary') : badge('Support', 'secondary')}</td><td>${esc(r.subject)}</td><td>${badge(STAT[r.status][0], STAT[r.status][1])}</td><td class="text-nowrap">${when(r.created_at)}</td><td class="text-end"><button class="btn btn-sm btn-light" title="Open" onclick="ADMX.sup(${r.request_id})"><i class="bi bi-chat-left-text"></i></button></td></tr>`).join('')) }
  });

  /* ---------- settings + health ---------- */
  async function settings() {
    $('#pg').innerHTML = SPIN;
    try {
      const [{ settings: s }, h] = await Promise.all([A('/settings'), A('/health')]), up = h.server.uptimeSec, T = h.db.tables;
      $('#pg').innerHTML = `<div class="row g-3"><div class="col-lg-5"><div class="cx h-100">${head('gear-fill', 'Application settings', '#2563eb', '#8b5cf6')}
        <div class="form-check form-switch mb-3"><input class="form-check-input" type="checkbox" id="s1" ${s.registration_open === '1' ? 'checked' : ''}><label class="form-check-label" for="s1">Allow new registrations</label></div>
        <label class="small" for="s2">Failed-login limit (3–50 attempts per 10 minutes)</label><input id="s2" type="number" min="3" max="50" class="form-control mb-3" value="${esc(s.login_attempt_limit)}">
        <label class="small" for="s3">Support email shown to customers (optional)</label><input id="s3" type="email" class="form-control mb-3" maxlength="160" value="${esc(s.support_email)}" placeholder="support@example.com">
        <div id="se" class="text-danger small mb-2" role="alert"></div><button class="btn btn-primary" id="ssv"><i class="bi bi-check2"></i> Save settings</button><div class="small text-muted mt-2">Values are validated again on the server before they are saved.</div></div></div>
      <div class="col-lg-7"><div class="cx h-100"><div class="d-flex">${head('heart-pulse-fill', 'System health', '#10b981', '#06b6d4')}<button class="btn btn-sm btn-light ms-auto align-self-start" onclick="go('adminsettings')"><i class="bi bi-arrow-clockwise"></i> Refresh</button></div>
        <div class="row g-2 mb-3">${[['Database', h.db.ok ? badge('Healthy', 'success') : badge('Problem', 'danger'), h.db.ok ? 'Integrity check passed' : esc(h.db.error || h.db.check)], ['Server', badge('Running', 'success'), `Up ${Math.floor(up / 3600)}h ${Math.floor(up % 3600 / 60)}m`], ['Database file', `<b>${esc(h.db.file)}</b>`, `${h.db.sizeKB} KB · ${esc(h.db.journal)} mode`], ['Runtime', `<b>Node ${esc(h.server.node)}</b>`, `${h.server.memoryMB} MB memory`], ['Active sessions', `<b>${h.activeSessions}</b>`, 'signed-in browsers']].map(x => `<div class="col-6"><div class="p-2 rounded bg-light h-100"><div class="small text-muted">${x[0]}</div><div>${x[1]}</div><div class="small text-muted">${x[2]}</div></div></div>`).join('')}</div>
        <div class="small text-muted mb-1">Records in the database</div><div class="d-flex flex-wrap gap-2">${Object.entries(T).map(([k, v]) => `<span class="badge text-bg-light border">${esc(k)}: ${v}</span>`).join('')}</div></div></div></div>`;
      $('#ssv').onclick = () => run(async () => { $('#se').textContent = ''; try { await A('/settings', { method: 'PUT', body: { registration_open: $('#s1').checked ? '1' : '0', login_attempt_limit: $('#s2').value, support_email: $('#s3').value } }); toast('Settings saved') } catch (e) { $('#se').textContent = e.message; throw e } }, $('#ssv'));
    } catch (e) { $('#pg').innerHTML = `<div class="cx">${fail(e, "go('adminsettings')")}</div>` }
  }

  /* ---------- customer page: send support request / feedback ---------- */
  const help = () => { $('#pg').innerHTML = `<div class="cx" style="max-width:640px"><h5>Help &amp; feedback</h5><p class="small text-muted">Ask for help or tell us what to improve. An administrator will review it.</p><select id="hk" class="form-select mb-2"><option value="SUPPORT">I need help</option><option value="FEEDBACK">I have feedback</option></select><input id="hs" class="form-control mb-2" maxlength="80" placeholder="Subject"><textarea id="hm" class="form-control mb-3" rows="5" maxlength="1000" placeholder="Write your message…"></textarea><button class="btn btn-primary" id="hb2">Send</button></div>`; $('#hb2').onclick = () => run(async () => { await api('/support', { method: 'POST', body: { kind: $('#hk').value, subject: $('#hs').value, message: $('#hm').value } }); toast('Thank you! Your message was sent.'); $('#hs').value = $('#hm').value = '' }, $('#hb2')) };

  window.EXTRA_PAGES = { admin: overview, adminusers: users, admintx: transactions, adminanalytics: analytics, adminlogs: logs, adminsupport: support, adminsettings: settings, help };
})();
