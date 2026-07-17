'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { saveMessage } = require('../services/messages');
const { sendContactEmail } = require('../services/mailer');

const router = express.Router();

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // max 5 submissions per IP per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.redirect('/?contact=throttled#contact'),
});

const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

router.post('/contact', limiter, async (req, res) => {
  // Honeypot: real users never fill the hidden "website" field.
  if (String(req.body.website || '').trim() !== '') {
    return res.redirect('/?contact=sent#contact'); // silently drop bots
  }

  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim();
  const subject = String(req.body.subject || '').trim();
  const message = String(req.body.message || '').trim();

  if (name.length < 2 || !validEmail(email) || message.length < 5) {
    return res.redirect('/?contact=error#contact');
  }

  const record = {
    name: name.slice(0, 200),
    email: email.slice(0, 200),
    subject: subject.slice(0, 200),
    message: message.slice(0, 5000),
    ip: req.ip || '',
    user_agent: String(req.get('user-agent') || '').slice(0, 300),
  };

  try {
    saveMessage(record); // always store, even if email delivery fails
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('contact save error:', e.message);
    return res.redirect('/?contact=error#contact');
  }

  try {
    await sendContactEmail(record);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('contact email error:', e.message); // message is still saved for the inbox
  }

  res.redirect('/?contact=sent#contact');
});

module.exports = router;
