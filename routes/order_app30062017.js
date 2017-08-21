var express = require('express');
var debug = require('debug')('outlet_app:server');
var format = require('string-format');
var firebase = require('firebase');
var redis = require('redis');
var lockredis = require('lockredis');
var path = require('path');
var async = require('async');
var fs = require('fs');
var request = require('request');
var requestretry = require('requestretry');
var randomstring = require('randomstring');

var helper = require('./helper');
var startPrint = require('../misc/printer').startPrint;
var sendUpdatedSMS = require('../misc/printer').sendUpdatedSMS;
var isForcePrintBill = require('../misc/isForcePrintBill');


format.extend(String.prototype);
var redisClient = redis.createClient({ connect_timeout: 2000, retry_max_delay: 5000 });
redisClient.on('error', function (msg) {
  console.error(msg);
});

var router = express.Router();

function wait(ms) {
  var start = new Date().getTime();
  var end = start;
  while (end < start + ms) {
    end = new Date().getTime();
  }
}

// Routes coming from the Order app

// This request will push the order related data to the plcio daemon
// to start serving the order
router.post('/place_order', function (req, res, next) {
  console.log("place_order req =+++++++++++=", req.body);
  var order_details = req.body.order;
  var counter_code = req.body.counter_code;
  var payment_mode = req.body.mode;
  var sides = req.body.sides;
  var from_counter = req.body.from_counter;
  var savings = req.body.savings;
  var bill_no = req.body.bill_no;
  var mobile_num = req.body.mobile_num;
  var credit_card_no = req.body.credit_card_no;
  var cardholder_name = req.body.cardholder_name;
  var unique_Random_Id = req.body.unique_Random_Id != undefined ? req.body.unique_Random_Id : '';
  var test_mode = null;
  var order_barcodes = [];
  console.log("unique_Random_Id received :- ", unique_Random_Id);
  // Getting the no. of items in the order
  var num_items = 0;
  for (var key in order_details) {
    num_items += order_details[key]["count"];
  }

  redisClient.get(helper.test_mode_flag, function (get_err, get_reply) {
    if (get_err) {
      debug(get_err);
      res.status(500).send({ bill_no: -1 });
      return;
    }
    test_mode = JSON.parse(get_reply);
    if (test_mode === null) {
      test_mode = false;
    }
    onTestModeRetrieved(test_mode);
  });

  // If no bill_no, that means, this has come from order app and we need to
  // create the bill_no
  function onTestModeRetrieved(test_mode) {
    if (bill_no == undefined) {
      if (test_mode) {
        bill_no = 0;
        moveForward(bill_no, test_mode);
      } else {
        // Incrementing the bill no.
        redisClient.incrby(helper.bill_no_node, 1, function (b_err, b_reply) {
          if (b_err) {
            debug(b_err);
            res.status(500).send({ bill_no: -1 });
            return;
          }
          bill_no = parseInt(b_reply) - 1;
          moveForward(bill_no, test_mode);
        });
      }
    } else {
      moveForward(bill_no, test_mode);
    }
  }

  function moveForward(bill_no, test_mode) {
    isForcePrintBill()
      .then(function (is_force_print_bill) {
        // If it is test_mode or from_counter, we always do the dispensing
        if (payment_mode == 'card' || is_force_print_bill || from_counter || test_mode) {
          io.emit('beverage_orders', {
            bill_no: bill_no,
            sides: sides
          });

          var locker = lockredis(redisClient);
          locker('lock_item', {
            timeout: 5000,
            retries: Infinity,
            retryDelay: 10
          }, function (lock_err, done) {
              if (lock_err) {
                // Lock could not be acquired for some reason.
                debug(lock_err);
                return res.status(500).send({ bill_no: -1 });
              }

              // Getting all the required items first with async.parallel.
              // And then running the main logic in the callback
              async.parallel({
                dispense_id: function (callback) {
                  // Incrementing the dispense id
                  redisClient.incrby(helper.dispense_id_node, num_items, function (d_err, d_reply) {
                    if (d_err) {
                      callback("error while retreiving from redis- {}".format(d_err), null);
                      return;
                    }
                    callback(null, parseInt(d_reply) - num_items);
                  });
                },
                stock_count: function (callback) {
                  // Getting the stock count here
                  redisClient.get(helper.stock_count_node, function (err, reply) {
                    if (err) {
                      callback("error while retreiving from redis- {}".format(err), null);
                      return;
                    }
                    callback(null, reply);
                  });
                },
                num_lanes: function (callback) {
                  redisClient.get(helper.plc_config_node, function (err, reply) {
                    if (err) {
                      callback('error while retreiving from redis- {}'.format(err), null);
                      return;
                    }
                    var plc_config = JSON.parse(reply);
                    // callback(null, plc_config.lane_count);
                    callback(null, plc_config);
                  });
                },
                outlet_phone_no: function (callback) {
                  redisClient.get(helper.outlet_config_node, function (err, reply) {
                    if (err) {
                      callback('error while retreiving from redis- {}'.format(err), null);
                      return;
                    }
                    var outlet_config = JSON.parse(reply);
                    callback(null, outlet_config.phone_no);
                  });
                }
              },
                function (err, results) {
                  if (err) {
                    debug(err);
                    done();
                    return;
                  }
                  stock_count = JSON.parse(results.stock_count);

                  // Getting a multi-redis transaction started
                  var multi = redisClient.multi();
                  var item_queue = [];
                  for (var item_id in order_details) {
                    for (var j = 0; j < order_details[item_id]["count"]; j++) {
                      var barcode = getOldestBarcode(item_id, stock_count[item_id]["item_details"]);
                      // XXX: This case should not come
                      if (barcode == null) {
                        continue;
                      }
                      order_barcodes.push(barcode);
                      stock_count = updateStockCount(stock_count, barcode);
                      var heating_flag = order_details[item_id]["heating_flag"];
                      var heating_reduction = order_details[item_id]["heating_reduction"];//SHLOK

                      var plc_type = 1;
                      var num_lanes_count = 1;
                      if (results.num_lanes != null) {
                        num_lanes_count = results.num_lanes.lane_count;
                        plc_type = results.num_lanes.plc_type;
                      }

                      console.log("place_order :: plc_type: " + plc_type + " Lane count: " + num_lanes_count);

                      var lane_no = (results.dispense_id % num_lanes_count) + 1;
                      var isveg = order_details[item_id]["veg"];
                      // Decrementing lock only if it is not test mode
                      // Adding this as part of the transaction
                      multi.decr(item_id + '_locked_count', function (s_err, s_reply) {
                        if (s_err) {
                          console.error(s_err);
                        }
                      });

                      var date = getOrderStubDate();
                      if (test_mode && item_id >= 9000 && item_id <= 9003) {
                        if (item_id % 2 == 0) {
                          heating_flag = false;
                          heating_reduction = false;//SHLOK
                        } else {
                          heating_flag = true;
                          heating_reduction = true;//SHLOK
                        }
                      }
                      var order_stub = createOrderStub(barcode, counter_code,
                        heating_flag, date,
                        bill_no, results.dispense_id, heating_reduction, isveg, plc_type);
                      item_val = {
                        "dispense_id": results.dispense_id,
                        "status": "pending",
                        "order_stub": order_stub
                      };
                      item_queue.push(item_val);

                      results.dispense_id++;
                    }
                  }

                  // Setting the new stock count, also as part of the transaction
                  multi.set(helper.stock_count_node, JSON.stringify(stock_count),
                    function (set_err, set_reply) {
                      if (set_err) {
                        console.error(set_err);
                      }
                    });

                  multi.exec(function (err, replies) {
                    done();
                    if (err) {
                      debug(err);
                      return;
                    }

                    // Merging with the lock counts and sending to browser and firebase
                    var item_id_list = [];
                    for (var item_id in stock_count) {
                      item_id_list.push(item_id + '_locked_count');
                      item_id_list.push(item_id + '_mobile_locked_count');
                    }

                    redisClient.mget(item_id_list, function (l_err, l_reply) {
                      for (var item_id in stock_count) {
                        if (l_reply[item_id_list.indexOf(item_id + '_locked_count')]) {
                          stock_count[item_id]["locked_count"] = parseInt(l_reply[item_id_list.indexOf(item_id + '_locked_count')]);
                        } else {
                          stock_count[item_id]["locked_count"] = 0;
                        }

                        if (l_reply[item_id_list.indexOf(item_id + '_mobile_locked_count')]) {
                          stock_count[item_id]["mobile_locked_count"] = parseInt(l_reply[item_id_list.indexOf(item_id + '_mobile_locked_count')]);
                        } else {
                          stock_count[item_id]["mobile_locked_count"] = 0;
                        }
                      }
                      // broadcasting the new stock count to all connected clients
                      io.emit(helper.stock_count_node, stock_count);
                      io.sockets.emit(helper.stock_count_node, stock_count);

                      // Put the data in firebase
                      var rootref = new firebase(process.env.FIREBASE_CONN);
                      var stock_count_node = rootref.child('{}/{}'.format(process.env.OUTLET_ID, helper.stock_count_node));
                      stock_count_node.set(stock_count);
                    });
                  });
                  // End of multi transaction

                  if (isEmpty(stock_count)) {
                    redisClient.set(helper.dispenser_status_node, 'empty', function (d_set_err, d_set_reply) {
                      if (d_set_err) {
                        console.error(d_set_err);
                      }
                    });
                    io.emit('dispenser_empty', true);
                    io.sockets.emit('dispenser_empty', true);
                  } else {
                    io.emit('dispenser_empty', false);
                    io.sockets.emit('dispenser_empty', false);
                  }

                  if (test_mode) {
                    debug("Going into test mode");
                    // pushing the item to the queue
                    item_queue.map(function (item_val) {
                      redisClient.rpush(helper.dispenser_queue_node, JSON.stringify(item_val),
                        function (lp_err, lp_reply) {
                          if (lp_err) {
                            debug(lp_err);
                            return;
                          }
                        });
                    });
                    // Prepare the bill data and pass it on to the print function
                    // The print function will load the html file, fill in the details
                    // and then generate the pdf.
                    var bill_to_print = prepareBillToPrint(order_details, sides);
                    var dateObj = new Date();
                    var date = dateObj.toDateString();
                    var time = dateObj.toLocaleTimeString();
                    debug("generating pdf");
                    // add sides to the prepareBillDict function,
                    // Create the pdf once and post the bill results just once
                    startPrint(bill_to_print, bill_no, date, time, savings, mobile_num, results.outlet_phone_no);
                  } else {
                    // create an entry in sales_order
                    // and also in sales order payments
                    var hq_url = process.env.HQ_URL;
                    //var PLACE_ORDER_TO_HQ_URL = hq_url + '/outlet/place_order';
                    //var STORE_BILL_ENTRY_DATA_URL = hq_url + '/outlet/store_bill';
                    var UPDATE_RECOVERY_DETAILS_URL = hq_url + '/outlet/update_recovery_details/' + process.env.OUTLET_ID;
                    debug('Payment mode is - ' + payment_mode);
                    // Prepare the bill data and pass it on to the print function
                    // The print function will load the html file, fill in the details
                    // and then generate the pdf.
                    var bill_dict = prepareBillDict(order_details, sides);
                    var bill_to_print = prepareBillToPrint(order_details, sides);
                    var dateObj = new Date();
                    var date = dateObj.toDateString();
                    var time = dateObj.toLocaleTimeString();
                    // add sides to the prepareBillDict function,
                    // Create the pdf once and post the bill results just once
                    //console.log("results 2: " + JSON.stringify(results));
                    //console.log("results.outlet_phone_no 2: " + results.outlet_phone_no);
                    startPrint(bill_to_print, bill_no, date, time, savings, mobile_num, results.outlet_phone_no);
                    debug("Placing order to HQ");
                    var bill_time = GetFormattedDateDDMMYYYY();

                    var obj = {
                      "name": "ORDER_DETAILS",
                      "order_details": order_details,
                      "sides": sides,
                      "counter_code": counter_code,
                      "payment_mode": payment_mode,
                      "outlet_id": process.env.OUTLET_ID,
                      "order_barcodes": order_barcodes,
                      "mobile_num": mobile_num,
                      "credit_card_no": credit_card_no,
                      "cardholder_name": cardholder_name,
                      "bill_no": bill_no,
                      "food_details": bill_dict,
                      "unique_Random_Id": unique_Random_Id,
                      "is_mobile_order": false,
                      "bill_time": bill_time,
                      "bill_status": "Pending"
                    }

                    //console.log("Outlet Object for DirectBillURL **** " + JSON.stringify(obj));
                    redisClient.lpush("Bills", JSON.stringify(obj));
                    // var DirectBillURL = process.env.HQ_URL + "/outlet/DirectBill";
                    // requestretry({
                    //   url: DirectBillURL,
                    //   forever: true,
                    //   maxAttempts: 25,
                    //   method: "POST",
                    //   json: obj
                    // }, function (error, response, body) {
                    //   if (body != undefined && (error != "" || error != null || error != "" != undefined)) {
                    //     var res = JSON.stringify(body);
                    //     redisClient.lrem("Bills", 1, res);

                    //     if (error || (response && response.statusCode != 200)) {
                    //       debug('{}: {} {}'.format(DirectBillURL, error, body));
                    //       body.bill_status = "Error";
                    //       redisClient.lpush("Bills", JSON.stringify(body));
                    //       debug("Bill Details to HQ  -- Error");
                    //       return;
                    //     }
                    //     body.bill_status = "Success";
                    //     redisClient.lpush("Bills", JSON.stringify(body));
                    //     debug("Updated Bill Details to HQ ");
                    //   }
                    // });

                    var ref = new Firebase(process.env.FIREBASE_QUEUE);

                    ref.child('tasks').push({
                      "name": "ORDER_DETAILS",
                      "order_details": order_details,
                      "sides": sides,
                      "counter_code": counter_code,
                      "payment_mode": payment_mode,
                      "outlet_id": process.env.OUTLET_ID,
                      "order_barcodes": order_barcodes,
                      "mobile_num": mobile_num,
                      "credit_card_no": credit_card_no,
                      "cardholder_name": cardholder_name,
                      "bill_no": bill_no,
                      "food_details": bill_dict,
                      "unique_Random_Id": unique_Random_Id,
                      "is_mobile_order": false
                    }); // after updating order details
                    debug("Successfully updated order details in HQ");
                    // pushing the item to the queue
                    item_queue.map(function (item_val) {
                      redisClient.rpush(helper.dispenser_queue_node, JSON.stringify(item_val),
                        function (lp_err, lp_reply) {
                          if (lp_err) {
                            debug(lp_err);
                            return;
                          }
                        });
                    });

                    // Store the recovery details in the HQ
                    requestretry({
                      url: UPDATE_RECOVERY_DETAILS_URL,
                      forever: true,
                      method: "POST",
                      json: {
                        "bill_no": bill_no,
                        "dispense_id": results.dispense_id
                      }
                    }, function (error, response, body) {
                        if (error || (response && response.statusCode != 200)) {
                          debug('{}: {} {}'.format(UPDATE_RECOVERY_DETAILS_URL, error, body));
                          return;
                        }
                        debug("Updated HQ with the recovery details");
                      });
                  }
                }); // async.parallel
            }); // end lock function

        } else {
          console.log("else part called");
          // We do not print immediately when the payment mode is cash.
          // The outlet staff prints it after getting the money
          var rand_string = randomstring.generate(5);
          io.emit('bill_dispense_data', {
            "tag": rand_string,
            "order_details": order_details,
            "counter_code": counter_code,
            "payment_mode": payment_mode,
            "sides": sides,
            "savings": savings,
            "bill_no": bill_no,
            "mobile_num": mobile_num,
            "credit_card_no": credit_card_no,
            "cardholder_name": cardholder_name,
            "unique_Random_Id": unique_Random_Id
          });
          io.sockets.emit('bill_dispense_data', {
            "tag": rand_string,
            "order_details": order_details,
            "counter_code": counter_code,
            "payment_mode": payment_mode,
            "bill_no": bill_no,
            "sides": sides,
            "savings": savings,
            "mobile_num": mobile_num,
            "credit_card_no": credit_card_no,
            "cardholder_name": cardholder_name,
            "unique_Random_Id": unique_Random_Id
          });
        }
        redisClient.get(helper.stock_count_node, function (err, reply) {
          var parsed_response = JSON.parse(reply);
          var item_id_list = [];
          for (var item_id in parsed_response) {
            item_id_list.push(item_id + '_locked_count');
          }

          redisClient.mget(item_id_list, function (l_err, l_reply) {
            for (var item_id in parsed_response) {
              if (l_reply[item_id_list.indexOf(item_id + '_locked_count')]) {
                parsed_response[item_id]["locked_count"] = parseInt(l_reply[item_id_list.indexOf(item_id + '_locked_count')]);
              } else {
                parsed_response[item_id]["locked_count"] = 0;
              }
            }
            io.emit(helper.stock_count_node, parsed_response);
          });
        });
        debug("Sending bill no- ", bill_no);
        res.send({ bill_no: bill_no });
      }, function (bill_print_err) {
        res.status(500).send({ bill_no: -1 });
      });
  }
});



function GetFormattedDateDDMMYYYY() {
  var d = new Date,
    dformat = [d.getFullYear() + '-', (d.getMonth() + 1).padLeft() + '-', d.getDate().padLeft()
    ].join('');

  return dformat;
}

Number.prototype.padLeft = function (base, chr) {
  var len = (String(base || 10).length - String(this).length) + 1;
  return len > 0 ? new Array(len).join(chr || '0') + this : this;
}


// This handler dispenses item/s for a replacement workflow
// It is nearly same to /place_order but calls to HQ are not made
// and some other info are not required
router.post('/fulfill_replacement/:id', function (req, res, next) {
  var order_id = req.params.id;
  var order_details = req.body.replaced_item_details;
  var amount = req.body.amount;
  var replaced_amount = req.body.replaced_amount;
  var old_item_details = req.body.item_details;
  var mobile_num = req.body.mobile_num;
  var original_bill_no = req.body.bill_no;
  var replaced_item_details = {};
  debug("Received replacement call");
  debug("New items - ", order_details, " old items- ", old_item_details);
  // Getting the no. of items in the order
  var num_items = 0;
  for (var key in order_details) {
    num_items += order_details[key]["count"];
  }

  // Getting all the required items first with async.parallel.
  // And then running the main logic in the callback
  async.parallel({
    dispense_id: function (callback) {
      // Incrementing the dispense id
      redisClient.incrby(helper.dispense_id_node, num_items, function (d_err, d_reply) {
        if (d_err) {
          callback("error while retreiving from redis- {}".format(d_err), null);
          return;
        }
        callback(null, parseInt(d_reply) - num_items);
      });
    },
    stock_count: function (callback) {
      // Getting the stock count here
      redisClient.get(helper.stock_count_node, function (err, reply) {
        if (err) {
          callback("error while retreiving from redis- {}".format(err), null);
          return;
        }
        callback(null, reply);
      });
    },
    num_lanes: function (callback) {
      redisClient.get(helper.plc_config_node, function (err, reply) {
        if (err) {
          callback('error while retreiving from redis- {}'.format(err), null);
          return;
        }
        var plc_config = JSON.parse(reply);
        //callback(null, plc_config.lane_count);
        callback(null, plc_config);
      });
    }
  },
    function (err, results) {
      if (err) {
        console.error(err);
        res.status(500).send(err);
        return;
      }
      stock_count = JSON.parse(results.stock_count);

      // Getting a multi-redis transaction started
      var multi = redisClient.multi();
      for (var item_id in order_details) {
        for (var j = 0; j < order_details[item_id]["count"]; j++) {
          var barcode = getOldestBarcode(item_id, stock_count[item_id]["item_details"]);
          if (barcode == null) {
            // most probably barcodes have expired or spoiled
            continue;
          }
          if (replaced_item_details.hasOwnProperty(barcode)) {
            replaced_item_details[barcode]++;
          } else {
            replaced_item_details[barcode] = 1;
          }

          stock_count = updateStockCount(stock_count, barcode);
          var heating_flag = order_details[item_id]["heating_flag"];
          var heating_reduction = order_details[item_id]["heating_reduction"];

          var plc_type = 1;
          var num_lanes_count = 1;
          if (results.num_lanes != null) {
            num_lanes_count = results.num_lanes.lane_count;
            plc_type = results.num_lanes.plc_type;
          }

          console.log("fulfill_replacement :: plc_type: " + plc_type + " Lane count: " + num_lanes_count);

          var lane_no = (results.dispense_id % num_lanes_count) + 1;
          var isveg = order_details[item_id]["veg"];
          // Adding this as part of the transaction
          multi.decr(item_id + '_locked_count', function (s_err, s_reply) {
            if (s_err) {
              console.error(s_err);
            }
          });
          var date = getOrderStubDate();
          var order_stub = createOrderStub(barcode, lane_no,
            heating_flag, date,
            original_bill_no, results.dispense_id, heating_reduction, isveg, plc_type); // SHLOK
          item_val = {
            "dispense_id": results.dispense_id,
            "status": "pending",
            "order_stub": order_stub
          };

          // pushing the item to the queue
          redisClient.rpush(helper.dispenser_queue_node, JSON.stringify(item_val),
            function (lp_err, lp_reply) {
              if (lp_err) {
                console.error(err);
                res.status(500).send(err);
                return;
              }
            });
          results.dispense_id++;
        }
      }

      // Setting the new stock count, also as part of the transaction
      multi.set(helper.stock_count_node, JSON.stringify(stock_count),
        function (set_err, set_reply) {
          if (set_err) {
            console.error(set_err);
          }
        });

      multi.exec(function (err, replies) {
        // Merging with the lock counts and sending to browser and firebase
        var item_id_list = [];
        for (var item_id in stock_count) {
          item_id_list.push(item_id + '_locked_count');
        }

        redisClient.mget(item_id_list, function (l_err, l_reply) {
          for (var item_id in stock_count) {
            if (l_reply[item_id_list.indexOf(item_id + '_locked_count')]) {
              stock_count[item_id]["locked_count"] = parseInt(l_reply[item_id_list.indexOf(item_id + '_locked_count')]);
            } else {
              stock_count[item_id]["locked_count"] = 0;
            }
          }
          // broadcasting the new stock count to all connected clients
          io.emit(helper.stock_count_node, stock_count);
          io.sockets.emit(helper.stock_count_node, stock_count);

          // Put the data in firebase
          var rootref = new firebase(process.env.FIREBASE_CONN);
          var stock_count_node = rootref.child('{}/{}'.format(process.env.OUTLET_ID, helper.stock_count_node));
          stock_count_node.set(stock_count);
        });

      });
      // End of multi transaction

      if (isEmpty(stock_count)) {
        redisClient.set(helper.dispenser_status_node, 'empty', function (d_set_err, d_set_reply) {
          if (d_set_err) {
            console.error(d_set_err);
          }
        });
        io.emit('dispenser_empty', true);
        io.sockets.emit('dispenser_empty', true);
      } else {
        io.emit('dispenser_empty', false);
        io.sockets.emit('dispenser_empty', false);
      }

      // For each restaurant, iterate and print the bill.
      // Get the data and pass it on to the print function
      // The print function will load the html file, fill in the details
      // and then print the document.
      var bill_to_print = prepareBillToPrint(order_details, null);
      var dateObj = new Date();
      var date = dateObj.toDateString();
      var time = dateObj.toLocaleTimeString();
      startPrint(bill_to_print, original_bill_no, date, time, 0, mobile_num);

      var hq_url = process.env.HQ_URL;
      var REPLACE_ITEMS_URL = hq_url + '/outlet/replace_items/' + order_id;
      requestretry({
        url: REPLACE_ITEMS_URL,
        method: "POST",
        maxAttempts: 25,
        json: {
          "amount": amount,
          "item_details": old_item_details,
          "bill_no" : original_bill_no,
          "replaced_amount": replaced_amount,
          "replaced_item_details": replaced_item_details
        }
      }, function (error, response, body) {
          if (error || (response && response.statusCode != 200)) {
            debug('{}: {} {}'.format(REPLACE_ITEMS_URL, error, body));
            res.status(500).send('{}: {} {}'.format(REPLACE_ITEMS_URL, error, body));
            return;
          }
          debug(body);
          res.send('success');
        });
    });
});

router.post('/generate_duplicate_bill/:order_id', function (req, res, next) {
  var order_id = req.params.order_id;
  var mobile_num = req.body.mobile_num;

  // Make a call to HQ to get the order
  var hq_url = process.env.HQ_URL;
  var GET_ORDER_DETAILS_URL = '/outlet/order_details/';
  requestretry(hq_url + GET_ORDER_DETAILS_URL + order_id,
    function (error, response, body) {
      if (error || (response && response.statusCode != 200)) {
        debug('{}: {} {}'.format(hq_url + GET_ORDER_DETAILS_URL, error, body));
        res.status(500).send('{}: {} {}'.format(hq_url + GET_ORDER_DETAILS_URL, error, body));
        return;
      }
      var order_response = JSON.parse(body);
      if (order_response.length == 0) {
        res.send('Failed to find order details');
      }
      var order_details = [];
      var bill_no = order_response[0].bill_no;
      for (var i = 0; i < order_response.length; i++) {
        order_details.push({
          "name": order_response[i].name,
          "count": order_response[i].quantity,
          "amount": order_response[i].quantity * order_response[i].mrp,
          "side_order": order_response[i].side_order,
          "restaurant_id": order_response[i].rest_id,
          "restaurant_name": order_response[i].rest_name,
          "tin_no": order_response[i].tin_no,
          "st_no": order_response[i].tin_no
        });
        if (stringStartsWith(order_response[i].barcode, "xxxxx")) {
          order_details.push({
            "name": order_response[i].name,
            "count": order_response[i].original_quantity,
            "amount": order_response[i].original_quantity * order_response[i].mrp,
            "side_order": order_response[i].side_order,
            "restaurant_id": order_response[i].rest_id,
            "restaurant_name": order_response[i].rest_name,
            "tin_no": order_response[i].tin_no,
            "st_no": order_response[i].tin_no
          });
        }
      }

      var return_dict = {}
      order_details.map(function (item) {
        if (return_dict.hasOwnProperty(item.restaurant_id)) {
          return_dict[item.restaurant_id].push(item);
        } else {
          return_dict[item.restaurant_id] = [item];
        }
      });

      // Need a list of name, count, amount, side_order
      var dateObj = new Date();
      var date = dateObj.toDateString();
      var time = dateObj.toLocaleTimeString();
      startPrint(return_dict, bill_no, date, time, 0, mobile_num);
      res.send('Successfully re-generated bill');
    });
});

router.post('/resend_updated_sms', function (req, res, next) {
  var bill_no = req.body.bill_no;
  var food_item_id = req.body.food_item_id;
  var hq_url = process.env.HQ_URL;

  //get the food name from DB
  requestretry(hq_url + '/food_item/item_name/' + food_item_id,
    function (error, response, body) {
      if (error || (response && response.statusCode != 200)) {
        debug('{}: {} {}'.format(hq_url + '/food_item/item_name/', error, body));
        res.status(500).send('{}: {} {}'.format(hq_url + '/food_item/item_name/', error, body));
        return;
      }
      var parsed_response = JSON.parse(body);
      var item_name = parsed_response.name;

      requestretry(hq_url + '/outlet/mobile_num/' + bill_no,
        function (sub_error, sub_response, sub_body) {
          if (sub_error || (sub_response && sub_response.statusCode != 200)) {
            debug('{}: {} {}'.format(hq_url + '/outlet/mobile_num/', sub_error, sub_body));
            res.status(500).send('{}: {} {}'.format(hq_url + '/outlet/mobile_num/', sub_error, sub_body));
            return;
          }
          if (!sub_body) {
            return res.send('success');
          }
          var sub_parsed_response = JSON.parse(sub_body);

          var mobile_num = sub_parsed_response.mobile_num;
          //send the sms
          sendUpdatedSMS(item_name, bill_no, mobile_num);
          res.send('success');
        });
    });
});

// This return the image for the food_item id
router.get('/image/:id', function (req, res, next) {
  var food_item_id = req.params.id;
  // getting the filepath and sending the picture
  var filePath = process.env.SOURCE_FOLDER;
  var outlet_code = process.env.OUTLET_CODE;

  var customPath = path.join(filePath, outlet_code);
  customPath = path.join(customPath, 'menu_items');
  customPath = path.join(customPath, food_item_id);
  if (fs.existsSync(customPath)) {
    return res.sendFile(path.join(customPath, '4.png'));
  } else {
    filePath = path.join(filePath, food_item_id);
    // Sending 4.png because the resolution at 4.png looks ideal for order app
    filePath = path.join(filePath, '4.png');
    return res.sendFile(filePath);
  }
});

router.get('/test_mode', function (req, res, next) {
  redisClient.get(helper.test_mode_flag, function (get_err, get_reply) {
    if (get_err) {
      debug(get_err);
      res.status(500).send(false);
      return;
    }
    test_mode = JSON.parse(get_reply);
    if (test_mode === null) {
      test_mode = false;
    }
    res.send(test_mode);
  });
});

router.get('/stop_orders_state', function (req, res, next) {
  redisClient.get(helper.stop_orders_flag, function (get_err, get_reply) {
    if (get_err) {
      debug(get_err);
      res.status(500).send(false);
      return;
    }
    var stop_orders = JSON.parse(get_reply);
    if (stop_orders === null) {
      stop_orders = false;
    }
    res.send(stop_orders);
  });
});

router.get('/run_count', function (req, res, next) {
  // sending the run count to the order app
  res.send({ run_count: RUN_COUNT });
});


// This call locks the quantity for the particular item code
// eg- {"direction": "increase", "delta_count": 2}
router.post('/lock_item/:item_id', function (req, res, next) {
  // increment/decrement the lock count here
  // then get stock count from redis and populate with the new lock data
  // and send to websocket
  var item_id = req.params.item_id;
  var delta_count = parseInt(req.body.delta_count);
  debug("Locking item id - ", item_id, " in direction- ", req.body.direction, " for quantity- ", delta_count);
  if (req.body.direction == "increase") {
    redisClient.incrby(item_id + '_locked_count', delta_count, update_lock_count_callback);
  } else if (req.body.direction == "decrease") {
    redisClient.decrby(item_id + '_locked_count', delta_count, update_lock_count_callback);
  }

  function update_lock_count_callback(l_err, l_reply) {
    if (l_err) {
      console.error(l_err);
      res.status(500).send("error while retreiving from redis- {}".format(l_err));
      return;
    }
    // Put the data in firebase
    var root_ref = new firebase(process.env.FIREBASE_CONN);
    var item_ref = root_ref.child(process.env.OUTLET_ID + '/stock_count/' + item_id + '/locked_count');
    item_ref.transaction(function (current_value) {
      if (current_value === null) {
        return 0;
      }
      if (req.body.direction == "increase") {
        return current_value += delta_count;
      } else if (req.body.direction == "decrease") {
        return current_value -= delta_count;
      }
    });
    redisClient.get(helper.stock_count_node, function (err, reply) {
      var parsed_response = JSON.parse(reply);
      var item_id_list = [];
      for (var item_id in parsed_response) {
        item_id_list.push(item_id + '_locked_count');
      }

      redisClient.mget(item_id_list, function (l_err, l_reply) {
        for (var item_id in parsed_response) {
          if (l_reply[item_id_list.indexOf(item_id + '_locked_count')]) {
            parsed_response[item_id]["locked_count"] = parseInt(l_reply[item_id_list.indexOf(item_id + '_locked_count')]);
          } else {
            parsed_response[item_id]["locked_count"] = 0;
          }
        }

        // broadcasting the new stock count to all connected clients
        io.emit(helper.stock_count_node, parsed_response);
        debug("stock count is- ", JSON.stringify(parsed_response));
        // Sending success to the ajax call
        res.send('success');
      });
    });
  }
});

// This call tries to check if a lock can be achieved
// If not, it responds accordingly
router.post('/try_lock/:item_id', function (req, res, next) {
  var target_item_id = req.params.item_id;
  var delta_count = parseInt(req.body.delta_count);
  debug("Trying to see if " + target_item_id + " can be locked");

  // First get the stock count and the locks,
  // construct the complete data structure
  redisClient.get(helper.stock_count_node, function (err, reply) {
    if (err) {
      debug(err);
      return res.send({ "error": true, "flag": false });
    }
    var parsed_response = JSON.parse(reply);
    var item_id_list = [];
    for (var item_id in parsed_response) {
      item_id_list.push(item_id + '_locked_count');
    }

    var locker = lockredis(redisClient);
    locker('lock_item', {
      timeout: 5000,
      retries: Infinity,
      retryDelay: 10
    }, function (lock_err, done) {
        if (lock_err) {
          // Lock could not be acquired for some reason.
          debug(lock_err);
          return res.send({ "error": true, "flag": false });
        }

        // do stuff...
        redisClient.mget(item_id_list, function (l_err, l_reply) {
          for (var item_id in parsed_response) {
            if (l_reply[item_id_list.indexOf(item_id + '_locked_count')]) {
              parsed_response[item_id]["locked_count"] = parseInt(l_reply[item_id_list.indexOf(item_id + '_locked_count')]);
            } else {
              parsed_response[item_id]["locked_count"] = 0;
            }
          }
          if (!parsed_response.hasOwnProperty(target_item_id)) {
            debug(target_item_id + ' does not exist in stock');
            done(); // release lock
            return res.send({ "error": true, "flag": false });
          }
          // If stock_quantity < 1 , return error
          var stock_quantity = getStockItemCount(parsed_response[target_item_id]["item_details"]) - parsed_response[target_item_id]["locked_count"];
          if (stock_quantity < 1) {
            done(); // release lock
            return res.send({ "error": false, "flag": false });
          } else {
            parsed_response[target_item_id]["locked_count"]++;
            redisClient.incrby(target_item_id + '_locked_count', 1, function (set_err, set_reply) {
              if (set_err) {
                debug(set_err);
                done(); // release lock
                return res.send({ "error": true, "flag": false });
              }
              io.emit(helper.stock_count_node, parsed_response);

              // Put the data in firebase for cart addition
              var root_ref = new firebase(process.env.FIREBASE_CONN);
              var item_ref = root_ref.child(process.env.OUTLET_ID + '/stock_count/' + target_item_id + '/locked_count');
              item_ref.transaction(function (current_value) {
                if (current_value === null) {
                  return 0;
                }
                return current_value += 1;
              });

              debug("stock count is- ", JSON.stringify(parsed_response));
              done(); // release lock
              // else, increase the lock count, and then emit the new stock
              return res.send({ "error": false, "flag": true });
            });
          }
        });
      });
  });

});

function getStockItemCount(item_details) {
  var count = 0;
  for (var i = 0; i < item_details.length; i++) {
    if (!item_details[i]["expired"] && !item_details[i]["spoiled"]) {
      count += item_details[i]["count"];
    }
  }
  return count;
}

// This returns the discount percent of the customer based on his/her
// num_transactions
router.get('/customer_details/:mobile_num', function (req, res, next) {
  var mobile_num = req.params.mobile_num;
  var hq_url = process.env.HQ_URL;
  var CUSTOMER_DETAILS_URL = hq_url + '/outlet/customer_details/' + mobile_num;
  request({
    url: CUSTOMER_DETAILS_URL,
  }, function (error, response, body) {
      if (error || (response && response.statusCode != 200)) {
        console.error('{}: {} {}'.format(hq_url, error, body));
        res.status(500).send('{}: {} {}'.format(hq_url, error, body));
        return;
      }
      debug(body);
      res.send(JSON.parse(body));
    });
});

// This updates the customer_details row for that customer, with the new
// sales and savings value and incremented the num_transactions value
router.post('/customer_details/:mobile_num', function (req, res, next) {
  var mobile_num = req.params.mobile_num;
  var total_expenditure = req.body.total_expenditure;
  var total_savings = req.body.total_savings;

  var hq_url = process.env.HQ_URL;
  var CUSTOMER_DETAILS_URL = hq_url + '/outlet/customer_details/' + mobile_num;
  request({
    url: CUSTOMER_DETAILS_URL,
    method: "POST",
    json: { "total_expenditure": total_expenditure, "total_savings": total_savings }
  }, function (error, response, body) {
      if (error || (response && response.statusCode != 200)) {
        console.error('{}: {} {}'.format(hq_url, error, body));
        res.status(500).send('{}: {} {}'.format(hq_url, error, body));
        return;
      }
      debug(body);
      res.send(body);
    });
});

// helper functions
function getOldestBarcode(item_id, item_details) {
  var oldestTimestamp = 9999999900; // This is the max timestamp possible
  var barcode = null;
  for (var i = 0; i < item_details.length; i++) {
    // This item has expired, no need to see this item
    // if (item_details[i]["expired"] || item_details[i]["spoiled"])
    if (item_details[i]["spoiled"]) {
      continue;
    }
    if (item_details[i]["timestamp"] < oldestTimestamp) {
      oldestTimestamp = item_details[i]["timestamp"];
      barcode = item_details[i]["barcode"];
    }
  }
  return barcode;
}

function updateStockCount(stock_count, barcode) {
  for (var item_id in stock_count) {
    var item = stock_count[item_id]["item_details"];
    for (var i = 0; i < item.length; i++) {
      if (item[i]["barcode"] == barcode) {
        stock_count[item_id]["item_details"][i]["count"]--;
        // If there are no more items left, delete the node
        if (!stock_count[item_id]["item_details"][i]["count"]) {
          stock_count[item_id]["item_details"].splice(i, 1);
          i--;
        }
      }
    }
  }
  return stock_count;
}

function getOrderStubDate() {
  var date_obj = new Date();
  // gets a list of [dd, mm, yyyy]
  var date_items = date_obj.toISOString().substr(0, 10).split('-').reverse();
  // stripping off the first 2 characters from yyyy
  date_items[2] = date_items[2].substr(2);
  // joining them and returning
  return date_items.join('');
}

function createOrderStub(barcode, lane_no,
  heating_flag, date,
  bill_no, dispense_id, heating_reduction, isveg, plc_type) { // SHLOK
  debug("createOrderStub:: Heating: " + heating_flag + "; Reduction:" + heating_reduction + "; Veg:" + isveg);
  var heating;
  var veg = '1';

  if (!heating_flag) {
    heating = '0';
  } else if (heating_reduction) {
    heating = '1';
  } else {
    heating = '2';
  }

  if (!isveg) // non-Veg
  {
    veg = '0';
  }

  var order_stub = '';
  order_stub += parseInt(lane_no).pad();
  order_stub += barcode;
  order_stub += heating;
  //order_stub += (heating_flag) ? 'Y' : 'N';
  //order_stub += (heating_reduction) ? 'Y' : 'N'; // SHLOK
  order_stub += date;
  order_stub += dispense_id.pad(6);
  if (Number(plc_type) == 0) {
    console.log("createOrderStub :: old plc_type machine called: " + plc_type);
    order_stub += bill_no.pad(10);
  }
  else {
    console.log("createOrderStub :: new plc_type machine called: " + plc_type);
    order_stub += 0;
    order_stub += veg;
    order_stub += bill_no.pad(8);
  }
  debug("Created order stub as- ", order_stub);

  return order_stub;
}

function isEmpty(stock_count) {
  for (var item_id in stock_count) {
    var item = stock_count[item_id]["item_details"];
    // check if all items are sold or not
    if (item == undefined) {
      continue;
    }
    for (var i = 0; i < item.length; i++) {
      // check if the item is not expired or spoiled
      if (item[i]["expired"] || item[i]["spoiled"]) {
        continue;
      }
      if (item[i]["count"]) {
        return false;
      }
    }
  }
  return true;
}


function getFoodDetails(restaurant_details) {
  var food_details = {};
  for (var i = 0; i < restaurant_details["items"].length; i++) {
    food_details[restaurant_details["items"][i]["id"]] = restaurant_details["items"][i]["count"];
  }
  return food_details;
}

function prepareBillDict(order_details, sides) {
  var bill_dict = {};
  for (var item_id in order_details) {
    bill_dict[item_id] = order_details[item_id]["count"];
  }
  if (sides) {
    for (var item_id in sides) {
      bill_dict[item_id] = sides[item_id]["count"];
    }
  }
  return bill_dict;
}

function prepareBillToPrint(order_details, sides) {
  var bill_items = [];
  for (var item_id in order_details) {
    bill_items.push({
      "name": order_details[item_id]["name"],
      "count": order_details[item_id]["count"],
      "amount": order_details[item_id]["price"],
      "side_order": order_details[item_id]["side_order"],
      "restaurant_id": order_details[item_id]["restaurant_details"]["id"],
      "tin_no": order_details[item_id]["restaurant_details"]["tin_no"],
      "st_no": order_details[item_id]["restaurant_details"]["st_no"],
      "restaurant_name": order_details[item_id]["restaurant_details"]["name"]
    });
  }
  if (sides) {
    for (var item_id in sides) {
      bill_items.push({
        "name": sides[item_id]["name"],
        "count": sides[item_id]["count"],
        "amount": sides[item_id]["price"],
        "side_order": sides[item_id]["side_order"],
        "restaurant_id": sides[item_id]["restaurant_details"]["id"],
        "tin_no": sides[item_id]["restaurant_details"]["tin_no"],
        "st_no": sides[item_id]["restaurant_details"]["st_no"],
        "restaurant_name": sides[item_id]["restaurant_details"]["name"]
      });
    }
  }

  // Grouping them by restaurant
  var return_dict = {}
  bill_items.map(function (item) {
    if (return_dict.hasOwnProperty(item.restaurant_id)) {
      return_dict[item.restaurant_id].push(item);
    } else {
      return_dict[item.restaurant_id] = [item];
    }
  });

  return return_dict;
}

function stringStartsWith(string, prefix) {
  return string.slice(0, prefix.length) == prefix;
}

function getItemId(barcode) {
  return parseInt(barcode.substr(8, 4), 36);
}

Number.prototype.pad = function (size) {
  var s = String(this);
  while (s.length < (size || 2)) { s = "0" + s; }
  return s;
}

module.exports = router;
