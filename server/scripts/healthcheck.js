'use strict';

// Container healthcheck: exit 0 if the app answers on the loopback, else 1.
// A separate file avoids fragile shell quoting in the Dockerfile HEALTHCHECK.
const http = require('http');
const port = Number(process.env.PORT) || 3000;

const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 4000 }, (res) => {
  res.resume();
  process.exit(res.statusCode && res.statusCode < 500 ? 0 : 1);
});
req.on('error', () => process.exit(1));
req.on('timeout', () => {
  req.destroy();
  process.exit(1);
});
