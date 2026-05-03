require('dotenv').config();
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const bcrypt = require('bcryptjs');
const path = require('path');
const multer = require('multer');
const helmet = require('helmet');
const { initDb, run, get, all } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

const upload = multer({
  dest: path.join(__dirname, 'uploads'),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'image/png', 'image/jpeg'];
    cb(null, allowed.includes(file.mimetype));
  }
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Virtual Pay hosted checkout/webhook integration.
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: __dirname }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' }
}));

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

function flash(req, type, message) {
  req.session.flash = { type, message };
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).render('error', { title: 'Forbidden', message: 'Admin access required.' });
  next();
}

async function refreshSessionUser(req) {
  if (!req.session.user) return;
  const user = await get(`SELECT id, name, email, phone, role, membership_status FROM users WHERE id = ?`, [req.session.user.id]);
  req.session.user = user;
}

app.get('/', async (req, res) => {
  const news = await all(`SELECT * FROM news ORDER BY published_at DESC LIMIT 3`);
  const manifesto = await get(`SELECT * FROM manifesto ORDER BY uploaded_at DESC LIMIT 1`);
  res.render('home', { title: 'Home', news, manifesto });
});

app.get('/about', (req, res) => res.render('about', { title: 'About' }));
app.get('/events', (req, res) => res.render('events', { title: 'Events' }));

app.get('/leaders', async (req, res) => {
  const leaders = await all(`SELECT * FROM leaders ORDER BY display_order ASC, id ASC`);
  res.render('leaders', { title: 'Party Leaders', leaders });
});

app.get('/candidates', async (req, res) => {
  const candidates = await all(`SELECT * FROM candidates ORDER BY display_order ASC, id ASC`);
  res.render('candidates', { title: 'Political Candidates', candidates });
});

app.get('/news', async (req, res) => {
  const posts = await all(`SELECT * FROM news ORDER BY published_at DESC`);
  res.render('news', { title: 'News', posts });
});

app.get('/news/:slug', async (req, res) => {
  const post = await get(`SELECT * FROM news WHERE slug = ?`, [req.params.slug]);
  if (!post) return res.status(404).render('error', { title: 'Not Found', message: 'News article not found.' });
  res.render('article', { title: post.title, post });
});

app.get('/manifesto', async (req, res) => {
  const manifesto = await get(`SELECT * FROM manifesto ORDER BY uploaded_at DESC LIMIT 1`);
  res.render('manifesto', { title: 'Manifesto', manifesto });
});

app.post('/manifesto', requireAdmin, upload.single('manifesto'), async (req, res) => {
  if (!req.file) {
    flash(req, 'error', 'Please upload a PDF, PNG, or JPG file under 10MB.');
    return res.redirect('/admin');
  }
  await run(`INSERT INTO manifesto (title, filename, original_name) VALUES (?, ?, ?)`, [req.body.title || 'Manifesto', req.file.filename, req.file.originalname]);
  flash(req, 'success', 'Manifesto uploaded.');
  res.redirect('/manifesto');
});

app.get('/social', (req, res) => res.render('social', { title: 'Social Media' }));

app.get('/register', (req, res) => res.render('register', { title: 'Register' }));
app.post('/register', async (req, res) => {
  const { name, email, phone, password } = req.body;
  if (!name || !email || !password) {
    flash(req, 'error', 'Name, email, and password are required.');
    return res.redirect('/register');
  }
  const exists = await get(`SELECT id FROM users WHERE email = ?`, [email.toLowerCase()]);
  if (exists) {
    flash(req, 'error', 'That email is already registered. Please log in.');
    return res.redirect('/login');
  }
  const hash = await bcrypt.hash(password, 12);
  const result = await run(`INSERT INTO users (name, email, phone, password_hash) VALUES (?, ?, ?, ?)`, [name, email.toLowerCase(), phone || '', hash]);
  const user = await get(`SELECT id, name, email, phone, role, membership_status FROM users WHERE id = ?`, [result.lastID]);
  req.session.user = user;
  flash(req, 'success', 'Account created. You can now activate your membership.');
  res.redirect('/member');
});

app.get('/login', (req, res) => res.render('login', { title: 'Login' }));
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await get(`SELECT * FROM users WHERE email = ?`, [(email || '').toLowerCase()]);
  if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
    flash(req, 'error', 'Invalid email or password.');
    return res.redirect('/login');
  }
  req.session.user = { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, membership_status: user.membership_status };
  res.redirect(user.role === 'admin' ? '/admin' : '/member');
});

app.post('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

app.get('/member', requireAuth, async (req, res) => {
  await refreshSessionUser(req);
  const payments = await all(`SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC`, [req.session.user.id]);
  res.render('member', { title: 'Member Portal', payments });
});


app.post('/create-virtualpay-payment', requireAuth, async (req, res) => {
  const user = req.session.user;
  const amountCents = Number(process.env.MEMBERSHIP_AMOUNT_CENTS || 2000);
  const currency = (process.env.MEMBERSHIP_CURRENCY || 'USD').toUpperCase();
  const reference = `NDP-${user.id}-${Date.now()}`;

  await run(
    `INSERT INTO payments (user_id, gateway, gateway_reference, amount, currency, status) VALUES (?, ?, ?, ?, ?, ?)`,
    [user.id, 'virtualpay', reference, amountCents, currency.toLowerCase(), 'pending']
  );

  const hostedUrl = process.env.VIRTUAL_PAY_CHECKOUT_URL;
  if (!hostedUrl) {
    flash(req, 'error', 'Virtual Pay checkout URL is not configured yet. Ask the admin to add VIRTUAL_PAY_CHECKOUT_URL.');
    return res.redirect('/member');
  }

  // Hosted-payment-page mode: Virtual Pay provides the secure payment page.
  // Ask Virtual Pay for your exact field names; this redirect uses standard query parameters.
  const url = new URL(hostedUrl);
  url.searchParams.set('merchant_id', process.env.VIRTUAL_PAY_MERCHANT_ID || '');
  url.searchParams.set('reference', reference);
  url.searchParams.set('amount', (amountCents / 100).toFixed(2));
  url.searchParams.set('currency', currency);
  url.searchParams.set('customer_email', user.email);
  url.searchParams.set('customer_name', user.name);
  url.searchParams.set('description', 'NDP Monthly Membership');
  url.searchParams.set('success_url', `${BASE_URL}/member?payment=success&ref=${encodeURIComponent(reference)}`);
  url.searchParams.set('cancel_url', `${BASE_URL}/member?payment=cancelled&ref=${encodeURIComponent(reference)}`);

  res.redirect(303, url.toString());
});

app.post('/virtualpay/webhook', express.json(), async (req, res) => {
  const expected = process.env.VIRTUAL_PAY_WEBHOOK_SECRET;
  if (expected && req.headers['x-virtualpay-signature'] !== expected) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  try {
    const payload = req.body || {};
    const reference = payload.reference || payload.gateway_reference || payload.order_id;
    const status = String(payload.status || payload.payment_status || '').toLowerCase();
    const transactionId = payload.transaction_id || payload.transactionId || payload.id || null;

    if (!reference) return res.status(400).json({ error: 'Missing payment reference' });

    const payment = await get(`SELECT * FROM payments WHERE gateway_reference = ?`, [reference]);
    if (!payment) return res.status(404).json({ error: 'Payment reference not found' });

    const paidStatuses = ['paid', 'success', 'successful', 'approved', 'completed'];
    if (paidStatuses.includes(status)) {
      await run(`UPDATE payments SET status = ?, gateway_transaction_id = ? WHERE id = ?`, ['paid', transactionId, payment.id]);
      await run(`UPDATE users SET membership_status = ? WHERE id = ?`, ['active', payment.user_id]);
    } else if (status) {
      await run(`UPDATE payments SET status = ?, gateway_transaction_id = ? WHERE id = ?`, [status, transactionId, payment.id]);
    }

    res.json({ received: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Virtual Pay webhook handler failed' });
  }
});

app.get('/admin', requireAdmin, async (req, res) => {
  const users = await all(`SELECT id, name, email, phone, role, membership_status, created_at FROM users ORDER BY created_at DESC`);
  const payments = await all(`SELECT payments.*, users.name, users.email FROM payments JOIN users ON users.id = payments.user_id ORDER BY payments.created_at DESC`);
  const news = await all(`SELECT * FROM news ORDER BY published_at DESC`);
  const leaders = await all(`SELECT * FROM leaders ORDER BY display_order ASC, id ASC`);
  const candidates = await all(`SELECT * FROM candidates ORDER BY display_order ASC, id ASC`);
  res.render('admin', { title: 'Admin Dashboard', users, payments, news, leaders, candidates });
});

app.post('/admin/news', requireAdmin, async (req, res) => {
  const slug = (req.body.slug || req.body.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  await run(`INSERT INTO news (title, slug, excerpt, body) VALUES (?, ?, ?, ?)`, [req.body.title, slug, req.body.excerpt, req.body.body]);
  flash(req, 'success', 'News article published.');
  res.redirect('/admin');
});

app.post('/admin/users/:id/status', requireAdmin, async (req, res) => {
  await run(`UPDATE users SET membership_status = ? WHERE id = ?`, [req.body.status, req.params.id]);
  flash(req, 'success', 'Member status updated.');
  res.redirect('/admin');
});

app.post('/admin/payments/:id/confirm', requireAdmin, async (req, res) => {
  const payment = await get(`SELECT * FROM payments WHERE id = ?`, [req.params.id]);
  if (!payment) {
    flash(req, 'error', 'Payment not found.');
    return res.redirect('/admin');
  }
  await run(`UPDATE payments SET status = ?, gateway_transaction_id = COALESCE(gateway_transaction_id, ?) WHERE id = ?`, ['paid', req.body.transaction_id || 'manual-confirmation', payment.id]);
  await run(`UPDATE users SET membership_status = ? WHERE id = ?`, ['active', payment.user_id]);
  flash(req, 'success', 'Payment confirmed and membership activated.');
  res.redirect('/admin');
});

app.post('/admin/leaders', requireAdmin, upload.single('photo'), async (req, res) => {
  const { role, name, bio, display_order } = req.body;
  if (!role || !name) {
    flash(req, 'error', 'Leader role and name are required.');
    return res.redirect('/admin');
  }
  await run(
    `INSERT INTO leaders (role, name, bio, photo_filename, display_order) VALUES (?, ?, ?, ?, ?)`,
    [role, name, bio || '', req.file ? req.file.filename : null, Number(display_order || 0)]
  );
  flash(req, 'success', 'Leader profile added.');
  res.redirect('/leaders');
});

app.post('/admin/leaders/:id/delete', requireAdmin, async (req, res) => {
  await run(`DELETE FROM leaders WHERE id = ?`, [req.params.id]);
  flash(req, 'success', 'Leader profile deleted.');
  res.redirect('/admin');
});

app.post('/admin/candidates', requireAdmin, upload.single('photo'), async (req, res) => {
  const { name, district, bio, priorities, display_order } = req.body;
  if (!name) {
    flash(req, 'error', 'Candidate name is required.');
    return res.redirect('/admin');
  }
  await run(
    `INSERT INTO candidates (name, district, bio, priorities, photo_filename, display_order) VALUES (?, ?, ?, ?, ?, ?)`,
    [name, district || '', bio || '', priorities || '', req.file ? req.file.filename : null, Number(display_order || 0)]
  );
  flash(req, 'success', 'Candidate profile added.');
  res.redirect('/candidates');
});

app.post('/admin/candidates/:id/delete', requireAdmin, async (req, res) => {
  await run(`DELETE FROM candidates WHERE id = ?`, [req.params.id]);
  flash(req, 'success', 'Candidate profile deleted.');
  res.redirect('/admin');
});

app.use((req, res) => res.status(404).render('error', { title: 'Not Found', message: 'Page not found.' }));

initDb().then(() => app.listen(PORT, () => console.log(`Site running at ${BASE_URL}`))).catch(err => {
  console.error(err);
  process.exit(1);
});
