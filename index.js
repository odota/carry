/**
 * Worker serving as main web application
 * Serves web/API requests
 **/
const config = require('./config.js');
console.log(config.NODE_ENV)
console.log(config.GOAL);
console.log(config.REDIS_URL);
const redis = require('./store/redis');
const db = require('./store/db');
const cassandra = config.ENABLE_CASSANDRA_MATCH_STORE_READ ? require('../store/cassandra') : undefined;
const queries = require('./store/queries');
const search = require('./store/search');
const donate = require('./routes/donate');
const request = require('request');
const compression = require('compression');
const session = require('cookie-session');
const path = require('path');
const moment = require('moment');
const async = require('async');
const express = require('express');
const app = express();
const passport = require('passport');
const api_key = config.STEAM_API_KEY.split(',')[0];
const SteamStrategy = require('passport-steam').Strategy;
const host = config.ROOT_URL;
const querystring = require('querystring');
const util = require('util');
const sessOptions = {
  maxAge: 52 * 7 * 24 * 60 * 60 * 1000,
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  domain: ".albertcui.com"  //Add . to beginning to allow other hosts
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
passport.use(new SteamStrategy({
  returnURL: `${host}/return`,
  realm: host,
  apiKey: api_key,
}, (identifier, profile, cb) => {
  const player = profile._json;
  player.last_login = new Date();
  queries.insertPlayer(db, player, (err) => {
    if (err) {
      return cb(err);
    }
    return cb(err, player);
  });
}));
// TODO Remove this with SPA (Views/Locals config)
app.set('views', path.join(__dirname, '../views'));
app.set('view engine', 'jade');
app.locals.moment = moment;
app.locals.constants = constants;
app.locals.tooltips = require('../lang/en.json');
app.locals.qs = querystring;
app.locals.util = util;
app.locals.config = config;
app.locals.basedir = `${__dirname}/../views`;
app.locals.prettyPrint = utility.prettyPrint;
app.locals.percentToTextClass = utility.percentToTextClass;
app.locals.getAggs = utility.getAggs;
// TODO remove this with SPA (no more public assets)
app.use('/public', express.static(path.join(__dirname, '/../public')));
// Session/Passport middleware
app.use(session(sessOptions));
app.use(passport.initialize());
app.use(passport.session());

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

app.route('/login').get(passport.authenticate('steam', {
  failureRedirect: '/',
}));
app.route('/return').get(passport.authenticate('steam', {
  failureRedirect: '/',
}), (req, res, next) => {
  if (config.UI_HOST) {
    return res.redirect(`${config.UI_HOST}/players/${req.user.account_id}`);
  }
  return res.redirect(`/players/${req.user.account_id}`);
});
app.route('/logout').get((req, res) => {
  req.logout();
  req.session = null;
  if (config.UI_HOST) {
    return res.redirect(config.UI_HOST);
  }
  return res.redirect('/');
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
const port = config.PORT || config.FRONTEND_PORT;
const server = app.listen(port, () => {
  console.log('[WEB] listening on %s', port);
});
// listen for TERM signal .e.g. kill
process.once('SIGTERM', gracefulShutdown);
// listen for INT signal e.g. Ctrl-C
process.once('SIGINT', gracefulShutdown);
// this function is called when you want the server to die gracefully
// i.e. wait for existing connections
function gracefulShutdown() {
  console.log('Received kill signal, shutting down gracefully.');
  server.close(() => {
    console.log('Closed out remaining connections.');
    process.exit();
  });
  // if after
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit();
  }, 10 * 1000);
}