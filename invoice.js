const config = require('./config');
const db = require('./store/db');
const moment = require('moment');
const async = require('async');

const stripe_secret = config.STRIPE_SECRET;
const stripe_public = config.STRIPE_PUBLIC;
const API_PRICE = config.API_PRICE;

const stripe = require('stripe')(stripe_secret);

let invoiceMonth = moment(); //.subtract(1, 'month');

console.log("Running invoice script on", moment().format("YYYY MM DD"));
console.log("Invoice is for", invoiceMonth.format("MMMM YYYY"));

db.raw(
  `
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
  ORDER BY 1 DESC
  `)
.asCallback((err, results) => {
  if (err) {
    return console.err(err);
  }
  
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
      console.log(err);
      console.log(results.rows);
      if (results.rows.length === 1 && results.rows[0].usage_count === e.usage_count) {
        let charge
        stripe.charges.create({
          amount: 2000,
          currency: "usd",
          customer: e.customer_id,
          description: `Charge for OpenDota API usage for ${invoiceMonth.format("YYYY-MM")}`
        }, (err, charge) => {
          if (err) {
            return console.log("[FAILED] Charge creation failed. api_key",
              e.api_key,
              "account_id",
              e.account_id,
              "customer_id",
              e.customer_id
            );
          }
          
          console.log()
        });
      } else {
        if (results.rows.length != 1) {
          console.log("[FAILED] Got multiple records. api_key",
            e.api_key,
            "account_id",
            e.account_id,
            "customer_id",
            e.customer_id
          );
        } else {
          console.log(
            "[FAILED] Usage did not match count ad end of month. api_key",
            e.api_key,
            "account_id",
            e.account_id,
            "customer_id",
            e.customer_id
          );
        }
        cb();
      }
    })
  });
})