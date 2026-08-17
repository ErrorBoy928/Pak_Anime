const bcrypt = require('bcryptjs');
const { init, get, run } = require('./index');

async function main() {
  await init();

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@pakanime.local';
  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeMe123!';

  const existing = await get('SELECT id FROM users WHERE email = ?', [adminEmail]);

  if (existing) {
    console.log('Admin account already exists, skipping.');
    return;
  }

  const hash = bcrypt.hashSync(adminPassword, 10);
  await run(
    'INSERT INTO users (username, email, password_hash, is_admin) VALUES (?, ?, ?, 1)',
    [adminUsername, adminEmail, hash]
  );
  console.log('Admin account created:');
  console.log(`  email: ${adminEmail}`);
  console.log(`  password: ${adminPassword}`);
  console.log('Change this password after first login.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
