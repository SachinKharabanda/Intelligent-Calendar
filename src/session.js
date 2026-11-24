// Anonymous cookie-based visitors (no accounts, no passwords). Status: Implemented.
// A visitor is a random UUID in the first-party cookie `ic_session`. The server trusts it
// only as a calendar key: it is validated as a UUID, never used as authentication, and holds
// no personal data. Clearing the cookie gives the browser a fresh, empty calendar.

var crypto = require('crypto');

var COOKIE = 'ic_session';
var MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function middleware(req, res, next) {
  var id = req.cookies && req.cookies[COOKIE];
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    id = crypto.randomUUID();
    res.cookie(COOKIE, id, {
      httpOnly: true,
      sameSite: 'lax',
      secure: !!process.env.VERCEL, // https on Vercel, plain http on localhost
      maxAge: MAX_AGE_MS,
    });
  }
  req.sessionId = id.toLowerCase();
  next();
}

module.exports = { middleware: middleware, COOKIE: COOKIE };
