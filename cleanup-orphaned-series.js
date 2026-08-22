// One-time cleanup: removes any "series" records that have zero episodes
// left (these can be left behind by deletes made before this cleanup was
// added to the delete route itself). Safe to run any time — it only
// touches series with no episodes.
//
// HOW TO USE:
// 1. Fill in DATABASE_URL and DATABASE_AUTH_TOKEN below — same values you
//    used in Render's environment variables.
// 2. Run: node cleanup-orphaned-series.js

const DATABASE_URL = 'PASTE_YOUR_DATABASE_URL_HERE';
const DATABASE_AUTH_TOKEN = 'PASTE_YOUR_DATABASE_AUTH_TOKEN_HERE';

const { createClient } = require('@libsql/client');

const db = createClient({ url: DATABASE_URL, authToken: DATABASE_AUTH_TOKEN });

async function main() {
  if (DATABASE_URL.startsWith('PASTE_')) {
    console.error('Edit this file first and fill in the 2 values at the top.');
    process.exit(1);
  }

  const orphans = await db.execute(`
    SELECT s.id, s.title, s.poster_key
    FROM series s
    LEFT JOIN anime a ON a.series_id = s.id
    WHERE a.id IS NULL
  `);

  if (orphans.rows.length === 0) {
    console.log('No orphaned series found — nothing to clean up.');
    return;
  }

  console.log(`Found ${orphans.rows.length} orphaned series:`);
  orphans.rows.forEach((r) => console.log(` - [${r.id}] ${r.title}`));

  for (const row of orphans.rows) {
    await db.execute({ sql: 'DELETE FROM series WHERE id = ?', args: [row.id] });
  }
  console.log('Deleted.');
  console.log('Note: this only removes the database records — if any of');
  console.log('those series had a poster image, that file itself still sits');
  console.log('in R2 taking up a little space, but it is now unused and');
  console.log('harmless to leave there.');
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
