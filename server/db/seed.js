const bcrypt = require('bcryptjs');
const { init, get, run } = require('./index');

async function ensureAdminSeeded() {
  await init();

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@pakanime.local';
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeMe123!';

  const existing = await get('SELECT id FROM users WHERE email = ?', [adminEmail]);
  if (existing) {
    return { created: false };
  }

  const hash = bcrypt.hashSync(adminPassword, 10);
  await run(
    'INSERT INTO users (username, email, password_hash, is_admin) VALUES (?, ?, ?, 1)',
    [adminUsername, adminEmail, hash]
  );
  return { created: true, email: adminEmail, username: adminUsername, password: adminPassword };
}

// Runs standalone when called via `npm run seed`, but not when required
// from server/index.js (which calls ensureAdminSeeded() itself on boot).
if (require.main === module) {
  ensureAdminSeeded()
    .then((result) => {
      if (result.created) {
        console.log('Admin account created:');
        console.log(`  email: ${result.email}`);
        console.log(`  password: ${result.password}`);
        console.log('Change this password after first login.');
      } else {
        console.log('Admin account already exists, skipping.');
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { ensureAdminSeeded };
