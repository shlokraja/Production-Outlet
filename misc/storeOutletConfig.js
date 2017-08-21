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

function storeOutletConfig() {
  var outlet_id = process.env.OUTLET_ID;
  var hq_url = process.env.HQ_URL;
  var OUTLET_CONFIG_URL = '/outlet/outlet_config/';
  // Getting the response from HQ
  request(hq_url + OUTLET_CONFIG_URL + outlet_id,
    function (error, response, body) {
    if (error || (response && response.statusCode != 200)) {
      console.error('{}: {} {}'.format(hq_url, error, body));
      return;
    }
    // Storing it in redis
    redisClient.set(helper.outlet_config_node,
              body,
              function(outlet_err, outlet_reply){
      if (outlet_err) {
        console.error('error while inserting in redis- {}'.format(outlet_err));
      }
      debug('successfully stored outlet config');
    });
  });
}

module.exports = storeOutletConfig;
