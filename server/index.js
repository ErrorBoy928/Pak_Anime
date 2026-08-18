require('dotenv').config();
const path = require('path');
const express = require('express');
const session = require('express-session');
const SqliteSessionStore = require('./db/session-store');
const { ensureAdminSeeded } = require('./db/seed');

const authRoutes = require('./routes/auth');
const animeRoutes = require('./routes/anime');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    store: new SqliteSessionStore(),
    secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      sameSite: 'lax',
    },
  })
);

app.use('/api/auth', authRoutes);
app.use('/api/anime', animeRoutes);

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Generic error handler so a thrown/rejected route doesn't crash the process.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'server_error' });
});

ensureAdminSeeded()
  .then((result) => {
    if (result.created) {
      console.log('First-run: admin account created —', result.email);
    }
    app.listen(PORT, () => {
      console.log(`Pak-Anime running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
  });
