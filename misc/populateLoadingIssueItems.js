var debug = require('debug')('outlet_app:server');
var format = require('string-format');
var requestretry = require('requestretry');
var async = require('async');
var redis = require('redis');

var helper = require('../routes/helper');
format.extend(String.prototype);

// Initiating the redisClient
var redisClient = redis.createClient({connect_timeout : 2000, retry_max_delay: 5000});
redisClient.on('error', function(msg) {
  console.error(msg);
});


// This function populates the loading issue items dialog which is shown as the last step during loading
function populateLoadingIssueItems() {
  var hq_url = process.env.HQ_URL;
  var GET_LOADING_ISSUE_ITEMS_URL = '/outlet/get_loading_issue_items/';
  var GET_LAST_LOAD_ITEMS_URL = '/outlet/get_last_load_items/';
  var outlet_id = process.env.OUTLET_ID;

  // Here we are returning for both loading_issue items and unscanned items
  // Both of them will be marked at one shot
  async.parallel({
    loading_issue: function(callback) {
      // This returns all the batches of the last PO from every restaurant
      requestretry(hq_url + GET_LOADING_ISSUE_ITEMS_URL + outlet_id,
        function (error, response, body) {
        if (error || (response && response.statusCode != 200)) {
          callback('{}: {} {}'.format(hq_url, error, body), null);
          return;
        }
        callback(null, JSON.parse(body));
      });
    },
    unscanned_slots: function(callback) {
      redisClient.get(helper.last_load_info_node, function(err, reply) {
        if (err) {
          callback("error while retrieving from redis- {}".format(err), null);
          return;
        }
        var last_load_pos = [];
        var last_load_info = JSON.parse(reply);
        if (last_load_info !== null) {
          for (var rest_id in last_load_info) {
            var rest_items = last_load_info[rest_id];
            for (var i = 0; i < rest_items.length; i++) {
              last_load_pos.push(rest_items[i]);
            }
          }
          // Need to get the item ids corresponding to the last load
          requestretry(hq_url + GET_LAST_LOAD_ITEMS_URL + outlet_id + '/?last_load_info=' + JSON.stringify(last_load_pos),
            function (error, response, body) {
            if (error || (response && response.statusCode != 200)) {
              callback('{}: {} {}'.format(hq_url, error, body), null);
              return;
            }
            callback(null, JSON.parse(body));
          });
        } else {
          callback(null, []);
        }
      });
    }
  },
  function(err, results) {
    if (err) {
      console.error(err);
      return;
    }
    redisClient.set(helper.loading_issue_items_node,
          JSON.stringify(results),
          function(redis_err, redis_reply) {
      if (redis_err) {
        console.error("error from redis- {}".format(redis_err));
        return;
      }
    });
  });
}

module.exports = populateLoadingIssueItems;
