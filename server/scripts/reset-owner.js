'use strict';

// Clears the owner account so /admin shows the first-run "create account"
// screen again. Content, gallery and messages are left untouched.
require('dotenv').config();
const db = require('../db');

const n = db.prepare('DELETE FROM users').run().changes;
// eslint-disable-next-line no-console
console.log(`Removed ${n} owner account(s). Visit /admin to create a new owner.`);
process.exit(0);
