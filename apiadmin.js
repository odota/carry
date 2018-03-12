const async = require('async');
const redis = require('./store/redis');
const db = require('./store/db');

function storeUsageCounts(cursor) {
  
  redis.scan(cursor, "MATCH", "api_count_limit:*", (err, results) => {
    if (err) {
      return console.log("[ERROR] ", err);
    }
    
    let cursor = results[0];

    async.parallel({
      usage: (cb) => async.mapLimit(results[1], 20, (e, cb2) => redis.get(e, cb2), cb),
      keyInfo: (cb) => async.mapLimit(results[1], 20, (e, cb2) => {
        db.from('api_keys').where({
          api_key: e.replace('api_count_limit:', "")
        }).asCallback(cb2);
      }, cb)
    },
    (err, results) => {
      if( err) {
        return console.error("[ERROR] ", err);
      }

      db('api_key_usage')
        .insert(results.keyInfo.map((e, i) => {
          return {
              account_id: e[0].account_id,
              api_key: e[0].api_key,
              customer_id: e[0].customer_id,
              usage_count: results.usage[i]
          };
        }))
        .asCallback((err, results) => {
          if (err) {
            return console.error("[ERROR] ", err);
          }
        
          if (cursor !== "0") {
            storeUsageCounts(cursor);
          }
        });
    });
  });
}

setInterval(() => storeUsageCounts(0), 10 * 60 * 1000); //Every 10 minutes
