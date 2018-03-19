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
      ARRAY_AGG(api_key) as api_jeys,
      ARRAY_AGG(customer_id) as customer_ids,
      account_id
    FROM (  
      SELECT
        MAX(usage_count) as usage_count,
        account_id,
        customer_id,
        api_key
      FROM api_key_usage
      WHERE
        timestamp <= '${invoiceMonth.endOf('month').format("YYYY-MM-DD")}'
        AND timestamp >= '${invoiceMonth.startOf('month').format("YYYY-MM-DD")}'
      GROUP BY 2, 3, 4
    ) as T1
    GROUP BY 4
  `)
.asCallback((err, results) => {
  if (err) {
    return console.error(err);
  }
  
  console.log(results.rows);
  process.exit(1);
  
  async.eachLimit(results.rows, 10, (e, cb) => {
    
    db.raw(
    `
      SELECT
        MAX(timestamp),
        usage_count,
        account_id,
        customer_id,
        api_key
      FROM api_key_usage
      WHERE
        timestamp <= '${invoiceMonth.endOf('month').format("YYYY-MM-DD")}'
        AND timestamp >= '${invoiceMonth.startOf('month').format("YYYY-MM-DD")}'
        AND account_id = ${e.account_id ? "'" + e.account_id + "'" : null}
        AND customer_id = ${e.customer_id ? "'" + e.customer_id + "'" : null}
        AND api_key = ${e.api_key ? "'" + e.api_key + "'" : null}
      GROUP BY 2, 3, 4, 5
    `)
    .asCallback((err, results) => {
      
      console.log("[PROCESSING] Key:", e.api_key, "| Usage:", e.usage_count, "| Account:", e.account_id, "| Customer:", e.customer_id);
      
      countProcessed++;
      
      if (err) {
        console.error(err);
        return cb(err);
      }

      if (results.rows.length === 1 && results.rows[0].usage_count === e.usage_count) {
        
        e.usage_count = 25001;
        if (e.usage_count <= API_FREE_LIMIT) {
          console.log("[SKIPPED] Key", e.api_key, "under limit.");
          countSkipped++;
          return cb();
        }

        let chargeCount = e.usage_count - API_FREE_LIMIT;
        let charge = Math.round(chargeCount / API_UNIT * API_PRICE * 100);

        if (charge < 50) {
          console.log("[SKIPPED] Key", e.api_key, "charge less than $0.50.");
          countSkipped++;
          return cb();
        }
        
        stripe.charges.create({
          amount: charge,
          currency: "usd",
          customer: e.customer_id,
          description: `OpenDota API usage for ${invoiceMonth.format("YYYY-MM")}. # Calls: ${chargeCount}.`,
          metadata: {
            api_key: e.api_key,
            account_id: e.account_id,
            usage: e.usage_count,
            charge_count: chargeCount
          }
        }, (err, charge) => {
          if (err) {
            console.error("[FAILED] Charge creation failed. api_key",
              e.api_key,
              "account_id",
              e.account_id,
              "customer_id",
              e.customer_id
            );
            
            console.error(err);
            return cb(err);
          }
          
          console.log("[CHARGED]", charge, "| ID:", charge.id, "Key:", e.api_key, "| Usage:", e.usage_count, "| Account:", e.account_id, "| Customer:", e.customer_id);
          
          countCharged++;
          return cb();
        });
      } else {
        if (results.rows.length != 1) {
          console.error("[FAILED] Got multiple records. api_key",
            e.api_key,
            "account_id",
            e.account_id,
            "customer_id",
            e.customer_id
          );
        } else {
          console.error(
            "[FAILED] Usage did not match count ad end of month. api_key",
            e.api_key,
            "account_id",
            e.account_id,
            "customer_id",
            e.customer_id
          );
        }
        
        countFailed++;
        return cb();
      }
    })
  },
  (err) => {
    if (err) {
      process.exit(1);
    }
    
    console.log("[METADATA] Processed:", countProcessed, "| Charged:", countCharged, "| Skipped:", countSkipped, "| Failed:", countFailed);
    process.exit(0);
  });
})