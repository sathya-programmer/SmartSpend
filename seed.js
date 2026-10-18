'use strict';
// Creates a demo account with sample data:  npm run seed   (login: Demo User / Demo@1234)
const db = require('./db');
const { createUser, ex, q1 } = require('./server');
const NAME = 'Demo User', PASS = 'Demo@1234';
if (q1('SELECT 1 AS x FROM users WHERE full_name=?', NAME)) { console.log('Demo account already exists. Login: ' + NAME + ' / ' + PASS); process.exit(0); }
const uid = createUser(NAME, PASS, 'demo@smartspend.test', 'INR');
const cat = n => q1('SELECT category_id FROM categories WHERE user_id=? AND category_name=?', uid, n).category_id;
const mo = i => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i); return d.toLocaleDateString('en-CA').slice(0, 7); };
const now = new Date().getDate();
const add = (i, day, type, c, desc, amt) => ex('INSERT INTO transactions(user_id,category_id,transaction_type,amount,description,payment_method,transaction_date) VALUES(?,?,?,?,?,?,?)', uid, cat(c), type, amt, desc, 'UPI', mo(i) + '-' + String(i ? day : Math.min(day, now)).padStart(2, '0'));
for (let i = 0; i < 3; i++) {
  add(i, 1, 'INCOME', 'Salary', 'Monthly salary', 45000);
  if (i < 2) add(i, 10, 'INCOME', 'Freelancing', 'Freelance project', 4000 + i * 2500);
  [[2, 'Housing', 'Room rent', 9000], [5, 'Food', 'Groceries', 3200], [8, 'Transportation', 'Bus pass', 1200], [11, 'Bills and Utilities', 'Electricity bill', 1800],
   [14, 'Entertainment', 'Movie night', 600], [17, 'Shopping', 'Clothes', 2800], [20, 'Education', 'Books', 1500], [24, 'Food', 'Restaurant', 1100]]
    .forEach(r => add(i, r[0], 'EXPENSE', r[1], r[2], Math.round(r[3] * (1 + ((i * 7 + r[0]) % 5) / 20))));
}
ex('INSERT INTO budgets(user_id,category_id,month,budget_amount) VALUES(?,?,?,?)', uid, null, mo(0), 25000);
ex('INSERT INTO budgets(user_id,category_id,month,budget_amount) VALUES(?,?,?,?)', uid, cat('Food'), mo(0), 6000);
const far = new Date(); far.setMonth(far.getMonth() + 6);
ex('INSERT INTO goals(user_id,goal_name,target_amount,current_amount,target_date,saved_date) VALUES(?,?,?,?,?,?)', uid, 'New laptop', 60000, 24000, far.toLocaleDateString('en-CA'), mo(0) + '-01');
ex('INSERT INTO investments(user_id,name,inv_type,invested,current_value,buy_date) VALUES(?,?,?,?,?,?)', uid, 'Nifty 50 index fund', 'Mutual Funds', 5000, 5600, mo(1) + '-15');
console.log('Demo account created. Login: ' + NAME + ' / ' + PASS);
