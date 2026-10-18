'use strict';
// Admin API. Mounted by server.js under /api/admin/* AFTER server-side admin authorization has passed.
// Admins see account-level data only: no passwords/hashes, and no transaction descriptions or notes.
const fs = require('fs'), path = require('path');
module.exports = function (c) {
  const { q, q1, ex, bad, str, hashPw, wipeUser, mo, ml, csvCell } = c;
  const n = (sql, ...a) => q1(sql, ...a).n, r2 = x => Math.round((x || 0) * 100) / 100;
  const DT = /^\d{4}-\d{2}-\d{2}$/, lk = s => '%' + s.replace(/[\\%_]/g, '\\$&') + '%';
  const pg = (Q, d = 15) => { const size = Math.min(100, Math.max(5, +Q.get('size') || d)), page = Math.max(1, +Q.get('page') || 1); return { size, page, off: (page - 1) * size }; };
  const pack = (rows, total, P) => ({ rows, total, page: P.page, pages: Math.max(1, Math.ceil(total / P.size)) });
  const ago = d => new Date(Date.now() - d * 864e5).toISOString().slice(0, 19).replace('T', ' ');

  /* ---- settings (validated here, on the server) ---- */
  const SET = {
    registration_open: { def: '1', ok: v => v === '0' || v === '1' },
    login_attempt_limit: { def: '15', ok: v => /^\d{1,2}$/.test(v) && +v >= 3 && +v <= 50 },
    support_email: { def: '', ok: v => v === '' || (v.length <= 160 && /^[^@\s]{1,64}@[^@\s]{1,100}\.[^@\s]{2,}$/.test(v)) }
  };
  const SETMSG = { registration_open: 'Registration must be on or off', login_attempt_limit: 'Login attempt limit must be a whole number from 3 to 50', support_email: 'Enter a valid support email address (or leave it empty)' };
  const settings = () => { const o = {}; for (const k in SET) o[k] = SET[k].def; q('SELECT setting_key,value FROM app_settings').forEach(r => { if (SET[r.setting_key]) o[r.setting_key] = r.value; }); return o; };
  const api = {
    setting: k => settings()[k],
    limit: () => { try { return +settings().login_attempt_limit || 15; } catch (e) { return 15; } },
    log(a, action, target, result, detail) {
      try { ex('INSERT INTO admin_logs(admin_id,admin_name,action,target,result,detail) VALUES(?,?,?,?,?,?)', a && a.id || null, a && a.name || '', action, String(target || '').slice(0, 120), result || 'SUCCESS', String(detail || '').slice(0, 200)); }
      catch (e) { console.error('Activity log failed:', e.message); }
    },
    submit(uid, b) {   // a signed-in customer sends a support request or feedback
      const kind = b.kind === 'FEEDBACK' ? 'FEEDBACK' : 'SUPPORT', sub = str(b.subject, 80), msg = str(b.message, 1000);
      if (!sub) bad('Please enter a subject'); if (msg.length < 5) bad('Please write a short message');
      if (n("SELECT COUNT(*) n FROM support_requests WHERE user_id=? AND created_at>datetime('now','-1 day')", uid) >= 10) bad('Too many requests today. Please try again tomorrow.', 429);
      const u = q1('SELECT account_id FROM users WHERE user_id=?', uid);
      return { request_id: ex('INSERT INTO support_requests(user_id,account_id,kind,subject,message) VALUES(?,?,?,?,?)', uid, u.account_id || '', kind, sub, msg).id };
    }
  };

  /* ---- statistics: every number comes from a COUNT/SUM query on the live database ---- */
  const primary = () => (q1('SELECT u.preferred_currency c FROM transactions t JOIN users u ON u.user_id=t.user_id GROUP BY c ORDER BY COUNT(*) DESC LIMIT 1') || {}).c || 'INR';
  function monthly(cur, k) {
    const from = mo(k - 1), rows = q("SELECT substr(t.transaction_date,1,7) m,t.transaction_type ty,SUM(t.amount) s,COUNT(*) c FROM transactions t JOIN users u ON u.user_id=t.user_id WHERE u.preferred_currency=? AND substr(t.transaction_date,1,7)>=? GROUP BY m,ty", cur, from);
    return Array.from({ length: k }, (_, i) => { const m = mo(k - 1 - i), g = t => (rows.find(r => r.m === m && r.ty === t) || {}).s || 0; return { m: ml(m), income: r2(g('INCOME')), expense: r2(g('EXPENSE')) }; });
  }
  const dbFile = () => process.env.DB_FILE || path.join(__dirname, 'smartspend.db');
  function stats() {
    const users = n("SELECT COUNT(*) n FROM users WHERE role='USER'"), blocked = n("SELECT COUNT(*) n FROM users WHERE role='USER' AND is_blocked=1"), cur = primary();
    const tot = q("SELECT u.preferred_currency c,t.transaction_type ty,SUM(t.amount) s FROM transactions t JOIN users u ON u.user_id=t.user_id GROUP BY c,ty");
    const cs = [...new Set(tot.map(r => r.c))].map(c => { const g = t => (tot.find(r => r.c === c && r.ty === t) || {}).s || 0; return { cur: c, income: r2(g('INCOME')), expense: r2(g('EXPENSE')) }; });
    const pc = cs.find(x => x.cur === cur) || { income: 0, expense: 0 };
    return {
      users, blocked, active: users - blocked,
      newWeek: n("SELECT COUNT(*) n FROM users WHERE role='USER' AND created_at>=?", ago(7)), newMonth: n("SELECT COUNT(*) n FROM users WHERE role='USER' AND created_at>=?", ago(30)),
      transactions: n('SELECT COUNT(*) n FROM transactions'), budgets: n('SELECT COUNT(*) n FROM budgets'), goals: n('SELECT COUNT(*) n FROM goals'), investments: n('SELECT COUNT(*) n FROM investments'),
      openSupport: n("SELECT COUNT(*) n FROM support_requests WHERE status!='RESOLVED'"),
      currency: cur, income: pc.income, expense: pc.expense, currencies: cs, months: monthly(cur, 6),
      signups: [5, 4, 3, 2, 1, 0].map(i => ({ m: ml(mo(i)), n: n("SELECT COUNT(*) n FROM users WHERE role='USER' AND substr(created_at,1,7)=?", mo(i)) })),
      source: { file: path.basename(dbFile()), checkedAt: new Date().toISOString() }
    };
  }
  function analytics(Q) {
    const curs = q("SELECT DISTINCT u.preferred_currency c FROM transactions t JOIN users u ON u.user_id=t.user_id ORDER BY c").map(r => r.c);
    const cur = curs.includes(Q.get('currency')) ? Q.get('currency') : primary(), k = [3, 6, 12, 24].includes(+Q.get('months')) ? +Q.get('months') : 6, from = mo(k - 1);
    return {
      currency: cur, currencies: curs, months: monthly(cur, k),
      categories: q("SELECT c.category_name n,SUM(t.amount) s FROM transactions t JOIN users u ON u.user_id=t.user_id JOIN categories c ON c.category_id=t.category_id WHERE t.transaction_type='EXPENSE' AND u.preferred_currency=? AND substr(t.transaction_date,1,7)>=? GROUP BY c.category_name ORDER BY s DESC LIMIT 8", cur, from).map(r => ({ n: r.n, s: r2(r.s) })),
      trend: Array.from({ length: k }, (_, i) => { const m = mo(k - 1 - i); return { m: ml(m), n: n('SELECT COUNT(*) n FROM transactions WHERE substr(transaction_date,1,7)=?', m) }; })
    };
  }
  function health() {
    let ok = true, err = '', check = 'ok';
    try { q1('SELECT 1 AS x'); check = Object.values(q1('PRAGMA quick_check(1)'))[0]; ok = check === 'ok'; } catch (e) { ok = false; err = e.message; }
    let size = 0; try { size = fs.statSync(dbFile()).size; } catch (e) { }
    const T = ['users', 'transactions', 'categories', 'budgets', 'goals', 'investments', 'sessions', 'admin_logs', 'support_requests'], tables = {};
    if (ok) T.forEach(t => { tables[t] = n(`SELECT COUNT(*) n FROM ${t}`); });
    const m = process.memoryUsage();
    return { db: { ok, check, error: err, file: path.basename(dbFile()), sizeKB: Math.round(size / 1024), journal: ok ? Object.values(q1('PRAGMA journal_mode'))[0] : '', tables }, server: { ok: true, uptimeSec: Math.round(process.uptime()), node: process.version, memoryMB: Math.round(m.rss / 1048576), time: new Date().toISOString() }, activeSessions: ok ? n('SELECT COUNT(*) n FROM sessions WHERE expires_at>?', Date.now()) : 0 };
  }

  /* ---- users ---- */
  const SORT = { newest: 'u.created_at DESC,u.user_id DESC', oldest: 'u.created_at ASC,u.user_id ASC', name: 'u.full_name COLLATE NOCASE ASC', account: 'u.account_id ASC', tx: 'tx_count DESC,u.user_id' };
  function users(Q) {
    const w = ["u.role='USER'"], p = [], s = str(Q.get('q'), 60).trim().toLowerCase(), P = pg(Q);
    if (s) { w.push("(lower(u.full_name) LIKE ? ESCAPE '\\' OR lower(u.account_id) LIKE ? ESCAPE '\\')"); p.push(lk(s), lk(s)); }
    if (Q.get('status') === 'active') w.push('u.is_blocked=0'); if (Q.get('status') === 'inactive') w.push('u.is_blocked=1');
    const W = w.join(' AND '), total = n(`SELECT COUNT(*) n FROM users u WHERE ${W}`, ...p);
    const rows = q(`SELECT u.user_id,u.account_id,u.full_name,u.preferred_currency,u.created_at,u.is_blocked,(SELECT COUNT(*) FROM transactions t WHERE t.user_id=u.user_id) AS tx_count FROM users u WHERE ${W} ORDER BY ${SORT[Q.get('sort')] || SORT.newest} LIMIT ? OFFSET ?`, ...p, P.size, P.off);
    return pack(rows, total, P);
  }
  const userDetail = id => {
    const u = q1("SELECT user_id,account_id,full_name,preferred_currency,created_at,is_blocked FROM users WHERE user_id=? AND role='USER'", id); if (!u) bad('User not found', 404);
    const cnt = t => n(`SELECT COUNT(*) n FROM ${t} WHERE user_id=?`, id);
    return { ...u, counts: { transactions: cnt('transactions'), budgets: cnt('budgets'), goals: cnt('goals'), investments: cnt('investments'), categories: cnt('categories') }, income_tx: n("SELECT COUNT(*) n FROM transactions WHERE user_id=? AND transaction_type='INCOME'", id), expense_tx: n("SELECT COUNT(*) n FROM transactions WHERE user_id=? AND transaction_type='EXPENSE'", id), last_tx: (q1('SELECT MAX(transaction_date) d FROM transactions WHERE user_id=?', id) || {}).d, open_support: n("SELECT COUNT(*) n FROM support_requests WHERE user_id=? AND status!='RESOLVED'", id) };
  };

  /* ---- transactions (descriptions/notes are deliberately never returned) ---- */
  function txWhere(Q) {
    const w = [], p = [], s = str(Q.get('q'), 40).trim().toUpperCase();
    if (s) { if (/^\d+$/.test(s)) { w.push("(t.transaction_id=? OR u.account_id LIKE ? ESCAPE '\\')"); p.push(+s, lk(s)); } else { w.push("u.account_id LIKE ? ESCAPE '\\'"); p.push(lk(s)); } }
    if (['INCOME', 'EXPENSE'].includes(Q.get('type'))) { w.push('t.transaction_type=?'); p.push(Q.get('type')); }
    if (Q.get('category')) { w.push('c.category_name=?'); p.push(str(Q.get('category'), 40)); }
    if (DT.test(Q.get('from') || '')) { w.push('t.transaction_date>=?'); p.push(Q.get('from')); }
    if (DT.test(Q.get('to') || '')) { w.push('t.transaction_date<=?'); p.push(Q.get('to')); }
    return { W: w.length ? 'WHERE ' + w.join(' AND ') : '', p };
  }
  const TXF = 'FROM transactions t JOIN users u ON u.user_id=t.user_id JOIN categories c ON c.category_id=t.category_id', TXS = { date_desc: 't.transaction_date DESC,t.transaction_id DESC', date_asc: 't.transaction_date ASC,t.transaction_id ASC', amt_desc: 't.amount DESC', amt_asc: 't.amount ASC' };
  function transactions(Q) {
    const { W, p } = txWhere(Q), P = pg(Q, 20);
    return { ...pack(q(`SELECT t.transaction_id,u.account_id,t.transaction_type,c.category_name,t.amount,u.preferred_currency cur,t.transaction_date ${TXF} ${W} ORDER BY ${TXS[Q.get('sort')] || TXS.date_desc} LIMIT ? OFFSET ?`, ...p, P.size, P.off), n(`SELECT COUNT(*) n ${TXF} ${W}`, ...p), P), categories: q('SELECT DISTINCT category_name n FROM categories ORDER BY n').map(r => r.n) };
  }

  /* ---- support, logs ---- */
  function support(Q) {
    const w = [], p = [], P = pg(Q);
    if (['OPEN', 'IN_PROGRESS', 'RESOLVED'].includes(Q.get('status'))) { w.push('status=?'); p.push(Q.get('status')); } if (['SUPPORT', 'FEEDBACK'].includes(Q.get('kind'))) { w.push('kind=?'); p.push(Q.get('kind')); }
    const s = str(Q.get('q'), 40).trim().toUpperCase(); if (s) { w.push("(account_id LIKE ? ESCAPE '\\' OR upper(subject) LIKE ? ESCAPE '\\')"); p.push(lk(s), lk(s)); }
    const W = w.length ? 'WHERE ' + w.join(' AND ') : '';
    return pack(q(`SELECT request_id,account_id,kind,subject,message,status,admin_note,created_at,updated_at FROM support_requests ${W} ORDER BY CASE status WHEN 'RESOLVED' THEN 1 ELSE 0 END,request_id DESC LIMIT ? OFFSET ?`, ...p, P.size, P.off), n(`SELECT COUNT(*) n FROM support_requests ${W}`, ...p), P);
  }
  function logs(Q) {
    const w = [], p = [], P = pg(Q, 20);
    if (['SUCCESS', 'FAILED', 'DENIED'].includes(Q.get('result'))) { w.push('result=?'); p.push(Q.get('result')); } if (Q.get('action')) { w.push('action=?'); p.push(str(Q.get('action'), 40)); }
    const W = w.length ? 'WHERE ' + w.join(' AND ') : '';
    return { ...pack(q(`SELECT log_id,admin_id,admin_name,action,target,result,detail,created_at FROM admin_logs ${W} ORDER BY log_id DESC LIMIT ? OFFSET ?`, ...p, P.size, P.off), n(`SELECT COUNT(*) n FROM admin_logs ${W}`, ...p), P), actions: q('SELECT DISTINCT action a FROM admin_logs ORDER BY a').map(r => r.a) };
  }

  /* ---- router: p is the path after /api/admin ---- */
  api.handle = function (p, M, Q, b, adm) {
    if (p === '/stats' && M === 'GET') return stats();
    if (p === '/analytics' && M === 'GET') return analytics(Q);
    if (p === '/health' && M === 'GET') return health();
    if (p === '/users' && M === 'GET') return users(Q);
    if (p === '/transactions' && M === 'GET') return transactions(Q);
    if (p === '/transactions/export' && M === 'GET') {
      const { W, p: pr } = txWhere(Q), rows = q(`SELECT t.transaction_id,u.account_id,t.transaction_date,t.transaction_type,c.category_name,u.preferred_currency cur,t.amount ${TXF} ${W} ORDER BY t.transaction_date DESC,t.transaction_id DESC LIMIT 50000`, ...pr);
      api.log(adm, 'EXPORT_TRANSACTIONS', rows.length + ' rows', 'SUCCESS', 'filters: ' + (Q.toString() || 'none'));
      return { __csv: 'Transaction ID,Account ID,Date,Type,Category,Currency,Amount\n' + rows.map(r => [r.transaction_id, r.account_id, r.transaction_date, r.transaction_type, r.category_name, r.cur, r.amount].map(csvCell).join(',')).join('\n') };
    }
    if (p === '/support' && M === 'GET') return support(Q);
    if (p === '/logs' && M === 'GET') return logs(Q);
    if (p === '/settings' && M === 'GET') return { settings: settings() };
    if (p === '/settings' && M === 'PUT') {
      const ch = [];
      for (const k of Object.keys(b)) { if (!SET[k]) { api.log(adm, 'UPDATE_SETTINGS', k, 'FAILED', 'unknown setting'); bad('Unknown setting: ' + str(k, 40)); } }
      for (const k of Object.keys(b)) { const v = String(b[k] ?? '').trim(); if (!SET[k].ok(v)) { api.log(adm, 'UPDATE_SETTINGS', k, 'FAILED', 'invalid value'); bad(SETMSG[k]); } ch.push([k, v]); }
      ch.forEach(([k, v]) => ex("INSERT INTO app_settings(setting_key,value,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(setting_key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at", k, v));
      api.log(adm, 'UPDATE_SETTINGS', ch.map(x => x[0]).join(','), 'SUCCESS', ch.map(x => x[0] + '=' + (x[0] === 'support_email' ? '(email)' : x[1])).join(' '));
      return { settings: settings() };
    }
    let m = p.match(/^\/support\/(\d+)$/);
    if (m && M === 'PUT') {
      const r = q1('SELECT request_id FROM support_requests WHERE request_id=?', +m[1]); if (!r) bad('Request not found', 404);
      if (!['OPEN', 'IN_PROGRESS', 'RESOLVED'].includes(b.status)) bad('Choose a valid status');
      ex("UPDATE support_requests SET status=?,admin_note=?,updated_at=datetime('now') WHERE request_id=?", b.status, str(b.admin_note, 500), +m[1]);
      api.log(adm, 'UPDATE_SUPPORT', '#' + m[1], 'SUCCESS', 'status=' + b.status); return { ok: 1 };
    }
    m = p.match(/^\/users\/(\d+)(?:\/(status|block|password))?$/);
    if (m) {
      const tid = +m[1], act = m[2];
      if (!act && M === 'GET') return userDetail(tid);
      const t = q1('SELECT user_id,role,account_id,full_name FROM users WHERE user_id=?', tid); if (!t) bad('User not found', 404);
      if (t.role === 'ADMIN') { api.log(adm, 'USER_CHANGE', 'admin account', 'DENIED', 'admin accounts cannot be changed here'); bad('The admin account cannot be changed here'); }
      const tag = t.account_id || ('user#' + tid);
      if (act === 'status' && M === 'POST') {   // { active: true|false }
        const v = b.active ? 0 : 1; ex('UPDATE users SET is_blocked=? WHERE user_id=?', v, tid); if (v) ex('DELETE FROM sessions WHERE user_id=?', tid);
        api.log(adm, v ? 'DEACTIVATE_USER' : 'ACTIVATE_USER', tag, 'SUCCESS'); return { ok: 1, is_blocked: v };
      }
      if (act === 'block' && M === 'POST') {    // older route kept for compatibility
        const v = b.blocked ? 1 : 0; ex('UPDATE users SET is_blocked=? WHERE user_id=?', v, tid); if (v) ex('DELETE FROM sessions WHERE user_id=?', tid);
        api.log(adm, v ? 'DEACTIVATE_USER' : 'ACTIVATE_USER', tag, 'SUCCESS'); return { ok: 1, is_blocked: v };
      }
      if (act === 'password' && M === 'POST') {
        if (typeof b.password !== 'string' || !b.password) bad('Please enter a new password'); if (b.password.length > 200) bad('Password is too long');
        ex('UPDATE users SET password_hash=? WHERE user_id=?', hashPw(b.password), tid); ex('DELETE FROM sessions WHERE user_id=?', tid);
        api.log(adm, 'RESET_PASSWORD', tag, 'SUCCESS'); return { ok: 1 };
      }
      if (!act && M === 'DELETE') {   // the caller must type the Account ID: enforced here, not just in the browser
        if (!t.account_id || b.confirm !== t.account_id) { api.log(adm, 'DELETE_USER', tag, 'FAILED', 'confirmation did not match'); bad('Type the Account ID exactly to confirm deletion'); }
        wipeUser(tid); api.log(adm, 'DELETE_USER', tag, 'SUCCESS', 'account and all its data removed'); return { ok: 1 };
      }
    }
  };
  return api;
};
