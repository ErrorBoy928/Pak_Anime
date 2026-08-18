const session = require('express-session');
const { get, run } = require('./index');

class SqliteSessionStore extends session.Store {
  async get(sid, cb) {
    try {
      const row = await get('SELECT sess, expires FROM sessions WHERE sid = ?', [sid]);
      if (!row || row.expires < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.sess));
    } catch (err) {
      cb(err);
    }
  }

  async set(sid, sessionData, cb) {
    try {
      const maxAge = sessionData.cookie?.maxAge || 1000 * 60 * 60 * 24 * 7;
      const expires = Date.now() + maxAge;
      await run(
        `INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`,
        [sid, JSON.stringify(sessionData), expires]
      );
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  async destroy(sid, cb) {
    try {
      await run('DELETE FROM sessions WHERE sid = ?', [sid]);
      cb(null);
    } catch (err) {
      cb(err);
    }
  }

  touch(sid, sessionData, cb) {
    this.set(sid, sessionData, cb);
  }
}

module.exports = SqliteSessionStore;
