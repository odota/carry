const express = require('express');
const api = express.Router();
const config = require('../config');
const async = require('async');
const moment = require('moment');
const stripe_secret = config.STRIPE_SECRET;
const stripe_public = config.STRIPE_PUBLIC;
const stripe = require('stripe')(stripe_secret);
const uuid = require('uuid/v5');
const bodyParser = require('body-parser');

module.exports = function (db, redis) {
  api.use(bodyParser.json());
  api.use(bodyParser.urlencoded(
    {
      extended: true,
    }));
  api.route('/').get((req, res, next) => {
    db.from('api_keys')
      .where({
        account_id: req.user.account_id
      }).asCallback((err, results) => {
          if (err) {
            return next(err);
          }
          
          res.render('api', {
            key: results,
            stripe_public,
          });
      });
  });
  
  api.route('/create').post((req, res, next) => {
    
    const token = req.body.token;

    if (!token || isNaN(amount)) {
      return res.sendStatus(500);
    }

    console.log('Got token %s', token.id);
    
    stripe.customers.create({
        source: token.id,
        plan: 1,
        quantity: amount, // Plan is $1/cheese/month
        email: token.email,
      }, (err, customer) => {
        
        
      });
    db('api_keys')
      .insert({
        account_id: req.user.account_id,
        api_key: uuid(config.ROOT_URL, uuid.URL)
      })
      .asCallback((err, results) => {
        if (err) {
          return next(err);
        }
        
      })
  });
  
  api.route('/stripe_checkout').post((req, res, next) => {
    const amount = Number(req.body.amount);
    const subscription = req.body.subscription !== 'false';
    const token = req.body.token;

    if (!token || isNaN(amount)) {
      return res.sendStatus(500);
    }

    console.log('Got token %s', token.id);

    if (subscription) {
      stripe.customers.create({
        source: token.id,
        plan: 1,
        quantity: amount, // Plan is $1/cheese/month
        email: token.email,
      }, (err, customer) => {
        if (err) {
          return res.send(checkErr(err));
        }

        if (req.user) {
          db('subscriptions').insert({
            account_id: req.user.account_id,
            customer_id: customer.id,
            amount,
            active_until: moment().add(1, 'M').format('YYYY-MM-DD'),
          }).asCallback((err) => {
            if (err) return res.send(checkErr());

            console.log('Added subscription for %s, cusomer id %s',
                                    req.user.account_id,
                                    customer.id);

            req.session.cheeseAmount = amount;
            req.session.subscription = 1; // Signed in
            return res.sendStatus(200);
          });
        } else {
          req.session.cheeseAmount = amount;
          req.session.subscription = 2; // Not signed in
          return res.sendStatus(200);
        }
      });
    } else {
      stripe.charges.create({
        amount: amount * 100,
        currency: 'usd',
        source: token.id,
        description: `Buying ${amount} cheese!`,
      }, (err, charge) => {
        if (err) {
          return res.send(checkErr(err));
        }

        addCheeseAndRespond(req, res, amount);
      });
    }
  });
  api.route('/stripe_endpoint').post((req, res, next) => {
    const id = req.body.id;
    console.log('Got a event from Stripe, id %s', id);
        // Get the event from Stripe to verify
    stripe.events.retrieve(id, (err, event) => {
      if (err) {
        return res.sendStatus(400);
      }

            // Only care about charge succeeded or subscription ended
      if (event.type !== 'charge.succeeded' && event.type !== 'customer.subscription.deleted') {
        return res.sendStatus(200);
      }

            // Check that we haven't seen this before
      redis.lrange('stripe:events', 0, 1000, (err, result) => {
        if (err) {
          console.log(err);
          return res.sendStatus(400); // Redis is derping, have Stripe send back later
        }

        for (let i = 0; i < result.length; i++) {
          if (result[i] === id) {
            console.log('Found event %s in redis.', id);
            return res.sendStatus(200);
          }
        }

                // New event
        if (event.type === 'charge.succeeded') {
          const amount = event.data.object.amount / 100;

          console.log('Event %s: Charge succeeded for %s.', id, amount);

                    // Update cheese goal
          redis.incrby('cheese_goal', amount, (err, val) => {
            if (!err && val === Number(amount)) {
                            // this condition indicates the key is new
                            // Set TTL to end of the month
              redis.expire('cheese_goal', moment().endOf('month').unix() - moment().unix());
            } else if (err) {
              console.log('Failed to increment cheese_goal');
            }

            const customer = event.data.object.customer;
            if (customer) { // Subscription, associate with user if possible
              console.log('Event %s: Charge belongs to customer %s.', id, customer);

              db('subscriptions')
                            .returning('account_id')
                            .update({
                              active_until: moment().add(1, 'M').format('YYYY-MM-DD'),
                            })
                            .where({
                              customer_id: customer,
                            })
                            .asCallback((err, sub) => {
                              if (err) return res.sendStatus(400); // Postgres derping
                              if (sub && sub.length > 0) {
                                console.log('Event %s: Found customer %s, account_id is %s', id, customer, sub[0]);
                                db('players')
                                    .increment('cheese', amount || 0)
                                    .where({
                                      account_id: sub[0],
                                    })
                                    .asCallback((err, result) => {
                                      if (err) return res.sendStatus(400);
                                      console.log('Event %s: Incremented cheese of %s', id, sub[0]);
                                      addEventAndRespond(id, res);
                                    });
                              } else {
                                console.log('Event %s: Did not find customer %s.', id, customer);
                                addEventAndRespond(id, res);
                              }
                            });
            } else {
              addEventAndRespond(id, res);
            }
          });
        } else if (event.type === 'customer.subscription.deleted') {
                    // Our delete process should delete the subscription, but make sure.
          const customer = event.data.object.customer;
          console.log('Event %s: Customer %s being deleted.', id, customer);

          db('subscriptions')
                    .where({
                      customer_id: customer,
                    }).del()
                    .asCallback((err, result) => {
                      if (err) return res.sendStatus(400);

                      addEventAndRespond(id, res);
                    });
        } else { // Shouldn't happen
          res.sendStatus(200);
        }
      });
    });
  });
  
  api.route('/thanks').get((req, res) => {
    const cheeseCount = req.session.cheeseAmount || 0;
    const subscription = req.session.subscription;
    const cancel = req.session.cancel;

    clearPaymentSessions(req);
    res.render('thanks', {
      cheeseCount,
      subscription,
      cancel,
    });
  });
  api.route('/cancel').get((req, res, next) => {
    if (!req.user) { return res.render('cancel', {
      sub: false,
    }); }

    db('subscriptions')
        .where({
          account_id: req.user.account_id,
        })
        .asCallback((err, sub) => {
          if (err) return next(err);
          res.render('cancel', {
            sub,
          });
        });
  }).post((req, res, next) => {
    db('subscriptions')
        .where({
          account_id: req.user.account_id,
        })
        .asCallback((err, subs) => {
          if (err) {
            return next(err);
          }

          async.each(subs, (sub, cb) => {
            stripe.customers.del(sub.customer_id, (err, result) => {
                    // Indicates the subscription has already been deleted.
              if (err && err.rawType !== 'invalid_request_error') return cb(err);
              db('subscriptions')
                    .where({
                      customer_id: sub.customer_id,
                    })
                    .del()
                    .asCallback(cb);
            });
          }, (err) => {
            if (err) return next(err);

            req.session.cancel = true;
            res.redirect('/thanks');
          });
        });
  });

  return api;

  function addCheeseAndRespond(req, res, amount) {
    if (req.user) {
      db('players')
            .increment('cheese', amount || 0)
            .where({
              account_id: req.user.account_id,
            }).asCallback((err) => {
              if (err) { return res.send(
                    'There was a problem processing your subscription.'
                    + ' Please contact us for support.'); }

              req.session.cheeseAmount = amount;
              res.sendStatus(200);
            });
    } else {
      req.session.cheeseAmount = amount;
      return res.sendStatus(200);
    }
  }

  function addEventAndRespond(id, res) {
    redis.lpush('stripe:events', id);
    redis.ltrim('stripe:events', 0, 1000);
    res.sendStatus(200);
  }

  function checkErr(err) {
    if (err.raw_type === 'card_error') {
      return 'There was a problem processing your card. ' +
                   'Did you enter the details correctly?';
    } else {
      return 'There was a problem processing your request. ' +
                   "If you're trying to make a subscription, only credit/debit cards are supported. " +
                   'If you keep getting errors, please contact us for support.';
    }
  }

  function clearPaymentSessions(req) {
    req.session.cheeseAmount = null;
    req.session.subscription = null;
    req.session.cancel = null;
  }
};
