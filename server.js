require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { ranks } = require('./config');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const receiptDir = path.join(ROOT, 'storage', 'receipts');
fs.mkdirSync(receiptDir, { recursive: true });
if (!process.env.SESSION_SECRET || !process.env.ADMIN_PASSWORD || !process.env.MTA_API_TOKEN) {
  console.error('Missing SESSION_SECRET, ADMIN_PASSWORD or MTA_API_TOKEN. Copy .env.example to .env and configure it.');
  process.exit(1);
}
const db = new Database(path.join(ROOT, 'storage', 'darkcity.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY, account_name TEXT NOT NULL, rank_id TEXT NOT NULL,
  rank_name TEXT NOT NULL, amount REAL NOT NULL, receipt_file TEXT NOT NULL,
  note TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL, reviewed_at TEXT, reviewed_by TEXT, rejection_reason TEXT
);
CREATE TABLE IF NOT EXISTS grants (
  order_id TEXT PRIMARY KEY REFERENCES orders(id), account_name TEXT NOT NULL,
  rank_id TEXT NOT NULL, rank_name TEXT NOT NULL, acl_group TEXT NOT NULL,
  created_at TEXT NOT NULL, delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at);
CREATE INDEX IF NOT EXISTS idx_grants_delivery ON grants(delivered_at);
`);

app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], scriptSrc: ["'self'", "'unsafe-inline'"],
    imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], fontSrc: ["'self'", 'data:'], objectSrc: ["'none'"],
    frameAncestors: ["'none'"]
  }}
}));
app.use(express.json({ limit: '100kb' }));
app.use(session({
  name: 'darkcity.admin', secret: process.env.SESSION_SECRET, resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 2 * 60 * 60 * 1000 }
  // For multi-instance production deployments, replace MemoryStore with a persistent session store.
}));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

const orderLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false });
const upload = multer({
  storage: multer.diskStorage({ destination: receiptDir, filename: (_req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase()) }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype))
});
const now = () => new Date().toISOString();
const safeEqual = (a, b) => {
  const aa = Buffer.from(String(a || '')); const bb = Buffer.from(String(b || ''));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};
function requireAdmin(req, res, next) { if (!req.session?.admin) return res.status(401).json({ error: 'Admin girişi tələb olunur.' }); next(); }
function requireMta(req, res, next) { if (!safeEqual(req.get('x-darkcity-token'), process.env.MTA_API_TOKEN)) return res.status(401).json({ error: 'Unauthorized MTA bridge.' }); next(); }
function publicOrder(row) {
  return { id: row.id, accountName: row.account_name, rankName: row.rank_name, amount: row.amount, note: row.note,
    status: row.status, createdAt: row.created_at, reviewedAt: row.reviewed_at, reviewedBy: row.reviewed_by, rejectionReason: row.rejection_reason };
}

app.get('/api/public-config', (_req, res) => res.json({
  payment: { recipient: process.env.PAYMENT_RECIPIENT || 'Dark City', bank: process.env.PAYMENT_BANK || 'Bank məlumatı təyin edilməyib',
    card: process.env.PAYMENT_CARD || '', note: process.env.PAYMENT_NOTE || 'Ödəniş açıqlamasında MTA username və sifariş ID qeyd edin.' },
  ranks: ranks.map(({ id, name, price, duration, description }) => ({ id, name, price, duration, description }))
}));

app.post('/api/orders', orderLimiter, upload.single('receipt'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'JPG, PNG və ya WEBP formatında çek şəkli yükləyin (maksimum 5 MB).' });
  const accountName = String(req.body.accountName || '').trim();
  const rank = ranks.find(r => r.id === String(req.body.rankId || ''));
  const note = String(req.body.note || '').trim().slice(0, 300);
  if (!/^[A-Za-z0-9_.-]{3,32}$/.test(accountName) || !rank) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'MTA username (3–32 simvol) və rütbə düzgün daxil edilməyib.' });
  }
  const id = 'DC-' + crypto.randomBytes(5).toString('hex').toUpperCase();
  db.prepare(`INSERT INTO orders (id, account_name, rank_id, rank_name, amount, receipt_file, note, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`).run(id, accountName, rank.id, rank.name, rank.price, req.file.filename, note, now());
  res.status(201).json({ message: 'Sifariş yaradıldı. Admin çeki yoxladıqdan sonra nəticə bildiriləcək.', orderId: id });
});

app.get('/api/orders/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(String(req.params.id).toUpperCase());
  if (!row) return res.status(404).json({ error: 'Sifariş tapılmadı.' });
  res.json(publicOrder(row));
});

app.post('/api/admin/login', loginLimiter, (req, res) => {
  const username = String(req.body.username || ''); const password = String(req.body.password || '');
  if (!safeEqual(username, process.env.ADMIN_USERNAME || 'admin') || !safeEqual(password, process.env.ADMIN_PASSWORD))
    return res.status(401).json({ error: 'İstifadəçi adı və ya şifrə yanlışdır.' });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Sessiya yaradıla bilmədi.' });
    req.session.admin = username;
    req.session.save(() => res.json({ ok: true, username }));
  });
});
app.post('/api/admin/logout', requireAdmin, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/admin/me', requireAdmin, (req, res) => res.json({ username: req.session.admin }));
app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const status = ['pending', 'approved', 'rejected'].includes(req.query.status) ? req.query.status : 'all';
  const rows = status === 'all' ? db.prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT 300').all() :
    db.prepare('SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT 300').all(status);
  res.json(rows.map(publicOrder));
});
app.get('/api/admin/receipts/:id', requireAdmin, (req, res) => {
  const row = db.prepare('SELECT receipt_file FROM orders WHERE id = ?').get(req.params.id);
  if (!row) return res.sendStatus(404);
  const file = path.basename(row.receipt_file); const full = path.join(receiptDir, file);
  if (!fs.existsSync(full)) return res.sendStatus(404);
  res.setHeader('Cache-Control', 'no-store'); res.sendFile(full);
});
app.post('/api/admin/orders/:id/approve', requireAdmin, (req, res) => {
  const tx = db.transaction(() => {
    const row = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!row) throw new Error('Sifariş tapılmadı.');
    if (row.status !== 'pending') throw new Error('Bu sifariş artıq nəzərdən keçirilib.');
    const rank = ranks.find(r => r.id === row.rank_id);
    if (!rank) throw new Error('Rütbə konfiqurasiyada tapılmadı.');
    db.prepare("UPDATE orders SET status='approved', reviewed_at=?, reviewed_by=? WHERE id=?").run(now(), req.session.admin, row.id);
    db.prepare(`INSERT INTO grants (order_id, account_name, rank_id, rank_name, acl_group, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(row.id, row.account_name, row.rank_id, row.rank_name, rank.aclGroup, now());
  });
  try { tx(); res.json({ ok: true, message: 'Ödəniş təsdiqləndi. MTA serveri rütbə təhvilini növbəti yoxlamada alacaq.' }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/admin/orders/:id/reject', requireAdmin, (req, res) => {
  const reason = String(req.body.reason || 'Çek təsdiqlənmədi.').trim().slice(0, 300);
  const result = db.prepare("UPDATE orders SET status='rejected', reviewed_at=?, reviewed_by=?, rejection_reason=? WHERE id=? AND status='pending'")
    .run(now(), req.session.admin, reason, req.params.id);
  if (!result.changes) return res.status(400).json({ error: 'Sifariş tapılmadı və ya artıq nəzərdən keçirilib.' });
  res.json({ ok: true });
});

// MTA server polls this endpoint. Only approved and not-yet-delivered grants are returned.
app.get('/api/mta/pending', requireMta, (req, res) => {
  const grants = db.prepare('SELECT order_id AS orderId, account_name AS accountName, rank_id AS rankId, rank_name AS rankName, acl_group AS aclGroup FROM grants WHERE delivered_at IS NULL ORDER BY created_at ASC LIMIT 50').all();
  res.json({ grants });
});
app.post('/api/mta/ack', requireMta, (req, res) => {
  const orderId = String(req.body.orderId || '');
  const result = db.prepare('UPDATE grants SET delivered_at=? WHERE order_id=? AND delivered_at IS NULL').run(now(), orderId);
  if (!result.changes) return res.status(404).json({ error: 'Gözləyən grant tapılmadı və ya artıq tamamlanıb.' });
  res.json({ ok: true });
});

app.get('/admin', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'admin.html')));
app.get('*', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));
app.use((err, _req, res, _next) => {
  console.error(err);
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Çek maksimum 5 MB ola bilər.' : 'Fayl yüklənmə xətası.' });
  res.status(500).json({ error: 'Server xətası baş verdi.' });
});
app.listen(PORT, () => console.log(`Dark City website running at http://localhost:${PORT}`));
