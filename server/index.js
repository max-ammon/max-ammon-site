'use strict';

require('dotenv').config();

const app = require('./app');

const PORT = Number(process.env.PORT) || 3000;

/*
 * HOST accepts a comma-separated list, so the site can be reachable on exactly
 * the interfaces you intend and no others. Examples:
 *   HOST=127.0.0.1                 -> this machine only (default)
 *   HOST=127.0.0.1,10.8.0.6        -> this machine + that one VPN address
 *   HOST=0.0.0.0                   -> every network this machine is on
 */
const hosts = String(process.env.HOST || '127.0.0.1')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

/*
 * Uploading a clip or master over a slow connection can take longer than Node's
 * default 5-minute request timeout, which would abort the upload with a 408.
 * Widen the whole-request window (headers keep their short default timeout, so
 * slow-header/slowloris protection is unchanged, and the reverse proxy still
 * enforces a minimum data rate in front of us). Override with REQUEST_TIMEOUT_MS
 * if an even slower line needs it.
 */
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS) || 30 * 60 * 1000;

hosts.forEach((host) => {
  const server = app.listen(PORT, host, () => {
    // eslint-disable-next-line no-console
    console.log(
      `max-ammon site running at http://${host}:${PORT} (upload timeout ${Math.round(REQUEST_TIMEOUT_MS / 60000)} min)`
    );
  });
  server.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error(`could not listen on ${host}:${PORT} -> ${err.code || err.message}`);
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
});
