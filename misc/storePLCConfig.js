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

function storePLCConfig() {
  var outlet_id = process.env.OUTLET_ID;
  var hq_url = process.env.HQ_URL;
  var PLC_CONFIG_URL = '/outlet/plc_config/';
  // Getting the response from HQ
  request(hq_url + PLC_CONFIG_URL + outlet_id,
    function (error, response, body) {
    if (error || (response && response.statusCode != 200)) {
      console.error('{}: {} {}'.format(hq_url, error, body));
      return;
    }
    // Storing it in redis
    redisClient.set(helper.plc_config_node,
              body,
              function(store_plc_err, store_plc_reply){
      if (store_plc_err) {
        console.error('error while inserting in redis- {}'.format(store_plc_err));
      }
      debug('successfully stored plc config');
    });
  });
}

module.exports = storePLCConfig;
