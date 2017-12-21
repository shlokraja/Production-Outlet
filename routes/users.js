var express = require('express');
var router = express.Router();
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
var _ = require('underscore');
var helper = require('./helper');
format.extend(String.prototype);

var redisClient = redis.createClient({ connect_timeout: 2000, retry_max_delay: 5000 });


redisClient.on('error', function (msg)
{
    console.error(msg);
});

router.get('/CheckLogin', function (req, res, next)
{
    redisClient.get("loginuserdetails",
		function (set_err, set_reply)
		{
		    if (set_err)
		    {
		        console.error('error while getting  from redis- {}'.format(set_err));
		        return;
		    }
		    if (set_reply != null)
		    {
		        var data = JSON.parse(set_reply);
		        loggedinuserid = data.user_id;
		        res.send({ userid: loggedinuserid, username: data.user_name })
		    }
		    else
		    {
		        res.send({ userid: 0 })
		    }
		});
});

router.post('/Login', function (req, res, next)
{
    var hq_url = process.env.HQ_URL;
    var outlet_id = process.env.OUTLET_ID;
    var login_Url = "/users/Login";
    console.log(req.body);
    requestretry({
        url: hq_url + login_Url,
        method: "POST",
        forever: true,
        json: { "username": req.body.user, "password": req.body.password, "outlet_id": outlet_id }
    },
        function (error, response, body)
        {
            if (error || (response && response.statusCode != 200))
            {
                console.error('{}: {} {}'.format(hq_url, error, body));
                res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                return;
            }
            console.log(body[0]);
            if (body != null && body.length > 0)
            {
                loggedinuserid = body[0].user_id;
                redisClient.set("loginuserid",body[0].user_id,
                function (set_err, set_reply)
                {
                    if (set_err)
                    {
                        console.error('error while inserting in redis- {}'.format(set_err));
                        return;
                    }
                });
                body[0].logindatetime = new Date();
                var data = JSON.stringify(body[0])
                redisClient.set("loginuserdetails", data,
                function (set_err, set_reply)
                {
                    if (set_err)
                    {
                        console.error('error while inserting in redis- {}'.format(set_err));
                        return;
                    }
                });
                res.status(200).send("Logged in successfully");
            }
            else
            {
                res.status(403).send('{}: {} {}'.format(hq_url, "User Not exists", null));
            }
        });

});

router.get('/checkLogout', function (req, res, next)
{
    console.log("Check_pending_reconciled_items");
    var pending_reconcile_items = [];
    var reconcile_redis_items = [];
    // Get PO details


    var reconcile_stock_count = [];
    redisClient.get(helper.reconcile_stock_count_node,
        function (err, reply_reconcile_stock_count)
        {
            if (err)
            {
                console.error("outlet_app.js :: get_po_details " + err);
                res.status(500).send(err);
                return;
            }

            reconcile_stock_count = JSON.parse(reply_reconcile_stock_count);


            redisClient.get(helper.po_details_node, function (err, reply_po_details)
            {
                if (err)
                {
                    debug('error while retreiving from redis- {}'.format(err));
                    return;
                }


                var json_data = { "json_result": reply_po_details, "reconcile_stock_count": reconcile_stock_count };

                var json_parsed_po_in_redis = JSON.parse(json_data.json_result);
                var reconcile_redis_stock = json_data.reconcile_stock_count;

                if (json_parsed_po_in_redis != undefined && json_parsed_po_in_redis != null)
                {
                    for (var po_id in json_parsed_po_in_redis)
                    {
                        // PO master values
                        var po_list = json_parsed_po_in_redis;
                        var po_master_data = po_list[po_id][0];
                        var po_id_pad = po_master_data.po_id.pad(8);
                        var restaurant_id = po_master_data.restaurant_id;
                        var restaurant_name = po_master_data.rest_name;
                        var session_name = po_master_data.session_name;

                        var po_items = po_list[po_id];
                        for (var item_count = 0; item_count < po_items.length; item_count++)
                        {
                            var scanned_item_count = 0;
                            // PO Item values   
                            var item_id = po_items[item_count].food_item_id;
                            var item_po_qty = po_items[item_count].qty;
                            var item_name = po_items[item_count].item_name;

                            // filter reconcile_stock_count based on po_id and item_id   
                            var reconcile_stock_item_data = _.where(reconcile_redis_stock, { 'po_id': po_id_pad, 'item_id': item_id.toString(), 'is_reconciled': false });

                            var groups = _.groupBy(reconcile_stock_item_data, function (value)
                            {
                                return value.po_id + '#' + value.item_id;
                            });

                            var data = _.map(groups, function (group)
                            {
                                return {
                                    count: _(group).reduce(function (m, x) { return m + x.count; }, 0)
                                }
                            });

                            if (data != undefined && data.length > 0)
                            {
                                scanned_item_count = Number(data[0].count);

                                if (scanned_item_count < item_po_qty)
                                {
                                    pending_reconcile_items.push({
                                        po_id: po_id,
                                        restaurant_id: restaurant_id,
                                        restaurant_name: restaurant_name,
                                        food_item_id: item_id,
                                        item_name: item_name,
                                        po_qty: item_po_qty,
                                        scanned_qty: scanned_item_count,
                                        session_name: session_name
                                    });
                                }
                            }
                        }
                    }
                    if (pending_reconcile_items.length > 0)
                    {
                        res.send({ pendingreconcile: true, pending_reconcile_items: pending_reconcile_items })
                    }
                    else
                    {
                        res.send({ pendingreconcile: false, pending_reconcile_items: pending_reconcile_items })
                    }
                }
                else
                {
                    res.send({ pendingreconcile: true, pending_reconcile_items: pending_reconcile_items })
                }
            });
        });
});

router.get('/getSalesDetails', function (req, res, next)
{
    var hq_url = process.env.HQ_URL;
    var outlet_id = process.env.OUTLET_ID;
    var login_Url = "/users/salesdetails/";
    console.log(req.body);
    requestretry({
        url: hq_url + login_Url + loggedinuserid + '/' + outlet_id,
        method: "GET",
        forever: true,
    },
        function (error, response, body)
        {
            if (error || (response && response.statusCode != 200))
            {
                console.error('{}: {} {}'.format(hq_url, error, body));
                res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                return;
            }
            res.status(200).send({"sales_details": body });
        });

});

router.post('/Logout', function (req, res, next)
{
    var hq_url = process.env.HQ_URL;
    var outlet_id = process.env.OUTLET_ID;
    var login_Url = "/users/Logout";
    //console.log(req.body);
    redisClient.get(helper.outlet_config_node, function (err, reply) {
        if (err)
        {
            console.log('error while retreiving from redis- {}'.format(err), null);
            return;
        }

        console.log("#################************############*************####  outlet_config :: " + JSON.parse(reply));
        outlet_config = JSON.parse(reply);
        //var reqdata = JSON.parse(req.body);
        requestretry({
            url: hq_url + login_Url,
            method: "POST",
            forever: true,
            json: { "userid": loggedinuserid, "remarks": req.body.remarks, "mailcontent": req.body.mailcontent, "outlet_name": outlet_config.name, "store_managers_mail_id": outlet_config.store_managers_mail_id, "username": req.body.username, "outlet_id": outlet_id }
        },
            function (error, response, body)
            {
                if (error || (response && response.statusCode != 200))
                {
                    console.error('{}: {} {}'.format(hq_url, error, body));
                    res.status(500).send('{}: {} {}'.format(hq_url, error, body));
                    return;
                }
                if (body != null)
                {
                    if (body.indexOf("success") > -1)
                    {
                        redisClient.del("loginuserdetails", function (err, res)
                        {
                            if (err)
                            {
                                console.error('error while inserting in redis- {}'.format(err));
                                return;
                            }
                        });

                        redisClient.del("loginuserid", function (err, res)
                        {
                            if (err)
                            {
                                console.error('error while inserting in redis- {}'.format(err));
                                return;
                            }
                        });
                    }
                }
                res.status(200).send(body);
            });
    });
});

function loaduserDetails()
{
    console.log("******LoginUseDetails*********")
    if (loggedinuserid == null || loggedinuserid == 0)
    {
        console.log("******LoginUseDetails********* TRUE")
        redisClient.get("loginuserdetails",
            function (set_err, set_reply)
            {
                if (set_err)
                {
                    console.error('error while getting  from redis- {}'.format(set_err));
                    return;
                }
                if (set_reply != null)
                {
                    console.log("******LoginUseDetails********* TRUE*******")
                    var data = JSON.parse(set_reply);
                    loggedinuserid = data.user_id;
                    console.log(loggedinuserid);
                }
            });
    }
}

setInterval(loaduserDetails, 10000);

module.exports = router;