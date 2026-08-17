const express = require('express');
const bcrypt = require('bcryptjs');
const { get, run } = require('../db');

const router = express.Router();

const usernameRule = /^[a-zA-Z0-9_]{3,20}$/;
const emailRule = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', async (req, res, next) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'missing_fields' });
    }
    if (!usernameRule.test(username)) {
      return res.status(400).json({ error: 'invalid_username' });
    }
    if (!emailRule.test(email)) {
      return res.status(400).json({ error: 'invalid_email' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'weak_password' });
    }

    const taken = await get('SELECT id FROM users WHERE username = ? OR email = ?', [username, email]);
    if (taken) {
      return res.status(409).json({ error: 'already_exists' });
    }

    const hash = bcrypt.hashSync(password, 10);
    const result = await run(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
      [username, email, hash]
    );

    req.session.userId = Number(result.lastInsertRowid);
    req.session.isAdmin = false;
    req.session.username = username;

    res.status(201).json({ id: Number(result.lastInsertRowid), username, isAdmin: false });
  } catch (err) {
    next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return res.status(400).json({ error: 'missing_fields' });
    }

    const user = await get('SELECT * FROM users WHERE username = ? OR email = ?', [identifier, identifier]);

    if (!user || !bcrypt.compareSync(password, user.password_hash)) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }

    req.session.userId = Number(user.id);
    req.session.isAdmin = !!user.is_admin;
    req.session.username = user.username;

    res.json({ id: Number(user.id), username: user.username, isAdmin: !!user.is_admin });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

router.get('/me', (req, res) => {
  if (!req.session.userId) {
    return res.json({ user: null });
  }
  res.json({
    user: {
      id: req.session.userId,
      username: req.session.username,
      isAdmin: !!req.session.isAdmin,
    },
  });
});

module.exports = router;
