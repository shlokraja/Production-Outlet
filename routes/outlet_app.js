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
var nodemailer = require('nodemailer');
var check_incoming_po = require('../misc/checkIncomingPOStatus');
var moment = require('moment');
var helper = require('./helper');
format.extend(String.prototype);
// Initiating the redisClient
var redisClient = redis.createClient({ connect_timeout: 2000, retry_max_delay: 5000 });


redisClient.on('error', function (msg) {
    console.error(msg);
});


// Routes coming from the outlet app itself
// This gets the test mode flag from the outlet dash and passes it down
// to the order app.
router.post('/test_mode', function (req, res, next) {
    var flag = req.body.flag;
    debug("Received test mode flag as - " + flag);
    // If flag is true, mark it as the start time in the DB, else as end time
    debug("Marking start time of test mode in the DB");
    var hq_url = process.env.HQ_URL;
    var TEST_MODE_TIME_URL = '/outlet/new_test_mode_time/';
    var outlet_id = process.env.OUTLET_ID;

    if (flag)
    {
        debug("Set Test Mode Timeout started");
        var TimeoutId = setTimeout(ClearTestMode, (60000 * process.env.TEST_MODE_TIME))
        var obj = new Object();
        obj.status = flag
        obj.starttime = new Date()
        obj.endtime = null
        redisClient.set(helper.test_mode_flag, flag);
        redisClient.set("test_mode_details", JSON.stringify(obj),
		function (set_err, set_reply) {
		    if (set_err)
		    {
		        console.error('error while inserting in redis- {}'.format(set_stock_count_err));
		        return;
		    }
		});
        debug("Set Test Mode Timeout Completed");
    }
    else
    {
        ClearTestMode();
        res.send('success');
    }
});

router.post('/test_mode_preprint', function (req, res, next) {
    var flag = req.body.flag;
        
    // Pre-Printed Code - Start (New for pre-printed)

    // console.log('**************************** flag' + flag)
    //if (!flag) {
    //    console.log('**************************** remove test comparision executed')
    //    // deleting the barcode_comparision node
    //    redisClient.del(helper.barcode_comparision, function (del_err, del_reply) {
    //        if (del_err) {
    //            console.error("error while deleting barcode_comparision in redis- {}".format(b_err));
    //            return;
    //        }
    //    });
    //}

    // Pre-Printed Code - End

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
        function (error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(hq_url, error, body));
                res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                return;
            }
            // debug(body);
        });
    redisClient.set(helper.test_mode_flag,
        flag,
        function (set_err, set_reply) {
            if (set_err) {
                console.error('error while inserting in redis- {}'.format(set_stock_count_err));
                return;
            }
        });
    debug("Sending the test mode flag to the order app");
    io.emit('test_mode', flag);
    io.sockets.emit('test_mode', flag);
    res.send('success');
});

//Clear Test mode function is to auto off the test mode based on the outlet configuration
//this will trigger from the test mode is started  after the timeout
function ClearTestMode() {
    debug("Clear Test Mode Timeout started");
	redisClient.get("test_mode_details", function(err,res) {
		if(err)
		{
			    console.error('error while inserting in redis- {}'.format(set_stock_count_err));
				return;
		}
		else {
				var obj = JSON.parse(res);
				obj.endtime = new Date();
				
				redisClient.set(helper.test_mode_flag,false);
				redisClient.set("test_mode_details", JSON.stringify(obj), function(err,res)
				{
					if (set_err)
					{
						console.error('error while inserting in redis- {}'.format(set_stock_count_err));
						return;
					}
                });
				requestretry({
					url: hq_url + TEST_MODE_TIME_URL + outlet_id,
					method: "POST",
					maxAttempts: 10,
					json: obj
                },function (error, response, body){	
					if (error || (response && response.statusCode != 200))
					{
						console.error('{}: {} {}'.format(hq_url, error, body));
						res.status(500).send('{}: {} {}'.format(hq_url, error, body));
						return;
					}
					debug(body);
				});
			}
		});
	io.emit('test_mode', false);
    io.sockets.emit('test_mode', false);
}

// This function notes down any issue that might have occured during
// test mode and sends it to the HQ to be noted in the DB
router.post('/test_mode_issue', function (req, res, next) {
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
        function (error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(hq_url, error, body));
                res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                return;
            }
            res.send(body);
        });
});

router.post('/beverage_control', function (req, res, next) {
    var data = req.body.data;
    var dataToSend = [];
    // flattening the dictionary to a list
    for (var item_id in data) {
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
router.post('/mark_spoilage', function (req, res, next) {
    var barcodes = req.body.barcodes;
    var misc_notes = req.body.misc_notes;
    redisClient.get(helper.stock_count_node, function (err, reply) {
        if (err) {
            console.error("error while retreiving from redis- {}".format(err));
            res.status(500).send("error while retreiving from redis- {}".format(err));
            return;
        }
        var stock_count = JSON.parse(reply);
        for (var item_id in stock_count) {
            var item_node = stock_count[item_id];
            for (var i = 0; i < item_node["item_details"].length; i++) {
                var barcode = item_node["item_details"][i]["barcode"];
                // checking for the barcode in the item details
                if (barcodes.indexOf(barcode) != -1) {
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
            function (set_stock_count_err, set_stock_count_reply) {
                if (set_stock_count_err) {
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
        }, function (bill_error, bill_response, bill_body) {
            if (bill_error || (bill_response && bill_response.statusCode != 200)) {
                console.error('{}: {} {}'.format(MARK_SPOILAGE_URL, bill_error, bill_body));
                return;
            }
            // debug(bill_body);
        });
        res.send('success');
    });
});

// This will mark entire stock as spoiled
router.post('/force_fail_entire_stock', function (req, res, next) {
    var misc_notes = null;
    var barcodes = [];
    var fail_all = req.body.fail_all;
    redisClient.get(helper.stock_count_node, function (err, reply) {
        if (err) {
            console.error("error while retreiving from redis- {}".format(err));
            res.status(500).send("error while retreiving from redis- {}".format(err));
            return;
        }
        var stock_count = JSON.parse(reply);
        debugger;
        for (var item_id in stock_count) {
            var item_node = stock_count[item_id];
            for (var i = 0; i < item_node["item_details"].length; i++) {
                var barcode = item_node["item_details"][i]["barcode"];
                var count = item_node["item_details"][i]["count"];
                for (var j = 0; j < count; ++j) {
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
            function (set_stock_count_err, set_stock_count_reply) {
                if (set_stock_count_err) {
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
        }, function (bill_error, bill_response, bill_body) {
            if (bill_error || (bill_response && bill_response.statusCode != 200)) {
                console.error('{}: {} {}'.format(FORCE_FAILURE_URL, bill_error, bill_body));
                return;
            }
            // debug(bill_body);
            res.send('success');
        });
    });
});

// This is to update the inventory after removing the expired items
router.post('/signal_expiry_item_removal', function (req, res, next) {
    // clear out the expiry_slots queue from redis
    redisClient.del(helper.expiry_slots_node, function (err, reply) {
        if (err) {
            console.error(err);
            res.status(500).send("error while deleting expiry slots in redis- {}".format(err));
            return;
        }
        debug('Expired slots removed from redis');
    });
    // get the barcodes of all expired items from the redis queue and send
    // them to HQ
    redisClient.get(helper.stock_count_node, function (redis_err, redis_res) {
        if (redis_err) {
            console.error(redis_err);
            res.status(500).send(redis_err);
            return;
        }
        var barcodes = [];
        var stock_count = JSON.parse(redis_res);
        for (var item_id in stock_count) {
            var item_node = stock_count[item_id];
            for (var i = 0; i < item_node["item_details"].length; i++) {
                if (item_node["item_details"][i]["expired"]) {
                    for (var j = 0; j < item_node["item_details"][i]["count"]; j++) {
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
        }, function (expire_error, expire_response, expire_body) {
            if (expire_error || (expire_response && expire_response.statusCode != 200)) {
                console.error('{}: {} {}'.format(hq_url, expire_error, expire_body));
                return;
            }
            // debug(expire_body);
        });
        res.send('success');
    });
});

router.post('/signal_unscanned_item_removal', function (req, res, next) {
    // clear out the expiry_slots queue from redis
    redisClient.del(helper.unscanned_slots_node, function (err, reply) {
        if (err) {
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
    }, function (error, response, body) {
        if (error || (response && response.statusCode != 200)) {
            console.error('{}: {} {}'.format(hq_url, error, body));
            return;
        }
        // debug(body);
    });
    res.send('success');
});

// This will return the no. of unscanned slots for the outlet dash
router.get('/unscanned_slots', function (req, res, next) {
    // Get the unscanned slots and last load info first
    redisClient.get(helper.unscanned_slots_node,
        function (err, reply) {
            if (err) {
                console.error(err);
                res.status(500).send(err);
                return;
            }
            var unscanned_slots = JSON.parse(reply);
            res.send({ "unscanned_slots": unscanned_slots });
        });
});

router.post('/update_unscanned_items', function (req, res, next) {
    var hq_url = process.env.HQ_URL;
    var outlet_id = process.env.OUTLET_ID;

    // First removing the unscanned items slot in redis -
    redisClient.del(helper.unscanned_slots_node, function (err, reply) {
        if (err) {
            console.error(err);
            res.status(500).send(err);
            return;
        }
        debug('Unscanned slots removed from redis');
        res.send('success');
    });
});

router.get('/update_outstanding_po', function (req, res, next) {
    check_incoming_po();
    res.send('success');
});

router.get('/get_loading_issue_items', function (req, res, next) {
    redisClient.get(helper.loading_issue_items_node, function (err, reply) {
        if (err) {
            console.error("error while retrieving from redis- {}".format(err));
            res.status(500).send("error while retrieving from redis- {}".format(err));
            return;
        }
        var parsed_response = JSON.parse(reply);
        if (!parsed_response) {
            res.send({});
            return;
        }
        res.send({
            "unscanned": parsed_response.unscanned_slots,
            "loading_issue": parsed_response.loading_issue
        });
    });
});

router.post('/store_loading_issue_items', function (req, res, next) {
    // this will contact the HQ and update the final status of the latest po
    // and batch and mark the barcodes as 'loading_issue'
    var item_id_info = req.body.item_id_info;
    var hq_url = process.env.HQ_URL;
    var STORE_LOADING_ISSUE_ITEMS_URL = hq_url + '/outlet/report_loading_issue/' + process.env.OUTLET_ID;
    requestretry({
        url: STORE_LOADING_ISSUE_ITEMS_URL,
        method: "POST",
        json: { "item_id_info": item_id_info }
    }, function (error, response, body) {
        if (error || (response && response.statusCode != 200)) {
            console.error('{}: {} {}'.format(hq_url, error, body));
            res.status(500).send('{}: {} {}'.format(hq_url, error, body));
            return;
        }
        res.send(body);
    });
});

// This will signal the HQ that day has started and open the main page
router.post('/start_of_day_signal', function (req, res, next) {
    var supplies = req.body.supplies;
    if (!supplies) {
        res.status(400).send('Please fill the supplies field');
        return;
    }
    outlet_register("sod", false);
    var hq_url = process.env.HQ_URL;
    var SUPPLIES_STATUS_URL = hq_url + '/outlet/supplies_status?phase=start_of_day';
    requestretry({
        url: SUPPLIES_STATUS_URL,
        method: "POST",
        forever: true,
        json: { "supplies": supplies }
    }, function (error, response, body) {
        if (error || (response && response.statusCode != 200)) {
            console.error('{}: {} {}'.format(hq_url, error, body));
            return;
        }
        // debug(body);
    });

    // Deleting the zero sales node
    redisClient.del(helper.zero_sales_count_node, function (del_err, del_reply) {
        if (del_err) {
            console.error("error while deleting zero sales in redis- {}".format(b_err));
            return;
        }
        debug("Deleted the zero sales count node");
    });

    redisClient.del(helper.stock_count_node, function (del_err, del_reply) {
        if (del_err) {
            console.error("error while deleting stock_count in redis- {}".format(b_err));
            return;
        }
        debug("Deleted the stock count node");
    });
    
    // Pre-Printed Code - Start (New for Pre-printed code)

    //redisClient.get(helper.outlet_config_node, function (err, reply) {
    //    if (err) {
    //        debug('error while retreiving from redis- {}'.format(err), null);
    //        return;
    //    }
    //    var outlet_config = JSON.parse(reply);
    //    var city = outlet_config.city;
    //    var outlet_id = pad(outlet_config.id, 3);
    //    var test_barcode = city + outlet_id + 'TST';
    //    console.log('***********************************************test_barcode' + test_barcode);
    //    redisClient.get(helper.barcode_comparision, function (err, reply) {
    //        if (err) {
    //            debug('error while retreiving from redis- {}'.format(err));
    //            return;
    //        }
    //        var dummy_array = [];
    //        var current_count = 1;
    //        for (var itemId = 9001; itemId <= 9003; itemId++) {
    //            var end_count = current_count + 29;
    //            for (var i = current_count; i <= end_count; i++) {
    //                var test_data_matrix = 'TST' + pad(i, 6);
    //                dummy_array.push({ data_matrix_code: test_data_matrix, barcode: test_barcode + itemId + '121020251700' });
    //                current_count++;
    //            }
    //        }

    //        redisClient.set(helper.barcode_comparision,
    //            JSON.stringify(dummy_array),
    //            function (err, rply) {
    //                if (err) {
    //                    console.log('*******************error while inserting in redis- {}'.format(err));
    //                }

    //            });
    //    });
    //});

    // Pre-Printed Code - End

    // Resetting the bill_no to 1 because its at the end of the day
    redisClient.set(helper.bill_no_node, 1, function (b_err, b_reply) {
        if (b_err) {
            console.error("error while setting bill_no in redis- {}".format(b_err));
            return;
        }
        debug("Set the bill no to 1");
    });

    redisClient.set(helper.dispense_id_node, 1, function (d_err, d_reply) {
        if (d_err) {
            callback("error while retreiving from redis- {}".format(d_err), null);
            return;
        }
        debug("Set the dispense_id to 1");
    });

    redisClient.set(helper.start_of_day_flag, false, function (sod_err, sod_reply) {
        if (sod_err) {
            console.error("error while setting sod in redis- {}".format(sod_err));
            return;
        }
        res.send('success');
    });
});

function pad(n, length) {
    var len = length - ('' + n).length;
    return (len > 0 ? new Array(++len).join('0') : '') + n
}

//The post method call HQ to activate mobile pending orders
router.post('/mobile_pending_orders', function (req, res, next) {
    // debug("*******************************mobile_pending_orders" + JSON.stringify(req.body));
    var hq_url = process.env.HQ_URL;
    var MOBILE_PENDING_URL = '/outlet_mobile/activate_mobile_order/';
    var outletid = req.body.outletid;
    var mobileno = req.body.mobileno;
    var referenceno = req.body.referenceno;

    request({
        url: hq_url + MOBILE_PENDING_URL,
        method: "POST",
        json: { "referenceno": referenceno, "mobileno": mobileno, "outletid": outletid }
    },
        function (error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(hq_url, error, body));
                res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                return;
            }
            res.send(body);
        });
});

function outlet_register(phases, isautomaticEOD) {
    var phase = phases;
    var hq_url = process.env.HQ_URL;
    var OUTLET_REGISTER_URL = hq_url + '/outlet_mobile/outlet_register_status';
    request({
        url: OUTLET_REGISTER_URL,
        method: "POST",
        json: { "phase": phase, "outlet_id": process.env.OUTLET_ID, "isautomaticEOD": isautomaticEOD }
    }, function (error, response, body) {
        if (error || (response && response.statusCode != 200)) {
            console.error('{}: {} {}'.format(hq_url, error, body));
            return;
        }
        //debug(body);
    });
}

router.post('/automatic_sod_24hr_outlet', function (req, res, next) {
    var phase = 'sod';
    var hq_url = process.env.HQ_URL;
    var OUTLET_REGISTER_URL = hq_url + '/outlet_mobile/automatic_sod_24hr_outlet';
    request({
        url: OUTLET_REGISTER_URL,
        method: "POST",
        json: { "phase": phase, "outlet_id": process.env.OUTLET_ID }
    }, function (error, response, body) {
        if (error || (response && response.statusCode != 200))
        {
            console.error('{}: {} {}'.format(hq_url, error, body));
            return;
        }        
    });    
});

// This will signal the HQ that day has ended and return with a locked page
router.post('/end_of_day_signal', function (req, res, next) {
    var supplies = req.body.supplies;
    var isautomaticEOD = req.body.isautomaticEOD;
    if (!supplies) {
        res.status(400).send('Please fill the supplies field');
        return;
    }
    outlet_register("eod",isautomaticEOD);
    var hq_url = process.env.HQ_URL;
    var SUPPLIES_STATUS_URL = hq_url + '/outlet/supplies_status?phase=end_of_day';
    requestretry({
        url: SUPPLIES_STATUS_URL,
        method: "POST",
        json: { "supplies": supplies }
    }, function (error, response, body) {
        if (error || (response && response.statusCode != 200)) {
            console.error('{}: {} {}'.format(hq_url, error, body));
            return;
        }
        //debug(body);
    });

    // Deleting the zero sales node
    redisClient.del(helper.zero_sales_count_node, function (del_err, del_reply) {
        if (del_err) {
            console.error("error while deleting zero sales in redis- {}".format(b_err));
            return;
        }
    });

    // Pre-Printed Code - Start (New for pre-printed code)

    //// deleting the barcode_comparision node
    //redisClient.del(helper.barcode_comparision, function (del_err, del_reply) {
    //    if (del_err) {
    //        console.error("error while deleting barcode_comparision in redis- {}".format(b_err));
    //        return;
    //    }
    //});

    // Pre-Printed Code - End

    // Resetting the bill_no to 1 because its at the end of the day
    redisClient.set(helper.bill_no_node, 1, function (b_err, b_reply) {
        if (b_err) {
            console.error("error while setting bill_no in redis- {}".format(b_err));
            return;
        }

        redisClient.get(helper.dispense_id_node, function (dis_err, dis_reply) {
            // Store the recovery details in the HQ
            var UPDATE_RECOVERY_DETAILS_URL = hq_url + '/outlet/update_recovery_details/' + process.env.OUTLET_ID;
            requestretry({
                url: UPDATE_RECOVERY_DETAILS_URL,
                method: "POST",
                json: {
                    "bill_no": 1,
                    "dispense_id": JSON.parse(dis_reply)
                }
            }, function (error, response, body) {
                if (error || (response && response.statusCode != 200)) {
                    console.error('{}: {} {}'.format(hq_url, error, body));
                    return;
                }
                debug("Updated HQ with the recovery details");
            });
        });

        // Setting the start of day flag to true
        redisClient.set(helper.start_of_day_flag, true, function (sod_err, sod_reply) {
            if (sod_err) {
                console.error("error while setting sod in redis- {}".format(sod_err));
                res.status(500).send(sod_err);
                return;
            }
            res.send('success');
        });
    });
});

router.post('/expire_all_items', function (req, res, next) {
    debug("Expiring all items in stock");
    redisClient.get(helper.stock_count_node, function (redis_err, redis_res) {
        if (redis_err) {
            console.error(redis_err);
            return;
        }
        var parsed_response = JSON.parse(redis_res);
        for (var item_id in parsed_response) {
            var item_details = parsed_response[item_id]["item_details"];
            for (var i = 0; i < item_details.length; i++)
            {

                var current_barcode = item_details[i]["barcode"];
                var barcode_date = current_barcode.substring(16, 20) + "-" + current_barcode.substring(14, 16) + "-" + current_barcode.substring(12, 14);
                // new Date("2016-12-03") > new Date()

                // Donot update as "expired" for furture item barcodes 
                // If next day batch is 
                if (new Date(barcode_date) < new Date())
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
                        function (lp_err, lp_reply) {
                            if (lp_err)
                            {
                                console.error(err);
                                return;
                            }
                        });
                }
            }
        }

        // push to redis
        redisClient.set(helper.stock_count_node,
            JSON.stringify(parsed_response),
            function (set_stock_count_err, set_stock_count_reply) {
                if (set_stock_count_err) {
                    console.error('error while inserting in redis- {}'.format(set_stock_count_err));
                }
            });
        // get the lock counts
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

router.post('/store_last_load_info', function (req, res, next) {
    var po_id = req.body.po_id;
    var batch_id = req.body.batch_id;
    var rest_id = req.body.rest_id;
    var reconcile_items = req.body.reconcile_items;

    // update HQ that this batch has been received
    var hq_url = process.env.HQ_URL;
    var UPDATE_RECEIVED_TIME_URL = hq_url + '/outlet/update_received_time/' + process.env.OUTLET_ID;
    requestretry({
        url: UPDATE_RECEIVED_TIME_URL,
        method: "POST",
        json: { "po_id": po_id, "batch_id": batch_id, "rest_id": rest_id, "reconcile_items": reconcile_items }
    }, function (error, response, body) {
        if (error || (response && response.statusCode != 200)) {
            console.error('{}: {} {}'.format(hq_url, error, body));
            return;
        }
        //debug(body);
    });

    // update redis with the last load info
    redisClient.get(helper.last_load_tmp_node, function (err, reply) {
        if (err) {
            console.error(err);
            res.status(500).send("error while last load info from redis- {}".format(err));
            return;
        }
        var parsed_response = JSON.parse(reply);
        if (parsed_response === null) {
            parsed_response = {};
        }
        parsed_response[rest_id] = [{ "po_id": po_id, "batch_id": batch_id }];
        redisClient.set(helper.last_load_tmp_node, JSON.stringify(parsed_response), function (err, reply) {
            if (err) {
                console.error(err);
                return res.status(500).send(err);
            }
            res.send('success');
        });
    });
    // get_matrix_code(batch_id);
});

router.post('/mark_po_received', function (req, res, next) {
    var allItems = req.body;
    var hq_url = process.env.HQ_URL;
    var UPDATE_RECEIVED_TIME_URL = hq_url + '/outlet/update_received_time/' + process.env.OUTLET_ID;

    allItems.map(function (item) {
        requestretry({
            url: UPDATE_RECEIVED_TIME_URL,
            method: "POST",
            json: { "po_id": item.po_id, "batch_id": item.batch_id, "rest_id": item.rest_id }
        }, function (error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(hq_url, error, body));
                return;
            }
            //debug(body);
        });
    });

    // deleting the last load info node
    redisClient.del(helper.last_load_info_node,
        function (set_err, set_reply) {
            if (set_err) {
                return debug(set_err);
            }
            debug("Deleted the last load info node");
            res.send('success');
        });
});

// This call contacts the HQ and returns the list of food_item issues
router.get('/food_item_issues', function (req, res, next) {
    var hq_url = process.env.HQ_URL;
    var time = req.query.time;
    var GET_FOOD_ITEM_ISSUES_URL = '/outlet/food_item_issues/';
    var outlet_id = process.env.OUTLET_ID;
    request(hq_url + GET_FOOD_ITEM_ISSUES_URL + outlet_id + '?time=' + time,
        { forever: true },
        function (error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(hq_url, error, body));
                res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                return;
            }
            res.send(JSON.parse(body));
        });
});

// This call contacts the HQ and returns the list of non_food_item issues
router.get('/non_food_item_issues', function (req, res, next) {
    var hq_url = process.env.HQ_URL;
    var time = req.query.time;
    var GET_NONFOOD_ITEM_ISSUES_URL = '/outlet/non_food_item_issues/';
    var outlet_id = process.env.OUTLET_ID;
    request(hq_url + GET_NONFOOD_ITEM_ISSUES_URL + outlet_id + '?time=' + time,
        { forever: true },
        function (error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(hq_url, error, body));
                res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                return;
            }
            res.send(JSON.parse(body));
        });
});

router.get('/food_item_list', function (req, res, next) {
    async.parallel({
        food_item_list: function (callback) {
            // Getting the food item list from HQ
            var hq_url = process.env.HQ_URL;
            var GET_FOOD_ITEM_LIST_URL = '/outlet/food_item_list/';
            var outlet_id = process.env.OUTLET_ID;
            request(hq_url + GET_FOOD_ITEM_LIST_URL + outlet_id,
                { forever: true },
                function (error, response, body) {
                    if (error || (response && response.statusCode != 200)) {
                        callback('{}: {} {}'.format(hq_url, error, body), null);
                        return;
                    }
                    callback(null, JSON.parse(body));
                });
        },
        non_food_types: function (callback) {
            //non_food_types
            var hq_url = process.env.HQ_URL;
            var GET_NON_FOOD_TYPES_URL = '/outlet/non_food_types';
            request(hq_url + GET_NON_FOOD_TYPES_URL,
                { forever: true },
                function (error, response, body) {
                    if (error || (response && response.statusCode != 200)) {
                        callback('{}: {} {}'.format(hq_url, error, body), null);
                        return;
                    }
                    callback(null, body);
                });
        }
    },
        function (err, results) {
            if (err) {
                console.error(err);
                res.status(500).send(err);
                return;
            }
            var food_item_list = results.food_item_list;
            var non_food_types = results.non_food_types;
            res.send({ "food_item_list": food_item_list, "non_food_types": non_food_types });
        });
});

router.post('/update_item_issues', function (req, res, next) {
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
        function (error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(hq_url, error, body));
                res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                return;
            }
            res.send(body);
        });
});

router.get('/get_sales_info_cashcard', function (req, res, next) {
    var hq_url = process.env.HQ_URL;
    var AMOUNT_SOLD_CASHCARD_URL = '/outlet/getcashcard_sales_daymonth/';
    var outlet_id = process.env.OUTLET_ID;
    console.log("get_sales_info_cashcard :=", hq_url + AMOUNT_SOLD_CASHCARD_URL + outlet_id);
    request(hq_url + AMOUNT_SOLD_CASHCARD_URL + outlet_id,
        { forever: true },
        function (error, response, body) {
            if (error || (response && response.statusCode != 200)) {
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
router.get('/get_sales_info', function (req, res, next) {
    // Doing an async parallel call to get the different infos
    async.parallel({
        amount_sold_cash: function (callback) {
            // This is the amount given to them at the start of the month
            var AMOUNT_SOLD_CASH_URL = '/outlet/amount_for_month/' + process.env.OUTLET_ID;
            console.log("amount_sold_cash url:-", process.env.HQ_URL + AMOUNT_SOLD_CASH_URL);
            request(process.env.HQ_URL + AMOUNT_SOLD_CASH_URL,
                { forever: true },
                function (error, response, body) {
                    if (error || (response && response.statusCode != 200)) {
                        callback('{}: {} {}'.format(process.env.HQ_URL, error, body), null);
                        return;
                    }
                    if (!body) {
                        callback(null, { "sum": 0 });
                    } else {
                        callback(null, JSON.parse(body));
                    }
                });
        },
        amount_sold_cashcard: function (callback) {
            // This is the amount given to them at the start of the month
            var AMOUNT_SOLD_CASHCARD_URL = '/outlet/getcashcard_sales_daymonth/' + process.env.OUTLET_ID;
            console.log("AMOUNT_SOLD_CASHCARD_URL :-", AMOUNT_SOLD_CASHCARD_URL);
            request(process.env.HQ_URL + AMOUNT_SOLD_CASHCARD_URL,
                { forever: true },
                function (error, response, body) {
                    if (error || (response && response.statusCode != 200)) {
                        callback('{}: {} {}'.format(process.env.HQ_URL, error, body), null);
                        return;
                    }
                    if (!body) {
                        callback(null, { "sum": 0 });
                    } else {
                        callback(null, JSON.parse(body));
                    }
                });
        },
        amount_sold_pettycash: function (callback) {
            // This is the amount sold in petty cash for that month
            var AMOUNT_SOLD_PETTY_CASH_URL = '/outlet/amount_sold_pettycash/' + process.env.OUTLET_ID;
            request(process.env.HQ_URL + AMOUNT_SOLD_PETTY_CASH_URL,
                { forever: true },
                function (error, response, body) {
                    if (error || (response && response.statusCode != 200)) {
                        callback('{}: {} {}'.format(process.env.HQ_URL, error, body), null);
                        return;
                    }
                    if (!body) {
                        callback(null, { "sum": 0 });
                    } else {
                        callback(null, JSON.parse(body));
                    }
                });
        }
    },
        function (err, results) {
            if (err) {
                console.error(err);
                res.status(500).send(err);
                return;
            }
            res.send(results);
        });
});

router.get('/get_live_pos', function (req, res, next) {
    var hq_url = process.env.HQ_URL;
    var UPDATE_ITEM_ISSUES_URL = '/outlet/get_live_pos/';
    var outlet_id = process.env.OUTLET_ID;
    request(hq_url + UPDATE_ITEM_ISSUES_URL + outlet_id,
        { forever: true },
        function (error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(hq_url, error, body));
                res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                return;
            }
            res.send(body);
        });
});

// Handler to keep track of the petty cash expenditure by the outlet staff
router.post('/petty_expenditure', function (req, res, next) {
    var hq_url = process.env.HQ_URL;
    var PETTY_EXPENDITURE_URL = '/outlet/petty_expenditure/';
    var outlet_id = process.env.OUTLET_ID;
    requestretry({
        url: hq_url + PETTY_EXPENDITURE_URL + outlet_id,
        forever: true,
        method: "POST",
        json: { "data": req.body.data }
    },
        function (error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(hq_url, error, body));
                res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                return;
            }
            res.send(body);
        });
});

// Handler that returns the list of names to the outlet dash
router.get('/staff_roster', function (req, res, next) {
    var STAFF_ROSTER_URL = '/outlet/staff_roster/' + process.env.OUTLET_ID;
    // requesting the HQ to get the staff list
    request(process.env.HQ_URL + STAFF_ROSTER_URL,
        { forever: true },
        function (error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(process.env.HQ_URL, error, body));
                res.status(500).send('{}: {} {}'.format(process.env.HQ_URL, error, body));
                return;
            }
            res.send(JSON.parse(body));
        });
});

router.post('/staff_roster', function (req, res, next) {
    var STAFF_ROSTER_URL = '/outlet/staff_roster/' + process.env.OUTLET_ID;
    requestretry({
        url: process.env.HQ_URL + STAFF_ROSTER_URL,
        method: "POST",
        forever: true,
        json: { "data": req.body.data }
    },
        function (error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(process.env.HQ_URL, error, body));
                res.status(500).send('{}: {} {}'.format(process.env.HQ_URL, error, body));
                return;
            }
            res.send(body);
        });
});

// This handler passes the stop order command to the order app
router.post('/stop_orders', function (req, res, next) {
    redisClient.set(helper.stop_orders_flag,
        true,
        function (set_err, set_reply) {
            if (set_err) {
                console.error('error while inserting in redis- {}'.format(set_stock_count_err));
                return;
            }
            io.emit('stop_orders', true);
            res.send('success');
        });
});

// This handler passes the stop order command to the order app
router.post('/resume_orders', function (req, res, next) {
    redisClient.set(helper.stop_orders_flag,
        false,
        function (set_err, set_reply) {
            if (set_err) {
                console.error('error while inserting in redis- {}'.format(set_stock_count_err));
                return;
            }
            io.emit('stop_orders', false);
            res.send('success');
        });
});

// Handler that returns the breakdown of the petty cash expenditure
// after getting it from the HQ
router.get('/petty_cash_breakdown', function (req, res, next) {
    var PETTY_CASH_URL = '/outlet/petty_cash_breakdown/' + process.env.OUTLET_ID;
    // requesting the HQ to get the staff list
    requestretry(process.env.HQ_URL + PETTY_CASH_URL,
        function (error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(process.env.HQ_URL, error, body));
                res.status(500).send('{}: {} {}'.format(process.env.HQ_URL, error, body));
                return;
            }
            res.send(JSON.parse(body));
        });
});

router.post('/expire_item_batch/:item_id', function (req, res, next) {
    // get the stock from redis
    redisClient.get(helper.stock_count_node, function (redis_err, redis_res) {
        if (redis_err) {
            console.error(redis_err);
            res.status(500).send(redis_err);
            return;
        }
        var item_id = req.params.item_id;
        var parsed_response = JSON.parse(redis_res);
        // if stock[item_id] is present, expire all batches of it
        if (parsed_response.hasOwnProperty(item_id)) {
            var item_details = parsed_response[item_id]["item_details"];
            for (var i = 0; i < item_details.length; i++) {
                item_details[i]["expired"] = true;
                // Pushing the data to redis to store the list of expired slots
                var slots = item_details[i]["slot_ids"];
                io.emit('expiry_slots', slots);
                // Adding the list of expired slots to redis
                redisClient.rpush(helper.expiry_slots_node, JSON.stringify(slots),
                    function (lp_err, lp_reply) {
                        if (lp_err) {
                            console.error(err);
                            return;
                        }
                    });
            }
            // push to redis
            redisClient.set(helper.stock_count_node,
                JSON.stringify(parsed_response),
                function (set_stock_count_err, set_stock_count_reply) {
                    if (set_stock_count_err) {
                        console.error('error while inserting in redis- {}'.format(set_stock_count_err));
                    }
                });
            // get the lock counts
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
                // Sending the data to the socket.io channel
                io.emit(helper.stock_count_node, parsed_response);
                io.sockets.emit(helper.stock_count_node, parsed_response);

                // Put the data in firebase
                var rootref = new firebase(process.env.FIREBASE_CONN);
                var stock_count_node = rootref.child('{}/{}'.format(process.env.OUTLET_ID, helper.stock_count_node));
                stock_count_node.set(parsed_response);
                return res.send('success');
            });
        } else {
            return res.send('success');
        }
    });
});

// This will return the no. of unscanned slots for the outlet dash
router.get('/get_reconcile_stock_slots', function (req, res, next) {
    var slot_list = [];
    var stock_count = [];
    var scanned_reconcile_slotids = [];
    var unscanned_slots = [];
    var empty_slots = [];
    var item_name_slot_wise = {};
    var item_id_slot_wise = {};
    item_id_slot_wise.items = [];

    redisClient.get(helper.plc_config_node, function (err, reply) {
        if (err) {
            debug('error while retreiving from redis- {}'.format(err));
            res.status(500).send('redis down');
            return;
        }
        if (!reply) {
            return res.status(500).send("No plc config found");
        }
        var plc_config = JSON.parse(reply);
        var dispenser_slot_count = plc_config["dispenser_slot_count"];

        for (var i = 1; i <= dispenser_slot_count; i++) {
            slot_list.push(i);
        }
        // // Get the unscanned slots and last load info first
        redisClient.get(helper.stock_count_node,
            function (err, reply_stock_count_node) {
                if (err) {
                    console.error(err);
                    res.status(500).send(err);
                    return;
                }

                stock_count = JSON.parse(reply_stock_count_node);

                var item_data = [];
                var slot_ids = [];
                for (var key in stock_count) {
                    // ignore if the item is in test mode
                    if (isTestModeItem(Number(key))) {
                        continue;
                    }

                    // If there are no items, just continue
                    // var locked_count = reconcile_stock_count[key].locked_count;
                    if (stock_count[key]["item_details"] == undefined) {
                        continue;
                    }

                    if (stock_count) {
                        
                        stock_count[key]["item_details"].map(function (item) {

                            if (item.slot_ids != undefined && item.slot_ids != null) {
                                if (item.slot_ids.length > 0) {
                                    
                                    // Normal Code - Start (Replaced for Pre-Printed)

                                    scanned_reconcile_slotids = scanned_reconcile_slotids.concat(item.slot_ids);
                                    var slot_items = { "slot_ids": item.slot_ids, "item_id": key };
                                    item_id_slot_wise.items.push(slot_items);

                                    // Normal Code - End (Replaced for Pre-Printed)

                                    // Pre-Printed Code - Start

                                    //for (var i = 0; i < item.slot_ids.length; i++) {
									//	if(item.slot_ids[i].slot_id != null && item.slot_ids[i].slot_id != undefined)
									//	{
                                    //    slot_ids.push(item.slot_ids[i].slot_id[0])
									//	}
                                    //}
                                    //scanned_reconcile_slotids = slot_ids;
                                    //var slot_items = { "slot_ids": slot_ids, "item_id": key };
                                    //item_id_slot_wise.items.push(slot_items);

                                    // Pre-Printed Code - End
                                }
                                // console.log("item_id_slot_wise ***************#################" + item_id_slot_wise.items.length);
                            }
                        });
                    }

                }

                empty_slots = slot_list.diff(scanned_reconcile_slotids);

                var scanned_min_value = Math.min.apply(Math, scanned_reconcile_slotids);
                var scanned_max_value = Math.max.apply(Math, scanned_reconcile_slotids);


                console.log("scanned_slots_with_itemnames: " + JSON.stringify(item_id_slot_wise));
                // console.log("empty_slots: " + empty_slots);
                // console.log("unscanned_slots: " + unscanned_slots);

                res.send({
                    "scanned_min_value": scanned_min_value,
                    "scanned_max_value": scanned_max_value,
                    "scanned_slots": scanned_reconcile_slotids,
                    "empty_slots": empty_slots,
                    "dispenser_slot_count": dispenser_slot_count,
                    "item_id_slot_wise": item_id_slot_wise
                });
            });
    });

});

router.get('/get_reconcile_stock_count_data', function (req, res, next) {
    var reconcile_stock_count = [];
    redisClient.get(helper.reconcile_stock_count_node,
        function (err, reply_reconcile_stock_count) {
            if (err) {
                console.error(err);
                res.status(500).send(err);
                return;
            }

            reconcile_stock_count = JSON.parse(reply_reconcile_stock_count);


            console.log("reconcile_stock_count: " + JSON.stringify(reconcile_stock_count));
            res.send({ "reconcile_stock_count": reconcile_stock_count });
        });
});

router.get('/get_po_details', function (req, res, next) {

    try {        
        var reconcile_stock_count = [];
        redisClient.get(helper.reconcile_stock_count_node,
            function (err, reply_reconcile_stock_count) {
                if (err) {
                    console.error("outlet_app.js :: get_po_details " + err);
                    res.status(500).send(err);
                    return;
                }

                reconcile_stock_count = JSON.parse(reply_reconcile_stock_count);
                console.log("reconcile_stock_count: " + JSON.stringify(reconcile_stock_count));
                
                redisClient.get(helper.po_details_node, function (err, reply_po_details) {
                    if (err)
                    {
                        debug('error while retreiving from redis- {}'.format(err));
                        return;
                    }

                    res.send({ "json_result": reply_po_details, "reconcile_stock_count": reconcile_stock_count});
                });
            });
    }
    catch (e) {
        console.log("outlet_app.js :: get_po_details " + e);
    }
});

router.post('/save_reconcile_data', function (req, res, next) {
        
    var reconcile_items = req.body.reconcile_items;

    console.log("outlet_app.js :: save_reconcile_data function called reconcile_items:: " + JSON.stringify(reconcile_items));

    if (reconcile_items.length > 0)
    {
        var hq_url = process.env.HQ_URL;
        var save_reconcile_data_url = hq_url + '/outlet/save_reconcile_data/';

        console.log("save_reconcile_data_url: " + save_reconcile_data_url);
        console.log("reconcile_items: " + JSON.stringify(reconcile_items));

        request({
            url: save_reconcile_data_url,
            method: "POST",
            json: { "reconcile_items": reconcile_items }
        }, function (error, response) {
            if (error || (response && response.statusCode != 200))
            {
                console.error('{}: {} {}'.format(save_reconcile_data_url, error, ""));
                res.status(500).send('{}: {} {}'.format(save_reconcile_data_url, error, ""));
                return;
            }
            //debug(body);
        });
    }

    res.send("success");
});

router.get('/check_reconcile_data', function (req, res, next) {
    console.log("outlet_app :: check_reconcile_data started: ");
    var hq_url = process.env.HQ_URL;
    var check_reconcile_data_url = hq_url + '/outlet/check_reconcile_data/' + process.env.OUTLET_ID;

    console.log("outlet_app :: check_reconcile_data_url: " + check_reconcile_data_url);

    requestretry({
        url: check_reconcile_data_url,
        forever: true,
        method: "GET",
    }, function (error, response, result) {
        try {
            if (error || (response && response.statusCode != 200)) {
                console.log("outlet_app.js :: " + '{}: {} {}'.format(hq_url + check_reconcile_data_url, error, result));
                return;
            }

            var json_result = JSON.parse(result);
            //var result = { json_result };
            res.send({ "json_result": json_result });

        } catch (e) {
            console.log("outlet_app.js :: check_reconcile_data " + e);
        }
    });

});

// This is to update the inventory after removing the expired items
router.post('/delete_reconcile_stock_count', function (req, res, next) {
    // clear out the delete_reconcile_stock_count queue from redis
    console.log("delete_reconcile_stock_count function called");
    redisClient.del(helper.reconcile_stock_count_node, function (err, reply) {
        if (err) {
            console.error(err);
            res.status(500).send("error while deleting reconcile_stock_count_node slots in redis- {}".format(err));
            return;
        }
        debug('reconcile_stock_count_node in redis');
    });

    redisClient.del("Bills");
    res.send("success");
});

router.post('/update_reconcile_stock_count', function (req, res, nest) {
    var reconcile_stock_count;

    redisClient.get(helper.reconcile_stock_count_node,
        function (err, reply_reconcile_stock_count) {
            if (err) {
                console.error(err);
                res.status(500).send(err);
                return;
            }

            reconcile_stock_count = JSON.parse(reply_reconcile_stock_count);
            console.log("reconcile_stock_count: " + JSON.stringify(reconcile_stock_count));

            if (reconcile_stock_count != null)
            {
                for (i = 0; i < reconcile_stock_count.length; i++)
                {
                    console.log("item_barcode: " + reconcile_stock_count[i].barcode);
                    var current_barcode = reconcile_stock_count[i].barcode;
                    var barcode_date = current_barcode.substring(16, 20) + "-" + current_barcode.substring(14, 16) + "-" + current_barcode.substring(12, 14);
                    // new Date("2016-12-03") > new Date()

                    // Donot update as "expired" for furture item barcodes 
                    if (new Date(barcode_date) < new Date())
                    {
                       // reconcile_stock_count[i].count = 0;
                        // Removed expiry items from reconcile queue
                        reconcile_stock_count.splice(i, 1);
                        i--;
                    }
                }
            }

            redisClient.set(helper.reconcile_stock_count_node,
                JSON.stringify(reconcile_stock_count),
                function (set_err, set_reply) {
                    if (set_err) {
                        debug(set_err);
                    }
                });

            console.log("Final Redis reconcile_stock_count:: " + JSON.stringify(reconcile_stock_count));
        });

        res.send("success");
});

router.post('/update_reconcile_stock_count_automatic', function (req, res, nest) {
    console.log("update_reconcile_stock_count_automatic: " + JSON.stringify(req.body));
    var reconcile_items = req.body.reconcile_items;
    var reconcile_stock_count;

    redisClient.get(helper.reconcile_stock_count_node,
        function (err, reply_reconcile_stock_count) {
            if (err)
            {
                console.error(err);
                res.status(500).send(err);
                return;
            }

            reconcile_stock_count = JSON.parse(reply_reconcile_stock_count);
            console.log("reconcile_stock_count: " + JSON.stringify(reconcile_stock_count));

            if (reconcile_items != null)
            {
                for (i = 0; i < reconcile_items.length; i++)
                {
                    console.log("update_reconcile_stock_count_automatic po_id: " + reconcile_items[i].po_id);
                    var reconcile_po_id = reconcile_items[i].po_id;
                    var reconcile_item_id = reconcile_items[i].food_item_id;

                   // var reconcile_stock_item_data = _.where(reconcile_stock_count, { 'po_id': reconcile_po_id });
                    // var reconcile_stock_count_index = reconcile_stock_count.indexOf();
                    for (item = 0; item < reconcile_stock_count.length; item++)
                    {
                        // var barcode_date = current_barcode.substring(16, 20) + "-" + current_barcode.substring(14, 16) + "-" + current_barcode.substring(12, 14);
                        var reconcile_stock_count_po_id = reconcile_stock_count[item].po_id;
                        var reconcile_stock_count_item_id = reconcile_stock_count[item].item_id;

                        if (Number(reconcile_stock_count_po_id) == Number(reconcile_po_id) && Number(reconcile_item_id) == reconcile_stock_count_item_id)
                        {
                            // reconcile_stock_count[item].count = 0;
                            // Removed expiry items from reconcile queue
                            reconcile_stock_count.splice(item, 1);
                            item--;
                        }
                    }
                }
            }

            redisClient.set(helper.reconcile_stock_count_node,
                JSON.stringify(reconcile_stock_count),
                function (set_err, set_reply) {
                    if (set_err)
                    {
                        debug(set_err);
                    }
                });

            console.log("Final Redis reconcile_stock_count:: " + JSON.stringify(reconcile_stock_count));
        });

        res.send("success");
});

router.get('/reconcile_remarks', function (req, res, next) {

    redisClient.get(helper.reconcile_remarks_node, function (err, reply_reconcile_remarks) {
        if (err)
        {
            debug('error while retreiving from redis- {}'.format(err));
            return;
        }
        
        res.send({ "reconcile_remarks": reply_reconcile_remarks });
    });
});


router.get('/outlet_session_timings', function (req, res, next) {

    redisClient.get(helper.session_time_node, function (err, outlet_session_timings) {
        if (err)
{
            debug('error while retreiving from redis- {}'.format(err));
            return;
        }
        res.send(JSON.parse(outlet_session_timings));        
    });
});

router.get('/get_data_matrix', function (req, res, next) {
    console.log('get_data_matrix route function called batch id is ' + req.query.batch_id);
    var batch_id = req.query.batch_id;
    if (batch_id != null && batch_id != undefined) {
        get_matrix_code(batch_id);

    }
    res.send('Success');
});

router.post('/store_po_details_in_redis', function (req, res, next) {
    // this will contact the HQ and update the final status of the latest po
    // and batch and mark the barcodes as 'loading_issue'
    var po_details = req.body.po_details;
    
    redisClient.set(helper.po_details_node,
                       JSON.stringify(po_details),
                       function (store_po_details_err, store_po_details_reply) {
                           if (store_po_details_err)
                           {
                               console.error('error while inserting in redis- {}'.format(store_po_details_err));
                           }

                       });

                       res.send("success");
});

router.post('/update_po_master_list_received_time', function (req, res, next) {
    var reconcile_items = req.body;
    if (reconcile_items.length > 0)
    {
        var hq_url = process.env.HQ_URL;
        var update_po_master_list_received_time_url = hq_url + '/outlet/update_po_master_list_received_time/';

        console.log("update_po_master_list_received_time: " + update_po_master_list_received_time_url);
        // console.log("reconcile_items: " + JSON.stringify(reconcile_items));

        request({
            url: update_po_master_list_received_time_url,
            method: "POST",
            json: { "reconcile_items": reconcile_items }
        }, function (error, response) {
            if (error || (response && response.statusCode != 200))
            {
                console.error('{}: {} {}'.format(update_po_master_list_received_time_url, error, ""));
                res.status(500).send('{}: {} {}'.format(update_po_master_list_received_time_url, error, ""));
                return;
            }            
        });

        res.send("success");
    }
});

router.post('/send_restautant_excess_mail', function (req, res, next) {
    var restaurant_excess_mails = req.body.restaurant_excess_mails;
    console.log("restaurant_excess_mails ********************************* restaurant_excess_mails: " + JSON.stringify(restaurant_excess_mails));
    
    if (restaurant_excess_mails != null)
    {
        var transporter_mail = nodemailer.createTransport({
            host: "smtp.gmail.com", // hostname
            port: 465,
            secure: true,
            auth: {
                user: 'no-reply@atchayam.in',
                pass: 'Atchayam123'
            }
        }, {
            // default values for sendMail method
            from: 'no-reply@atchayam.in',
            headers: {
                'My-Awesome-Header': '123'
            }
        });

        for (var mail_count = 0; mail_count < restaurant_excess_mails.length;mail_count++)
        {
            console.log("****Restaurant Email Id***" + restaurant_excess_mails[mail_count].restaurant_mail_id);

            // Send excess items mail to restaurant

            var excess_mail = {
                from: 'no-reply@atchayam.in', // sender address
                to: restaurant_excess_mails[mail_count].restaurant_mail_id, // list of receivers
                subject: 'Excess Items Against PO Number: ' + restaurant_excess_mails[mail_count].po_id + " to " + restaurant_excess_mails[mail_count].outlet_name, // Subject line
                text: restaurant_excess_mails[mail_count].excess_mail_content,
                html: restaurant_excess_mails[mail_count].excess_mail_content
            }

            transporter_mail.sendMail(excess_mail, function (error, response) {
                if (error)
                {
                    console.log(error);
                }

                console.log("excess_mail message sent: " + response.message);
            });
        }

        res.send("success");
    }
});

// Send Undelivered PO items details send mail to restaurant
router.post('/send_pending_reconcile_po_mail', function (req, res, next) {
    console.log("******** #################################### send_pending_reconcile_po_mail function called");

    var item_details_content = req.body.mail_content;
    var outlet_id = req.body.outlet_id;
    var outlet_name = req.body.outlet_name;
    var city = req.body.city;
    var store_managers_mail_id = req.body.store_managers_mail_id;
    var mail_content = "";

    if (item_details_content != null)
    {
        // mail content for pending reconcile po items    
        mail_content = '<html><body>';
        mail_content += '<div>';
        mail_content += 'Hi,<br/> Please find the following details of pending reconcile items from <b>' + outlet_name + ' </b>outlet. <br/><br/><br/><table class="reconsile" border="1" cellpadding="0" cellspacing="0" width="75%">';
        mail_content += '<tr style="background-color: #fbb713;color: #4a4b4a;font-weight: bold;text-align:center;"><th style=\"padding: 5px;width:50px;\">PO Id</th>';
        mail_content += '<th style=\"padding: 5px;width:150px;\">Restaurant Name</th><th  style=\"padding: 5px;width:150px;\">Session Name</th>';
        mail_content += '<th  style=\"padding: 5px;width:150px;\">Item Name</th><th style=\"padding: 5px;width:150px;\">PO Qty</th>';
        mail_content += '<th style=\"padding: 5px;width:150px;\">Scanned Qty</th><th style=\"padding: 5px;width:150px;\">Undelivered Qty</th></tr>';
        mail_content += item_details_content;
        mail_content += '</table><br/><br/>';
        mail_content += '<div><br/>Thanks,<br/>Frshly</div></body></html>';
        console.log("******** send_pending_reconcile_items :: mail_content :: " + mail_content);


        var transporter_mail = nodemailer.createTransport({
            host: "smtp.gmail.com", // hostname
            port: 465,
            secure: true,
            auth: {
                user: 'no-reply@atchayam.in',
                pass: 'Atchayam123'
            }
        }, {
            // default values for sendMail method
            from: 'no-reply@atchayam.in',
            headers: {
                'My-Awesome-Header': '123'
            }
        });

        // Send undelivered items to restaurant
        // TODO - check for semicolon seperated email id's
        if (store_managers_mail_id)
        {
            var date1 = moment.utc().format('YYYY-MM-DD HH:mm:ss');
            var localTime = moment.utc(date1).toDate();

            var mail = {
                from: 'no-reply@atchayam.in', // sender address
                to: store_managers_mail_id, // list of receivers
                subject: 'Pending Reconcile Items in ' + outlet_name + ' on ' + moment(localTime).format('YYYY-MM-DD HH:mm:ss'), // Subject line
                text: mail_content,
                html: mail_content
            }

            transporter_mail.sendMail(mail, function (error, response) {
                if (error)
                {
                    console.log(error);
                } else
                {
                    console.log("message sent: " + response.message);
                }
            });
        }

        res.send("success");
    }
});

router.get('/get_outlet_config_redis', function (req, res, next) {
    var outlet_config = [];
    redisClient.get(helper.outlet_config_node,
        function (err, reply_outlet_config) {
            if (err)
            {
                console.error(err);
                res.status(500).send(err);
                return;
            }

            outlet_config = JSON.parse(reply_outlet_config);
            console.log("outlet_config: " + JSON.stringify(outlet_config));
            res.send(outlet_config);
        });
});

function isTestModeItem(item_code) {
    if (item_code >= 9000 && item_code <= 9003) {
        return true;
    } else {
        return false;
    }

}

function get_matrix_code(batch_id) {
    console.log("************Batch_id received in staff_roster method " + batch_id);
    var GET_DATA_MATRIX_URL = '/food_vendor/get_data_matrix/' + batch_id;
    // requesting the HQ to get the staff list
    request(process.env.HQ_URL + GET_DATA_MATRIX_URL,
        { forever: true },
        function (error, response, body) {
            if (error || (response && response.statusCode != 200)) {
                console.error('{}: {} {}'.format(process.env.HQ_URL, error, body));
                return;
            }
            console.log("************data received from get_data_matrix (HQ) in staff_roster method(outlet) " + body);


            redisClient.get(helper.barcode_comparision, function (err, reply) {
                if (err) {
                    debug('error while retreiving from redis- {}'.format(err));
                    return;
                }

                var config = reply != null ? JSON.parse(reply) : null;
                if (config != null) {
                    console.log("*************************barcode_comparision length " + config.length);
                    if (config.length > 0) {
                        var parsed_data = JSON.parse(body);
                        _.each(parsed_data, function (obj) {
                            config.push(obj);
                        });
                        console.log("*************************inside true condition final result" + JSON.stringify(config));
                        redisClient.set(helper.barcode_comparision, JSON.stringify(config),
                            function (lp_err, lp_reply) {
                                if (lp_err) {
                                    console.log("***************err while update rpush barcode_comparision" + lp_err);
                                    return;
                                }
                            });
                    } else {
                        console.log("*************************inside false condition");
                        redisClient.set(helper.barcode_comparision,
                            body,
                            function (err, rply) {
                                if (err) {
                                    console.log('*******************error while inserting in redis- {}'.format(err));
                                }

                            });
                    }
                } else {
                    console.log("*************************inside config null condition");
                    redisClient.set(helper.barcode_comparision,
                        body,
                        function (err, rply) {
                            if (err) {
                                console.log('*******************error while inserting in redis- {}'.format(err));
                            }

                        });
                }
            });
        });
};


module.exports = router;
