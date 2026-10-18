'use strict';
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const db = require('./db');
const PORT = +process.env.PORT || 3000, HOST = process.env.HOST || '127.0.0.1', PUB = path.join(__dirname, 'public');
const COOKIE = 'ss_session', DAYS = 30;

/* ---------- small helpers ---------- */
const q = (sql, ...p) => db.prepare(sql).all(...p).map(r => ({ ...r }));
const q1 = (sql, ...p) => { const r = db.prepare(sql).get(...p); return r ? { ...r } : null; };
const ex = (sql, ...p) => { const r = db.prepare(sql).run(...p); return { changes: Number(r.changes), id: Number(r.lastInsertRowid) }; };
class HttpErr extends Error { constructor(msg, code = 400) { super(msg); this.code = code; } }
const bad = (m, c) => { throw new HttpErr(m, c); };
const r2 = n => Math.round(n * 100) / 100, sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const num = v => { const n = Number(String(v ?? '').replace(/,/g, '')); return isFinite(n) && Math.abs(n) < 1e12 ? n : NaN; };
const str = (v, max = 120) => String(v ?? '').trim().slice(0, max);
const DT = /^\d{4}-\d{2}-\d{2}$/, MT = /^\d{4}-\d{2}$/, validDate = v => DT.test(v || '') && !isNaN(Date.parse(v));
const today = () => new Date().toLocaleDateString('en-CA');
const mo = i => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); return d.toLocaleDateString('en-CA').slice(0, 7); };
const ml = m => new Date(m + '-01T00:00:00').toLocaleString('en-US', { month: 'short', year: '2-digit' });
const money = (n, c) => new Intl.NumberFormat(c === 'INR' ? 'en-IN' : undefined, { style: 'currency', currency: c }).format(n || 0);
const INV = ['Stocks', 'Mutual Funds', 'Gold', 'Fixed Deposit', 'Crypto', 'Real Estate', 'Other'], CUR = require('./currencies');
const CI = ['Salary', 'Freelancing', 'Business', 'Investments', 'Other Income'], CE = ['Food', 'Transportation', 'Education', 'Shopping', 'Housing', 'Bills and Utilities', 'Healthcare', 'Entertainment', 'Travel', 'Other Expenses'];

/* ---------- passwords and sessions ---------- */
const hashPw = pw => { const salt = crypto.randomBytes(16); return salt.toString('hex') + ':' + crypto.scryptSync(pw, salt, 64).toString('hex'); };
const checkPw = (pw, stored) => { const [s, h] = String(stored).split(':'); if (!s || !h) return false; const a = crypto.scryptSync(pw, Buffer.from(s, 'hex'), 64), b = Buffer.from(h, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b); };
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
// The Account ID is created here, inside the same transaction that saves the user: if anything fails nothing is saved and the counter
// is rolled back too. BEGIN IMMEDIATE takes the write lock first, so two sign-ups (even in two server processes) can never read the same number.
function createUser(name, pw, email, cur) {
  const hash = hashPw(pw);   // slow on purpose, so it is done before the lock is taken
  db.exec('BEGIN IMMEDIATE');
  try {
    ex("UPDATE counters SET value = value + 1 WHERE name='account_id'");
    const accountId = 'ACC' + q1("SELECT value FROM counters WHERE name='account_id'").value;
    const uid = ex('INSERT INTO users(account_id,full_name,email,password_hash,preferred_currency) VALUES(?,?,?,?,?)', accountId, name, email, hash, cur || 'INR').id;
    CI.forEach(n => ex('INSERT INTO categories(user_id,category_name,category_type) VALUES(?,?,?)', uid, n, 'INCOME'));
    CE.forEach(n => ex('INSERT INTO categories(user_id,category_name,category_type) VALUES(?,?,?)', uid, n, 'EXPENSE'));
    db.exec('COMMIT'); return uid;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}
const tries = new Map();
function limited(ip) { const t = tries.get(ip); return t && t.n >= ADM.limit() && Date.now() - t.t < 600000; }
function fail(ip) { const t = tries.get(ip); tries.set(ip, t && Date.now() - t.t < 600000 ? { n: t.n + 1, t: t.t } : { n: 1, t: Date.now() }); }
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(c => c[0]).map(c => [c[0], decodeURIComponent(c.slice(1).join('='))]));
function sessionUser(req) {
  const t = cookies(req)[COOKIE]; if (!t) return null;
  const s = q1('SELECT s.user_id, s.expires_at FROM sessions s JOIN users u ON u.user_id=s.user_id WHERE s.token_hash=? AND u.is_blocked=0', sha(t));
  if (!s || s.expires_at < Date.now()) return null; return s.user_id;
}
function startSession(res, uid) {
  const t = crypto.randomBytes(32).toString('hex');
  ex('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)', sha(t), uid, Date.now() + DAYS * 864e5);
  res.setHeader('Set-Cookie', `${COOKIE}=${t}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${DAYS * 86400}${process.env.COOKIE_SECURE === '1' ? '; Secure' : ''}`);
}
const prof = uid => q1('SELECT account_id,full_name,email,preferred_currency,role FROM users WHERE user_id=?', uid);
const OWNED = ['transactions', 'budgets', 'goals', 'investments', 'notifications', 'sessions', 'categories'];
function wipeUser(uid) {
  db.exec('BEGIN');
  try { for (const t of OWNED) ex(`DELETE FROM ${t} WHERE user_id=?`, uid); ex('DELETE FROM users WHERE user_id=?', uid); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}
// Creates the admin account at start-up. Set ADMIN_PASSWORD (and optionally ADMIN_NAME) on a public server.
// When running locally with no ADMIN_PASSWORD, a default admin (Admin / Admin@1234) is created for development only.
function ensureAdmin() {
  const name = str(process.env.ADMIN_NAME || 'Admin', 60), set = process.env.ADMIN_PASSWORD;
  const pw = set || (HOST === '127.0.0.1' || HOST === 'localhost' ? 'Admin@1234' : '');
  const found = q1('SELECT user_id, role FROM users WHERE full_name=?', name);
  if (found && found.role !== 'ADMIN') return console.warn(`A normal user is already named "${name}". Set ADMIN_NAME to a different name to create the admin.`);
  if (found) { if (set) ex('UPDATE users SET password_hash=? WHERE user_id=?', hashPw(set), found.user_id); return; }
  if (!pw) return console.warn('No admin account yet. Set the ADMIN_PASSWORD environment variable to create one.');
  ex("INSERT INTO users(full_name,email,password_hash,preferred_currency,role) VALUES(?,?,?,?,'ADMIN')", name, 'admin@local', hashPw(pw), 'INR');
  console.log(`Admin account created. Sign in as "${name}".`);
}

/* ---------- loading a user's data (all calculations run on these arrays) ---------- */
function load(uid) {
  const U = q1('SELECT preferred_currency FROM users WHERE user_id=?', uid);
  return {
    id: uid, cur: U.preferred_currency,
    cats: q('SELECT category_id,category_name,category_type FROM categories WHERE user_id=? ORDER BY category_type DESC, category_name', uid),
    tx: q('SELECT transaction_id,category_id,transaction_type,amount,description,payment_method,notes,transaction_date FROM transactions WHERE user_id=?', uid),
    bud: q('SELECT budget_id,category_id,month,budget_amount FROM budgets WHERE user_id=?', uid),
    goals: q('SELECT goal_id,goal_name,target_amount,current_amount,target_date,saved_date FROM goals WHERE user_id=? ORDER BY goal_id', uid),
    inv: q('SELECT investment_id,name,inv_type,invested,current_value,buy_date FROM investments WHERE user_id=? ORDER BY investment_id', uid)
  };
}
const cn = (u, id) => (u.cats.find(c => c.category_id === id) || {}).category_name || '—';
const spent = (u, m, cid) => sum(u.tx.filter(t => t.transaction_type === 'EXPENSE' && t.transaction_date.slice(0, 7) === m && (!cid || t.category_id === cid)), t => t.amount);
const bl = (u, m) => u.bud.filter(z => z.month === m).map(z => ({ ...z, category_name: z.category_id ? cn(u, z.category_id) : null, spent: r2(spent(u, m, z.category_id)) }));
const tot = (u, m, ty) => sum(u.tx.filter(t => t.transaction_type === ty && (!m || t.transaction_date.slice(0, 7) === m)), t => t.amount);
const cg = (u, rows) => { const c = {}; rows.filter(t => t.transaction_type === 'EXPENSE').forEach(t => { const n = cn(u, t.category_id); c[n] = (c[n] || 0) + t.amount; }); return Object.entries(c).map(([n, s]) => ({ n, s: r2(s) })); };
const invTx = u => u.inv.map(v => ({ transaction_id: v.investment_id, transaction_type: 'INVESTMENT', amount: v.invested, description: 'Invested in ' + v.name, category_id: null, category_name: v.inv_type, transaction_date: v.buy_date, payment_method: 'Investment', notes: '' }));
const goalTx = u => u.goals.filter(g => g.current_amount > 0).map(g => ({ transaction_id: g.goal_id, transaction_type: 'SAVINGS', amount: g.current_amount, description: 'Saved for ' + g.goal_name, category_id: null, category_name: 'Savings goal', transaction_date: g.saved_date || today(), payment_method: 'Savings', notes: '' }));
function flt(u, Q) {
  const s = (Q.get('q') || '').toLowerCase(), ty = Q.get('type'), ca = Q.get('category'), f = Q.get('from'), t = Q.get('to');
  const K = { date_desc: (a, b) => b.transaction_date.localeCompare(a.transaction_date) || b.transaction_id - a.transaction_id, date_asc: (a, b) => a.transaction_date.localeCompare(b.transaction_date) || a.transaction_id - b.transaction_id, amt_desc: (a, b) => b.amount - a.amount, amt_asc: (a, b) => a.amount - b.amount };
  return [...u.tx.map(x => ({ ...x, category_name: cn(u, x.category_id) })), ...invTx(u), ...goalTx(u)]
    .filter(x => (!s || (x.description + ' ' + x.notes + ' ' + x.category_name).toLowerCase().includes(s)) && (!ty || x.transaction_type === ty) && (!ca || x.category_id == ca) && (!f || x.transaction_date >= f) && (!t || x.transaction_date <= t))
    .sort(K[Q.get('sort')] || K.date_desc);
}
const csvCell = v => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
const csv = rows => 'Date,Type,Category,Description,Method,Amount,Notes\n' + rows.map(t => [t.transaction_date, t.transaction_type, t.category_name, t.description || '', t.payment_method, t.amount, t.notes].map(csvCell).join(',')).join('\n');

const ADM = require('./admin')({ q, q1, ex, bad, str, hashPw, wipeUser, mo, ml, csvCell });   // admin API (see admin.js)

/* ---------- insights, dashboard, reports ---------- */
function ins(u) {
  const F = n => money(n, u.cur), m = mo(0), e = tot(u, m, 'EXPENSE'), pe = tot(u, mo(1), 'EXPENSE'), i = tot(u, m, 'INCOME'), it = [], d = new Date().getDate();
  const top = cg(u, u.tx.filter(t => t.transaction_date.slice(0, 7) === m)).sort((a, b) => b.s - a.s)[0];
  const w = bl(u, m).map(z => ({ ...z, p: z.spent / z.budget_amount })).sort((a, b) => b.p - a.p)[0];
  if (top) it.push({ title: 'Top spending category', text: `${top.n} is your biggest expense this month at ${F(top.s)} (${Math.round(top.s / e * 100)}% of spending).`, how: 'Expenses this month are grouped by category and the largest group is shown.' });
  if (pe > 0) it.push({ title: e > pe ? 'Spending is up' : 'Spending is down', text: `You spent ${F(e)} this month versus ${F(pe)} last month (${e >= pe ? '+' : '−'}${Math.round(Math.abs(e - pe) / pe * 100)}%).`, how: 'Total expenses this month compared with total expenses last month.' });
  if (i > 0) it.push({ title: 'Savings rate', text: `You are saving ${Math.round((i - e) / i * 100)}% of your income this month.`, how: '(Income − expenses) ÷ income for the current month.' });
  if (w) it.push({ title: 'Budget watch', text: `${w.category_name || 'Overall budget'} is ${Math.round(w.p * 100)}% used.`, how: 'Spent ÷ limit for each budget this month; the highest is shown.' });
  if (e > 0) it.push({ title: 'Average daily spend', text: `About ${F(e / d)} per day so far this month.`, how: `Expenses this month ÷ ${d} days elapsed.` });
  return it.length ? it : [{ title: 'Not enough data yet', text: 'Add a few transactions to see insights.', how: 'Insights need at least one expense this month.' }];
}
function dash(u) {
  const m = mo(0), ob = u.bud.find(z => z.month === m && !z.category_id), e = tot(u, m, 'EXPENSE'), i = tot(u, m, 'INCOME');
  const ti = sum(u.inv, v => v.invested), tw = sum(u.inv, v => v.current_value), sv = sum(u.goals, g => g.current_amount);
  const bal = tot(u, 0, 'INCOME') - tot(u, 0, 'EXPENSE') - ti - sv;
  return {
    balance: r2(bal), invested: r2(ti), inv_value: r2(tw), saved: r2(sv), goal_target: r2(sum(u.goals, g => g.target_amount)), net_worth: r2(bal + tw + sv),
    income: r2(i), expense: r2(e), remaining: ob ? r2(ob.budget_amount - e) : null, savings: r2(i - e), insights: ins(u).slice(0, 3), budgets: bl(u, m), goals: u.goals.slice(0, 4),
    recent: flt(u, new URLSearchParams()).slice(0, 5),
    months: [5, 4, 3, 2, 1, 0].map(k => ({ m: ml(mo(k)), income: r2(tot(u, mo(k), 'INCOME')), expense: r2(tot(u, mo(k), 'EXPENSE')) })),
    cats: cg(u, u.tx.filter(t => t.transaction_date.slice(0, 7) === m))
  };
}
function rep(u, f, t) {
  f = f || mo(0) + '-01'; t = t || today();
  const R = u.tx.filter(z => z.transaction_date >= f && z.transaction_date <= t), I = z => z.transaction_type === 'INCOME' ? 'income' : 'expense';
  const g = k => { const o = {}; R.forEach(z => { const key = k(z); (o[key] = o[key] || { income: 0, expense: 0 })[I(z)] += z.amount; }); return Object.keys(o).sort().map(key => ({ k: key, income: r2(o[key].income), expense: r2(o[key].expense) })); };
  const i = sum(R.filter(z => I(z) === 'income'), z => z.amount), e = sum(R.filter(z => I(z) === 'expense'), z => z.amount);
  const monday = z => { const d = new Date(z.transaction_date + 'T00:00:00'); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.toLocaleDateString('en-CA'); };
  return { from: f, to: t, income: r2(i), expense: r2(e), savings: r2(i - e), daily: g(z => z.transaction_date).map(z => ({ d: z.k, income: z.income, expense: z.expense })), weekly: g(monday).map(z => ({ d: z.k, income: z.income, expense: z.expense })), months: g(z => z.transaction_date.slice(0, 7)).map(z => ({ m: ml(z.k), income: z.income, expense: z.expense })), cats: cg(u, R) };
}

/* ---------- notifications ---------- */
function note(uid, type, msg) { if (!q1('SELECT 1 AS x FROM notifications WHERE user_id=? AND message=?', uid, msg)) ex('INSERT INTO notifications(user_id,notification_type,message) VALUES(?,?,?)', uid, type, msg); }
function checkBudgets(uid) {
  const u = load(uid), m = mo(0);
  bl(u, m).forEach(b => {
    const p = b.spent / b.budget_amount * 100, n = b.category_name || 'Overall';
    if (p >= 80) note(uid, p >= 100 ? 'BUDGET_EXCEEDED' : 'BUDGET_80', p >= 100 ? `${n} budget exceeded for ${m}.` : `${n} budget has reached ${Math.round(p)}% for ${m}.`);
  });
}
function afterTx(uid, id) {
  const u = load(uid), t = u.tx.find(z => z.transaction_id === id);
  if (t && t.transaction_type === 'EXPENSE') { const o = u.tx.filter(z => z.transaction_type === 'EXPENSE' && z.transaction_id !== id); if (o.length >= 5 && t.amount > 3 * sum(o, z => z.amount) / o.length) note(uid, 'UNUSUAL', `Unusual expense: ${t.description || cn(u, t.category_id)} (${money(t.amount, u.cur)}) is much higher than your average.`); }
  checkBudgets(uid);
}

/* ---------- validation ---------- */
function txFields(uid, b) {
  const a = num(b.amount), c = q1('SELECT category_id,category_type FROM categories WHERE category_id=? AND user_id=?', +b.category_id || 0, uid);
  if (!['INCOME', 'EXPENSE'].includes(b.type)) bad('Choose a type');
  if (!(a > 0)) bad('Enter an amount greater than 0');
  if (!c || c.category_type !== b.type) bad('Choose a matching category');
  if (!validDate(b.date)) bad('Choose a date');
  return [c.category_id, b.type, r2(a), str(b.description), str(b.payment_method, 30) || 'Cash', str(b.notes, 300), b.date];
}
const own = (table, col, id, uid) => q1(`SELECT * FROM ${table} WHERE ${col}=? AND user_id=?`, id, uid) || bad('Not found', 404);

/* ---------- the API ---------- */
function route(req, res, url, body, ip) {
  const p = url.pathname.replace(/^\/api/, ''), M = req.method, Q = url.searchParams, b = body || {}, id = +p.split('/')[2];
  // public routes
  if (p === '/register' && M === 'POST') {
    if (limited(ip)) bad('Too many attempts. Please wait a few minutes.', 429);
    if (ADM.setting('registration_open') === '0') bad('Registration is closed right now. Please contact the administrator.', 403);
    const n = str(b.full_name, 60);
    if (!n) bad('Please enter your name');
    if (typeof b.password !== 'string' || !b.password) bad('Please enter a password');
    if (b.password.length > 200) bad('Password is too long');
    let uid;
    try { uid = createUser(n, b.password, n.toLowerCase().replace(/\W+/g, '') + '@local', CUR.includes(b.currency) ? b.currency : 'INR'); }
    catch (e) { if (/UNIQUE/i.test(e.message)) bad('That name is already registered'); throw e; }
    startSession(res, uid); return prof(uid);   // sign in straight away
  }
  if (p === '/login' && M === 'POST') {
    if (limited(ip)) bad('Too many attempts. Please wait a few minutes.', 429);
    const u = q1('SELECT user_id,password_hash,is_blocked,role,full_name FROM users WHERE full_name=?', str(b.name, 60));
    if (!u || typeof b.password !== 'string' || !checkPw(b.password, u.password_hash)) { fail(ip); if (u && u.role === 'ADMIN') ADM.log({ id: u.user_id, name: u.full_name }, 'ADMIN_LOGIN', '', 'FAILED', 'wrong password'); bad('Invalid name or password', 400); }
    if (u.is_blocked) bad('This account has been blocked. Please contact the administrator.', 403);
    tries.delete(ip); startSession(res, u.user_id); if (u.role === 'ADMIN') ADM.log({ id: u.user_id, name: u.full_name }, 'ADMIN_LOGIN', '', 'SUCCESS'); return prof(u.user_id);
  }
  if (p === '/forgot') return { message: 'Please contact the administrator to reset your password, or create a new account.' };
  if (p === '/logout') { const t = cookies(req)[COOKIE]; if (t) ex('DELETE FROM sessions WHERE token_hash=?', sha(t)); res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`); return { ok: 1 }; }
  // everything below needs a signed-in user
  const uid = sessionUser(req); if (!uid) bad(p === '/me' ? 'Not signed in' : 'Please sign in again', 401);

  const isAdmin = q1('SELECT role FROM users WHERE user_id=?', uid).role === 'ADMIN';

  /* ---------- admin area: authorised on the server for EVERY /api/admin route ---------- */
  if (p.startsWith('/admin')) {
    if (!isAdmin) { ADM.log({ id: uid, name: prof(uid).full_name }, 'ACCESS_DENIED', p.slice(0, 80), 'DENIED', 'non-admin tried an admin API'); bad('Admins only', 403); }
    if (M !== 'GET' && !/application\/json/i.test(req.headers['content-type'] || '')) bad('JSON requests only', 415);   // blocks cross-site form posts
    const out = ADM.handle(p.slice(6), M, Q, b, { id: uid, name: prof(uid).full_name });
    if (out === undefined) bad('Not found', 404);
    return out;
  }
  if (p === '/support' && M === 'POST') { if (isAdmin) bad('Admin accounts cannot send support requests'); return ADM.submit(uid, b); }

  if (p === '/me' && M === 'DELETE') {
    if (isAdmin) bad('The admin account cannot be deleted');
    if (limited(ip)) bad('Too many attempts. Please wait a few minutes.', 429);
    const u = q1('SELECT password_hash FROM users WHERE user_id=?', uid);
    if (typeof b.password !== 'string' || !checkPw(b.password, u.password_hash)) { fail(ip); bad('Password is incorrect'); }
    wipeUser(uid);
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`); return { ok: 1 };
  }
  if (p === '/me' && M === 'PUT') {
    const n = str(b.full_name, 60); if (!n) bad('Name is required'); if (!CUR.includes(b.preferred_currency)) bad('Invalid currency');
    try { ex('UPDATE users SET full_name=?, preferred_currency=? WHERE user_id=?', n, b.preferred_currency, uid); } catch (e) { if (/UNIQUE/i.test(e.message)) bad('That name is already taken'); throw e; }
    return prof(uid);
  }
  if (p === '/me') return prof(uid);
  if (p === '/me/password') {
    const u = q1('SELECT password_hash FROM users WHERE user_id=?', uid);
    if (!checkPw(String(b.current || ''), u.password_hash)) bad('Current password is incorrect');
    if (typeof b.next !== 'string' || !b.next) bad('Please enter a new password'); if (b.next.length > 200) bad('Password is too long');
    ex('UPDATE users SET password_hash=? WHERE user_id=?', hashPw(b.next), uid); return { ok: 1 };
  }

  if (p === '/categories') {
    if (M === 'POST') {
      const n = str(b.category_name, 40); if (!n) bad('Category name is required'); if (!['INCOME', 'EXPENSE'].includes(b.category_type)) bad('Choose a type');
      if (q1('SELECT 1 AS x FROM categories WHERE user_id=? AND category_type=? AND lower(category_name)=lower(?)', uid, b.category_type, n)) bad('That category already exists');
      ex('INSERT INTO categories(user_id,category_name,category_type) VALUES(?,?,?)', uid, n, b.category_type);
    }
    return load(uid).cats;
  }
  if (p.startsWith('/categories/') && M === 'DELETE') {
    own('categories', 'category_id', id, uid);
    if (q1('SELECT 1 AS x FROM transactions WHERE category_id=? AND user_id=?', id, uid)) bad('This category has transactions and cannot be deleted');
    ex('DELETE FROM categories WHERE category_id=? AND user_id=?', id, uid); return { ok: 1 };
  }

  if (p === '/transactions' && M === 'POST') { const f = txFields(uid, b), tid = ex('INSERT INTO transactions(user_id,category_id,transaction_type,amount,description,payment_method,notes,transaction_date) VALUES(?,?,?,?,?,?,?,?)', uid, ...f).id; afterTx(uid, tid); return { transaction_id: tid }; }
  if (p === '/transactions') { const r = flt(load(uid), Q), pg = Math.max(1, +Q.get('page') || 1); return { total: r.length, rows: r.slice((pg - 1) * 10, pg * 10) }; }
  if (p === '/transactions/export') return { __csv: csv(flt(load(uid), Q)) };
  if (p.startsWith('/transactions/')) {
    own('transactions', 'transaction_id', id, uid);
    if (M === 'DELETE') ex('DELETE FROM transactions WHERE transaction_id=? AND user_id=?', id, uid);
    else { ex('UPDATE transactions SET category_id=?,transaction_type=?,amount=?,description=?,payment_method=?,notes=?,transaction_date=? WHERE transaction_id=? AND user_id=?', ...txFields(uid, b), id, uid); afterTx(uid, id); }
    return { ok: 1 };
  }

  if (p === '/budgets' && M === 'POST') {
    const a = num(b.amount), cid = b.category_id ? +b.category_id : null;
    if (!MT.test(b.month || '')) bad('Choose a month'); if (!(a > 0)) bad('Enter a limit greater than 0');
    if (cid && !q1("SELECT 1 AS x FROM categories WHERE category_id=? AND user_id=? AND category_type='EXPENSE'", cid, uid)) bad('Invalid category');
    const e = q1('SELECT budget_id FROM budgets WHERE user_id=? AND month=? AND ' + (cid ? 'category_id=?' : 'category_id IS NULL'), ...(cid ? [uid, b.month, cid] : [uid, b.month]));
    if (e) ex('UPDATE budgets SET budget_amount=? WHERE budget_id=?', r2(a), e.budget_id); else ex('INSERT INTO budgets(user_id,category_id,month,budget_amount) VALUES(?,?,?,?)', uid, cid, b.month, r2(a));
    checkBudgets(uid); return { ok: 1 };
  }
  if (p === '/budgets') return bl(load(uid), MT.test(Q.get('month') || '') ? Q.get('month') : mo(0));
  if (p.startsWith('/budgets/')) { ex('DELETE FROM budgets WHERE budget_id=? AND user_id=?', id, uid); return { ok: 1 }; }

  if (p === '/goals' && M === 'GET') return load(uid).goals;
  if (p === '/goals' || p.startsWith('/goals/')) {
    if (M === 'DELETE') { ex('DELETE FROM goals WHERE goal_id=? AND user_id=?', id, uid); return { ok: 1 }; }
    const t = num(b.target_amount), c = num(b.current_amount || 0), name = str(b.goal_name, 60);
    if (!name) bad('Goal name is required'); if (!(t > 0)) bad('Target must be greater than 0'); if (!(c >= 0)) bad('Saved amount cannot be negative'); if (!validDate(b.target_date)) bad('Choose a target date');
    let gid = id;
    if (M === 'POST') gid = ex('INSERT INTO goals(user_id,goal_name,target_amount,current_amount,target_date,saved_date) VALUES(?,?,?,?,?,?)', uid, name, r2(t), r2(c), b.target_date, today()).id;
    else { const old = own('goals', 'goal_id', id, uid); ex('UPDATE goals SET goal_name=?,target_amount=?,current_amount=?,target_date=?,saved_date=? WHERE goal_id=? AND user_id=?', name, r2(t), r2(c), b.target_date, old.current_amount === r2(c) && old.saved_date ? old.saved_date : today(), id, uid); }
    const pc = c / t * 100; if (pc >= 50) note(uid, 'GOAL_MILESTONE', pc >= 100 ? `Goal "${name}" reached!` : `Goal "${name}" is halfway there.`);
    return { goal_id: gid };
  }

  if (p === '/investments' || p.startsWith('/investments/')) {
    if (M === 'GET') return load(uid).inv;
    if (M === 'DELETE') { ex('DELETE FROM investments WHERE investment_id=? AND user_id=?', id, uid); return { ok: 1 }; }
    const a = num(b.invested), c = num(b.current_value), name = str(b.name, 80);
    if (!name) bad('Name is required'); if (!INV.includes(b.inv_type)) bad('Choose a type'); if (!(a > 0)) bad('Amount invested must be greater than 0'); if (!(c >= 0)) bad('Enter the current value'); if (!validDate(b.buy_date)) bad('Choose a date');
    if (M === 'POST') return { investment_id: ex('INSERT INTO investments(user_id,name,inv_type,invested,current_value,buy_date) VALUES(?,?,?,?,?,?)', uid, name, b.inv_type, r2(a), r2(c), b.buy_date).id };
    own('investments', 'investment_id', id, uid);
    ex('UPDATE investments SET name=?,inv_type=?,invested=?,current_value=?,buy_date=? WHERE investment_id=? AND user_id=?', name, b.inv_type, r2(a), r2(c), b.buy_date, id, uid); return { investment_id: id };
  }

  if (p === '/notifications/read') { ex('UPDATE notifications SET is_read=1 WHERE user_id=?', uid); return { ok: 1 }; }
  if (p === '/notifications') return q('SELECT notification_type,message,is_read,created_at FROM notifications WHERE user_id=? ORDER BY notification_id DESC LIMIT 100', uid).map(n => ({ ...n, created_at: new Date(n.created_at.replace(' ', 'T') + 'Z').toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) }));
  if (p === '/insights') return { method: 'Insights are calculated from your own transactions and budgets. Open "How this was calculated" on each card for the formula.', items: ins(load(uid)) };
  if (p === '/dashboard') return dash(load(uid));
  if (p === '/reports') return rep(load(uid), validDate(Q.get('from')) ? Q.get('from') : null, validDate(Q.get('to')) ? Q.get('to') : null);
  bad('Not found', 404);
}

/* ---------- HTTP server (API + static files) ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.json': 'application/json' };
function send(res, code, data, headers = {}) {
  const isStr = typeof data === 'string';
  res.writeHead(code, { 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin', ...headers, 'Content-Type': headers['Content-Type'] || (isStr ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8') });
  res.end(isStr || Buffer.isBuffer(data) ? data : JSON.stringify(data));
}
function readBody(req) {
  return new Promise((ok, no) => {
    let n = 0; const ch = [];
    req.on('data', c => { n += c.length; if (n > 1e6) { no(new HttpErr('Request too large', 413)); req.destroy(); } else ch.push(c); });
    req.on('end', () => { const t = Buffer.concat(ch).toString('utf8'); if (!t) return ok({}); try { ok(JSON.parse(t)); } catch (e) { no(new HttpErr('Invalid JSON')); } });
    req.on('error', no);
  });
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : null;
      const out = route(req, res, url, body, req.socket.remoteAddress);
      if (out && out.__csv !== undefined) return send(res, 200, out.__csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="smartspend-transactions.csv"' });
      return send(res, 200, out ?? { ok: 1 }, { 'Cache-Control': 'no-store' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    let f = path.normalize(path.join(PUB, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
    if (!f.startsWith(PUB + path.sep) && f !== PUB) return send(res, 403, 'Forbidden');
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(PUB, 'index.html');
    return send(res, 200, fs.readFileSync(f), { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  } catch (e) {
    if (e instanceof HttpErr) return send(res, e.code, { error: e.message });
    console.error(e); return send(res, 500, { error: 'Something went wrong on the server' });
  }
});
setInterval(() => { try { ex('DELETE FROM sessions WHERE expires_at<?', Date.now()); } catch (e) { } }, 3600000).unref();
if (require.main === module) { ensureAdmin(); server.listen(PORT, HOST, () => console.log(`SmartSpend is running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`)); }
module.exports = { server, createUser, hashPw, ex, q1, ensureAdmin };
