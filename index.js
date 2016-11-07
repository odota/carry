const cp = require('child_process');
const path = require('path');
if (process.env.PROVIDER === 'gce') {
  cp.execSync(
    'curl -H "Metadata-Flavor: Google" -L http://metadata.google.internal/computeMetadata/v1/project/attributes/env > '
    + path.join(__dirname, '/.env'));
}

const config = require('./config');
const redis = require('./store/redis');
const db = require('./store/db');
const donate = require('./routes/donate');
const session = require('cookie-session');
const moment = require('moment');
const async = require('async');
const express = require('express');
const app = express();
const passport = require('passport');
const compression = require('compression');
const host = config.UI_HOST;
const querystring = require('querystring');
const util = require('util');
const sessOptions = {
  domain: config.COOKIE_DOMAIN,
  maxAge: 52 * 7 * 24 * 60 * 60 * 1000,
  secret: config.SESSION_SECRET
};
// PASSPORT config
passport.serializeUser((user, done) => {
  done(null, user.account_id);
});
passport.deserializeUser((account_id, done) => {
  done(null, {
    account_id,
  });
});

// TODO Remove this with SPA (Views/Locals config)
app.set('views', path.join(__dirname, '/views'));
app.set('view engine', 'jade');
app.locals.moment = moment;
app.locals.qs = querystring;
app.locals.util = util;
app.locals.config = config;
app.locals.host = host;
app.locals.basedir = `${__dirname}/views`;

// TODO remove this with SPA (no more public assets)
app.use('/public', express.static(path.join(__dirname, '/public')));
// Session/Passport middleware
app.use(session(sessOptions));
app.use(passport.initialize());
app.use(passport.session());
app.use(compression());

app.use((req, res, cb) => {
  async.parallel({
    banner(cb) {
      redis.get('banner', cb);
    },
    cheese(cb) {
      redis.get('cheese_goal', cb);
    },
  }, (err, results) => {
    res.locals.user = req.user;
    res.locals.banner_msg = results.banner;
    res.locals.cheese = results.cheese;
    return cb(err);
  });
});

app.use('/', donate(db, redis));
app.use((req, res, next) => {
  const err = new Error('Not Found');
  err.status = 404;
  return next(err);
});
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500);
  redis.zadd('error_500', moment().format('X'), req.originalUrl);
  if (req.originalUrl.indexOf('/api') === 0) {
    return res.json({
      error: err,
    });
  } else if (config.NODE_ENV === 'development') {
    // default express handler
    next(err);
  } else {
    return res.render(`error/${err.status === 404 ? '404' : '500'}`, {
      error: err,
    });
  }
});
const port = config.CARRY_PORT;
const server = app.listen(port, () => {
  console.log('[WEB] listening on %s', port);
});