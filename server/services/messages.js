'use strict';

const db = require('../db');

const insMsg = db.prepare(
  'INSERT INTO contact_messages (name, email, subject, message, ip, user_agent, status) VALUES (@name, @email, @subject, @message, @ip, @user_agent, @status)'
);
const qAll = db.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC, id DESC');
const qUnread = db.prepare("SELECT COUNT(*) AS c FROM contact_messages WHERE status = 'new'");
const setStatus = db.prepare('UPDATE contact_messages SET status = ? WHERE id = ?');
const delMsg = db.prepare('DELETE FROM contact_messages WHERE id = ?');

function saveMessage(m) {
  return insMsg.run({
    name: m.name || '',
    email: m.email || '',
    subject: m.subject || '',
    message: m.message || '',
    ip: m.ip || '',
    user_agent: m.user_agent || '',
    status: 'new',
  }).lastInsertRowid;
}

function listMessages() {
  return qAll.all();
}

function unreadCount() {
  return qUnread.get().c;
}

function updateStatus(id, status) {
  if (['new', 'read', 'archived'].includes(status)) setStatus.run(status, id);
}

function deleteMessage(id) {
  delMsg.run(id);
}

module.exports = { saveMessage, listMessages, unreadCount, updateStatus, deleteMessage };
