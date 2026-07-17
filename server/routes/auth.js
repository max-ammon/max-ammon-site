'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const auth = require('../services/auth');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15, // 15 attempts per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).render('admin/login', {
      title: 'Log in',
      error: 'Too many attempts. Please wait a few minutes and try again.',
      values: {},
    }),
});

// First-run: create the owner account. Shown only while no owner exists.
router.get('/setup', (req, res) => {
  if (auth.ownerExists()) return res.redirect('/admin/login');
  res.render('admin/setup', { title: 'Create owner account', error: null, values: {} });
});

router.post('/setup', (req, res) => {
  if (auth.ownerExists()) return res.status(403).send('Owner already exists.');
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const confirm = String(req.body.confirm || '');

  const errors = [];
  if (username.length < 3) errors.push('Username must be at least 3 characters.');
  if (password.length < 8) errors.push('Password must be at least 8 characters.');
  if (password !== confirm) errors.push('Passwords do not match.');
  if (errors.length) {
    return res
      .status(400)
      .render('admin/setup', { title: 'Create owner account', error: errors.join(' '), values: { username } });
  }

  const id = auth.createOwner(username, password);
  req.session.userId = id;
  req.session.username = username;
  res.redirect('/admin');
});

// Login.
router.get('/login', (req, res) => {
  if (!auth.ownerExists()) return res.redirect('/admin/setup');
  if (req.session.userId) return res.redirect('/admin');
  res.render('admin/login', { title: 'Log in', error: null, values: {} });
});

router.post('/login', loginLimiter, (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  const user = auth.verifyCredentials(username, password);
  if (!user) {
    return res
      .status(401)
      .render('admin/login', { title: 'Log in', error: 'Incorrect username or password.', values: { username } });
  }
  req.session.userId = user.id;
  req.session.username = user.username;
  const dest = req.session.returnTo || '/admin';
  delete req.session.returnTo;
  res.redirect(dest);
});

// Logout.
router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

module.exports = router;
