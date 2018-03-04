const express = require('express');
const api = express.Router();
const config = require('../config');
const async = require('async');
const stripe_secret = config.STRIPE_SECRET;
const stripe_public = config.STRIPE_PUBLIC;
const stripe = require('stripe')(stripe_secret);
const uuid = require('uuid/v4');
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
          
          if (results.length > 0) {
            stripe.customers.retrieve(results[0].customer_id,
            (err, customer) => {
              if (err) {
                return next(err);
              }
              
              const source = customer.sources.data[0];
              
              return res.render('api', {
                key: results.length > 0 ? results[0].api_key : null,
                stripe_public,
                credit_brand: source.brand,
                credit_last4: source.last4
              });
            })
          } else {
            return res.render('api', {
              key: results.length > 0 ? results[0].api_key : null,
              stripe_public,
            });
          }
      });
  });
  
  api.route('/create').post((req, res, next) => {
    
    const token = req.body.token;

    if (!token || !req.user) {
      console.log("/api/create No token or no user");
      return res.sendStatus(500);
    }

    console.log('Got token %s', token.id);
    
    stripe.customers.create({
        source: token.id,
        email: token.email,
      }, (err, customer) => {
      
        if (err) {
          console.log(err);
          return res.send(checkErr(err));
        }
        
        const api_key = uuid();

        const query = `INSERT INTO api_keys (account_id, api_key, customer_id)
          VALUES (${req.user.account_id}, '${api_key}', '${customer.id}')
          ON CONFLICT (account_id) DO UPDATE SET
          api_key = '${api_key}', customer_id = '${customer.id}'`;

        db.raw(query)
          .asCallback((err, results) => {
            if (err) {
              console.log(err);
              return next(err);
            }

            stripe.customers.update(customer.id, {
              metadata: {
                account_id: req.user.account_id,
                api_key: api_key
              }
            }, (err, customer) => {
              if (err) {
                return next(err);
              }
              
              return res.sendStatus(200);
            })
          })
      });
  });
  
  api.route('/update').post((req,res,next) => {

    const token = req.body.token;

    if (!token || !req.user) {
      return res.sendStatus(500);
    }

    db.from('api_keys')
    .where({
      account_id: req.user.account_id
    }).asCallback((err, results) => {
        if (err) {
          return next(err);
        }
        
        if (results.length < 1) {
          return next("No previous entry to update.");
        }
        
        stripe.customers.update(results[0].customer_id, {
          source: token.id,
          email: token.email
        }, (err, customer) => {
          if (err) {
            return next(err);
          }
          
          return res.sendStatus(200);
        })
    });
  })
  
  api.route('/delete').get((req, res, next) => {
    if (!req.user) { return res.render('cancel', {
      sub: false,
    }); }

    db.from('api_keys')
    .where({
      account_id: req.user.account_id
    })
    .update({
      api_key: null
    })
    .asCallback((err, results) => {
      if (err) {
        return next(err);
      }

      return res.redirect('/api');
    });
  })
  
  return api;

  function checkErr(err) {
    if (err.raw_type === 'card_error') {
      return 'There was a problem processing your card. ' +
                   'Did you enter the details correctly?';
    } else {
      return 'There was a problem processing your request. ' +
                   'If you keep getting errors, please contact us for support.';
    }
  }
};
