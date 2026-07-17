'use strict';

const nodemailer = require('nodemailer');

let transporter = null;
let mode = 'json'; // 'smtp' once configured, otherwise a no-send dev transport

function getTransporter() {
  if (transporter) return transporter;
  if (process.env.SMTP_HOST) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    mode = 'smtp';
  } else {
    // No SMTP configured yet: "send" to a JSON transport (no network) so the
    // contact flow works locally. Real mail goes out once SMTP_* is set in .env.
    transporter = nodemailer.createTransport({ jsonTransport: true });
    mode = 'json';
  }
  return transporter;
}

async function sendContactEmail(msg) {
  const t = getTransporter();
  const to = process.env.MAIL_TO || process.env.SMTP_USER || 'owner@localhost';
  const from = process.env.MAIL_FROM || 'Max Ammon site <no-reply@max-ammon.com>';
  const subjectExtra = msg.subject ? `: ${msg.subject}` : '';
  const info = await t.sendMail({
    to,
    from,
    replyTo: msg.email ? `${msg.name} <${msg.email}>` : undefined,
    subject: `[max-ammon.com] Message from ${msg.name}${subjectExtra}`,
    text: `Name: ${msg.name}\nEmail: ${msg.email}\n\n${msg.message}`,
  });
  if (mode === 'json') {
    // eslint-disable-next-line no-console
    console.log('[mailer] SMTP not configured — message logged instead of sent:\n' + info.message);
  }
  return { mode, info };
}

module.exports = { sendContactEmail, mailMode: () => mode };
