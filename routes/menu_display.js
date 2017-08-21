var express = require('express');
var router = express.Router();
var debug = require('debug')('outlet_app:server');
var redis = require('redis');
var format = require('string-format');
var path = require('path');
var helper = require('./helper')

format.extend(String.prototype);
var redisClient = redis.createClient({connect_timeout : 2000, retry_max_delay: 5000});
redisClient.on('error', function(msg) {
  console.error(msg);
});

// Routes coming from the menu display app

// This is for the menu display app to get the stock quantity for various items
// so that it can generate the images
router.get('/stock', function(req, res, next) {
  // Getting the data from redis
  redisClient.get(helper.stock_count_node, function(err, reply){
    if (err) {
      res.status(500).send("error while retreiving from redis- {}".format(err));
      return;
    }
    // Note - If key does not exist, redis will return null. This has to
    // be handled at the caller side
    debug(reply);
    res.type('application/json').send(reply);
  });
});

router.get('/stock_initial', function(req, res, next) {
  // Getting the data from redis
  redisClient.get(helper.stock_count_node, function(err, reply){
    if (err) {
      res.status(500).send("error while retreiving from redis- {}".format(err));
      return;
    }
    var stock_count = JSON.parse(reply);
    var item_id_list = [];
    // Check for empty stock
    if (stock_count==null || Object.keys(stock_count).length == 0) {
      return res.send({});
    }
    for (var item_id in stock_count) {
        item_id_list.push(item_id + '_locked_count');
        item_id_list.push(item_id + '_mobile_locked_count');
    }

    redisClient.mget(item_id_list, function(l_err, l_reply) {
      if (l_err) {
        res.status(500).send("error while retreiving from redis- {}".format(err));
        return;
      }
      for (var item_id in stock_count) {
        if (l_reply[item_id_list.indexOf(item_id+'_locked_count')]) {
          stock_count[item_id]["locked_count"] = parseInt(l_reply[item_id_list.indexOf(item_id+'_locked_count')]);
        } else {
          stock_count[item_id]["locked_count"] = 0;
        }

        if (l_reply[item_id_list.indexOf(item_id + '_mobile_locked_count')])
        {
            stock_count[item_id]["mobile_locked_count"] = parseInt(l_reply[item_id_list.indexOf(item_id + '_mobile_locked_count')]);
        } else
        {
            stock_count[item_id]["mobile_locked_count"] = 0;
        }
      }
      res.send(stock_count);
    });
  });
});

// This is the call from menu_display to know about the dispenser status
router.get('/dispenser_status', function(req, res, next) {
  // Getting the data from redis
  redisClient.get(helper.dispenser_status_node, function(err, reply){
    if (err) {
      res.status(500).send("error while retreiving from redis- {}".format(err));
      return;
    }
    // Note - If key does not exist, redis will return null. This has to
    // be handled at the caller side
    debug(reply);
    res.send(reply);
  });
});

// This is for knowing about offers, hot restaurants etc.
router.get('/additional_stats', function(req, res, next) {
  res.send('respond with additional_stats');
});

// This call is coming from the android monitor to return the image
router.get('/image.png', function(req, res, next) {
  var menu_display_folder = process.env.MENU_DISPLAY_FOLDER;
  var target_ips = process.env.MENU_DISPLAY_IPS.split(',');
  var remote_ip = req.client.remoteAddress;
  debug("Remote IP for menu display is- ", remote_ip);
  for (var i = 0; i < target_ips.length; i++) {
  if (target_ips[i] == remote_ip) {
    // get the index of the image depending on the IP of the machine
    // Sending 4.png because the resolution at 4.png looks ideal for order app
    var filePath = path.join(menu_display_folder, 'final'+i+'.png');
    return res.sendFile(filePath);
  }
  }
  var filePath = path.join(menu_display_folder, 'final0.png');
  return res.sendFile(filePath);
});

// This call is for returning the big image
router.get('/bigimage.png', function(req, res, next) {
  var menu_display_folder = process.env.MENU_DISPLAY_FOLDER;
  // Sending 4.png because the resolution at 4.png looks ideal for order app
  var filePath = path.join(menu_display_folder, 'finalproj.png');
  return res.sendFile(filePath);
});

router.get('/tv', function(req, res, next) {
  res.render('menu_display');
});

router.get('/bigtv', function(req, res, next) {
  res.render('menu_display_big');
});

module.exports = router;
