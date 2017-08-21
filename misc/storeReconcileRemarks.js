var debug = require('debug')('outlet_app:server');
var format = require('string-format');
var redis = require('redis');
var request = require('request');

var helper = require('../routes/helper');
format.extend(String.prototype);
// Initiating the redisClient
var redisClient = redis.createClient();
redisClient.on('error', function(msg) {
  console.error(msg);
});

function storeReconcileRemarks() {
    var outlet_id = process.env.OUTLET_ID;
    var hq_url = process.env.HQ_URL;
    var reconcile_remarks_url = '/outlet/reconcile_remarks/';

    console.log("storeReconcileRemarks: " + hq_url + reconcile_remarks_url);
    // Getting the response from HQ
    request(hq_url + reconcile_remarks_url,
      function (error, response, result) {
          if (error || (response && response.statusCode != 200))
          {
              console.error('{}: {} {}'.format(hq_url, error, result));
              return;
          }

          // result = result.toString();
          // var reconcile_remarks = (result.substr(1, result.length - 2)).split(',');
          console.log("storeReconcileRemarks ***************************: " + result);

          var reconcile_remarks = result.toString().split(',').map(function (n) {
              return n.replace('{', '').replace('}', '');
          });

          // Storing it in redis
          redisClient.set(helper.reconcile_remarks_node,
                    reconcile_remarks,
                    function (store_reconcile_remarks_err, store_reconcile_remarks_reply) {
                        if (store_reconcile_remarks_err)
                        {
                            console.error('error while inserting in redis- {}'.format(store_reconcile_remarks_err));
                        }
                        debug('successfully stored reconcile remarks.');
                    });
      });
}

module.exports = storeReconcileRemarks;
