const config = require('./config');
const db = require('./store/db');
const moment = require('moment');
const async = require('async');

const stripe_secret = config.STRIPE_SECRET;
const stripe_public = config.STRIPE_PUBLIC;
const API_PRICE = config.API_PRICE;
const API_UNIT = config.API_UNIT;
const API_FREE_LIMIT = config.API_FREE_LIMIT;
const stripe = require('stripe')(stripe_secret);

let invoiceMonth = moment(); //.subtract(1, 'month');

console.log("[METADATA] Running invoice script on", moment().format("YYYY MM DD"));
console.log("[METADATA] Invoice is for", invoiceMonth.format("MMMM YYYY"));

let countProcessed = 0, countSkipped = 0, countFailed = 0, countCharged = 0;

db.raw(
  `
    SELECT
      SUM(usage_count) as usage_count,
      ARRAY_AGG(api_key) as api_keys,
      ARRAY_AGG(customer_id ORDER BY timestamp DESC) as customer_ids,
      account_id
    FROM (  
      SELECT
        MAX(usage_count) as usage_count,
        account_id,
        customer_id,
        api_key,
        timestamp
      FROM api_key_usage
      WHERE
        timestamp <= '${invoiceMonth.endOf('month').format("YYYY-MM-DD")}'
        AND timestamp >= '${invoiceMonth.startOf('month').format("YYYY-MM-DD")}'
      GROUP BY account_id, customer_id, api_key, timestamp
    ) as T1
    GROUP BY account_id
  `)
.asCallback((err, results) => {
  if (err) {
    return console.error(err);
    
  }
  
  console.log(results.rows);

  async.eachLimit(results.rows, 10, (e, cb) => {
      
    console.log("[PROCESSING] Account:", e.account_id, "| Usage:", e.usage_count);
    countProcessed++;
      
    e.usage_count = 30001;
    if (e.usage_count <= API_FREE_LIMIT) {
      console.log("[SKIPPED] Account", e.account_id, "under limit.");
      countSkipped++;
      return cb();
    }

    let chargeCount = e.usage_count - API_FREE_LIMIT;
    let charge = Math.round(chargeCount / API_UNIT * API_PRICE * 100);

    if (charge < 50) {
      console.log("[SKIPPED] Account", e.account_id, "charge less than $0.50.");
      countSkipped++;
      return cb();
    }
    
    let chargeMetadata = {
        api_key: e.api_key,
        account_id: e.account_id,
        usage: e.usage_count,
        charge_count: chargeCount
      };
    
    if (e.customer_ids.length === 1) {
      createCharge(charge, e.customer_ids[0],chargeMetadata, cb);
    } else {
      // Try to find the most recent customer ID to use.
      db.from('api_keys')
        .where({
          account_id: e.account_id
        }).asCallback((err, results) => {
          if (err) {
            return cb(err);
          }

          console.log(results);
          if (results.length === 1) {
            createCharge(charge, results[0].customer_id, chargeMetadata, cb);
          } else {
            // This case shouldn't happen since we don't delete the customer_id.
            // Try charging the most recent customer_id available.
            console.log('No charge_id found in DB, account', e.account_id);
            async.someSeries(e.customer_ids, (e, cb2) => {
              createCharge(charge, e, chargeMetadata, (err) => {
                return err ? false : true;
              })
            }, cb);
          }
        });
    }
  },
  (err) => {
    if (err) {
      logandDie(err);
    }
    
    console.log("[METADATA] Processed:", countProcessed, "| Charged:", countCharged, "| Skipped:", countSkipped, "| Failed:", countFailed);
    process.exit(0);
  });
})


function createCharge(chargeAmount, customer_id, metadata, cb) {
   stripe.charges.create({
      amount: chargeAmount,
      currency: "usd",
      customer: customer_id,
      description: `OpenDota API usage for ${invoiceMonth.format("YYYY-MM")}. # Calls: ${metadata.chargeCount}.`,
      metadata: metadata
    }, (err, charge) => {
      if (err) {
        console.error("[FAILED] Charge creation failed. Account",
          metadata.account_id,
          "api_keys",
          metadata.api_keys.join(','),
          "customer_ids",
          metadata.customer_ids.join(',')
        );
        
        console.error(err);
        return cb(err);
      }
      
      console.log("[CHARGED]",
        metadata.account_id,
        "charged", chargeAmount,
        "| ID:", charge.id,
        "| Usage:", metadata.usage_count, 
        "| Customer:", customer_id);
      return cb();
    });
}

function logandDie(err) {
  console.log('[ERROR]', err);
  process.exit(1); 
}