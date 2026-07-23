'use strict';

// First-party, privacy-friendly page-view analytics. No cookies, no stored IP,
// no raw user-agent (see schema.sql and middleware/analytics.js). This module
// persists events and answers the aggregate questions the admin dashboard asks:
// views over time, top pages, referrers, and the device split.

const db = require('../db');

const insEvent = db.prepare(
  'INSERT INTO analytics_events (day, ts, path, referrer_host, device, visitor) VALUES (@day, @ts, @path, @referrer_host, @device, @visitor)'
);
const qTotals = db.prepare(
  "SELECT COUNT(*) AS views, COUNT(DISTINCT CASE WHEN visitor <> '' THEN visitor END) AS visitors FROM analytics_events WHERE day >= ? AND day <= ?"
);
const qPerDay = db.prepare(
  "SELECT day, COUNT(*) AS views, COUNT(DISTINCT CASE WHEN visitor <> '' THEN visitor END) AS visitors FROM analytics_events WHERE day >= ? AND day <= ? GROUP BY day"
);
const qTopPages = db.prepare(
  'SELECT path, COUNT(*) AS c FROM analytics_events WHERE day >= ? AND day <= ? GROUP BY path ORDER BY c DESC, path LIMIT ?'
);
const qTopReferrers = db.prepare(
  "SELECT referrer_host, COUNT(*) AS c FROM analytics_events WHERE day >= ? AND day <= ? AND referrer_host <> '' GROUP BY referrer_host ORDER BY c DESC, referrer_host LIMIT ?"
);
const qDevices = db.prepare(
  'SELECT device, COUNT(*) AS c FROM analytics_events WHERE day >= ? AND day <= ? GROUP BY device ORDER BY c DESC'
);
const qDirect = db.prepare(
  "SELECT COUNT(*) AS c FROM analytics_events WHERE day >= ? AND day <= ? AND referrer_host = ''"
);
const delOld = db.prepare('DELETE FROM analytics_events WHERE day < ?');

// YYYY-MM-DD in the server's local time (matches how days are bucketed on write).
function localDay(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

// Inclusive [fromDay, toDay] window covering the last `days` calendar days.
function rangeFor(days) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  return { fromDay: localDay(start), toDay: localDay(now) };
}

function record(evt) {
  insEvent.run({
    day: evt.day,
    ts: evt.ts,
    path: String(evt.path || '').slice(0, 512),
    referrer_host: String(evt.referrer_host || '').slice(0, 255),
    device: evt.device || '',
    visitor: evt.visitor || '',
  });
}

function summary(fromDay, toDay, limit) {
  const lim = limit || 15;
  const totals = qTotals.get(fromDay, toDay) || {};

  // Fill every calendar day in the range so the chart reads as a true timeline
  // (days with no visits become zero bars rather than being skipped).
  const byDay = {};
  qPerDay.all(fromDay, toDay).forEach((r) => { byDay[r.day] = r; });
  const perDay = [];
  const cur = new Date(fromDay + 'T00:00:00');
  const end = new Date(toDay + 'T00:00:00');
  while (cur <= end) {
    const day = localDay(cur);
    const row = byDay[day];
    perDay.push({ day, views: row ? row.views : 0, visitors: row ? row.visitors : 0 });
    cur.setDate(cur.getDate() + 1);
  }

  return {
    views: totals.views || 0,
    visitors: totals.visitors || 0,
    perDay,
    topPages: qTopPages.all(fromDay, toDay, lim),
    topReferrers: qTopReferrers.all(fromDay, toDay, lim),
    devices: qDevices.all(fromDay, toDay),
    direct: (qDirect.get(fromDay, toDay) || {}).c || 0,
  };
}

// Best-effort retention so the table can't grow unbounded on an unattended box.
function prune(beforeDay) {
  try { delOld.run(beforeDay); } catch (e) { /* best-effort */ }
}

module.exports = { record, summary, prune, localDay, rangeFor };
