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

function storeDispenserQueue() {
  // first check the redis nodes, if they are present, they no need
  redisClient.del(helper.dispenser_queue_node, function(err, reply) {
    if (err) {
      console.error(err);
      return;
    }
    debug("Pulling any pending dispenser queue data from HQ");

    // get the details from HQ
    var hq_url = process.env.HQ_URL;
    request({
      url: hq_url + '/outlet/dispenser_queue/' + process.env.OUTLET_ID,
      forever: true,
    }, function(error, response, body) {
      if (error || (response && response.statusCode != 200)) {
        console.error('{}: {} {}'.format(hq_url, error, body));
        return;
      }
      debug("Got queue details from HQ- ", body);
      var queue = JSON.parse(body);
      var seedDispenseId = 9000;
      // and then store it in redis
      queue.map(function(item) {
        var bill_no = item.bill_no;
        var quantity = item.quantity;
        var food_item_id = item.food_item_id;
        var barcode = item.barcode;
        for (var i = 0; i < quantity; i++) {
        var queue_item = {"dispense_id": seedDispenseId,
              "status": "timeout",
              "order_stub": createOrderStub(barcode,
                    1,
                    true,
                    getOrderStubDate(),
                    bill_no,
                    seedDispenseId)};
        seedDispenseId++;
        redisClient.rpush(helper.dispenser_queue_node, JSON.stringify(queue_item), function(set_err, set_reply) {
          if (set_err) {
            console.error(set_err);
            return;
          }
          debug("Pushed item {} to queue".format(food_item_id));
        });
        }
      });
    });
  });
}

function createOrderStub(barcode, lane_no,
                          heating_flag, date,
                          bill_no, dispense_id) {
  var order_stub = '';
  order_stub += parseInt(lane_no).pad();
  order_stub += barcode;
  order_stub += (heating_flag) ? 'Y' : 'N';
  order_stub += date;
  order_stub += dispense_id.pad(6);
  order_stub += bill_no.pad(10);

  return order_stub;
}

function getOrderStubDate() {
  var date_obj = new Date();
  // gets a list of [dd, mm, yyyy]
  var date_items = date_obj.toISOString().substr(0,10).split('-').reverse();
  // stripping off the first 2 characters from yyyy
  date_items[2] = date_items[2].substr(2);
  // joining them and returning
  return date_items.join('');
}

module.exports = storeDispenserQueue;
