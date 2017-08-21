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

function storeSessionTimings() {
    var outlet_id = process.env.OUTLET_ID;
    var hq_url = process.env.HQ_URL;
    var session_timings_url = '/outlet/get_session_timings/';

    console.log("storeSessionTimings: " + hq_url + session_timings_url);
    // Getting the response from HQ
    request(hq_url + session_timings_url + outlet_id,
      function (error, response, result) {
          if (error || (response && response.statusCode != 200))
          {
              console.error('{}: {} {}'.format(hq_url, error, result));
              return;
          }

          console.log("storeSessionTimings ***************************: " + JSON.stringify(result));

          // Storing it in redis
          redisClient.set(helper.session_time_node,
                    result,
                    function (result_err, result_reply) {
                        if (result_err)
                        {
                            console.error('error while inserting in redis- {}'.format(result_err));
                        }
                        debug('successfully stored reconcile remarks.');
                    });
      });
}

module.exports = storeSessionTimings;
