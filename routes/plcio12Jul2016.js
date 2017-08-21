var express = require('express');
var router = express.Router();
var debug = require('debug')('outlet_app:server');
var firebase = require('firebase');
var redis = require('redis');
var format = require('string-format');
var request = require('request');
var requestretry = require('requestretry');

var helper = require('./helper');

format.extend(String.prototype);
var redisClient = redis.createClient({ connect_timeout: 2000, retry_max_delay: 5000 });
redisClient.on('error', function (msg)
{
    debug(msg);
});

// Routes coming from the plcio daemon

// This will happen when the plc machine has finished serving the order.
// It is a signal to push the order details to HQ that it has been served.
// item structure - {"dispense_id": "", "status": "", "order_stub": ""}
router.post('/update_order_item_status', function (req, res, next)
{
    debug("Received call for updating item status- ", req.body.data);
    // Throw an error if content-type is not application/json
    if (req.get('Content-Type') != 'application/json')
    {
        res.status(415).send('');
        return;
    }
    var updated_item = req.body.data;

    redisClient.lrange(helper.dispenser_queue_node, 0, -1,
      function (q_err, q_reply)
      {
          if (q_err)
          {
              debug(q_err);
              res.status(500).send("error while retreiving from redis- {}".format(q_err));
              return;
          }
          var changed_index = -1;
          var dispense_status_data = {};
          for (var i = 0; i < q_reply.length; i++)
          {
              var queue_item = JSON.parse(q_reply[i]);
              if (queue_item.dispense_id == updated_item.dispense_id)
              {
                  changed_index = i;
                  if (updated_item.status == "delivered")
                  {
                      // remove the item from the queue
                      redisClient.lrem(helper.dispenser_queue_node, 0, JSON.stringify(queue_item),
                        function (set_err, set_reply)
                        {
                            debug("deleted the item of the redis queue at index - ", changed_index);
                        });
                  } else if (updated_item.status == "dispensing" || updated_item.status == "timeout")
                  {
                      //Updating the redis queue with the new status
                      redisClient.lset(helper.dispenser_queue_node, changed_index, JSON.stringify(updated_item),
                        function (set_err, set_reply)
                        {
                            debug("updated the redis queue with the new status- ",
                                updated_item.status, "at index- ", changed_index);
                        });
                  }

                  var bill_no = getBillNo(updated_item.order_stub);
                  if (!isNaN(bill_no) && bill_no != 0)
                  {
                      dispense_status_data[bill_no] = computeDispenseStatus(
                                      dispense_status_data[bill_no], updated_item.status);
                  }
              } else
              {
                  var bill_no = getBillNo(queue_item.order_stub);
                  if (!isNaN(bill_no) && bill_no != 0)
                  {
                      dispense_status_data[bill_no] = computeDispenseStatus(
                                        dispense_status_data[bill_no], queue_item.status);
                  }
              }
          }
          // send the dispenser data to the HQ
          debug("Sending dispense status data as- ", dispense_status_data);
          var ref = new Firebase(process.env.FIREBASE_QUEUE);
          ref.child('tasks').push({
              "name": "DISPENSE_STATUS_UPDATE",
              "outlet_id": process.env.OUTLET_ID,
              "data": dispense_status_data
          });
          debug("Successfully pushed the dispense status data");
          res.send("success");
      });
});


// This call returns the dispenser queue data structure to the plcio daemon
// The order queue is of this format - [{"dispense_id": "", "status": "", "order_stub": ""}]
router.get('/order_queue', function (req, res, next)
{
    redisClient.lrange(helper.dispenser_queue_node, 0, -1,
      function (q_err, q_reply)
      {
          if (q_err)
          {
              debug(q_err);
              res.status(500).send("error while retreiving from redis- {}".format(q_err));
              return;
          }
          var queue = [];
          for (var i = 0; i < q_reply.length; i++)
          {
              queue.push(JSON.parse(q_reply[i]));
          }
          res.send(queue);
      });
});

// This is the call when any changes in stock count occurs
// It should have a list of barcodes wth their count and slot_ids
// [{"barcode": "frggt564g", "count":2, "slot_ids": "3,4,5"}, {..}], [total_slot_list]
router.post('/submit_scanned_stock', function (req, res, next)
{
    debug("Stock submitted- ", req.body.data);
    var append_flag = req.body.append_only;
    if (append_flag == undefined)
    {
        append_flag = false;
    }
    debug("Append flag is ", append_flag);
    // Throw an error if content-type is not application/json
    if (req.get('Content-Type') != 'application/json')
    {
        res.status(415).send('');
        return;
    }

    var plcio_data = req.body.data;
    if (plcio_data == undefined)
    {
        debug("No stock data submitted");
        return res.send('failure');
    }
    var stock_count = {};
    redisClient.get(helper.plc_config_node, function (err, reply)
    {
        if (err)
        {
            debug('error while retreiving from redis- {}'.format(err));
            res.status(500).send('redis down');
            return;
        }
        if (!reply)
        {
            return res.status(500).send("No plc config found");
        }
        var plc_config = JSON.parse(reply);
        var dispenser_slot_count = plc_config["dispenser_slot_count"];
        var slot_list = [];
        for (var i = 1; i <= dispenser_slot_count; i++)
        {
            slot_list.push(i);
        }
        redisClient.lrange(helper.dispenser_queue_node, 0, -1,
          function (q_err, q_reply)
          {

              if (q_err)
              {
                  debug(q_err);
                  res.status(500).send("error while retreiving from redis- {}".format(q_err));
                  return;
              }

              // Preparing the pending queue
              var pending_queue = {};
              for (var i = 0; i < q_reply.length; i++)
              {
                  parsed_q_item = JSON.parse(q_reply[i]);
                  var barcode = getBarcode(parsed_q_item["order_stub"]);
                  // Only if the status is idle
                  if (parsed_q_item["status"] === "pending")
                  {
                      if (barcode in pending_queue)
                      {
                          pending_queue[barcode]++;
                      } else
                      {
                          pending_queue[barcode] = 1;
                      }
                  }
              }

              // Making the stock count data structure
              var scanned_slot_ids = [];
              for (var i = 0; i < plcio_data.length; i++)
              {
                  var barcode = plcio_data[i]["barcode"];

                  // Verify if the barcode is not jumbled up
                  if (!verifyBarcode(barcode))
                  {
                      debug("Scrambled barcode detected- ", barcode);
                      continue;
                  }

                  var count = plcio_data[i]["count"];
                  var slot_ids = (plcio_data[i]["slot_ids"]).split(',');
                  var details = extractDetails(barcode);
                  var item_id = details[0];
                  var timestamp = details[1];

                  // Verify if the item_id belongs to the DB
                  if (!verifyValidItemId(item_id))
                  {
                      debug("Item id- ", item_id, " does not belong to DB");
                      continue;
                  }

                  // store the slot_ids somewhere
                  scanned_slot_ids = scanned_slot_ids.concat(slot_ids);
                  // reducing by the no. of items in pending queue
                  if (barcode in pending_queue)
                  {
                      count -= pending_queue[barcode];
                  }

                  if (!(item_id in stock_count))
                  {
                      // the item in this barcode was never seen before.
                      stock_count[item_id] = { "item_details": [] };
                  }
                  stock_count[item_id]["item_details"].push({
                      "barcode": barcode,
                      "count": count,
                      "slot_ids": slot_ids,
                      "timestamp": timestamp,
                      "expired": false,
                      "spoiled": false,
                      "isExpired_InsertedintoDb": false
                  });
              }
              // Now calculate the diff of the total slot ids with the scanned slot ids
              // store the data in redis
              var unscanned_slots = slot_list.diff(scanned_slot_ids);
              redisClient.set(helper.unscanned_slots_node,
                            JSON.stringify(unscanned_slots),
                            function (set_err, set_reply)
                            {
                                if (set_err)
                                {
                                    return debug(set_err);
                                }
                                debug("Updated the unscanned slots node");
                            });

              // Copying from the tmp node and pasting to the main node
              redisClient.get(helper.last_load_tmp_node,
                            function (get_err, get_reply)
                            {
                                if (get_err)
                                {
                                    return debug(get_err);
                                }
                                if (!get_reply)
                                {
                                    debug("last load tmp node not set yet");
                                    return;
                                }
                                if (!get_reply)
                                {
                                    debug("last load tmp node not set yet");
                                    return;
                                }
                                redisClient.set(helper.last_load_info_node,
                                            get_reply,
                                            function (set_err, set_reply)
                                            {
                                                if (set_err)
                                                {
                                                    return debug(set_err);
                                                }
                                                debug("Updated the last load info node");
                                            });
                            });

              if (!append_flag)
              {
                  // if stock count is empty, that means need to clear the previous locks
                  if (Object.keys(stock_count).length == 0)
                  {
                      redisClient.get(helper.stock_count_node,
                        function (get_err, get_reply)
                        {
                            // so get the stock data, get the items, then
                            // set the locked count to 0
                            var old_stock = JSON.parse(get_reply);
                            var item_lock_counts = []
                            var multi = redisClient.multi();
                            for (var item_id in old_stock)
                            {
                                multi.set(item_id + '_locked_count', 0, function (set_err, set_reply)
                                {
                                    if (set_err)
                                    {
                                        console.log(set_err);
                                    }
                                });
                            }

                            // then set the new data and updateOtherStuff(stock_co)
                            multi.exec(function (err, replies)
                            {
                                // Put the data in redis
                                redisClient.set(helper.stock_count_node,
                                              JSON.stringify(stock_count),
                                              function (set_err, set_reply)
                                              {
                                                  if (set_err)
                                                  {
                                                      debug(set_err);
                                                  }
                                              });
                                updateOtherStuff(stock_count);
                            });
                        });
                  } else
                  {
                      // Put the data in redis
                      redisClient.set(helper.stock_count_node,
                                    JSON.stringify(stock_count),
                                    function (set_err, set_reply)
                                    {
                                        if (set_err)
                                        {
                                            debug(set_err);
                                        }
                                    });
                      updateOtherStuff(stock_count);
                  }
              } else
              {
                  redisClient.get(helper.stock_count_node,
                    function (get_err, get_reply)
                    {
                        //merge the two
                        var existing_stock_count = JSON.parse(get_reply);

                        if (existing_stock_count)
                        {
                            for (var item_id in stock_count)
                            {
                                if (existing_stock_count.hasOwnProperty(item_id))
                                {
                                    // then append to existing
                                    existing_stock_count[item_id]["item_details"] = existing_stock_count[item_id]["item_details"].concat(stock_count[item_id]["item_details"]);
                                } else
                                {
                                    // create new node
                                    existing_stock_count[item_id] = {};
                                    existing_stock_count[item_id]["item_details"] = stock_count[item_id]["item_details"];
                                }
                            }
                        } else
                        {
                            existing_stock_count = stock_count;
                        }
                        // set in redis
                        redisClient.set(helper.stock_count_node,
                                  JSON.stringify(existing_stock_count),
                                  function (set_err, set_reply)
                                  {
                                      if (set_err)
                                      {
                                          debug(set_err);
                                      }
                                  });

                        // update Other stuff
                        updateOtherStuff(existing_stock_count);
                    });
              }

              function updateOtherStuff(stock_count)
              {
                  var item_lock_counts = []
                  for (var item_id in stock_count)
                  {
                      item_lock_counts.push(item_id + '_locked_count');
                  }

                  // Get the lock counts, merge with stock_count and set in firebase
                  if (item_lock_counts.length)
                  {
                      redisClient.mget(item_lock_counts, function (set_err, set_reply)
                      {
                          if (set_err)
                          {
                              debug(set_err);
                              return;
                          }

                          var firebase_stock_count = stock_count;
                          for (var item_id in firebase_stock_count)
                          {
                              if (set_reply[item_lock_counts.indexOf(item_id + '_locked_count')])
                              {
                                  firebase_stock_count[item_id]["locked_count"] = parseInt(set_reply[item_lock_counts.indexOf(item_id + '_locked_count')]);
                              } else
                              {
                                  // setting the values to a default count of 0
                                  firebase_stock_count[item_id]["locked_count"] = 0;
                              }
                          }
                          debug("Setting stock count as- ", JSON.stringify(firebase_stock_count));
                          io.emit('stock_count', firebase_stock_count);
                          io.sockets.emit('stock_count', firebase_stock_count);

                          // Put the data in firebase
                          var rootref = new firebase(process.env.FIREBASE_CONN);
                          var stock_count_node = rootref.child('{}/{}'.format(process.env.OUTLET_ID, helper.stock_count_node));
                          stock_count_node.set(firebase_stock_count);
                      });
                  } else
                  {
                      // Setting empty data in firebase and to order apps
                      // Put the data in firebase
                      debug("Setting empty stock count");
                      var rootref = new firebase(process.env.FIREBASE_CONN);
                      var stock_count_node = rootref.child('{}/{}'.format(process.env.OUTLET_ID, helper.stock_count_node));
                      stock_count_node.set({});
                      io.emit('stock_count', {});
                      io.sockets.emit('stock_count', {});

                      // Return a success message
                      res.send('success');

                      debug("Setting dispenser status to empty due to wipe-off");
                      redisClient.set(helper.dispenser_status_node, 'empty', function (d_set_err)
                      {
                          if (d_set_err)
                          {
                              console.error(d_set_err);
                          }
                      });
                      io.emit('dispenser_empty', true);
                      io.sockets.emit('dispenser_empty', true);
                      return;
                  }

                  // Appending to the zero sales count
                  redisClient.get(helper.zero_sales_count_node, function (redis_err, redis_res)
                  {
                      if (redis_err)
                      {
                          debug(redis_err);
                          return;
                      }
                      var zero_sales = JSON.parse(redis_res);
                      if (zero_sales)
                      {
                          for (var item_id in stock_count)
                          {
                              // Not appending to zero sales list, if it is a test mode item
                              if (isTestModeItem(item_id))
                              {
                                  continue;
                              }
                              for (var i = 0; i < stock_count[item_id]["item_details"].length; i++)
                              {
                                  barcode = stock_count[item_id]["item_details"][i]["barcode"];
                                  // make this to a function
                                  if (!(item_id in zero_sales))
                                  {
                                      zero_sales[item_id] = stock_count[item_id];
                                      continue;
                                  }
                                  if (!checkBarcodePresent(barcode, zero_sales[item_id]["item_details"]))
                                  {
                                      zero_sales[item_id]["item_details"].push(stock_count[item_id]["item_details"][i]);
                                  }
                              }
                          }
                      } else
                      {
                          for (var item_id in stock_count)
                          {
                              // Not appending to zero sales list, if it is a test mode item
                              if (isTestModeItem(item_id))
                              {
                                  delete stock_count[item_id];
                              }
                          }
                          zero_sales = stock_count;
                      }

                      // updated_zero_item list needs to be repushed again
                      redisClient.set(helper.zero_sales_count_node,
                                JSON.stringify(zero_sales),
                                function (err, set_zero_sales_reply)
                                {
                                    if (err)
                                    {
                                        debug('error while inserting in redis- {}'.format(err));
                                    }
                                });
                  });


                  // Set the dispenser status to working
                  redisClient.set(helper.dispenser_status_node,
                                  'working',
                                  function (err, reply)
                                  {
                                      if (err)
                                      {
                                          debug('error while inserting in redis- {}'.format(err));
                                      }
                                      // Sending the signal to the order app to hide the delay message
                                      io.emit('order_delay', false);
                                      io.sockets.emit('order_delay', false);
                                  });

                  // Resetting dispenser_empty flag, because new stock is loaded now
                  io.emit('dispenser_empty', false);
                  io.sockets.emit('dispenser_empty', false);

                  // Return a success message
                  res.send('success');
              }
          });
    });
});

// This is the call when the status of dispenser changes
// The json data has status as key and value can be "loading", "empty", "working"
router.post('/dispenser_status', function (req, res, next)
{
    debug(req.body.status);
    // Throw an error if content-type is not application/json
    if (req.get('Content-Type') != 'application/json')
    {
        res.status(415).send('');
        return;
    }

    // Throw an error if status not in the predefined values
    if (req.body.status !== 'loading' &&
      req.body.status !== 'empty' &&
      req.body.status !== 'working')
    {
        res.status(400).send('');
        return;
    }

    // Put the data in redis
    redisClient.set(helper.dispenser_status_node,
                    req.body.status,
                    function (err, reply)
                    {
                        if (err)
                        {
                            res.status(500).send('error while inserting in redis- {}'.format(err));
                            return;
                        }
                        if (req.body.status === 'loading')
                        {
                            io.emit('order_delay', true);
                        } else
                        {
                            io.emit('order_delay', false);
                        }
                        // Return a success message
                        res.send('success');
                    });

});

// This is the call that the plcio will make to get the initial bootstrap config
router.get('/config', function (req, res, next)
{
    redisClient.get(helper.plc_config_node, function (err, reply)
    {
        if (err)
        {
            debug('error while retreiving from redis- {}'.format(err));
            res.status(500).send('error while retreiving from redis- {}'.format(err));
            return;
        }
        var plc_config = JSON.parse(reply);
        res.send(plc_config);
    });
});

// helper functions
function checkBarcodePresent(barcode, item_details)
{
    for (var i = 0; i < item_details.length; i++)
    {
        if (barcode === item_details[i]["barcode"])
        {
            return true;
        }
    }
    return false;
}

function extractDetails(barcode)
{
    if (checkIfTestMode(barcode.substr(8, 4)))
    {
        item_id = parseInt(barcode.substr(8, 4));
    } else
    {
        item_id = parseInt(barcode.substr(8, 4), 36);
    }
    day = Number(barcode.substr(12, 2));
    // weird javascript convention that the month starts from 0
    month = Number(barcode.substr(14, 2)) - 1;
    year = Number(barcode.substr(16, 4));
    hours = Number(barcode.substr(20, 2));
    minutes = Number(barcode.substr(22, 2));
    var date_obj = new Date(year, month, day, hours, minutes);
    var timestamp = Math.floor(date_obj.getTime() / 1000);
    return [item_id, timestamp];
}

function verifyBarcode(barcode)
{
    // First 2 chars should be text
    var city = barcode.substr(0, 2);

    // Next 3 should be integer
    var outlet_id = Number(barcode.substr(2, 3));
    if (!isInt(outlet_id))
    {
        return false;
    }

    var timestamp = Number(barcode.substr(12, 12));
    if (!isInt(timestamp))
    {
        return false;
    }
    return true;
}

function verifyValidItemId(item_id)
{
    // Confirm whether this is not a test mode item
    if (item_id >= 9000 && item_id <= 9099)
    {
        return true;
    }
    // First check if this has been populated or not
    if (OUTLET_ITEM_IDS.length == 0)
    {
        return true;
    }
    if (OUTLET_ITEM_IDS.indexOf(item_id) == -1)
    {
        return false;
    } else
    {
        return true;
    }
}

function isInt(n)
{
    return Number(n) === n && n % 1 === 0;
};

function checkIfTestMode(barcode)
{
    if (barcode[0] == '9' && barcode[1] == '0')
    {
        return true;
    } else
    {
        return false;
    }
}

function isTestModeItem(item_code)
{
    if (item_code >= 9000 && item_code <= 9099)
    {
        return true;
    } else
    {
        return false;
    }
}

function getBarcode(order_stub)
{
    return order_stub.substr(2, 22);
}

function getBillNo(order_stub)
{
    return parseInt(order_stub.substr(40, 10));
}

function computeDispenseStatus(current_status, new_status)
{
    var priorityMap = { 'timeout': -1, 'pending': 0, 'dispensing': 1, 'delivered': 2 }
    if (current_status === undefined)
    {
        return new_status;
    }
    if (priorityMap[current_status] <= priorityMap[new_status])
    {
        return current_status;
    } else
    {
        return new_status;
    }
}

Array.prototype.diff = function (a)
{
    return this.filter(function (i) { return a.indexOf(i) < 0; });
};

module.exports = router;
