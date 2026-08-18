function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'not_authenticated' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.userId || !req.session.isAdmin) {
    return res.status(403).json({ error: 'admin_only' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
