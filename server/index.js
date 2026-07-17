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

hosts.forEach((host) => {
  app
    .listen(PORT, host, () => {
      // eslint-disable-next-line no-console
      console.log(`max-ammon site running at http://${host}:${PORT}`);
    })
    .on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error(`could not listen on ${host}:${PORT} -> ${err.code || err.message}`);
    });
});
