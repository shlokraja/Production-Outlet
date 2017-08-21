//'use strict';
var express = require('express');
var debug = require('debug')('mobileapp:server');
var http = require('http');
var request = require('request');
var helper = require('../routes/helper');
var bodyParser = require('body-parser');
var firebase = require('firebase');
var redis = require('redis');
var lockredis = require('lockredis');
var randomstring = require('randomstring');
var isForcePrintBill = require('../misc/isForcePrintBill');
var startPrint = require('../misc/printermobile.js').startPrint;
var async = require('async');
var fs = require('fs');
var format = require('string-format');
var requestretry = require('requestretry');
var general = require('./general');
var server_ip_address = '';
var server_port = '';

var logfile = require('fs');
// This postgres dependency
var pg = require('pg');
format.extend(String.prototype);
var redisClient = redis.createClient({ connect_timeout: 2000, retry_strategy: 5000 });

redisClient.on('error', function (msg) {
    console.error(msg);
});


// // For Local - Client
//server_ip_address = "103.21.76.186";
//server_ip_address = "183.82.251.86";
//var firebase_connection = "https://atchayam-dev.firebaseio.com";
//var firebase_queue = "https://atchayam-dashboard.firebaseio.com/queue";
//var outlet_id = 6;
////var hq_url = "http://103.21.76.186:9090";
//var hq_url = "http://183.82.251.86:9090";
//server_port = '9099';
//var router = express();


//// // For Local - Shlok
//server_ip_address = "192.168.0.141";
//var firebase_connection = "https://atcorderstage.firebaseio.com";
//var firebase_queue = "https://atcpaymentstage.firebaseio.com/queue";
//var outlet_id = 9;
//var hq_url = "http://192.168.0.141:9087";
//server_port = '9500';
//var router = express();

//// // For Live - Atchayam-gofrugal
server_ip_address = "atchayam.gofrugal.com";
var firebase_connection = "https://torrid-fire-8553.firebaseio.com";
var firebase_queue = "https://atp-chat.firebaseio.com/queue";
var outlet_id = 15;
var hq_url = "http://atchayam.gofrugal.com:8008";
server_port = '9099';
var router = express();

/// // For Live - Atchayam-gofrugal - Test server
//server_ip_address = "115.114.95.49";
//var firebase_connection = "https://atctestoutlet2.firebaseio.com";
//var firebase_queue = "https://atctesthq2.firebaseio.com/queue";
//var outlet_id = 15;
//var hq_url = "http://115.114.95.49:8008";
//server_port = '9099';
//var router = express();

// For Singapore
//server_ip_address = "192.168.1.97";
//var firebase_connection = "https://atchayam-outlet.firebaseio.com";
//var firebase_queue = "https://atp-sg-chat.firebaseio.com/queue";
//var outlet_id = 16;
//var hq_url = "http://192.168.1.97:9090";
//server_port = '9099';
//var router = express();


// For muthu systsem
//server_ip_address = "1.23.70.170";
//var firebase_connection = "https://atchayam-outlet.firebaseio.com";
//var firebase_queue = "https://atp-sg-chat.firebaseio.com/queue";
//var outlet_id = 11;
//var hq_url = "http://1.23.70.170:9090";
//server_port = '9099';
//var router = express();


// // For Live - Read from .bootstraprc file
//var firebase_connection = process.env.FIREBASE_CONN;
//var firebase_queue = process.env.FIREBASE_QUEUE;
//var outlet_id = process.env.OUTLET_ID;
//var hq_url = process.env.HQ_URL;
//var listen_port = process.env.LISTEN_PORT;

//if (hq_url)
//{
//    server_ip_address = hq_url.split('//')[1].split(':')[0];
//}

//server_port = process.env.SERVER_PORT;
//var router = express();


var rootref = new firebase(firebase_connection);
var ref = new firebase(firebase_queue);

var success_status = "SUCCESS";
var fail_status = "FAIL";
var no_data_found = "NO DATA FOUND";
var pending_status = "Pending";
var dispensing_status = "Dispensing";

var output = '';
var message_text = '';
var status_text = '';
var context = '';

// to create a server for temporary use
// to hit this server use http://localhost:9098
// For local - client
//router.listen(9502, function () {
//    general.genericError("mobileapp.js :: outlets: " +'Example routermobile listening on port 9502!');
//});

//// // For local - shlok
//router.listen(9097, function () {
//    general.genericError("mobileapp.js :: listen: " + 'Example routermobile listening on port 9097!');
//});

// For Live - Atchayam-gofrugal
router.listen(9097, function () {
    general.genericError("mobileapp.js :: listen: " + 'Example routermobile listening on port 9097!');
});

// For Live - Atchayam-gofrugal - Test server
//router.listen(9097, function () {
//    general.genericError("mobileapp.js :: listen: " + 'Example routermobile listening on port 9097!');
//});

// For singapore
//router.listen(9097, function () {
//    general.genericError("mobileapp.js :: outlets: " +"mobileapp.js :: outlets: " +'Example routermobile listening on port 9097!');
//});

// For Muthu
//router.listen(9097, function () {
//    general.genericError("mobileapp.js :: outlets: " +"mobileapp.js :: outlets: " +'Example routermobile listening on port 9097!');
//});


// // For Live - Read from .bootstraprc file
//router.listen(listen_port, function () {
//    general.genericError("mobileapp.js :: listen: " + 'Example routermobile listening on port ' + listen_port + '!');
//});

var handleError = function (msg) {
    general.genericError("mobileapp.js :: " + msg);
};

var socket = require('socket.io-client')('http://' + server_ip_address + ':' + server_port, {
    forceNew: true,
    'heartbeat interval': 5,
    'heartbeat timeout': 10
});

//// Tell the server about it
var username = outlet_id;
socket.emit("add-user", { "username": username });

var result = TestPrivateMessage();

socket.emit("private-message", {
    "username": result.username,
    "content": result.content
});

function TestPrivateMessage() {
    var result = { "username": outlet_id, "content": "Test content message" };
    return result;
}

//// Whenever we receieve a message, append it to the <ul>
socket.on("add-message", function (data) {
    try
    {
        general.genericError("mobileapp.js :: add-message: " + "Userid: " + data.username + " add-message socket receive");
        general.genericError("mobileapp.js :: add-message: " + data.content);
    } catch (e)
    {
        general.genericError("mobileapp.js :: add-message: " + e);
    }
});

socket.on("send-lockitem-data-to-client", function (data, lockitem_client) {
    try
    {
        general.genericError("mobileapp.js :: send-lockitem-data-to-client: " + "receive-lockitem-content");
        //var result_data = ReceiveLockRequest(data);
        //if (result_data)
        //{
        //    lockitem_client({ result_data });
        //}

        var req = data;

        try
        {
            general.genericError("mobileapp.js :: send-lockitem-data-to-client: " + "Receive Lock Request");

            var items = req.items;
            var outletid = req.outletid;
            var mobileno = req.mobileno;
            var counter_code = req.counter_code;
            var referenceno = req.referenceno;
            var itemcount = 0, itemlockcount = 0, lockedcountredis = 0, itemcountplaced = 0;
            var receive_lock_result;

            // GetRequiredItems(items, counter_code);
            if (items != null)
            {
                // Read _locked_count for items from Redis
                var item_id_list = [];
                for (itemlockcount = 0; itemlockcount <= items.length - 1; itemlockcount++)
                {
                    // itemcountplaced += items[itemlockcount].count;
                    item_id_list.push(items[itemlockcount].item_id + '_locked_count');
                }

                // Getting the stock count
                // Getting all the required items first with async.parallel.
                // And then running the main logic in the callback
                async.parallel({
                    stock_count: function (callback) {
                        try
                        {
                            // Getting the stock count here
                            redisClient.get(helper.stock_count_node, function (err, reply) {
                                if (err)
                                {
                                    callback("error while retreiving from redis- {}".format(err), null);
                                    return;
                                }
                                callback(null, reply);
                            });
                        } catch (e)
                        {
                            general.genericError("mobileapp.js :: send-lockitem-data-to-client: " + e);
                        }
                    }
                },
            function (err, results) {
                try
                {
                    if (err)
                    {
                        general.genericError("mobileapp.js :: send-lockitem-data-to-client: " + err);
                        done();
                        return;
                    }

                    stock_count = JSON.parse(results.stock_count);
                    var itemcountinstock = 0;
                    var availableitems = 0;
                    var isValidItems = true;                    

                    redisClient.mget(item_id_list, function (l_err, l_reply) {
                        for (var item in items)
                        {
                            var item_id = items[item]["item_id"];
                            itemcountplaced = items[item]["count"];

                            itemcountinstock = parseInt(GetItemsCount(item_id, stock_count[item_id]["item_details"]));

                            try
                            {
                                if (l_reply[item_id_list.indexOf(item_id + '_locked_count')])
                                {
                                    lockedcountredis = parseInt(l_reply[item_id_list.indexOf(item_id + '_locked_count')]);
                                }
                            } catch (e)
                            {
                                general.genericError("mobileapp.js :: send-lockitem-data-to-client: get _locked_count " + e);
                            }

                            availableitems = itemcountinstock - lockedcountredis;

                            if (itemcountplaced > availableitems)
                            {
                                items[item]["count"] = availableitems;
                                isValidItems = false;
                                // break;
                            }
                        }

                        // itemcountplaced <= availableitems
                        if (isValidItems)
                        {
                            for (itemcount = 0; itemcount <= items.length - 1; itemcount++)
                            {
                                LockItem(items[itemcount].item_id, "increase", items[itemcount].count);
                            }

                            // socket.emit("lock-item-status", { "status": success_status, "outletid": outletid, "hqclient": "HQ-user", "mobileno": mobileno, "items": items, "referenceno": referenceno });
                            receive_lock_result = { "status": success_status, "outletid": outletid, "hqclient": "HQ-user", "mobileno": mobileno, "availableitems": items, "referenceno": referenceno }
                            // return receive_lock_result;
                            lockitem_client({ receive_lock_result });
                        }
                        else
                        {
                            // socket.emit("lock-item-status", { "status": fail_status, "outletid": outletid, "hqclient": "HQ-user", "mobileno": mobileno, "items": items, "referenceno": referenceno });
                            receive_lock_result = { "status": fail_status, "outletid": outletid, "hqclient": "HQ-user", "mobileno": mobileno, "availableitems": items, "referenceno": referenceno };
                            lockitem_client({ receive_lock_result });
                        }
                    });
                }
                catch (e)
                {
                    receive_lock_result = { "status": fail_status, "outletid": outletid, "hqclient": "HQ-user", "mobileno": mobileno, "availableitems": items, "referenceno": referenceno };
                    lockitem_client({ receive_lock_result });
                }
            });
            }
            else
            {
                // socket.emit("lock-item-status", { "status": fail_status, "outletid": outletid, "hqclient": "HQ-user", "mobileno": mobileno, "items": items, "referenceno": referenceno });
                receive_lock_result = { "status": fail_status, "outletid": outletid, "hqclient": "HQ-user", "mobileno": mobileno, "availableitems": items, "referenceno": referenceno };
                lockitem_client({ receive_lock_result });
            }
        } catch (e)
        {
            general.genericError("mobileapp.js :: send-lockitem-data-to-client: " + e);
        }

    } catch (e)
    {
        general.genericError("mobileapp.js :: send-lockitem-data-to-client: " + e);
    }
});

socket.on("stock_count", function (data) {
    try
    {
        general.genericError("mobileapp.js :: stock_count: " + "Stock Count received:" + data.stockcount);
    } catch (e)
    {
        general.genericError("mobileapp.js :: stock_count: " + e);
    }
});

/* SendReleaseLockRequest old functionality start */

/*
socket.on("send-releaselockitem-data-to-client", function (data) {
    try
    {
        general.genericError("mobileapp.js :: send-releaselockitem-data-to-client: " + "receive-releaselockitem-content");
        ReceiveReleaseLockRequest(data);
    } catch (e)
    {
        general.genericError("mobileapp.js :: send-releaselockitem-data-to-client: " + e);
    }
});
*/

/* SendReleaseLockRequest old functionality end */


socket.on("send-releaselockitem-data-to-client", function (data, releaselockitem_data) {
    try
    {
        general.genericError("mobileapp.js :: send-releaselockitem-data-to-client: " + "receive-releaselockitem-content");
        // ReceiveReleaseLockRequest(data);

        try
        {
            general.genericError("mobileapp.js :: ReceiveReleaseLockRequest: " + "Receive Release Lock Request");

            var req = data;
            var items = req.items;
            var outletid = req.outletid;
            var mobileno = req.mobileno;
            var counter_code = req.counter_code;
            var referenceno = req.referenceno;
            var releaselockitem_data_client;

            var itemcount = 0;

            // GetRequiredItems(items, counter_code);

            for (itemcount = 0; itemcount <= items.length - 1; itemcount++)
            {
                LockItem(items[itemcount].item_id, "decrease", items[itemcount].count);
            }

            // socket.emit("releaselock-item-status", { "status": success_status, "outletid": outlet_id, "hqclient": "HQ-user", "mobileno": mobileno, "items": items, "referenceno": referenceno });
            releaselockitem_data_client = { "status": success_status, "outletid": outlet_id, "hqclient": "HQ-user", "mobileno": mobileno, "items": items, "referenceno": referenceno };
            releaselockitem_data({ releaselockitem_data_client });
        } catch (e)
        {
            general.genericError("mobileapp.js :: ReceiveReleaseLockRequest: " + e);
        }

    } catch (e)
    {
        general.genericError("mobileapp.js :: send-releaselockitem-data-to-client: " + e);
    }
});


socket.on("send-test-emit-request-to-client", function (data, fn) {
    var result = testemit();
    if (result.status === success_status)
    {
        general.genericError("send-test-emit-request-to-client: " + result);
        fn({ exists: true, outletid: outlet_id });
    }
});

function testemit() {
    var result = { "status": success_status, "outletid": outlet_id };
    return result;
}

function ReceiveLockRequest(req) {
    try
    {
        general.genericError("mobileapp.js :: ReceiveLockRequest: " + "Receive Lock Request");

        var items = req.items;
        var outletid = req.outletid;
        var mobileno = req.mobileno;
        var counter_code = req.counter_code;
        var referenceno = req.referenceno;
        var itemcount = 0, itemlockcount = 0, lockedcountredis = 0, itemcountplaced = 0;
        var receive_lock_result;

        // GetRequiredItems(items, counter_code);
        if (items != null)
        {
            // Read _locked_count for items from Redis
            var item_id_list = [];
            for (itemlockcount = 0; itemlockcount <= items.length - 1; itemlockcount++)
            {
                itemcountplaced += items[itemlockcount].count;
                item_id_list.push(items[itemlockcount].item_id + '_locked_count');
            }

            // Getting the stock count
            // Getting all the required items first with async.parallel.
            // And then running the main logic in the callback
            async.parallel({
                stock_count: function (callback) {
                    try
                    {
                        // Getting the stock count here
                        redisClient.get(helper.stock_count_node, function (err, reply) {
                            if (err)
                            {
                                callback("error while retreiving from redis- {}".format(err), null);
                                return;
                            }
                            callback(null, reply);
                        });
                    } catch (e)
                    {
                        general.genericError("mobileapp.js :: GetRequiredItems: " + e);
                    }
                }
            },
        function (err, results) {
            try
            {
                if (err)
                {
                    general.genericError("mobileapp.js :: GetRequiredItems: " + err);
                    done();
                    return;
                }

                stock_count = JSON.parse(results.stock_count);
                var itemcountinstock = 0;
                var availableitems = 0;
                var isValidItems = true;

                redisClient.mget(item_id_list, function (l_err, l_reply) {
                    for (var item in items)
                    {
                        var item_id = items[item]["item_id"];
                        itemcountinstock = parseInt(GetItemsCount(item_id, stock_count[item_id]["item_details"]));

                        try
                        {
                            if (l_reply[item_id_list.indexOf(item_id + '_locked_count')])
                            {
                                lockedcountredis = parseInt(l_reply[item_id_list.indexOf(item_id + '_locked_count')]);
                            }
                        } catch (e)
                        {
                            general.genericError("mobileapp.js :: ReceiveLockRequest: get _locked_count " + e);
                        }


                        availableitems = itemcountinstock - lockedcountredis;
                        if (itemcountplaced > availableitems)
                        {
                            isValidItems = false;
                            break;
                        }
                    }

                    // itemcountplaced <= availableitems
                    if (isValidItems)
                    {
                        for (itemcount = 0; itemcount <= items.length - 1; itemcount++)
                        {
                            LockItem(items[itemcount].item_id, "increase", items[itemcount].count);
                        }

                        // socket.emit("lock-item-status", { "status": success_status, "outletid": outletid, "hqclient": "HQ-user", "mobileno": mobileno, "items": items, "referenceno": referenceno });
                        receive_lock_result = { "status": success_status, "outletid": outletid, "hqclient": "HQ-user", "mobileno": mobileno, "items": items, "referenceno": referenceno }
                        return receive_lock_result;
                    }
                    else
                    {
                        // socket.emit("lock-item-status", { "status": fail_status, "outletid": outletid, "hqclient": "HQ-user", "mobileno": mobileno, "items": items, "referenceno": referenceno });
                        receive_lock_result = { "status": fail_status, "outletid": outletid, "hqclient": "HQ-user", "mobileno": mobileno, "items": items, "referenceno": referenceno };
                        return receive_lock_result;
                    }
                });
            }
            catch (e)
            {
                receive_lock_result = { "status": fail_status, "outletid": outletid, "hqclient": "HQ-user", "mobileno": mobileno, "items": items, "referenceno": referenceno };
                return receive_lock_result;
            }
        });
        }
        else
        {
            // socket.emit("lock-item-status", { "status": fail_status, "outletid": outletid, "hqclient": "HQ-user", "mobileno": mobileno, "items": items, "referenceno": referenceno });
            receive_lock_result = { "status": fail_status, "outletid": outletid, "hqclient": "HQ-user", "mobileno": mobileno, "items": items, "referenceno": referenceno };
            return receive_lock_result;
        }
    } catch (e)
    {
        general.genericError("mobileapp.js :: ReceiveLockRequest: " + e);
    }
}

function ReceiveReleaseLockRequest(req) {
    try
    {
        general.genericError("mobileapp.js :: ReceiveReleaseLockRequest: " + "Receive Release Lock Request");

        var items = req.items;
        var outletid = req.outletid;
        var mobileno = req.mobileno;
        var counter_code = req.counter_code;
        var referenceno = req.referenceno;

        var itemcount = 0;

        // GetRequiredItems(items, counter_code);

        for (itemcount = 0; itemcount <= items.length - 1; itemcount++)
        {
            LockItem(items[itemcount].item_id, "decrease", items[itemcount].count);
        }

        socket.emit("releaselock-item-status", { "status": success_status, "outletid": outlet_id, "hqclient": "HQ-user", "mobileno": mobileno, "items": items, "referenceno": referenceno });
    } catch (e)
    {
        general.genericError("mobileapp.js :: ReceiveReleaseLockRequest: " + e);
    }
}

//Get all required items
function GetRequiredItems(order, counter_code) {
    try
    {
        var order_barcodes = [];
        var order_details = order;
        var test_mode = null;
        // Getting the no. of items in the order
        var num_items = 0;
        for (var key in order_details)
        {
            num_items += order_details[key]["count"];
        }

        var locker = lockredis(redisClient);
        locker('lock_item', {
            timeout: 5000,
            retries: Infinity,
            retryDelay: 10
        }, function (lock_err, done) {
            if (lock_err)
            {
                // Lock could not be acquired for some reason.
                general.genericError("mobileapp.js :: GetRequiredItems: " + lock_err);
                return res.status(500).send({ bill_no: -1 });
            }

            // Getting all the required items first with async.parallel.
            // And then running the main logic in the callback
            async.parallel({
                dispense_id: function (callback) {
                    try
                    {
                        // Incrementing the dispense id
                        redisClient.incrby(helper.dispense_id_node, num_items, function (d_err, d_reply) {
                            if (d_err)
                            {
                                callback("error while retreiving from redis- {}".format(d_err), null);
                                return;
                            }
                            callback(null, parseInt(d_reply) - num_items);
                        });
                    } catch (e)
                    {
                        general.genericError("mobileapp.js :: GetRequiredItems: " + e);
                    }
                },
                stock_count: function (callback) {
                    try
                    {
                        // Getting the stock count here
                        redisClient.get(helper.stock_count_node, function (err, reply) {
                            if (err)
                            {
                                callback("error while retreiving from redis- {}".format(err), null);
                                return;
                            }
                            callback(null, reply);
                        });
                    } catch (e)
                    {
                        general.genericError("mobileapp.js :: GetRequiredItems: " + e);
                    }
                },
                num_lanes: function (callback) {
                    try
                    {
                        redisClient.get(helper.plc_config_node, function (err, reply) {
                            if (err)
                            {
                                callback('error while retreiving from redis- {}'.format(err), null);
                                return;
                            }
                            var plc_config = JSON.parse(reply);
                            callback(null, plc_config.lane_count);
                        });
                    } catch (e)
                    {
                        general.genericError("mobileapp.js :: GetRequiredItems: " + e);
                    }
                },
                outlet_phone_no: function (callback) {
                    try
                    {
                        redisClient.get(helper.outlet_config_node, function (err, reply) {
                            try
                            {
                                if (err)
                                {
                                    callback('error while retreiving from redis- {}'.format(err), null);
                                    return;
                                }
                                var outlet_config = JSON.parse(reply);
                                callback(null, outlet_config.phone_no);

                            } catch (e)
                            {
                                general.genericError("mobileapp.js :: GetRequiredItems: " + e);
                            }
                        });
                    } catch (e)
                    {
                        general.genericError("mobileapp.js :: GetRequiredItems: " + e);
                    }
                }
            },
        function (err, results) {
            try
            {
                if (err)
                {
                    general.genericError("mobileapp.js :: GetRequiredItems: " + err);
                    done();
                    return;
                }

                stock_count = JSON.parse(results.stock_count);


                // Getting a multi-redis transaction started
                var multi = redisClient.multi();
                var item_queue = [];
                var item_id;
                for (var item in order_details)
                {
                    item_id = order_details[item]["item_id"];
                    for (var j = 0; j < order_details[item]["count"]; j++)
                    {
                        var barcode = getOldestBarcode(item_id, stock_count[item_id]["item_details"]);
                        // XXX: This case should not come
                        if (barcode == null)
                        {
                            continue;
                        }
                        order_barcodes.push(barcode);
                        stock_count = updateStockCount(stock_count, barcode);
                        // var heating_flag = order_details[item]["heating_flag"];
                        var heating_flag = 1;
                        if (food_item_data != null)
                        {
                            heating_reduction = food_item_data[item_id]["heating_reduction"];
                            heating_required = food_item_data[item_id]["heating_reqd"];
                        }

                        var lane_no = (results.dispense_id % results.num_lanes) + 1;
                        // Decrementing lock only if it is not test mode
                        // Adding this as part of the transaction
                        multi.decr(item_id + '_locked_count', function (s_err, s_reply) {
                            try
                            {
                                if (s_err)
                                {
                                    console.error(s_err);
                                }
                            } catch (e)
                            {
                                general.genericError("mobileapp.js :: GetRequiredItems: " + e);
                            }
                        });
                        var date = getOrderStubDate();
                        if (test_mode)
                        {
                            if (item_id % 2 == 0)
                            {
                                heating_flag = 0;
                            } else
                            {
                                heating_flag = 1;
                            }
                        }
                        else
                        {
                            if (heating_required)
                            {
                                heating_flag = heating_reduction == true ? 1 : 2;
                            }
                            else
                            {
                                heating_flag = 0;
                            }
                        }

                        var order_stub = createOrderStub(barcode, counter_code,
                                          heating_flag, date,
                                          0, results.dispense_id);
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
                  try
                  {
                      if (set_err)
                      {
                          console.error(set_err);
                      }
                  } catch (e)
                  {
                      general.genericError("mobileapp.js :: GetRequiredItems: " + e);
                  }
              });

                multi.exec(function (err, replies) {
                    try
                    {
                        done();
                        if (err)
                        {
                            general.genericError("mobileapp.js :: GetRequiredItems: " + err);
                            return;
                        }

                        // Merging with the lock counts and sending to browser and firebase
                        var item_id_list = [];
                        for (var item_id in stock_count)
                        {
                            item_id_list.push(item_id + '_locked_count');
                        }

                        redisClient.mget(item_id_list, function (l_err, l_reply) {
                            try
                            {
                                for (var item_id in stock_count)
                                {
                                    if (l_reply[item_id_list.indexOf(item_id + '_locked_count')])
                                    {
                                        stock_count[item_id]["locked_count"] = parseInt(l_reply[item_id_list.indexOf(item_id + '_locked_count')]);
                                    } else
                                    {
                                        stock_count[item_id]["locked_count"] = 0;
                                    }
                                }
                                // broadcasting the new stock count to all connected clients
                                socket.emit(helper.stock_count_node, stock_count);
                                // socket.sockets.emit(helper.stock_count_node, stock_count); // guna-doubt

                                // Put the data in firebase
                                var rootref = new firebase(firebase_connection);
                                var stock_count_node = rootref.child('{}/{}'.format(outlet_id, helper.stock_count_node));
                                stock_count_node.set(stock_count);
                            } catch (e)
                            {
                                general.genericError("mobileapp.js :: GetRequiredItems: " + e);
                            }
                        });
                    } catch (e)
                    {
                        general.genericError("mobileapp.js :: GetRequiredItems: " + e);
                    }
                });
                // End of multi transaction

                if (isEmpty(stock_count))
                {
                    redisClient.set(helper.dispenser_status_node, 'empty', function (d_set_err, d_set_reply) {
                        try
                        {
                            if (d_set_err)
                            {
                                console.error(d_set_err);
                            }
                        } catch (e)
                        {
                            general.genericError("mobileapp.js :: GetRequiredItems: " + e);
                        }
                    });
                    socket.emit('dispenser_empty', true);
                    // socket.sockets.emit('dispenser_empty', true); // guna-doubt
                } else
                {
                    socket.emit('dispenser_empty', false);
                    // socket.sockets.emit('dispenser_empty', false); // guna-doubt
                }
            } catch (e)
            {
                general.genericError("mobileapp.js :: GetRequiredItems: " + e);
            }
        });
        });
    } catch (e)
    {
        general.genericError("mobileapp.js :: GetRequiredItems: " + e);
    }
}

// This call locks the quantity for the particular item code
// eg- {"direction": "increase", "delta_count": 2}
function LockItem(item_id, direction, delta_count) {
    try
    {
        // increment/decrement the lock count here
        // then get stock count from redis and populate with the new lock data
        // and send to websocket
        // general.genericError("mobileapp.js :: LockItem: " +"Locking item id - ", item_id, " in direction- ", direction, " for quantity- ", delta_count);
        var previous_item_locked_count = 0;

        redisClient.get(item_id + '_locked_count', function (err, reply) {
            try
            {
                if (err)
                {
                    callback('error while retreiving from redis- {}'.format(err), null);
                    return;
                }

                previous_item_locked_count = JSON.parse(reply);

            } catch (e)
            {
                general.genericError("mobileapp.js :: send-order-request-to-client: " + e);
            }


            if (direction == "increase")
            {
                redisClient.incrby(item_id + '_locked_count', delta_count, update_lock_count_callback);
            } else if (direction == "decrease")
            {
                if (previous_item_locked_count > 0)
                {
                    redisClient.decrby(item_id + '_locked_count', delta_count, update_lock_count_callback);
                }
            }

            function update_lock_count_callback(l_err, l_reply) {
                try
                {
                    if (l_err)
                    {
                        console.error(l_err);
                        socket.emit("lock-item-status", { "status": "failed", "outletid": outlet_id, "hqclient": "HQ-user", "mobileno": "", "items": "" });
                        return "error while retreiving from redis- {}".format(l_err);
                    }
                    // Put the data in firebase
                    rootref = new firebase(firebase_connection);
                    var item_ref = rootref.child(outlet_id + '/stock_count/' + item_id + '/locked_count');
                    item_ref.transaction(function (current_value) {
                        try
                        {
                            if (current_value === null)
                            {
                                return 0;
                            }
                            // return current_value += delta_count;
                            if (direction == "increase")
                            {
                                return current_value += delta_count;
                            } else if (direction == "decrease")
                            {
                                current_value -= delta_count;

                                if (current_value < 0)
                                {
                                    current_value = 0;
                                }

                                return current_value;
                            }
                        } catch (e)
                        {
                            general.genericError("mobileapp.js :: LockItem: " + e);
                        }
                    });
                    redisClient.get(helper.stock_count_node, function (err, reply) {
                        try
                        {
                            if (err)
                            {
                                console.error(err);
                                socket.emit("lock-item-status", { "status": "failed", "outletid": outlet_id, "hqclient": "HQ-user", "mobileno": "", "items": "" });
                                return "error while retreiving from redis- {}".format(err);
                            }
                            var parsed_response = JSON.parse(reply);
                            var item_id_list = [];
                            for (var item_id in parsed_response)
                            {
                                item_id_list.push(item_id + '_locked_count');
                            }

                            redisClient.mget(item_id_list, function (l_err, l_reply) {
                                try
                                {
                                    if (l_err)
                                    {
                                        console.error(l_err);
                                        socket.emit("lock-item-status", { "status": "failed", "outletid": outlet_id, "hqclient": "HQ-user", "mobileno": "", "items": "" });
                                        return "error while retreiving from redis- {}".format(l_err);
                                    }
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

                                    // broadcasting the new stock count to all connected clients
                                    socket.emit(helper.stock_count_node, parsed_response);
                                    general.genericError("mobileapp.js :: LockItem: " + "stock count is- ", JSON.stringify(parsed_response));
                                    // Sending success to the ajax call                
                                    return success_status;
                                } catch (e)
                                {
                                    general.genericError("mobileapp.js :: LockItem: " + e);
                                }
                            });
                        } catch (e)
                        {
                            general.genericError("mobileapp.js :: LockItem: " + e);
                        }
                    });
                } catch (e)
                {
                    general.genericError("mobileapp.js :: LockItem: " + e);
                }
            }

        });
    } catch (e)
    {
        general.genericError("mobileapp.js :: LockItem: " + e);
    }
}

// helper functions
function getOldestBarcode(item_id, item_details) {
    try
    {
        var oldestTimestamp = 9999999900; // This is the max timestamp possible
        var barcode = null;
        for (var i = 0; i < item_details.length; i++)
        {
            // This item has expired, no need to see this item
            if (item_details[i]["expired"] || item_details[i]["spoiled"])
            {
                continue;
            }
            if (item_details[i]["timestamp"] < oldestTimestamp)
            {
                oldestTimestamp = item_details[i]["timestamp"];
                barcode = item_details[i]["barcode"];
            }
        }
        return barcode;
    } catch (e)
    {
        general.genericError("mobileapp.js :: LockItem: " + e);
    }
}

function GetItemsCount(item_id, item_details) {
    try
    {
        var oldestTimestamp = 9999999900; // This is the max timestamp possible
        var itemcount = 0;
        for (var i = 0; i < item_details.length; i++)
        {
            // This item has expired, no need to see this item
            if (item_details[i]["expired"] || item_details[i]["spoiled"])
            {
                continue;
            }
            //if (item_details[i]["timestamp"] < oldestTimestamp)
            //{
            oldestTimestamp = item_details[i]["timestamp"];
            itemcount += item_details[i]["count"];
            //}
        }
        return itemcount;
    } catch (e)
    {
        general.genericError("mobileapp.js :: LockItem: " + e);
    }
}

function updateStockCount(stock_count, barcode) {
    try
    {
        for (var item_id in stock_count)
        {
            var item = stock_count[item_id]["item_details"];
            for (var i = 0; i < item.length; i++)
            {
                if (item[i]["barcode"] == barcode)
                {
                    stock_count[item_id]["item_details"][i]["count"]--;
                    // If there are no more items left, delete the node
                    if (!stock_count[item_id]["item_details"][i]["count"])
                    {
                        stock_count[item_id]["item_details"].splice(i, 1);
                        i--;
                    }
                }
            }
        }

        return stock_count;
    } catch (e)
    {
        general.genericError("mobileapp.js :: updateStockCount: " + e);
    }
}

socket.on('send-order-request-to-client', function (data, order_data_client) {

    try
    {
        general.genericError("mobileapp.js :: send-order-request-to-client: " + "Outlet send-order-request-to-client: " + data.outletid);
        // PlaceOrder(data);

        try
        {
            general.genericError("mobileapp.js :: send-order-request-to-client: " + "Place order starting " + JSON.stringify(data));

            var req = data;
            var order_details = req.order_details;
            var counter_code = 1;
            var payment_mode = req.payment_mode;
            var sides = req.sides;
            var from_counter = '';
            var savings = req.savings;
            var bill_no; // guna doubt
            var mobile_num = req.mobileno;
            var credit_card_no = req.credit_card_no;
            var cardholder_name = req.cardholder_name;
            var referenceno = req.referenceno;
            var outletid = req.outletid;
            var orderdata;
            var test_mode = null;
            var order_barcodes = [];
            var num_items = 0;
            var num_items_stock_count = 0;
            var refrenceno_bill_no = 0;
            var output_response_data;

            var formated_outletid = general.leftPad(outletid, 3);

            redisClient.get(helper.test_mode_flag, function (get_err, get_reply) {
                try
                {
                    if (get_err)
                    {
                        general.genericError("mobileapp.js :: send-order-request-to-client: " + get_err);
                        res.status(500).send({ bill_no: -1 });
                        return;
                    }
                    test_mode = JSON.parse(get_reply);
                    if (test_mode === null)
                    {
                        test_mode = false;
                    }
                    onTestModeRetrieved(test_mode);
                } catch (e)
                {
                    general.genericError("mobileapp.js :: send-order-request-to-client: " + e);
                }
            });

            // If no bill_no, that means, this has come from order app and we need to
            // create the bill_no
            function onTestModeRetrieved(test_mode) {
                try
                {
                    if (bill_no == undefined)
                    {
                        if (test_mode)
                        {
                            bill_no = 0;
                            moveForward(bill_no, test_mode);
                        } else
                        {
                            // Incrementing the bill no.
                            redisClient.incrby(helper.bill_no_node, 1, function (b_err, b_reply) {
                                try
                                {
                                    if (b_err)
                                    {
                                        general.genericError("mobileapp.js :: send-order-request-to-client: " + b_err);
                                        res.status(500).send({ bill_no: -1 });
                                        return;
                                    }
                                    bill_no = parseInt(b_reply) - 1;
                                    moveForward(bill_no, test_mode);
                                } catch (e)
                                {
                                    general.genericError("mobileapp.js :: send-order-request-to-client: " + e);
                                }
                            });
                        }
                    } else
                    {
                        moveForward(bill_no, test_mode);
                    }
                } catch (e)
                {
                    general.genericError("mobileapp.js :: send-order-request-to-client: " + e);
                }
            }


            function moveForward(bill_no, test_mode) {
                try
                {
                    isForcePrintBill()
            .then(function (is_force_print_bill) {
                try
                {
                    var test_mode = null;
                    // Getting the no. of items in the order

                    for (var key in order_details)
                    {
                        num_items += order_details[key]["count"];
                    }

                    var locker = lockredis(redisClient);
                    locker('lock_item', {
                        timeout: 5000,
                        retries: Infinity,
                        retryDelay: 10
                    }, function (lock_err, done) {
                        try
                        {
                            if (lock_err)
                            {
                                // Lock could not be acquired for some reason.
                                general.genericError("mobileapp.js :: send-order-request-to-client: " + lock_err);
                                return res.status(500).send({ bill_no: -1 });
                            }

                            // Getting all the required items first with async.parallel.
                            // And then running the main logic in the callback
                            async.parallel({
                                dispense_id: function (callback) {
                                    try
                                    {
                                        // Incrementing the dispense id
                                        redisClient.incrby(helper.dispense_id_node, num_items, function (d_err, d_reply) {
                                            if (d_err)
                                            {
                                                callback("error while retreiving from redis- {}".format(d_err), null);
                                                return;
                                            }
                                            callback(null, parseInt(d_reply) - num_items);
                                        });
                                    } catch (e)
                                    {
                                        general.genericError("mobileapp.js :: send-order-request-to-client: " + e);
                                    }
                                },
                                stock_count: function (callback) {
                                    try
                                    {
                                        // Getting the stock count here
                                        redisClient.get(helper.stock_count_node, function (err, reply) {
                                            try
                                            {
                                                if (err)
                                                {
                                                    callback("error while retreiving from redis- {}".format(err), null);
                                                    return;
                                                }
                                                callback(null, reply);
                                            } catch (e)
                                            {
                                                general.genericError("mobileapp.js :: send-order-request-to-client: " + e);
                                            }
                                        });
                                    } catch (e)
                                    {
                                        general.genericError("mobileapp.js :: send-order-request-to-client: " + e);
                                    }
                                },
                                num_lanes: function (callback) {
                                    try
                                    {
                                        redisClient.get(helper.plc_config_node, function (err, reply) {
                                            try
                                            {
                                                if (err)
                                                {
                                                    callback('error while retreiving from redis- {}'.format(err), null);
                                                    return;
                                                }
                                                var plc_config = JSON.parse(reply);
                                                callback(null, plc_config.lane_count);
                                            } catch (e)
                                            {
                                                general.genericError("mobileapp.js :: send-order-request-to-client: " + e);
                                            }
                                        });
                                    } catch (e)
                                    {
                                        general.genericError("mobileapp.js :: send-order-request-to-client: " + e);
                                    }
                                },
                                outlet_phone_no: function (callback) {

                                    redisClient.get(helper.outlet_config_node, function (err, reply) {
                                        try
                                        {
                                            if (err)
                                            {
                                                callback('error while retreiving from redis- {}'.format(err), null);
                                                return;
                                            }
                                            var outlet_config = JSON.parse(reply);
                                            callback(null, outlet_config.phone_no);
                                        } catch (e)
                                        {
                                            general.genericError("mobileapp.js :: send-order-request-to-client: " + e);
                                        }
                                    });
                                }

                            },
                    function (err, results) {
                        try
                        {
                            if (err)
                            {
                                general.genericError("mobileapp.js :: send-order-request-to-client: " + err);
                                done();
                                return;
                            }

                            stock_count = JSON.parse(results.stock_count);


                            for (var item in order_details)
                            {
                                var item_id = order_details[item]["item_id"];

                                if (stock_count[item_id] != null && stock_count[item_id] != undefined)
                                {
                                    num_items_stock_count += order_details[item]["count"];
                                }
                            }

                            if (num_items == num_items_stock_count)
                            {
                                // Getting a multi-redis transaction started
                                var multi = redisClient.multi();
                                var item_queue = [];
                                var item_id;
                                var heating_reduction = false;
                                var heating_required = false;

                                for (var item in order_details)
                                {
                                    item_id = order_details[item]["item_id"];
                                    for (var j = 0; j < order_details[item]["count"]; j++)
                                    {
                                        var barcode = getOldestBarcode(item_id, stock_count[item_id]["item_details"]);
                                        // XXX: This case should not come
                                        if (barcode == null)
                                        {
                                            continue;
                                        }
                                        order_barcodes.push(barcode);

                                        // stock_count = updateStockCount(stock_count, barcode);
                                        var heating_flag_test = order_details[item]["heating_flag"];
                                        var heating_flag = 1;
                                        if (food_item_data != null)
                                        {
                                            heating_reduction = food_item_data[item_id]["heating_reduction"];
                                            heating_required = food_item_data[item_id]["heating_reqd"];
                                        }

                                        var lane_no = (results.dispense_id % results.num_lanes) + 1;

                                        var date = getOrderStubDate();
                                        if (test_mode)
                                        {
                                            if (item_id % 2 == 0)
                                            {
                                                heating_flag = 0;
                                            } else
                                            {
                                                heating_flag = 1;
                                            }
                                        }
                                        else
                                        {
                                            if (heating_required)
                                            {
                                                heating_flag = heating_reduction == true ? 1 : 2;
                                            }
                                            else
                                            {
                                                heating_flag = 0;
                                            }
                                        }

                                        //// todo - hardcoded
                                        //heating_flag = true;

                                        var order_stub = createOrderStub(barcode, counter_code,
                                                          heating_flag, date,
                                                          bill_no, results.dispense_id);
                                        item_val = {
                                            "dispense_id": results.dispense_id,
                                            "status": "pending",
                                            "order_stub": order_stub
                                        };
                                        item_queue.push(item_val);

                                        results.dispense_id++;
                                    }
                                }

                                general.genericError("Barcodes: " + order_barcodes);
                                // Setting the new stock count, also as part of the transaction
                                multi.set(helper.stock_count_node, JSON.stringify(stock_count),
                              function (set_err, set_reply) {
                                  try
                                  {
                                      if (set_err)
                                      {
                                          console.error(set_err);
                                      }
                                  } catch (e)
                                  {
                                      general.genericError("mobileapp.js :: send-order-request-to-client: " + e);
                                  }
                              });

                                multi.exec(function (err, replies) {
                                    try
                                    {
                                        done();
                                        if (err)
                                        {
                                            general.genericError("mobileapp.js :: send-order-request-to-client: " + err);
                                            return;
                                        }

                                    } catch (e)
                                    {
                                        general.genericError("mobileapp.js :: send-order-request-to-client: " + e);
                                    }
                                });
                                // End of multi transaction

                                if (isEmpty(stock_count))
                                {
                                    redisClient.set(helper.dispenser_status_node, 'empty', function (d_set_err, d_set_reply) {
                                        try
                                        {
                                            if (d_set_err)
                                            {
                                                console.error(d_set_err);
                                            }
                                        } catch (e)
                                        {
                                            general.genericError("mobileapp.js :: send-order-request-to-client: " + e);
                                        }
                                    });
                                    socket.emit('dispenser_empty', true);
                                    // socket.sockets.emit('dispenser_empty', true); // guna-doubt
                                } else
                                {
                                    socket.emit('dispenser_empty', false);
                                    // socket.sockets.emit('dispenser_empty', false); // guna-doubt
                                }
                            }

                            general.genericError("Order Items: " + num_items + " Avalilable Stock: " + num_items_stock_count);
                            if (num_items == num_items_stock_count)
                            {
                                // We do not print immediately when the payment mode is cash.
                                // The outlet staff prints it after getting the money
                                var rand_string = randomstring.generate(5);
                                general.genericError("mobileapp.js :: PlaceOrder: " + "Random String: " + rand_string);

                                redisClient.get(helper.stock_count_node, function (err, reply) {
                                    try
                                    {
                                        var parsed_response = JSON.parse(reply);
                                        var item_id_list = [];
                                        for (var item_id in parsed_response)
                                        {
                                            item_id_list.push(item_id + '_locked_count');
                                        }

                                        redisClient.mget(item_id_list, function (l_err, l_reply) {
                                            try
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
                                                socket.emit(helper.stock_count_node, parsed_response);
                                            } catch (e)
                                            {
                                                general.genericError("mobileapp.js :: send-order-request-to-client: " + e);
                                            }
                                        });
                                    } catch (e)
                                    {
                                        general.genericError("mobileapp.js :: send-order-request-to-client: " + e);
                                    }
                                });
                                general.genericError("mobileapp.js :: send-order-request-to-client: " + "Sending bill no- ", bill_no); 0
                                general.genericError("Sending bill no-: " + bill_no);
                                // res.send({ bill_no: bill_no });


                                var save_pending_orders_URL = hq_url + '/outlet/save_pending_orders'; // + process.env.OUTLET_ID;
                                general.genericError("save_pending_orders_URL: " + save_pending_orders_URL);

                                refrenceno_bill_no = formated_outletid + general.leftPad(bill_no, 6);
                                // Store the recovery details in the HQ
                                requestretry({
                                    url: save_pending_orders_URL,
                                    forever: true,
                                    method: "POST",
                                    json: {
                                        "bill_no": bill_no,
                                        "dispense_id": 1,
                                        "outletid": outlet_id,
                                        "mobileno": mobile_num,
                                        "referenceno": refrenceno_bill_no,
                                        "status": success_status
                                    }
                                }, function (error, response, body) {
                                    try
                                    {
                                        if (error || (response && response.statusCode != 200))
                                        {
                                            general.genericError("mobileapp.js :: send-order-request-to-client: " + '{}: {} {}'.format(save_pending_orders_URL, error, body));
                                            return;
                                        }
                                        general.genericError("mobileapp.js :: send-order-request-to-client: " + "Updated HQ with the recovery details");

                                        // index value changed by item_id
                                        var order_details_items_key = [];

                                        var orderjsondata = order_details;

                                        orderdata = {
                                            "tag": rand_string,
                                            "order_details": order_details,
                                            "counter_code": counter_code,
                                            "payment_mode": payment_mode,
                                            "sides": sides,
                                            "savings": savings,
                                            "bill_no": bill_no,
                                            "mobileno": mobile_num,
                                            "credit_card_no": credit_card_no,
                                            "cardholder_name": cardholder_name,
                                            "outletid": outlet_id,
                                            "order_barcodes": order_barcodes,
                                            "refrenceno_bill_no": refrenceno_bill_no
                                        };

                                        // Save Orders History    
                                        var save_orders_history_URL = hq_url + '/outlet/save_orders_history'; // + process.env.OUTLET_ID;

                                        general.genericError("save_orders_history_URL: " + save_orders_history_URL);

                                        var bill_dict = prepareBillDict(order_details, sides);
                                        general.genericError("save_orders_history_URL: " + save_orders_history_URL);
                                        // Store the recovery details in the HQ
                                        requestretry({
                                            url: save_orders_history_URL,
                                            forever: true,
                                            method: "POST",
                                            json: {
                                                "order_details": order_details,
                                                "sides": sides,
                                                "counter_code": counter_code,
                                                "payment_mode": payment_mode,
                                                "outlet_id": outlet_id,
                                                "order_barcodes": order_barcodes,
                                                "mobileno": mobile_num,
                                                "credit_card_no": credit_card_no,
                                                "cardholder_name": cardholder_name,
                                                "bill_no": bill_no,
                                                "food_details": bill_dict,
                                                "status": pending_status,
                                                "ordernumber": refrenceno_bill_no
                                            }
                                        }, function (error, response, body) {
                                            try
                                            {
                                                if (error || (response && response.statusCode != 200))
                                                {
                                                    general.genericError("mobileapp.js :: send-order-request-to-client: " + '{}: {} {}'.format(save_orders_history_URL, error, body));
                                                    return;
                                                }
                                            } catch (e)
                                            {
                                                general.genericError("mobileapp.js :: send-order-request-to-client: " + e);
                                            }
                                        });

                                        if (num_items == num_items_stock_count)
                                        {
                                            // Read Outlet config
                                            redisClient.get(helper.outlet_config_node, function (err, reply) {
                                                try
                                                {
                                                    if (err)
                                                    {
                                                        callback('error while retreiving from redis- {}'.format(err), null);
                                                        return;
                                                    }
                                                    var outlet_config = JSON.parse(reply);
                                                    // callback(null, outlet_config.phone_no);

                                                } catch (e)
                                                {
                                                    general.genericError("mobileapp.js :: GetRequiredItems: " + e);
                                                }
                                                var bill_to_print = prepareBillToPrint(order_details, sides);
                                                var dateObj = new Date();
                                                var date = dateObj.toDateString();
                                                var time = dateObj.toLocaleTimeString();
                                                //// add sides to the prepareBillDict function,
                                                //// Create the pdf once and post the bill results just once
                                                startPrint(bill_to_print, refrenceno_bill_no, date, time, 0, mobile_num, outlet_config.phone_no);

                                                general.genericError("Valid Stock:: num_items: " + num_items + " num_items_stock_count: " + num_items_stock_count);
                                                // socket.emit('send-order-status-to-server', { "hqclient": "HQ-user", "orderdata": orderdata, "bill_no": bill_no, "status": success_status, "referenceno": referenceno, "mobileno": mobile_num, "outletid": outlet_id, "item_queue": item_queue, "message": "Successfully updated order details in HQ" });
                                                output_response_data = { "hqclient": "HQ-user", "orderdata": orderdata, "bill_no": bill_no, "status": success_status, "referenceno": refrenceno_bill_no, "mobileno": mobile_num, "outletid": outlet_id, "item_queue": item_queue, "message": "Successfully updated order details in HQ" };
                                                order_data_client({ output_response_data });
                                            });
                                        }
                                    } catch (e)
                                    {
                                        general.genericError("mobileapp.js :: send-order-request-to-client: " + e);
                                    }
                                });


                            }
                            else
                            {
                                general.genericError("In-valid Stock:: num_items: " + num_items + " num_items_stock_count: " + num_items_stock_count);
                                // socket.emit('send-order-status-to-server', { "hqclient": "HQ-user", "orderdata": orderdata, "bill_no": -1, "status": fail_status, "referenceno": referenceno, "mobileno": mobile_num, "outletid": outlet_id, "item_queue": item_queue, "message": "Items are not available. Please re-order again." });
                                output_response_data = { "hqclient": "HQ-user", "orderdata": orderdata, "bill_no": -1, "status": fail_status, "referenceno": refrenceno_bill_no, "mobileno": mobile_num, "outletid": outlet_id, "item_queue": item_queue, "message": "Items are not available. Please re-order again." };
                                order_data_client({ output_response_data });
                            }
                        } catch (e)
                        {
                            general.genericError("mobileapp.js :: send-order-request-to-client: " + e);
                        }
                    });
                        } catch (e)
                        {
                            general.genericError("mobileapp.js :: send-order-request-to-client: " + e);
                        }
                    });
                } catch (e)
                {
                    general.genericError("mobileapp.js :: send-order-request-to-client: " + e);
                }

            }, function (bill_print_err) {
                // res.status(500).send({ bill_no: -1 });
                // socket.emit('send-order-status-to-server', { "hqclient": "HQ-user", "orderdata": orderdata, "bill_no": -1, "status": fail_status, "referenceno": referenceno, "mobileno": mobile_num, "outletid": outlet_id, "item_queue": '', "message": "Falied to updated order details in HQ" });
                output_response_data = { "hqclient": "HQ-user", "orderdata": orderdata, "bill_no": -1, "status": fail_status, "referenceno": refrenceno_bill_no, "mobileno": mobile_num, "outletid": outlet_id, "item_queue": '', "message": "Falied to updated order details in HQ" };
                order_data_client({ output_response_data });
            });
                } catch (e)
                {
                    general.genericError("mobileapp.js :: send-order-request-to-client: " + e);
                }
            }
        } catch (e)
        {
            general.genericError("mobileapp.js :: send-order-request-to-client: " + e);
        }

    } catch (e)
    {
        general.genericError("mobileapp.js :: send-order-request-to-client: " + e);
    }
});

socket.on('receive-activate-order-request-to-client', function (data, activate_order_data) {
    try
    {

        general.genericError(JSON.stringify(data));
        general.genericError("mobileapp.js :: receive-activate-order-request-to-client: " + "Outlet - receive-activate-order-request-to-client: " + data.outletid);
        // ActivateOrders(data);

        general.genericError("ActivateOrders: " + JSON.stringify(ActivateOrders));
        var req = data;
        var orderdata = req.orderdata;
        var referenceno = req.referenceno;
        var bill_no = req.bill_no;
        var item_queue = req.item_queue;

        var sales_order_id;
        if (orderdata != null && orderdata != '' && bill_no != -1)
        {
            var activate_order_data_client;

            general.genericError("Activate Order:: Bill No: " + bill_no);

            var bill_dict = prepareBillDict(orderdata.order_details, orderdata.sides);

            //var bill_to_print = prepareBillToPrint(orderdata.order_details, orderdata.sides);
            //var dateObj = new Date();
            //var date = dateObj.toDateString();
            //var time = dateObj.toLocaleTimeString();
            ////// add sides to the prepareBillDict function,
            ////// Create the pdf once and post the bill results just once
            //startPrint(bill_to_print, bill_no, date, time, 0, orderdata.mobileno, outlet_config.phone_no);


            //var place_order_to_HQ_URL = hq_url + '/outlet/place_order';
            //var store_bill_entry_data_HQ_URL = hq_url + '/outlet/store_bill';
            //var update_recovery_details_HQ_URL = hq_url + '/outlet/update_recovery_details/' + outlet_id; // process.env.OUTLET_ID;

            var ref = new Firebase(firebase_queue);
            ref.child('tasks').push({
                "name": "ORDER_DETAILS",
                "order_details": orderdata.order_details,
                "sides": orderdata.sides,
                "counter_code": orderdata.counter_code,
                "payment_mode": orderdata.payment_mode,
                "outlet_id": orderdata.outletid,
                "order_barcodes": orderdata.order_barcodes,
                "mobile_num": orderdata.mobileno,
                "credit_card_no": orderdata.credit_card_no,
                "cardholder_name": orderdata.cardholder_name,
                "bill_no": bill_no,
                "food_details": bill_dict
            }); // after updating order details

            general.genericError("item_queue: " + item_queue);
            if (item_queue.length > 0)
            {
                general.genericError("item_queue: " + JSON.stringify(item_queue));
                // pushing the item to the queue
                item_queue.map(function (item_val) {
                    general.genericError("Item_Queue: " + JSON.stringify(item_val));
                    redisClient.rpush(helper.dispenser_queue_node, JSON.stringify(item_val),
                      function (lp_err, lp_reply) {
                          if (lp_err)
                          {
                              activate_order_data_client = { "referenceno": referenceno, "status": fail_status, "outletid": orderdata.outletid, "hqclient": "HQ-user", "mobileno": orderdata.mobileno };
                              activate_order_data({ activate_order_data_client });
                              general.genericError("mobileapp.js :: ActivateOrders: " + lp_err);
                              return;
                          }
                      });
                });

                var UPDATE_RECOVERY_DETAILS_URL = hq_url + '/outlet/update_recovery_details/' + outlet_id;

                general.genericError("UPDATE_RECOVERY_DETAILS_URL: " + UPDATE_RECOVERY_DETAILS_URL);
                // Store the recovery details in the HQ
                requestretry({
                    url: UPDATE_RECOVERY_DETAILS_URL,
                    forever: true,
                    method: "POST",
                    json: {
                        "bill_no": bill_no,
                        "dispense_id": item_queue[item_queue.length - 1].dispense_id + 1
                    }
                }, function (error, response, body) {
                    if (error || (response && response.statusCode != 200))
                    {
                        activate_order_data_client = { "referenceno": referenceno, "status": fail_status, "outletid": orderdata.outletid, "hqclient": "HQ-user", "mobileno": orderdata.mobileno };
                        activate_order_data({ activate_order_data_client });
                        general.genericError("mobileapp.js :: ActivateOrders: " + '{}: {} {}'.format(UPDATE_RECOVERY_DETAILS_URL, error, body));
                        return;
                    }
                    general.genericError("mobileapp.js :: ActivateOrders: " + "Updated HQ with the recovery details");
                });
            }

            // Save Orders History    
            var update_orders_history_URL = hq_url + '/outlet/update_orders_history'; // + process.env.OUTLET_ID;

            general.genericError("update_orders_history_URL: " + update_orders_history_URL);

            // Store the recovery details in the HQ
            requestretry({
                url: update_orders_history_URL,
                forever: true,
                method: "POST",
                json: {
                    "order_details": orderdata.order_details,
                    "sides": orderdata.sides,
                    "counter_code": orderdata.counter_code,
                    "payment_mode": orderdata.payment_mode,
                    "outlet_id": orderdata.outletid,
                    "order_barcodes": orderdata.order_barcodes,
                    "mobileno": orderdata.mobileno,
                    "credit_card_no": orderdata.credit_card_no,
                    "cardholder_name": orderdata.cardholder_name,
                    "bill_no": bill_no,
                    "food_details": bill_dict,
                    "status": success_status,
                    "ordernumber": referenceno

                }
            }, function (error, response, body) {
                try
                {
                    if (error || (response && response.statusCode != 200))
                    {
                        activate_order_data_client = { "referenceno": referenceno, "status": fail_status, "outletid": orderdata.outletid, "hqclient": "HQ-user", "mobileno": orderdata.mobileno };
                        activate_order_data({ activate_order_data_client });
                        general.genericError("mobileapp.js :: ActivateOrders: " + '{}: {} {}'.format(update_orders_history_URL, error, body));
                        return;
                    }
                } catch (e)
                {
                    general.genericError("mobileapp.js :: ActivateOrders: " + e);
                }
            });

            activate_order_data_client = { "referenceno": referenceno, "status": success_status, "outletid": orderdata.outletid, "hqclient": "HQ-user", "mobileno": orderdata.mobileno };
            activate_order_data({ activate_order_data_client });
        }
        else
        {
            activate_order_data_client = { "referenceno": referenceno, "status": fail_status, "outletid": orderdata.outletid, "hqclient": "HQ-user", "mobileno": orderdata.mobileno };
            activate_order_data({ activate_order_data_client });
        }

    } catch (e)
    {
        activate_order_data_client = { "referenceno": referenceno, "status": fail_status, "outletid": orderdata.outletid, "hqclient": "HQ-user", "mobileno": orderdata.mobileno };
        activate_order_data({ activate_order_data_client });
        general.genericError("mobileapp.js :: receive-activate-order-request-to-client: " + e);
    }
});

// This request will push the order related data to the plcio daemon
// to start serving the order

function PlaceOrder(req) {
    try
    {
        general.genericError("mobileapp.js :: PlaceOrder: " + "Place order starting " + JSON.stringify(req));
        var order_details = req.order_details;
        var counter_code = 1;
        var payment_mode = req.payment_mode;
        var sides = req.sides;
        var from_counter = '';
        var savings = req.savings;
        var bill_no; // guna doubt
        var mobile_num = req.mobileno;
        var credit_card_no = req.credit_card_no;
        var cardholder_name = req.cardholder_name;
        var referenceno = req.referenceno;
        var outletid = req.outletid;
        var orderdata;
        var test_mode = null;
        var order_barcodes = [];
        var num_items = 0;
        var num_items_stock_count = 0;
        var refrenceno_bill_no = 0;
        //// Getting the no. of items in the order
        //var num_items = 0;
        //for (var key in order_details)
        //{
        //    num_items += order_details[key]["count"];
        //}

        var formated_outletid = general.leftPad(outletid, 3);

        redisClient.get(helper.test_mode_flag, function (get_err, get_reply) {
            try
            {
                if (get_err)
                {
                    general.genericError("mobileapp.js :: PlaceOrder: " + get_err);
                    res.status(500).send({ bill_no: -1 });
                    return;
                }
                test_mode = JSON.parse(get_reply);
                if (test_mode === null)
                {
                    test_mode = false;
                }
                onTestModeRetrieved(test_mode);
            } catch (e)
            {
                general.genericError("mobileapp.js :: PlaceOrder: " + e);
            }
        });

        // If no bill_no, that means, this has come from order app and we need to
        // create the bill_no
        function onTestModeRetrieved(test_mode) {
            try
            {
                if (bill_no == undefined)
                {
                    if (test_mode)
                    {
                        bill_no = 0;
                        moveForward(bill_no, test_mode);
                    } else
                    {
                        // Incrementing the bill no.
                        redisClient.incrby(helper.bill_no_node, 1, function (b_err, b_reply) {
                            try
                            {
                                if (b_err)
                                {
                                    general.genericError("mobileapp.js :: PlaceOrder: " + b_err);
                                    res.status(500).send({ bill_no: -1 });
                                    return;
                                }
                                bill_no = parseInt(b_reply) - 1;
                                moveForward(bill_no, test_mode);
                            } catch (e)
                            {
                                general.genericError("mobileapp.js :: PlaceOrder: " + e);
                            }
                        });
                    }
                } else
                {
                    moveForward(bill_no, test_mode);
                }
            } catch (e)
            {
                general.genericError("mobileapp.js :: PlaceOrder: " + e);
            }
        }


        function moveForward(bill_no, test_mode) {
            try
            {
                isForcePrintBill()
        .then(function (is_force_print_bill) {
            try
            {
                var test_mode = null;
                // Getting the no. of items in the order

                for (var key in order_details)
                {
                    num_items += order_details[key]["count"];
                }

                var locker = lockredis(redisClient);
                locker('lock_item', {
                    timeout: 5000,
                    retries: Infinity,
                    retryDelay: 10
                }, function (lock_err, done) {
                    try
                    {
                        if (lock_err)
                        {
                            // Lock could not be acquired for some reason.
                            general.genericError("mobileapp.js :: PlaceOrder: " + lock_err);
                            return res.status(500).send({ bill_no: -1 });
                        }

                        // Getting all the required items first with async.parallel.
                        // And then running the main logic in the callback
                        async.parallel({
                            dispense_id: function (callback) {
                                try
                                {
                                    // Incrementing the dispense id
                                    redisClient.incrby(helper.dispense_id_node, num_items, function (d_err, d_reply) {
                                        if (d_err)
                                        {
                                            callback("error while retreiving from redis- {}".format(d_err), null);
                                            return;
                                        }
                                        callback(null, parseInt(d_reply) - num_items);
                                    });
                                } catch (e)
                                {
                                    general.genericError("mobileapp.js :: PlaceOrder: " + e);
                                }
                            },
                            stock_count: function (callback) {
                                try
                                {
                                    // Getting the stock count here
                                    redisClient.get(helper.stock_count_node, function (err, reply) {
                                        try
                                        {
                                            if (err)
                                            {
                                                callback("error while retreiving from redis- {}".format(err), null);
                                                return;
                                            }
                                            callback(null, reply);
                                        } catch (e)
                                        {
                                            general.genericError("mobileapp.js :: PlaceOrder: " + e);
                                        }
                                    });
                                } catch (e)
                                {
                                    general.genericError("mobileapp.js :: PlaceOrder: " + e);
                                }
                            },
                            num_lanes: function (callback) {
                                try
                                {
                                    redisClient.get(helper.plc_config_node, function (err, reply) {
                                        try
                                        {
                                            if (err)
                                            {
                                                callback('error while retreiving from redis- {}'.format(err), null);
                                                return;
                                            }
                                            var plc_config = JSON.parse(reply);
                                            callback(null, plc_config.lane_count);
                                        } catch (e)
                                        {
                                            general.genericError("mobileapp.js :: PlaceOrder: " + e);
                                        }
                                    });
                                } catch (e)
                                {
                                    general.genericError("mobileapp.js :: PlaceOrder: " + e);
                                }
                            },
                            outlet_phone_no: function (callback) {

                                redisClient.get(helper.outlet_config_node, function (err, reply) {
                                    try
                                    {
                                        if (err)
                                        {
                                            callback('error while retreiving from redis- {}'.format(err), null);
                                            return;
                                        }
                                        var outlet_config = JSON.parse(reply);
                                        callback(null, outlet_config.phone_no);
                                    } catch (e)
                                    {
                                        general.genericError("mobileapp.js :: PlaceOrder: " + e);
                                    }
                                });
                            }

                        },
                function (err, results) {
                    try
                    {
                        if (err)
                        {
                            general.genericError("mobileapp.js :: PlaceOrder: " + err);
                            done();
                            return;
                        }

                        stock_count = JSON.parse(results.stock_count);


                        for (var item in order_details)
                        {
                            var item_id = order_details[item]["item_id"];

                            if (stock_count[item_id] != null && stock_count[item_id] != undefined)
                            {
                                num_items_stock_count += order_details[item]["count"];
                            }
                        }

                        if (num_items == num_items_stock_count)
                        {

                            // GetFoodItemDetails
                            // GetFoodItemDetails

                            // Getting a multi-redis transaction started
                            var multi = redisClient.multi();
                            var item_queue = [];
                            var item_id;
                            for (var item in order_details)
                            {
                                item_id = order_details[item]["item_id"];
                                for (var j = 0; j < order_details[item]["count"]; j++)
                                {
                                    var barcode = getOldestBarcode(item_id, stock_count[item_id]["item_details"]);
                                    // XXX: This case should not come
                                    if (barcode == null)
                                    {
                                        continue;
                                    }
                                    order_barcodes.push(barcode);

                                    // stock_count = updateStockCount(stock_count, barcode);
                                    //var heating_flag = order_details[item]["heating_flag"];

                                    var heating_flag = 1;
                                    if (food_item_data != null)
                                    {
                                        heating_reduction = food_item_data[item_id]["heating_reduction"];
                                        heating_required = food_item_data[item_id]["heating_reqd"];
                                    }
                                    var lane_no = (results.dispense_id % results.num_lanes) + 1;
                                    // Decrementing lock only if it is not test mode
                                    //// Adding this as part of the transaction
                                    //multi.decr(item_id + '_locked_count', function (s_err, s_reply) {
                                    //    try
                                    //    {
                                    //        if (s_err)
                                    //        {
                                    //            console.error(s_err);
                                    //        }
                                    //    } catch (e)
                                    //    {
                                    //        general.genericError("mobileapp.js :: PlaceOrder: " + e);
                                    //    }
                                    //});
                                    var date = getOrderStubDate();
                                    if (test_mode)
                                    {
                                        if (item_id % 2 == 0)
                                        {
                                            heating_flag = false;
                                        } else
                                        {
                                            heating_flag = true;
                                        }
                                    }
                                    else
                                    {
                                        if (heating_required)
                                        {
                                            heating_flag = heating_reduction == true ? 1 : 2;
                                        }
                                        else
                                        {
                                            heating_flag = 0;
                                        }
                                    }

                                    //// todo - hardcoded
                                    //heating_flag = true;

                                    var order_stub = createOrderStub(barcode, counter_code,
                                                      heating_flag, date,
                                                      bill_no, results.dispense_id);
                                    item_val = {
                                        "dispense_id": results.dispense_id,
                                        "status": "pending",
                                        "order_stub": order_stub
                                    };
                                    item_queue.push(item_val);

                                    results.dispense_id++;
                                }
                            }

                            general.genericError("Barcodes: " + order_barcodes);
                            // Setting the new stock count, also as part of the transaction
                            multi.set(helper.stock_count_node, JSON.stringify(stock_count),
                          function (set_err, set_reply) {
                              try
                              {
                                  if (set_err)
                                  {
                                      console.error(set_err);
                                  }
                              } catch (e)
                              {
                                  general.genericError("mobileapp.js :: PlaceOrder: " + e);
                              }
                          });

                            multi.exec(function (err, replies) {
                                try
                                {
                                    done();
                                    if (err)
                                    {
                                        general.genericError("mobileapp.js :: PlaceOrder: " + err);
                                        return;
                                    }

                                    //// Merging with the lock counts and sending to browser and firebase
                                    //var item_id_list = [];
                                    //for (var item_id in stock_count)
                                    //{
                                    //    item_id_list.push(item_id + '_locked_count');
                                    //}

                                    //redisClient.mget(item_id_list, function (l_err, l_reply) {
                                    //    try
                                    //    {
                                    //        for (var item_id in stock_count)
                                    //        {
                                    //            if (l_reply[item_id_list.indexOf(item_id + '_locked_count')])
                                    //            {
                                    //                stock_count[item_id]["locked_count"] = parseInt(l_reply[item_id_list.indexOf(item_id + '_locked_count')]);
                                    //            } else
                                    //            {
                                    //                stock_count[item_id]["locked_count"] = 0;
                                    //            }
                                    //        }
                                    //        // broadcasting the new stock count to all connected clients
                                    //        socket.emit(helper.stock_count_node, stock_count);
                                    //        // socket.sockets.emit(helper.stock_count_node, stock_count); // guna-doubt

                                    //        // Put the data in firebase
                                    //        var rootref = new firebase(firebase_connection);
                                    //        var stock_count_node = rootref.child('{}/{}'.format(outlet_id, helper.stock_count_node));
                                    //        stock_count_node.set(stock_count);

                                    //    } catch (e)
                                    //    {
                                    //        general.genericError("mobileapp.js :: PlaceOrder: " + e);
                                    //    }
                                    //});
                                } catch (e)
                                {
                                    general.genericError("mobileapp.js :: PlaceOrder: " + e);
                                }
                            });
                            // End of multi transaction

                            if (isEmpty(stock_count))
                            {
                                redisClient.set(helper.dispenser_status_node, 'empty', function (d_set_err, d_set_reply) {
                                    try
                                    {
                                        if (d_set_err)
                                        {
                                            console.error(d_set_err);
                                        }
                                    } catch (e)
                                    {
                                        general.genericError("mobileapp.js :: PlaceOrder: " + e);
                                    }
                                });
                                socket.emit('dispenser_empty', true);
                                // socket.sockets.emit('dispenser_empty', true); // guna-doubt
                            } else
                            {
                                socket.emit('dispenser_empty', false);
                                // socket.sockets.emit('dispenser_empty', false); // guna-doubt
                            }
                        }

                        general.genericError("Order Items: " + num_items + " Avalilable Stock: " + num_items_stock_count);
                        if (num_items == num_items_stock_count)
                        {
                            // We do not print immediately when the payment mode is cash.
                            // The outlet staff prints it after getting the money
                            var rand_string = randomstring.generate(5);
                            general.genericError("mobileapp.js :: PlaceOrder: " + "Random String: " + rand_string);

                            redisClient.get(helper.stock_count_node, function (err, reply) {
                                try
                                {
                                    var parsed_response = JSON.parse(reply);
                                    var item_id_list = [];
                                    for (var item_id in parsed_response)
                                    {
                                        item_id_list.push(item_id + '_locked_count');
                                    }

                                    redisClient.mget(item_id_list, function (l_err, l_reply) {
                                        try
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
                                            socket.emit(helper.stock_count_node, parsed_response);
                                        } catch (e)
                                        {
                                            general.genericError("mobileapp.js :: PlaceOrder: " + e);
                                        }
                                    });
                                } catch (e)
                                {
                                    general.genericError("mobileapp.js :: PlaceOrder: " + e);
                                }
                            });
                            general.genericError("mobileapp.js :: PlaceOrder: " + "Sending bill no- ", bill_no); 0
                            general.genericError("Sending bill no-: " + bill_no);
                            // res.send({ bill_no: bill_no });


                            var save_pending_orders_URL = hq_url + '/outlet/save_pending_orders'; // + process.env.OUTLET_ID;
                            general.genericError("save_pending_orders_URL: " + save_pending_orders_URL);

                            refrenceno_bill_no = formated_outletid + general.leftPad(bill_no, 6);
                            // Store the recovery details in the HQ
                            requestretry({
                                url: save_pending_orders_URL,
                                forever: true,
                                method: "POST",
                                json: {
                                    "bill_no": bill_no,
                                    "dispense_id": 1,
                                    "outletid": outlet_id,
                                    "mobileno": mobile_num,
                                    "referenceno": refrenceno_bill_no,
                                    "status": success_status
                                }
                            }, function (error, response, body) {
                                try
                                {
                                    if (error || (response && response.statusCode != 200))
                                    {
                                        general.genericError("mobileapp.js :: PlaceOrder: " + '{}: {} {}'.format(save_pending_orders_URL, error, body));
                                        return;
                                    }
                                    general.genericError("mobileapp.js :: PlaceOrder: " + "Updated HQ with the recovery details");

                                    // index value changed by item_id
                                    var order_details_items_key = [];

                                    var orderjsondata = order_details;

                                    orderdata = {
                                        "tag": rand_string,
                                        "order_details": order_details,
                                        "counter_code": counter_code,
                                        "payment_mode": payment_mode,
                                        "sides": sides,
                                        "savings": savings,
                                        "bill_no": bill_no,
                                        "mobileno": mobile_num,
                                        "credit_card_no": credit_card_no,
                                        "cardholder_name": cardholder_name,
                                        "outletid": outlet_id,
                                        "order_barcodes": order_barcodes,
                                        "refrenceno_bill_no": refrenceno_bill_no
                                    };

                                    // Save Orders History    
                                    var save_orders_history_URL = hq_url + '/outlet/save_orders_history'; // + process.env.OUTLET_ID;

                                    general.genericError("save_orders_history_URL: " + save_orders_history_URL);

                                    var bill_dict = prepareBillDict(order_details, sides);
                                    general.genericError("save_orders_history_URL: " + save_orders_history_URL);
                                    // Store the recovery details in the HQ
                                    requestretry({
                                        url: save_orders_history_URL,
                                        forever: true,
                                        method: "POST",
                                        json: {
                                            "order_details": order_details,
                                            "sides": sides,
                                            "counter_code": counter_code,
                                            "payment_mode": payment_mode,
                                            "outlet_id": outlet_id,
                                            "order_barcodes": order_barcodes,
                                            "mobileno": mobile_num,
                                            "credit_card_no": credit_card_no,
                                            "cardholder_name": cardholder_name,
                                            "bill_no": bill_no,
                                            "food_details": bill_dict,
                                            "status": pending_status,
                                            "ordernumber": refrenceno_bill_no
                                        }
                                    }, function (error, response, body) {
                                        try
                                        {
                                            if (error || (response && response.statusCode != 200))
                                            {
                                                general.genericError("mobileapp.js :: PlaceOrder: " + '{}: {} {}'.format(save_orders_history_URL, error, body));
                                                return;
                                            }
                                        } catch (e)
                                        {
                                            general.genericError("mobileapp.js :: PlaceOrder: " + e);
                                        }
                                    });

                                    if (num_items == num_items_stock_count)
                                    {

                                        general.genericError("Valid Stock:: num_items: " + num_items + " num_items_stock_count: " + num_items_stock_count);
                                        socket.emit('send-order-status-to-server', { "hqclient": "HQ-user", "orderdata": orderdata, "bill_no": bill_no, "status": success_status, "referenceno": referenceno, "mobileno": mobile_num, "outletid": outlet_id, "item_queue": item_queue, "message": "Successfully updated order details in HQ" });
                                    }
                                } catch (e)
                                {
                                    general.genericError("mobileapp.js :: PlaceOrder: " + e);
                                }
                            });


                        }
                        else
                        {
                            general.genericError("In-valid Stock:: num_items: " + num_items + " num_items_stock_count: " + num_items_stock_count);
                            socket.emit('send-order-status-to-server', { "hqclient": "HQ-user", "orderdata": orderdata, "bill_no": -1, "status": fail_status, "referenceno": referenceno, "mobileno": mobile_num, "outletid": outlet_id, "item_queue": item_queue, "message": "Items are not available. Please re-order again." });
                        }
                    } catch (e)
                    {
                        general.genericError("mobileapp.js :: PlaceOrder: " + e);
                    }
                });
                    } catch (e)
                    {
                        general.genericError("mobileapp.js :: PlaceOrder: " + e);
                    }
                });
            } catch (e)
            {
                general.genericError("mobileapp.js :: PlaceOrder: " + e);
            }

        }, function (bill_print_err) {
            // res.status(500).send({ bill_no: -1 });
            socket.emit('send-order-status-to-server', { "hqclient": "HQ-user", "orderdata": orderdata, "bill_no": -1, "status": fail_status, "referenceno": referenceno, "mobileno": mobile_num, "outletid": outlet_id, "item_queue": '', "message": "Falied to updated order details in HQ" });
        });
            } catch (e)
            {
                general.genericError("mobileapp.js :: PlaceOrder: " + e);
            }
        }
    } catch (e)
    {
        general.genericError("mobileapp.js :: PlaceOrder: " + e);
    }
}

function ActivateOrders(req) {
    try
    {
        general.genericError("ActivateOrders: " + JSON.stringify(ActivateOrders));
        var orderdata = req.orderdata;
        var referenceno = req.referenceno;
        var bill_no = req.bill_no;
        var item_queue = req.item_queue;

        var sales_order_id;
        if (orderdata != null && orderdata != '' && bill_no != -1)
        {
            general.genericError("Activate Order:: Bill No: " + bill_no);




            var bill_dict = prepareBillDict(orderdata.order_details, orderdata.sides);

            //var bill_to_print = prepareBillToPrint(orderdata.order_details, orderdata.sides);
            //var dateObj = new Date();
            //var date = dateObj.toDateString();
            //var time = dateObj.toLocaleTimeString();
            ////// add sides to the prepareBillDict function,
            ////// Create the pdf once and post the bill results just once
            //startPrint(bill_to_print, bill_no, date, time, 0, orderdata.mobileno, outlet_config.phone_no);


            //var place_order_to_HQ_URL = hq_url + '/outlet/place_order';
            //var store_bill_entry_data_HQ_URL = hq_url + '/outlet/store_bill';
            //var update_recovery_details_HQ_URL = hq_url + '/outlet/update_recovery_details/' + outlet_id; // process.env.OUTLET_ID;

            var ref = new Firebase(firebase_queue);
            ref.child('tasks').push({
                "name": "ORDER_DETAILS",
                "order_details": orderdata.order_details,
                "sides": orderdata.sides,
                "counter_code": orderdata.counter_code,
                "payment_mode": orderdata.payment_mode,
                "outlet_id": orderdata.outletid,
                "order_barcodes": orderdata.order_barcodes,
                "mobile_num": orderdata.mobileno,
                "credit_card_no": orderdata.credit_card_no,
                "cardholder_name": orderdata.cardholder_name,
                "bill_no": bill_no,
                "food_details": bill_dict
            }); // after updating order details

            general.genericError("item_queue: " + item_queue);
            if (item_queue.length > 0)
            {
                general.genericError("item_queue: " + JSON.stringify(item_queue));
                // pushing the item to the queue
                item_queue.map(function (item_val) {
                    general.genericError("Item_Queue: " + JSON.stringify(item_val));
                    redisClient.rpush(helper.dispenser_queue_node, JSON.stringify(item_val),
                      function (lp_err, lp_reply) {
                          if (lp_err)
                          {
                              general.genericError("mobileapp.js :: ActivateOrders: " + lp_err);
                              return;
                          }
                      });
                });

                var UPDATE_RECOVERY_DETAILS_URL = hq_url + '/outlet/update_recovery_details/' + outlet_id;

                general.genericError("UPDATE_RECOVERY_DETAILS_URL: " + UPDATE_RECOVERY_DETAILS_URL);
                // Store the recovery details in the HQ
                requestretry({
                    url: UPDATE_RECOVERY_DETAILS_URL,
                    forever: true,
                    method: "POST",
                    json: {
                        "bill_no": bill_no,
                        "dispense_id": item_queue[item_queue.length - 1].dispense_id + 1
                    }
                }, function (error, response, body) {
                    if (error || (response && response.statusCode != 200))
                    {
                        general.genericError("mobileapp.js :: ActivateOrders: " + '{}: {} {}'.format(UPDATE_RECOVERY_DETAILS_URL, error, body));
                        return;
                    }
                    general.genericError("mobileapp.js :: ActivateOrders: " + "Updated HQ with the recovery details");
                });
            }

            // Save Orders History    
            var update_orders_history_URL = hq_url + '/outlet/update_orders_history'; // + process.env.OUTLET_ID;

            general.genericError("update_orders_history_URL: " + update_orders_history_URL);

            // Store the recovery details in the HQ
            requestretry({
                url: update_orders_history_URL,
                forever: true,
                method: "POST",
                json: {
                    "order_details": orderdata.order_details,
                    "sides": orderdata.sides,
                    "counter_code": orderdata.counter_code,
                    "payment_mode": orderdata.payment_mode,
                    "outlet_id": orderdata.outletid,
                    "order_barcodes": orderdata.order_barcodes,
                    "mobileno": orderdata.mobileno,
                    "credit_card_no": orderdata.credit_card_no,
                    "cardholder_name": orderdata.cardholder_name,
                    "bill_no": bill_no,
                    "food_details": bill_dict,
                    "status": success_status,
                    "ordernumber": referenceno

                }
            }, function (error, response, body) {
                try
                {
                    if (error || (response && response.statusCode != 200))
                    {
                        general.genericError("mobileapp.js :: ActivateOrders: " + '{}: {} {}'.format(update_orders_history_URL, error, body));
                        return;
                    }
                } catch (e)
                {
                    general.genericError("mobileapp.js :: ActivateOrders: " + e);
                }
            });
        }
    } catch (e)
    {
        general.genericError("mobileapp.js :: ActivateOrders: " + e);
    }
}

function prepareBillDict(order_details, sides) {
    try
    {
        var bill_dict = {};
        for (var item_id in order_details)
        {
            bill_dict[item_id] = order_details[item_id]["count"];
        }
        if (sides)
        {
            for (var item_id in sides)
            {
                bill_dict[item_id] = sides[item_id]["count"];
            }
        }
        return bill_dict;
    } catch (e)
    {
        general.genericError("mobileapp.js :: prepareBillDict: " + e);
    }
}

function prepareBillDictMobile(order_details, sides) {
    try
    {
        var bill_dict = {};
        for (var i = 0; i < order_details.length; i++)
        {
            var item_id = order_details[i].item_id;
            bill_dict[item_id] = order_details[i]["count"];
        }
        if (sides)
        {
            for (var i = 0; i < sides.length; i++)
            {
                var item_id = sides[i].item_id;
                bill_dict[item_id] = sides[i]["count"];
            }
        }
        return bill_dict;
    } catch (e)
    {
        general.genericError("mobileapp.js :: prepareBillDictMobile: " + e);
    }
}

function getOrderStubDate() {
    try
    {
        var date_obj = new Date();
        // gets a list of [dd, mm, yyyy]
        var date_items = date_obj.toISOString().substr(0, 10).split('-').reverse();
        // stripping off the first 2 characters from yyyy
        date_items[2] = date_items[2].substr(2);
        // joining them and returning
        return date_items.join('');
    } catch (e)
    {
        general.genericError("mobileapp.js :: getOrderStubDate: " + e);
    }
}

function createOrderStub(barcode, lane_no,
                          heating_flag, date,
                          bill_no, dispense_id) {
    try
    {
        var order_stub = '';
        order_stub += parseInt(lane_no).pad();
        order_stub += barcode;
        //order_stub += (heating_flag) ? 'Y' : 'N';
        order_stub += heating_flag;
        order_stub += date;
        order_stub += dispense_id.pad(6);
        order_stub += bill_no.pad(10);
        general.genericError("mobileapp.js :: createOrderStub: " + "Created order stub as- ", order_stub);
        general.genericError("Created order stub as- " + order_stub);

        return order_stub;
    } catch (e)
    {
        general.genericError("mobileapp.js :: createOrderStub: " + e);
    }
}

function isEmpty(stock_count) {
    try
    {
        for (var item_id in stock_count)
        {
            var item = stock_count[item_id]["item_details"];
            // check if all items are sold or not
            if (item == undefined)
            {
                continue;
            }
            for (var i = 0; i < item.length; i++)
            {
                // check if the item is not expired or spoiled
                if (item[i]["expired"] || item[i]["spoiled"])
                {
                    continue;
                }
                if (item[i]["count"])
                {
                    return false;
                }
            }
        }
        return true;
    } catch (e)
    {
        general.genericError("mobileapp.js :: isEmpty: " + e);
    }
}

var food_item_data = {};

//// This will return the prices and the veg/non-veg flag
function getItemDetails() {
    var food_item_hq_url = hq_url + '/food_item/price_info/' + outlet_id;

    requestretry({
        url: food_item_hq_url,
        forever: true,
        method: "GET",
        json: {
        }
    }, function (error, response, body) {
        try
        {
            if (response)
            {
                var data = response.body;
                // console.log('Received price data');
                for (var i = 0; i < data.length; i++)
                {
                    food_item_data[data[i]["id"]] = {
                        "mrp": data[i]["mrp"],
                        "master_id": data[i]["master_id"],
                        "name": data[i]["name"],
                        "item_tag": data[i]["item_tag"],
                        "veg": data[i]["veg"],
                        "service_tax_percent": data[i]["service_tax_percent"],
                        "abatement_percent": data[i]["abatement_percent"],
                        "vat_percent": data[i]["vat_percent"],
                        "location": data[i]["location"],
                        "side_order": data[i]["side_order"],
                        "restaurant_details": {
                            "id": data[i]["r_id"],
                            "name": data[i]["r_name"],
                            "address": data[i]["r_address"],
                            "st_no": data[i]["r_st_no"],
                            "pan_no": data[i]["r_pan_no"],
                            "tin_no": data[i]["r_tin_no"]
                        },
                        "coke_details": {
                            "id": data[i]["b_id"],
                            "name": data[i]["b_name"],
                            "mrp": data[i]["b_mrp"],
                            "st": data[i]["b_service_tax_percent"],
                            "abt": data[i]["b_abatement_percent"],
                            "vat": data[i]["b_vat_percent"],
                            "discount_percent": data[i]["discount_percent"],
                            "restaurant_details":
                                        {
                                            "id": data[i]["b_r_id"],
                                            "name": data[i]["b_r_name"],
                                            "address": data[i]["b_r_address"],
                                            "st_no": data[i]["r_st_no"],
                                            "pan_no": data[i]["r_pan_no"],
                                            "tin_no": data[i]["b_r_tin_no"]
                                        }
                        },
                        "heating_reqd": data[i]["heating_required"],
                        "heating_reduction": data[i]["heating_reduction"],
                        "condiment_slot": data[i]["condiment_slot"],
                        "stock_quantity": -1
                    }
                }

                return;
            }
        } catch (e)
        {
            general.genericError("mobileapp.js :: getItemDetails: " + e);
        }
    });




}

getItemDetails();

// Get food item details every 1 hr
setInterval(getItemDetails(), 3600 * 1000);

function prepareBillToPrint(order_details, sides) {
    var bill_items = [];
    for (var item_id in order_details)
    {
        bill_items.push({
            "name": order_details[item_id]["name"],
            "count": order_details[item_id]["count"],
            "amount": order_details[item_id]["price"],
            "side_order": order_details[item_id]["side_order"],
            "restaurant_id": food_item_data[item_id]["restaurant_details"]["id"],
            "tin_no": food_item_data[item_id]["restaurant_details"]["tin_no"],
            "st_no": food_item_data[item_id]["restaurant_details"]["st_no"],
            "restaurant_name": food_item_data[item_id]["restaurant_details"]["name"]
        });
    }
    if (sides)
    {
        for (var item_id in sides)
        {
            bill_items.push({
                "name": sides[item_id]["name"],
                "count": sides[item_id]["count"],
                "amount": sides[item_id]["price"],
                "side_order": sides[item_id]["side_order"],
                "restaurant_id": food_item_data[item_id]["restaurant_details"]["id"],
                "tin_no": food_item_data[item_id]["restaurant_details"]["tin_no"],
                "st_no": food_item_data[item_id]["restaurant_details"]["st_no"],
                "restaurant_name": food_item_data[item_id]["restaurant_details"]["name"]
            });
        }
    }

    // Grouping them by restaurant
    var return_dict = {}
    bill_items.map(function (item) {
        if (return_dict.hasOwnProperty(item.restaurant_id))
        {
            return_dict[item.restaurant_id].push(item);
        } else
        {
            return_dict[item.restaurant_id] = [item];
        }
    });

    return return_dict;
}

Number.prototype.pad = function (size) {
    var s = String(this);
    while (s.length < (size || 2)) { s = "0" + s; }
    return s;
}

module.exports = router;
