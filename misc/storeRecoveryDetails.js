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

function storeRecoveryDetails() {
  var redis_nodes = [
    helper.bill_no_node,
    helper.dispense_id_node
  ];
  // first check the redis nodes, if they are present, they no need
  redisClient.mget(redis_nodes, function(err, reply) {
    if (err) {
      console.error(err);
      return;
    }
    if (reply[0] != null && reply[1] != null) {
      debug("All data is present. No need to query HQ");
      return;
    }
    debug("Recovery data is not present, pullling from HQ");

    // get the details from HQ
    var hq_url = process.env.HQ_URL;
    request({
      url: hq_url + '/outlet/get_recovery_details/' + process.env.OUTLET_ID,
    }, function(error, response, body) {
      if (error || (response && response.statusCode != 200)) {
        console.error('{}: {} {}'.format(hq_url, error, body));
        return;
      }
      debug("Got recovery details from HQ- ", body);
      if (!body) {
        return;
      }
      var recovery_details = JSON.parse(body);
      // and then store it in redis
      redisClient.set(helper.bill_no_node, recovery_details.bill_no, function(set_err, set_reply) {
        if (set_err) {
          console.error(set_err);
          return;
        }
        debug("Updated bill no from HQ");
      });
      redisClient.set(helper.dispense_id_node, recovery_details.dispense_id, function(set_err, set_reply) {
        if (set_err) {
          console.error(set_err);
          return;
        }
        debug("Updated dispense id from HQ");
      });
    });
  });
}

module.exports = storeRecoveryDetails;
