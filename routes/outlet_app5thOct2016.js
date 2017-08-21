var express = require('express');
var router = express.Router();
var debug = require('debug')('outlet_app:server');
var redis = require('redis');
var format = require('string-format');
var firebase = require('firebase');
var request = require('request');
var requestretry = require('requestretry');
var async = require('async');
var _ = require('underscore');

var check_incoming_po = require('../misc/checkIncomingPOStatus');

var helper = require('./helper');
format.extend(String.prototype);
// Initiating the redisClient
var redisClient = redis.createClient({ connect_timeout: 2000, retry_max_delay: 5000 });
redisClient.on('error', function (msg)
{
    console.error(msg);
});

// Routes coming from the outlet app itself

// This gets the test mode flag from the outlet dash and passes it down
// to the order app.
router.post('/test_mode', function (req, res, next)
{
    var flag = req.body.flag;
    debug("Received test mode flag as - " + flag);
    // If flag is true, mark it as the start time in the DB, else as end time
    debug("Marking start time of test mode in the DB");
    var hq_url = process.env.HQ_URL;
    var TEST_MODE_TIME_URL = '/outlet/test_mode_time/';
    var outlet_id = process.env.OUTLET_ID;
    requestretry({
        url: hq_url + TEST_MODE_TIME_URL + outlet_id,
        method: "POST",
        forever: true,
        json: { "start": flag }
    },
    function (error, response, body)
    {
        if (error || (response && response.statusCode != 200))
        {
            console.error('{}: {} {}'.format(hq_url, error, body));
            res.status(500).send('{}: {} {}'.format(hq_url, error, body));
            return;
        }
        debug(body);
    });
    redisClient.set(helper.test_mode_flag,
      flag,
      function (set_err, set_reply)
      {
          if (set_err)
          {
              console.error('error while inserting in redis- {}'.format(set_stock_count_err));
              return;
          }
      });
    debug("Sending the test mode flag to the order app");
    io.emit('test_mode', flag);
    io.sockets.emit('test_mode', flag);
    res.send('success');
});

// This function notes down any issue that might have occured during
// test mode and sends it to the HQ to be noted in the DB
router.post('/test_mode_issue', function (req, res, next)
{
    var issue_text = req.body.text;
    debug("Test mode issue received as- " + issue_text);
    var hq_url = process.env.HQ_URL;
    var TEST_MODE_ISSUES_URL = '/outlet/test_mode_issue/';
    var outlet_id = process.env.OUTLET_ID;
    requestretry({
        url: hq_url + TEST_MODE_ISSUES_URL + outlet_id,
        method: "POST",
        forever: true,
        json: { "text": issue_text }
    },
    function (error, response, body)
    {
        if (error || (response && response.statusCode != 200))
        {
            console.error('{}: {} {}'.format(hq_url, error, body));
            res.status(500).send('{}: {} {}'.format(hq_url, error, body));
            return;
        }
        res.send(body);
    });
});

router.post('/beverage_control', function (req, res, next)
{
    var data = req.body.data;
    var dataToSend = [];
    // flattening the dictionary to a list
    for (var item_id in data)
    {
        var item = data[item_id];
        item["id"] = item_id;
        dataToSend.push(item);
    }
    debug("Sending beverage signal as- ", JSON.stringify(dataToSend));
    io.emit('beverage_items', dataToSend);
    io.sockets.emit('beverage_items', dataToSend);
    res.send("success");
});

// This will mark the given barcodes to be spoiled in the stock_count
router.post('/mark_spoilage', function (req, res, next)
{
    var barcodes = req.body.barcodes;
    var misc_notes = req.body.misc_notes;
    redisClient.get(helper.stock_count_node, function (err, reply)
    {
        if (err)
        {
            console.error("error while retreiving from redis- {}".format(err));
            res.status(500).send("error while retreiving from redis- {}".format(err));
            return;
        }
        var stock_count = JSON.parse(reply);
        for (var item_id in stock_count)
        {
            var item_node = stock_count[item_id];
            for (var i = 0; i < item_node["item_details"].length; i++)
            {
                var barcode = item_node["item_details"][i]["barcode"];
                // checking for the barcode in the item details
                if (barcodes.indexOf(barcode) != -1)
                {
                    debug("barcode- {} has spoiled".format(barcode));
                    stock_count[item_id]["item_details"][i]["spoiled"] = true;
                }
            }
        }
        //Sending signal to the order app
        io.emit(helper.stock_count_node, stock_count);
        io.sockets.emit(helper.stock_count_node, stock_count);
        // Setting the value in redis
        redisClient.set(helper.stock_count_node,
          JSON.stringify(stock_count),
          function (set_stock_count_err, set_stock_count_reply)
          {
              if (set_stock_count_err)
              {
                  console.error('error while inserting in redis- {}'.format(set_stock_count_err));
                  return;
              }
          });
        // Put the data in firebase
        var rootref = new firebase(process.env.FIREBASE_CONN);
        var stock_count_node = rootref.child('{}/{}'.format(process.env.OUTLET_ID, helper.stock_count_node));
        stock_count_node.set(stock_count);

        // Marking the spoiled items in the final status table
        var hq_url = process.env.HQ_URL;
        var MARK_SPOILAGE_URL = hq_url + '/outlet/report_spoilage';
        requestretry({
            url: MARK_SPOILAGE_URL,
            method: "POST",
            forever: true,
            maxAttempts: 25,
            json: { "barcodes": barcodes, "misc_notes": misc_notes }
        }, function (bill_error, bill_response, bill_body)
        {
            if (bill_error || (bill_response && bill_response.statusCode != 200))
            {
                console.error('{}: {} {}'.format(MARK_SPOILAGE_URL, bill_error, bill_body));
                return;
            }
            debug(bill_body);
        });
        res.send('success');
    });
});

// This will mark entire stock as spoiled
router.post('/force_fail_entire_stock', function (req, res, next)
{
    var misc_notes = null;
    var barcodes = [];
    var fail_all = req.body.fail_all;
    redisClient.get(helper.stock_count_node, function (err, reply)
    {
        if (err)
        {
            console.error("error while retreiving from redis- {}".format(err));
            res.status(500).send("error while retreiving from redis- {}".format(err));
            return;
        }
        var stock_count = JSON.parse(reply);
        debugger;
        for (var item_id in stock_count)
        {
            var item_node = stock_count[item_id];
            for (var i = 0; i < item_node["item_details"].length; i++)
            {
                var barcode = item_node["item_details"][i]["barcode"];
                var count = item_node["item_details"][i]["count"];
                for (var j = 0; j < count; ++j)
                {
                    barcodes.push(barcode);
                }
                stock_count[item_id]["item_details"][i]["spoiled"] = true;
            }
        }
        //Sending signal to the order app
        io.emit(helper.stock_count_node, stock_count);
        // Setting the value in redis
        redisClient.set(helper.stock_count_node,
          JSON.stringify(stock_count),
          function (set_stock_count_err, set_stock_count_reply)
          {
              if (set_stock_count_err)
              {
                  console.error('error while inserting in redis- {}'.format(set_stock_count_err));
                  return;
              }
          });
        // Put the data in firebase
        var rootref = new firebase(process.env.FIREBASE_CONN);
        var stock_count_node = rootref.child('{}/{}'.format(process.env.OUTLET_ID, helper.stock_count_node));
        stock_count_node.set(stock_count);
        var hq_url = process.env.HQ_URL;
        var outlet_id = process.env.OUTLET_ID;
        var FORCE_FAILURE_URL = hq_url + '/outlet/force_failure';
        requestretry({
            url: FORCE_FAILURE_URL,
            method: "POST",
            forever: true,
            json: { "outlet_id": outlet_id, "barcodes": barcodes, "misc_notes": misc_notes, "fail_all": fail_all }
        }, function (bill_error, bill_response, bill_body)
        {
            if (bill_error || (bill_response && bill_response.statusCode != 200))
            {
                console.error('{}: {} {}'.format(FORCE_FAILURE_URL, bill_error, bill_body));
                return;
            }
            debug(bill_body);
            res.send('success');
        });
    });
});

// This is to update the inventory after removing the expired items
router.post('/signal_expiry_item_removal', function (req, res, next)
{
    // clear out the expiry_slots queue from redis
    redisClient.del(helper.expiry_slots_node, function (err, reply)
    {
        if (err)
        {
            console.error(err);
            res.status(500).send("error while deleting expiry slots in redis- {}".format(err));
            return;
        }
        debug('Expired slots removed from redis');
    });
    // get the barcodes of all expired items from the redis queue and send
    // them to HQ
    redisClient.get(helper.stock_count_node, function (redis_err, redis_res)
    {
        if (redis_err)
        {
            console.error(redis_err);
            res.status(500).send(redis_err);
            return;
        }
        var barcodes = [];
        var stock_count = JSON.parse(redis_res);
        for (var item_id in stock_count)
        {
            var item_node = stock_count[item_id];
            for (var i = 0; i < item_node["item_details"].length; i++)
            {
                if (item_node["item_details"][i]["expired"])
                {
                    for (var j = 0; j < item_node["item_details"][i]["count"]; j++)
                    {
                        barcodes.push(item_node["item_details"][i]["barcode"]);
                    }
                }
            }
        }
        var hq_url = process.env.HQ_URL;
        var REMOVE_EXPIRED_URL = hq_url + '/outlet/remove_expired_items';
        requestretry({
            url: REMOVE_EXPIRED_URL,
            method: "POST",
            json: { "barcodes": barcodes }
        }, function (expire_error, expire_response, expire_body)
        {
            if (expire_error || (expire_response && expire_response.statusCode != 200))
            {
                console.error('{}: {} {}'.format(hq_url, expire_error, expire_body));
                return;
            }
            debug(expire_body);
        });
        res.send('success');
    });
});

router.post('/signal_unscanned_item_removal', function (req, res, next)
{
    // clear out the expiry_slots queue from redis
    redisClient.del(helper.unscanned_slots_node, function (err, reply)
    {
        if (err)
        {
            console.error(err);
            res.status(500).send("error while retreiving from redis- {}".format(err));
            return;
        }
        debug('Unscanned slots removed from redis');
    });
    item_codes = req.body.item_codes;
    var hq_url = process.env.HQ_URL;
    var REMOVE_UNSCANNED_URL = hq_url + '/outlet/remove_unscanned_items';
    requestretry({
        url: REMOVE_UNSCANNED_URL,
        method: "POST",
        forever: true,
        json: { "item_codes": item_codes }
    }, function (error, response, body)
    {
        if (error || (response && response.statusCode != 200))
        {
            console.error('{}: {} {}'.format(hq_url, error, body));
            return;
        }
        debug(body);
    });
    res.send('success');
});

// This will return the no. of unscanned slots for the outlet dash
router.get('/unscanned_slots', function (req, res, next)
{
    // Get the unscanned slots and last load info first
    redisClient.get(helper.unscanned_slots_node,
      function (err, reply)
      {
          if (err)
          {
              console.error(err);
              res.status(500).send(err);
              return;
          }
          var unscanned_slots = JSON.parse(reply);
          res.send({ "unscanned_slots": unscanned_slots });
      });
});

router.post('/update_unscanned_items', function (req, res, next)
{
    var hq_url = process.env.HQ_URL;
    var outlet_id = process.env.OUTLET_ID;

    // First removing the unscanned items slot in redis -
    redisClient.del(helper.unscanned_slots_node, function (err, reply)
    {
        if (err)
        {
            console.error(err);
            res.status(500).send(err);
            return;
        }
        debug('Unscanned slots removed from redis');
        res.send('success');
    });
});

router.get('/update_outstanding_po', function (req, res, next)
{
    check_incoming_po();
    res.send('success');
});

router.get('/get_loading_issue_items', function (req, res, next)
{
    redisClient.get(helper.loading_issue_items_node, function (err, reply)
    {
        if (err)
        {
            console.error("error while retrieving from redis- {}".format(err));
            res.status(500).send("error while retrieving from redis- {}".format(err));
            return;
        }
        var parsed_response = JSON.parse(reply);
        if (!parsed_response)
        {
            res.send({});
            return;
        }
        res.send({
            "unscanned": parsed_response.unscanned_slots,
            "loading_issue": parsed_response.loading_issue
        });
    });
});

router.post('/store_loading_issue_items', function (req, res, next)
{
    // this will contact the HQ and update the final status of the latest po
    // and batch and mark the barcodes as 'loading_issue'
    var item_id_info = req.body.item_id_info;
    var hq_url = process.env.HQ_URL;
    var STORE_LOADING_ISSUE_ITEMS_URL = hq_url + '/outlet/report_loading_issue/' + process.env.OUTLET_ID;
    requestretry({
        url: STORE_LOADING_ISSUE_ITEMS_URL,
        method: "POST",
        json: { "item_id_info": item_id_info }
    }, function (error, response, body)
    {
        if (error || (response && response.statusCode != 200))
        {
            console.error('{}: {} {}'.format(hq_url, error, body));
            res.status(500).send('{}: {} {}'.format(hq_url, error, body));
            return;
        }
        res.send(body);
    });
});

// This will signal the HQ that day has started and open the main page
router.post('/start_of_day_signal', function (req, res, next)
{
    var supplies = req.body.supplies;
    if (!supplies)
    {
        res.status(400).send('Please fill the supplies field');
        return;
    }
    outlet_register("sod");
    var hq_url = process.env.HQ_URL;
    var SUPPLIES_STATUS_URL = hq_url + '/outlet/supplies_status?phase=start_of_day';
    requestretry({
        url: SUPPLIES_STATUS_URL,
        method: "POST",
        forever: true,
        json: { "supplies": supplies }
    }, function (error, response, body)
    {
        if (error || (response && response.statusCode != 200))
        {
            console.error('{}: {} {}'.format(hq_url, error, body));
            return;
        }
        debug(body);
    });

    // Deleting the zero sales node
    redisClient.del(helper.zero_sales_count_node, function (del_err, del_reply)
    {
        if (del_err)
        {
            console.error("error while deleting zero sales in redis- {}".format(b_err));
            return;
        }
        debug("Deleted the zero sales count node");
    });

    // Resetting the bill_no to 1 because its at the end of the day
    redisClient.set(helper.bill_no_node, 1, function (b_err, b_reply)
    {
        if (b_err)
        {
            console.error("error while setting bill_no in redis- {}".format(b_err));
            return;
        }
        debug("Set the bill no to 1");
    });

    redisClient.set(helper.dispense_id_node, 1, function (d_err, d_reply)
    {
        if (d_err)
        {
            callback("error while retreiving from redis- {}".format(d_err), null);
            return;
        }
        debug("Set the dispense_id to 1");
    });

    redisClient.set(helper.start_of_day_flag, false, function (sod_err, sod_reply)
    {
        if (sod_err)
        {
            console.error("error while setting sod in redis- {}".format(sod_err));
            return;
        }
        res.send('success');
    });
});

//The post method call HQ to activate mobile pending orders
router.post('/mobile_pending_orders', function (req, res, next)
{
    debug("*******************************mobile_pending_orders" + JSON.stringify(req.body));
    var hq_url = process.env.HQ_URL;
    var MOBILE_PENDING_URL = '/outlet_mobile/activate_mobile_order/';
    var outletid = req.body.outletid;
    var mobileno = req.body.mobileno;
    var referenceno = req.body.referenceno;
    
    requestretry({
        url: hq_url + MOBILE_PENDING_URL,
        method: "POST",
        forever: true,
        json: { "referenceno": referenceno, "mobileno": mobileno, "outletid": outletid }
    },
    function (error, response, body)
    {
        if (error || (response && response.statusCode != 200))
        {
            console.error('{}: {} {}'.format(hq_url, error, body));
            res.status(500).send('{}: {} {}'.format(hq_url, error, body));
            return;
        }
        res.send(body);
    });
});

function outlet_register(phases)
{
    var phase = phases;
    var hq_url = process.env.HQ_URL;
    var OUTLET_REGISTER_URL = hq_url + '/outlet_mobile/outlet_register_status';
    requestretry({
        url: OUTLET_REGISTER_URL,
        method: "POST",
        json: { "phase": phase, "outlet_id": process.env.OUTLET_ID }
    }, function (error, response, body)
    {
        if (error || (response && response.statusCode != 200))
        {
            console.error('{}: {} {}'.format(hq_url, error, body));
            return;
        }
        debug(body);
    });
}


// This will signal the HQ that day has ended and return with a locked page
router.post('/end_of_day_signal', function (req, res, next)
{
    var supplies = req.body.supplies;
    if (!supplies)
    {
        res.status(400).send('Please fill the supplies field');
        return;
    }
    outlet_register("eod");
    var hq_url = process.env.HQ_URL;
    var SUPPLIES_STATUS_URL = hq_url + '/outlet/supplies_status?phase=end_of_day';
    requestretry({
        url: SUPPLIES_STATUS_URL,
        method: "POST",
        json: { "supplies": supplies }
    }, function (error, response, body)
    {
        if (error || (response && response.statusCode != 200))
        {
            console.error('{}: {} {}'.format(hq_url, error, body));
            return;
        }
        debug(body);
    });

    // Deleting the zero sales node
    redisClient.del(helper.zero_sales_count_node, function (del_err, del_reply)
    {
        if (del_err)
        {
            console.error("error while deleting zero sales in redis- {}".format(b_err));
            return;
        }
    });


    // Resetting the bill_no to 1 because its at the end of the day
    redisClient.set(helper.bill_no_node, 1, function (b_err, b_reply)
    {
        if (b_err)
        {
            console.error("error while setting bill_no in redis- {}".format(b_err));
            return;
        }

        redisClient.get(helper.dispense_id_node, function (dis_err, dis_reply)
        {
            // Store the recovery details in the HQ
            var UPDATE_RECOVERY_DETAILS_URL = hq_url + '/outlet/update_recovery_details/' + process.env.OUTLET_ID;
            requestretry({
                url: UPDATE_RECOVERY_DETAILS_URL,
                method: "POST",
                json: {
                    "bill_no": 1,
                    "dispense_id": JSON.parse(dis_reply)
                }
            }, function (error, response, body)
            {
                if (error || (response && response.statusCode != 200))
                {
                    console.error('{}: {} {}'.format(hq_url, error, body));
                    return;
                }
                debug("Updated HQ with the recovery details");
            });
        });

        // Setting the start of day flag to true
        redisClient.set(helper.start_of_day_flag, true, function (sod_err, sod_reply)
        {
            if (sod_err)
            {
                console.error("error while setting sod in redis- {}".format(sod_err));
                res.status(500).send(sod_err);
                return;
            }
            res.send('success');
        });
    });
});

router.post('/expire_all_items', function (req, res, next)
{
    debug("Expiring all items in stock");
    redisClient.get(helper.stock_count_node, function (redis_err, redis_res)
    {
        if (redis_err)
        {
            console.error(redis_err);
            return;
        }
        var parsed_response = JSON.parse(redis_res);
        for (var item_id in parsed_response)
        {
            var item_details = parsed_response[item_id]["item_details"];
            for (var i = 0; i < item_details.length; i++)
            {
                // If the item is already expired, no need to do anything
                if (item_details[i]["expired"])
                {
                    continue;
                }
                item_details[i]["expired"] = true;
                // Pushing the data to redis to store the list of expired slots
                var slots = item_details[i]["slot_ids"];
                io.emit('expiry_slots', slots);
                // Adding the list of expired slots to redis
                redisClient.rpush(helper.expiry_slots_node, JSON.stringify(slots),
                  function (lp_err, lp_reply)
                  {
                      if (lp_err)
                      {
                          console.error(err);
                          return;
                      }
                  });
            }
        }

        // push to redis
        redisClient.set(helper.stock_count_node,
          JSON.stringify(parsed_response),
          function (set_stock_count_err, set_stock_count_reply)
          {
              if (set_stock_count_err)
              {
                  console.error('error while inserting in redis- {}'.format(set_stock_count_err));
              }
          });
        // get the lock counts
        var item_id_list = [];
        for (var item_id in parsed_response)
        {
            item_id_list.push(item_id + '_locked_count');
        }

        redisClient.mget(item_id_list, function (l_err, l_reply)
        {
            for (var item_id in parsed_response)
            {
                if (l_reply[item_id_list.indexOf(item_id + '_locked_count')])
                {
                    parsed_response[item_id]["locked_count"] = parseInt(l_reply[item_id_list.indexOf(item_id + '_locked_count')]);
                } else
                {
                    parsed_response[item_id]["locked_count"] = 0;
                }
            }
            // Sending the data to the socket.io channel
            io.emit(helper.stock_count_node, parsed_response);
            io.sockets.emit(helper.stock_count_node, parsed_response);

            // Put the data in firebase
            var rootref = new firebase(process.env.FIREBASE_CONN);
            var stock_count_node = rootref.child('{}/{}'.format(process.env.OUTLET_ID, helper.stock_count_node));
            stock_count_node.set(parsed_response);
        });
    });
    res.send("success");
});

router.post('/store_last_load_info', function (req, res, next)
{
    var po_id = req.body.po_id;
    var batch_id = req.body.batch_id;
    var rest_id = req.body.rest_id;

    // update HQ that this batch has been received
    var hq_url = process.env.HQ_URL;
    var UPDATE_RECEIVED_TIME_URL = hq_url + '/outlet/update_received_time/' + process.env.OUTLET_ID;
    requestretry({
        url: UPDATE_RECEIVED_TIME_URL,
        method: "POST",
        json: { "po_id": po_id, "batch_id": batch_id, "rest_id": rest_id }
    }, function (error, response, body)
    {
        if (error || (response && response.statusCode != 200))
        {
            console.error('{}: {} {}'.format(hq_url, error, body));
            return;
        }
        debug(body);
    });

    // update redis with the last load info
    redisClient.get(helper.last_load_tmp_node, function (err, reply)
    {
        if (err)
        {
            console.error(err);
            res.status(500).send("error while last load info from redis- {}".format(err));
            return;
        }
        var parsed_response = JSON.parse(reply);
        if (parsed_response === null)
        {
            parsed_response = {};
        }
        parsed_response[rest_id] = [{ "po_id": po_id, "batch_id": batch_id }];
        redisClient.set(helper.last_load_tmp_node, JSON.stringify(parsed_response), function (err, reply)
        {
            if (err)
            {
                console.error(err);
                return res.status(500).send(err);
            }
            res.send('success');
        });
    });
});

router.post('/mark_po_received', function (req, res, next)
{
    var allItems = req.body;
    var hq_url = process.env.HQ_URL;
    var UPDATE_RECEIVED_TIME_URL = hq_url + '/outlet/update_received_time/' + process.env.OUTLET_ID;

    allItems.map(function (item)
    {
        requestretry({
            url: UPDATE_RECEIVED_TIME_URL,
            method: "POST",
            json: { "po_id": item.po_id, "batch_id": item.batch_id, "rest_id": item.rest_id }
        }, function (error, response, body)
        {
            if (error || (response && response.statusCode != 200))
            {
                console.error('{}: {} {}'.format(hq_url, error, body));
                return;
            }
            debug(body);
        });
    });

    // deleting the last load info node
    redisClient.del(helper.last_load_info_node,
                function (set_err, set_reply)
                {
                    if (set_err)
                    {
                        return debug(set_err);
                    }
                    debug("Deleted the last load info node");
                    res.send('success');
                });
});

// This call contacts the HQ and returns the list of food_item issues
router.get('/food_item_issues', function (req, res, next)
{
    var hq_url = process.env.HQ_URL;
    var time = req.query.time;
    var GET_FOOD_ITEM_ISSUES_URL = '/outlet/food_item_issues/';
    var outlet_id = process.env.OUTLET_ID;
    request(hq_url + GET_FOOD_ITEM_ISSUES_URL + outlet_id + '?time=' + time,
      { forever: true },
      function (error, response, body)
      {
          if (error || (response && response.statusCode != 200))
          {
              console.error('{}: {} {}'.format(hq_url, error, body));
              res.status(500).send('{}: {} {}'.format(hq_url, error, body));
              return;
          }
          res.send(JSON.parse(body));
      });
});

// This call contacts the HQ and returns the list of non_food_item issues
router.get('/non_food_item_issues', function (req, res, next)
{
    var hq_url = process.env.HQ_URL;
    var time = req.query.time;
    var GET_NONFOOD_ITEM_ISSUES_URL = '/outlet/non_food_item_issues/';
    var outlet_id = process.env.OUTLET_ID;
    request(hq_url + GET_NONFOOD_ITEM_ISSUES_URL + outlet_id + '?time=' + time,
      { forever: true },
      function (error, response, body)
      {
          if (error || (response && response.statusCode != 200))
          {
              console.error('{}: {} {}'.format(hq_url, error, body));
              res.status(500).send('{}: {} {}'.format(hq_url, error, body));
              return;
          }
          res.send(JSON.parse(body));
      });
});

router.get('/food_item_list', function (req, res, next)
{
    async.parallel({
        food_item_list: function (callback)
        {
            // Getting the food item list from HQ
            var hq_url = process.env.HQ_URL;
            var GET_FOOD_ITEM_LIST_URL = '/outlet/food_item_list/';
            var outlet_id = process.env.OUTLET_ID;
            request(hq_url + GET_FOOD_ITEM_LIST_URL + outlet_id,
              { forever: true },
              function (error, response, body)
              {
                  if (error || (response && response.statusCode != 200))
                  {
                      callback('{}: {} {}'.format(hq_url, error, body), null);
                      return;
                  }
                  callback(null, JSON.parse(body));
              });
        },
        non_food_types: function (callback)
        {
            //non_food_types
            var hq_url = process.env.HQ_URL;
            var GET_NON_FOOD_TYPES_URL = '/outlet/non_food_types';
            request(hq_url + GET_NON_FOOD_TYPES_URL,
              { forever: true },
              function (error, response, body)
              {
                  if (error || (response && response.statusCode != 200))
                  {
                      callback('{}: {} {}'.format(hq_url, error, body), null);
                      return;
                  }
                  callback(null, body);
              });
        }
    },
    function (err, results)
    {
        if (err)
        {
            console.error(err);
            res.status(500).send(err);
            return;
        }
        var food_item_list = results.food_item_list;
        var non_food_types = results.non_food_types;
        res.send({ "food_item_list": food_item_list, "non_food_types": non_food_types });
    });
});

router.post('/update_item_issues', function (req, res, next)
{
    var hq_url = process.env.HQ_URL;
    var UPDATE_ITEM_ISSUES_URL = '/outlet/update_item_issues/';
    var outlet_id = process.env.OUTLET_ID;
    var barcode_details = req.body.barcode_details;
    var non_food_issue = req.body.non_food_issue;
    requestretry({
        url: hq_url + UPDATE_ITEM_ISSUES_URL + outlet_id,
        method: "POST",
        forever: true,
        json: { "barcode_details": barcode_details, "non_food_issue": non_food_issue }
    },
    function (error, response, body)
    {
        if (error || (response && response.statusCode != 200))
        {
            console.error('{}: {} {}'.format(hq_url, error, body));
            res.status(500).send('{}: {} {}'.format(hq_url, error, body));
            return;
        }
        res.send(body);
    });
});

router.get('/get_sales_info_cashcard', function (req, res, next)
{
    var hq_url = process.env.HQ_URL;
    var AMOUNT_SOLD_CASHCARD_URL = '/outlet/getcashcard_sales_daymonth/';
    var outlet_id = process.env.OUTLET_ID;
    console.log("get_sales_info_cashcard :=", hq_url + AMOUNT_SOLD_CASHCARD_URL + outlet_id);
    request(hq_url + AMOUNT_SOLD_CASHCARD_URL + outlet_id,
      { forever: true },
      function (error, response, body)
      {
          if (error || (response && response.statusCode != 200))
          {
              console.error('{}: {} {}'.format(hq_url, error, body));
              res.status(500).send('{}: {} {}'.format(hq_url, error, body));
              return;
          }
          res.send(body);
      });
});

// get no. of items sold since sod for food and other items
// get amount sold through cash since sod
// get amount sold in petty cash since sod
// get amount sold in food and snacks/drinks in that month
router.get('/get_sales_info', function (req, res, next)
{
    // Doing an async parallel call to get the different infos
    async.parallel({
        amount_sold_cash: function (callback)
        {
            // This is the amount given to them at the start of the month
            var AMOUNT_SOLD_CASH_URL = '/outlet/amount_for_month/' + process.env.OUTLET_ID;
            console.log("amount_sold_cash url:-", process.env.HQ_URL + AMOUNT_SOLD_CASH_URL);
            request(process.env.HQ_URL + AMOUNT_SOLD_CASH_URL,
              { forever: true },
              function (error, response, body)
              {
                  if (error || (response && response.statusCode != 200))
                  {
                      callback('{}: {} {}'.format(process.env.HQ_URL, error, body), null);
                      return;
                  }
                  if (!body)
                  {
                      callback(null, { "sum": 0 });
                  } else
                  {
                      callback(null, JSON.parse(body));
                  }
              });
        },
        amount_sold_cashcard: function (callback)
        {
            // This is the amount given to them at the start of the month
            var AMOUNT_SOLD_CASHCARD_URL = '/outlet/getcashcard_sales_daymonth/' + process.env.OUTLET_ID;
            console.log("AMOUNT_SOLD_CASHCARD_URL :-", AMOUNT_SOLD_CASHCARD_URL);
            request(process.env.HQ_URL + AMOUNT_SOLD_CASHCARD_URL,
              { forever: true },
              function (error, response, body)
              {
                  if (error || (response && response.statusCode != 200))
                  {
                      callback('{}: {} {}'.format(process.env.HQ_URL, error, body), null);
                      return;
                  }
                  if (!body)
                  {
                      callback(null, { "sum": 0 });
                  } else
                  {
                      callback(null, JSON.parse(body));
                  }
              });
        },
        amount_sold_pettycash: function (callback)
        {
            // This is the amount sold in petty cash for that month
            var AMOUNT_SOLD_PETTY_CASH_URL = '/outlet/amount_sold_pettycash/' + process.env.OUTLET_ID;
            request(process.env.HQ_URL + AMOUNT_SOLD_PETTY_CASH_URL,
              { forever: true },
              function (error, response, body)
              {
                  if (error || (response && response.statusCode != 200))
                  {
                      callback('{}: {} {}'.format(process.env.HQ_URL, error, body), null);
                      return;
                  }
                  if (!body)
                  {
                      callback(null, { "sum": 0 });
                  } else
                  {
                      callback(null, JSON.parse(body));
                  }
              });
        }
    },
    function (err, results)
    {
        if (err)
        {
            console.error(err);
            res.status(500).send(err);
            return;
        }
        res.send(results);
    });
});

router.get('/get_live_pos', function (req, res, next)
{
    var hq_url = process.env.HQ_URL;
    var UPDATE_ITEM_ISSUES_URL = '/outlet/get_live_pos/';
    var outlet_id = process.env.OUTLET_ID;
    request(hq_url + UPDATE_ITEM_ISSUES_URL + outlet_id,
      { forever: true },
      function (error, response, body)
      {
          if (error || (response && response.statusCode != 200))
          {
              console.error('{}: {} {}'.format(hq_url, error, body));
              res.status(500).send('{}: {} {}'.format(hq_url, error, body));
              return;
          }
          res.send(body);
      });
});

// Handler to keep track of the petty cash expenditure by the outlet staff
router.post('/petty_expenditure', function (req, res, next)
{
    var hq_url = process.env.HQ_URL;
    var PETTY_EXPENDITURE_URL = '/outlet/petty_expenditure/';
    var outlet_id = process.env.OUTLET_ID;
    requestretry({
        url: hq_url + PETTY_EXPENDITURE_URL + outlet_id,
        forever: true,
        method: "POST",
        json: { "data": req.body.data }
    },
    function (error, response, body)
    {
        if (error || (response && response.statusCode != 200))
        {
            console.error('{}: {} {}'.format(hq_url, error, body));
            res.status(500).send('{}: {} {}'.format(hq_url, error, body));
            return;
        }
        res.send(body);
    });
});

// Handler that returns the list of names to the outlet dash
router.get('/staff_roster', function (req, res, next)
{
    var STAFF_ROSTER_URL = '/outlet/staff_roster/' + process.env.OUTLET_ID;
    // requesting the HQ to get the staff list
    request(process.env.HQ_URL + STAFF_ROSTER_URL,
      { forever: true },
      function (error, response, body)
      {
          if (error || (response && response.statusCode != 200))
          {
              console.error('{}: {} {}'.format(process.env.HQ_URL, error, body));
              res.status(500).send('{}: {} {}'.format(process.env.HQ_URL, error, body));
              return;
          }
          res.send(JSON.parse(body));
      });
});

router.post('/staff_roster', function (req, res, next)
{
    var STAFF_ROSTER_URL = '/outlet/staff_roster/' + process.env.OUTLET_ID;
    requestretry({
        url: process.env.HQ_URL + STAFF_ROSTER_URL,
        method: "POST",
        forever: true,
        json: { "data": req.body.data }
    },
    function (error, response, body)
    {
        if (error || (response && response.statusCode != 200))
        {
            console.error('{}: {} {}'.format(process.env.HQ_URL, error, body));
            res.status(500).send('{}: {} {}'.format(process.env.HQ_URL, error, body));
            return;
        }
        res.send(body);
    });
});

// This handler passes the stop order command to the order app
router.post('/stop_orders', function (req, res, next)
{
    redisClient.set(helper.stop_orders_flag,
    true,
    function (set_err, set_reply)
    {
        if (set_err)
        {
            console.error('error while inserting in redis- {}'.format(set_stock_count_err));
            return;
        }
        io.emit('stop_orders', true);
        res.send('success');
    });
});

// This handler passes the stop order command to the order app
router.post('/resume_orders', function (req, res, next)
{
    redisClient.set(helper.stop_orders_flag,
    false,
    function (set_err, set_reply)
    {
        if (set_err)
        {
            console.error('error while inserting in redis- {}'.format(set_stock_count_err));
            return;
        }
        io.emit('stop_orders', false);
        res.send('success');
    });
});

// Handler that returns the breakdown of the petty cash expenditure
// after getting it from the HQ
router.get('/petty_cash_breakdown', function (req, res, next)
{
    var PETTY_CASH_URL = '/outlet/petty_cash_breakdown/' + process.env.OUTLET_ID;
    // requesting the HQ to get the staff list
    requestretry(process.env.HQ_URL + PETTY_CASH_URL,
      function (error, response, body)
      {
          if (error || (response && response.statusCode != 200))
          {
              console.error('{}: {} {}'.format(process.env.HQ_URL, error, body));
              res.status(500).send('{}: {} {}'.format(process.env.HQ_URL, error, body));
              return;
          }
          res.send(JSON.parse(body));
      });
});

router.post('/expire_item_batch/:item_id', function (req, res, next)
{
    // get the stock from redis
    redisClient.get(helper.stock_count_node, function (redis_err, redis_res)
    {
        if (redis_err)
        {
            console.error(redis_err);
            res.status(500).send(redis_err);
            return;
        }
        var item_id = req.params.item_id;
        var parsed_response = JSON.parse(redis_res);
        // if stock[item_id] is present, expire all batches of it
        if (parsed_response.hasOwnProperty(item_id))
        {
            var item_details = parsed_response[item_id]["item_details"];
            for (var i = 0; i < item_details.length; i++)
            {
                item_details[i]["expired"] = true;
                // Pushing the data to redis to store the list of expired slots
                var slots = item_details[i]["slot_ids"];
                io.emit('expiry_slots', slots);
                // Adding the list of expired slots to redis
                redisClient.rpush(helper.expiry_slots_node, JSON.stringify(slots),
                  function (lp_err, lp_reply)
                  {
                      if (lp_err)
                      {
                          console.error(err);
                          return;
                      }
                  });
            }
            // push to redis
            redisClient.set(helper.stock_count_node,
              JSON.stringify(parsed_response),
              function (set_stock_count_err, set_stock_count_reply)
              {
                  if (set_stock_count_err)
                  {
                      console.error('error while inserting in redis- {}'.format(set_stock_count_err));
                  }
              });
            // get the lock counts
            var item_id_list = [];
            for (var item_id in parsed_response)
            {
                item_id_list.push(item_id + '_locked_count');
            }

            redisClient.mget(item_id_list, function (l_err, l_reply)
            {
                for (var item_id in parsed_response)
                {
                    if (l_reply[item_id_list.indexOf(item_id + '_locked_count')])
                    {
                        parsed_response[item_id]["locked_count"] = parseInt(l_reply[item_id_list.indexOf(item_id + '_locked_count')]);
                    } else
                    {
                        parsed_response[item_id]["locked_count"] = 0;
                    }
                }
                // Sending the data to the socket.io channel
                io.emit(helper.stock_count_node, parsed_response);
                io.sockets.emit(helper.stock_count_node, parsed_response);

                // Put the data in firebase
                var rootref = new firebase(process.env.FIREBASE_CONN);
                var stock_count_node = rootref.child('{}/{}'.format(process.env.OUTLET_ID, helper.stock_count_node));
                stock_count_node.set(parsed_response);
                return res.send('success');
            });
        } else
        {
            return res.send('success');
        }
    });
});

module.exports = router;
