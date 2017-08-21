var debug = require('debug')('outlet_app:server');
var format = require('string-format');
var redis = require('redis');
var async = require('async');
var firebase = require('firebase');
var requestretry = require('requestretry');

var helper = require('../routes/helper');
format.extend(String.prototype);
// Initiating the redisClient
var redisClient = redis.createClient({ connect_timeout: 2000, retry_max_delay: 5000 });
redisClient.on('error', function (msg)
{
    console.error(msg);
});

function updateStockCountExpiry()
{
    // getting the stock count
    redisClient.get(helper.stock_count_node, function (redis_err, redis_res)
    {
        if (redis_err)
        {
            console.error(redis_err);
            return;
        }
        var parsed_response = JSON.parse(redis_res);
        console.log("helper.stock_count_node response data :-", redis_res);
        var function_list = [];
        for (var item_id in parsed_response)
        {
            var fn = function (item_id, callback)
            {
                var current_item_id = item_id;
                // getting the expiry time for the item id
                redisClient.hget(helper.expiry_time_node, current_item_id,
                    function (err, expiry_time)
                    {
                        if (err)
                        {
                            callback('error while retrieving from redis- {}'.format(err), null);
                            return;
                        }
                        if (!expiry_time)
                        {
                            callback('Expiry time not set yet.', null);
                            return;
                        }
                        var expiry_time_secs = parseFloat(expiry_time.slice(0, expiry_time.length - 1)) * 60 * 60;
                        callback(null, [item_id, expiry_time_secs]);
                    });
            }
            function_list.push(fn.bind(null, item_id));
        }

        async.parallel(function_list, function (err, expiry_time_list)
        {
            if (err)
            {
                //console.error(err);
                return;
            }

            var expiry_time_dict = {};
            for (var i = 0; i < expiry_time_list.length; i++)
            {
                expiry_time_dict[expiry_time_list[i][0]] = expiry_time_list[i][1];
            }

            var current_time = Math.floor(Date.now() / 1000);
            var is_expired = false;
            for (var item_id in parsed_response)
            {
                var item_node = parsed_response[item_id];
                for (var i = 0; i < item_node["item_details"].length; i++)
                {
                    var timestamp = item_node["item_details"][i]["timestamp"];
                    if (timestamp + expiry_time_dict[item_id] <= current_time)
                    {
                        if (!parsed_response[item_id]["item_details"][i]["expired"])
                        {
                            debug('Item id - {} has expired from stock_count'.format(item_id));
                            parsed_response[item_id]["item_details"][i]["expired"] = true;
                            is_expired = true;
                            // Pushing the data to redis to store the list of expired slots
                            var slots = parsed_response[item_id]["item_details"][i]["slot_ids"];
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
                }
            }
            // Sending the new stock data, if any change at all.
            if (is_expired)
            {
                //Get expired item details
                var barcodes = [];
                for (var item_id in parsed_response)
                {
                    var item_node = parsed_response[item_id];
                    for (var i = 0; i < item_node["item_details"].length; i++)
                    {
                        if (item_node["item_details"][i]["expired"] && !item_node["item_details"][i]["isExpired_InsertedintoDb"])
                        {
                            for (var j = 0; j < item_node["item_details"][i]["count"]; j++)
                            {
                                barcodes.push(item_node["item_details"][i]["barcode"]);
                            }
                            //parsed_response[item_id]["item_details"][i]["isExpired_InsertedintoDb"] = true;
                        }
                    }
                }
                // Send expired items to HQ
                debug(" expired item time :-" + Date.now());
                var hq_url = process.env.HQ_URL;
                var REMOVE_EXPIRED_URL = hq_url + '/outlet/remove_expired_items';
                debug("REMOVE_EXPIRED_URL  :-" + REMOVE_EXPIRED_URL);
                requestretry({
                    url: REMOVE_EXPIRED_URL,
                    method: "POST",
                    maxAttempts: 1,
                    json: { "barcodes": barcodes }
                }, function (expire_error, expire_response, expire_body)
                {
                    debug("expire_response.statusCode", expire_response.statusCode);
                    if (expire_error || (expire_response && expire_response.statusCode != 200))
                    {
                        console.error('{}: {} {}'.format(hq_url, expire_error, expire_body));
                        return;
                    }
                    else if (expire_error || (expire_response && expire_response.statusCode == 200))
                    {
                        for (var item_id in parsed_response)
                        {
                            var item_node = parsed_response[item_id];
                            for (var i = 0; i < item_node["item_details"].length; i++)
                            {
                                if (item_node["item_details"][i]["expired"] && !item_node["item_details"][i]["isExpired_InsertedintoDb"])
                                {
                                    parsed_response[item_id]["item_details"][i]["isExpired_InsertedintoDb"] = true;
                                }
                            }
                        }
                    }

                    debug("Update stock count expiry  :-" + expire_body);
                });

                // Resetting the stock_count
                redisClient.set(helper.stock_count_node,
                          JSON.stringify(parsed_response),
                          function (set_stock_count_err, set_stock_count_reply)
                          {
                              if (set_stock_count_err)
                              {
                                  console.error('error while inserting in redis- {}'.format(set_stock_count_err));
                              }
                          });
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

                    // Put the data in firebase
                    var rootref = new firebase(process.env.FIREBASE_CONN);
                    var stock_count_node = rootref.child('{}/{}'.format(process.env.OUTLET_ID, helper.stock_count_node));
                    stock_count_node.set(parsed_response);
                });
            }
        });
    });
}

module.exports = updateStockCountExpiry;
