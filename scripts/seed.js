require('dotenv').config();
const bcrypt = require('bcryptjs');
const { initDb, run, get } = require('../db');

function slugify(s) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''); }

(async () => {
  await initDb();
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@example.com';
  const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
  const existingAdmin = await get(`SELECT id FROM users WHERE email = ?`, [adminEmail]);
  if (!existingAdmin) {
    const hash = await bcrypt.hash(adminPassword, 12);
    await run(`INSERT INTO users (name, email, phone, password_hash, role, membership_status) VALUES (?, ?, ?, ?, ?, ?)`, ['Site Admin', adminEmail, '', hash, 'admin', 'active']);
  }
  const existingNews = await get(`SELECT id FROM news LIMIT 1`);
  if (!existingNews) {
    const posts = [
      ['Community Meeting Announced', 'Members and supporters are invited to a community meeting.', 'Join us for updates, discussion, and opportunities to get involved.'],
      ['Volunteer Day Coming Soon', 'A new community service event is being planned.', 'Details will be shared soon. Members can register interest through the portal.'],
      ['Membership Drive Launched', 'Monthly membership is now available online.', 'Supporters can register, log in, and activate a $20 monthly membership through Virtual Pay.']
    ];
    for (const [title, excerpt, body] of posts) {
      await run(`INSERT INTO news (title, slug, excerpt, body) VALUES (?, ?, ?, ?)`, [title, slugify(title), excerpt, body]);
    }
  }
  console.log(`Seed complete. Admin login: ${adminEmail} / ${adminPassword}`);
  process.exit(0);
})();
