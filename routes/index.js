var express = require('express');
var router = express.Router();
var redis = require('redis');
var async = require('async');
var request = require('request');

var helper = require('./helper');

// Initiating the redisClient
var redisClient = redis.createClient();
redisClient.on('error', function(msg) {
  console.error(msg);
});

/* GET home page. */
router.get('/', function(req, res, next) {
  async.parallel({
    start_of_day_flag: function(callback) {
      redisClient.get(helper.start_of_day_flag, function(err, reply) {
        if (err) {
          callback("error while retrieving from redis- {}".format(err), null);
          return;
        }
        if (reply === null || JSON.parse(reply) === true) {
          start_of_day = true;
        } else {
          start_of_day = false;
        }
        callback(null, start_of_day);
      });
    },
    outlet_config: function(callback) {
      // Getting the outlet config from redis
      redisClient.get(helper.outlet_config_node, function(err, reply) {
        if (err) {
          callback("error while retrieving from redis- {}".format(err), null);
          return;
        }
        if (!reply) {
          callback(null, {"end_of_day":false, "is24hr":false});
        } else {
          callback(null, JSON.parse(reply));
        }
      });
    }
  },
  function(err, results) {
    if (err) {
      console.error(err);
      res.status(500).send(err);
      return;
    }
    res.render('index', {
        hq_url: process.env.HQ_URL,
        outlet_id: process.env.OUTLET_ID,
        outlet_host: process.env.OUTLET_HOST,
        outlet_port: process.env.PORT,
        websocket_port: process.env.WEBSOCKET_PORT,
        start_of_day: results.start_of_day_flag,
        eod_time: results.outlet_config.end_of_day,
        is24hr: results.outlet_config.is24hr,
        short_name: results.outlet_config.short_name,
        expiry_time_interval: process.env.EXPIRY_TIME_INTERVAL,
        automatic_eod_time: results.outlet_config.automatic_eod_time,
        outlet_name: results.outlet_config.name,
        city: results.outlet_config.city,
        store_managers_mail_id: results.outlet_config.store_managers_mail_id
    });
  });
});

// Returns the orders page, along with the usual bootstrapping info
router.get('/orders', function(req, res, next) {
  res.render('orders', {hq_url: process.env.HQ_URL,
                      outlet_id: process.env.OUTLET_ID,
                      outlet_host: process.env.OUTLET_HOST,
                      outlet_port: process.env.PORT,
                      websocket_port: process.env.WEBSOCKET_PORT});
});

// Returns the issues page, along with the usual bootstrapping info
router.get('/issues', function(req, res, next) {
  res.render('issues', {hq_url: process.env.HQ_URL,
                      outlet_id: process.env.OUTLET_ID,
                      outlet_host: process.env.OUTLET_HOST,
                      outlet_port: process.env.PORT,
                      websocket_port: process.env.WEBSOCKET_PORT});
});

// Returns the dispenser queue page, along with the usual bootstrapping info
router.get('/dispenser_queue', function(req, res, next) {
  redisClient.lrange(helper.dispenser_queue_node, 0, -1,
    function(q_err, q_reply) {
      if (q_err) {
        console.error(q_err);
        res.status(500).send("error while retreiving from redis- {}".format(q_err));
        return;
      }
      var queue = [];
      for (var i = 0; i < q_reply.length; i++) {
        var item = JSON.parse(q_reply[i]);
        var bill_no = getBillNo(item.order_stub);
        var dispense_id = getDispenseId(item.order_stub);
        var target_lane = getTargetLane(item.order_stub);
        if (item.status == "timeout") {
          var isTimeout = true;
        } else {
          var isTimeout = false;
        }
        queue.push({bill_no: bill_no,
                  status: item.status,
                  dispense_id: dispense_id,
                  target_lane: target_lane,
                  timeout: isTimeout,
                  food_item_id: getFoodItemId(item.order_stub),
                  order_stub: item.order_stub});
      }
      res.render('dispenser_queue', {hq_url: process.env.HQ_URL,
                          outlet_id: process.env.OUTLET_ID,
                          outlet_host: process.env.OUTLET_HOST,
                          outlet_port: process.env.PORT,
                          websocket_port: process.env.WEBSOCKET_PORT,
                          queue: queue});
  });
});

function getBillNo(order_stub) {
  return parseInt(order_stub.substr(52, 8));
}

function getFoodItemId(order_stub) {
  return parseInt(order_stub.substr(10, 4), 36);
}

function getDispenseId(order_stub) {
  return parseInt(order_stub.substr(43, 6));
}

function getTargetLane(order_stub) {
  return parseInt(order_stub.substr(0, 2));
}

module.exports = router;
