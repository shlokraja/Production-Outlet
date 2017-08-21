var Q = require('q');
var request = require('request');
var redis = require('redis');

var helper = require('../routes/helper');
// Initiating the redisClient
var redisClient = redis.createClient();
redisClient.on('error', function(msg) {
  console.error(msg);
});

function isForcePrintBill() {
  var deferred = Q.defer();

  redisClient.get(helper.outlet_config_node, function(err, reply) {
    if(err) {
      deferred.reject('error while retreiving from redis- {}'.format(err));
      return;
    }
    if (!reply) {
      deferred.resolve(null);
      return;
    }
    var outlet_config = JSON.parse(reply);
    deferred.resolve(outlet_config.force_print_bill);
  });
  return deferred.promise;
}

module.exports = isForcePrintBill;
