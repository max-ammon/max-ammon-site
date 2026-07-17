'use strict';

const bcrypt = require('bcryptjs');
const db = require('../db');

const qOwner = db.prepare('SELECT * FROM users ORDER BY id LIMIT 1');
const qById = db.prepare('SELECT * FROM users WHERE id = ?');
const qByUsername = db.prepare('SELECT * FROM users WHERE username = ?');
const insUser = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
const updPass = db.prepare(
  "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?"
);

const BCRYPT_ROUNDS = 12;

function getOwner() {
  return qOwner.get() || null;
}

function ownerExists() {
  return !!qOwner.get();
}

function createOwner(username, password) {
  const hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
  const info = insUser.run(username, hash);
  return info.lastInsertRowid;
}

function verifyCredentials(username, password) {
  const user = qByUsername.get(username);
  if (!user) return null;
  if (!bcrypt.compareSync(password, user.password_hash)) return null;
  return user;
}

function changePassword(userId, newPassword) {
  updPass.run(bcrypt.hashSync(newPassword, BCRYPT_ROUNDS), userId);
}

// Route guard: allow only a logged-in owner whose account still exists.
function requireAuth(req, res, next) {
  const reject = () => {
    if (req.method === 'GET') return res.redirect('/admin/login');
    return res.status(401).json({ error: 'Not authenticated' });
  };

  if (!req.session || !req.session.userId) return reject();

  // The account may have been removed since the session was created
  // (e.g. `npm run reset-owner`), so don't trust the session alone.
  if (!qById.get(req.session.userId)) {
    return req.session.destroy(() => reject());
  }
  return next();
}

// Expose the logged-in owner (if any) to admin templates.
function currentUser(req) {
  if (req.session && req.session.userId) {
    return { id: req.session.userId, username: req.session.username };
  }
  return null;
}

module.exports = {
  getOwner,
  ownerExists,
  createOwner,
  verifyCredentials,
  changePassword,
  requireAuth,
  currentUser,
};
