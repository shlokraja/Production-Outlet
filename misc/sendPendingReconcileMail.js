var requestretry = require('requestretry');
var redis = require('redis');
var format = require('string-format');
var request = require('request');
var express = require('express');
// var helper = require('./routes/helper');
var helper = require('../routes/helper');
var async = require('async');
var _ = require('underscore');
var debug = require('debug')('automaticEOD:server');

format.extend(String.prototype);

var food_item_data = {};

// Initiating the redisClient
//var redisClient = redis.createClient(6379, '192.168.1.60', { connect_timeout: 2000, retry_max_delay: 5000 });
//redisClient.on('error', function (msg) {
//    console.error(msg);
//});

var redisClient = redis.createClient({ connect_timeout: 2000, retry_max_delay: 5000 });
redisClient.on('error', function (msg) {
    console.error(msg);
});

var hq_url = process.env.HQ_URL;
var outlet_id = process.env.OUTLET_ID;
var outlet_host = process.env.OUTLET_HOST;
var port = process.env.PORT;
var outlet_url = outlet_host + port;

//var hq_url = 'http://192.168.1.147:9000';
//var outlet_id = 6;
//var outlet_host = 'http://192.168.1.60:';
//var port = 8000;
//var outlet_url = outlet_host + port;

module.exports.InitPendingReconcileMail = function () {
    console.log("InitPendingReconcileMail function called");
    console.log("hq_url: " + hq_url + " outlet_id: " + outlet_id);
    send_pending_reconcile_mail();
}

function send_pending_reconcile_mail() {
    console.log("################################################### send_pending_reconcile_mail functionality called");

    request({
        url: outlet_url + '/outlet_app/outlet_session_timings',
        method: "GET"
    },
      function (error, response, outlet_session_timings) {
          if (error || (response && response.statusCode != 200))
          {
              console.error('{}: {} {}'.format(hq_url, error, ""));
              return;
          }

          console.log("outlet_session_timings:: " + JSON.stringify(outlet_session_timings));

          outlet_session_timings = JSON.parse(outlet_session_timings);
          if (outlet_session_timings != null)
          {
              for (var time_count = 0; time_count < outlet_session_timings.length; time_count++)
              {
                  var session_time_in_minutes;
                  var session_time_in_minutes_variation;
                  var current_time = new Date();
                  var time_in_mins = current_time.getHours() * 60 + current_time.getMinutes();

                  console.log("outlet_session_timings:: Inside function " + outlet_session_timings[time_count].end_time);

                  var s1 = outlet_session_timings[time_count].end_time.split(":");
                  session_time_in_minutes = s1[0] * 60 + Number(s1[1]) + 60;
                  session_time_in_minutes_variation = session_time_in_minutes + 35;

                  if (time_in_mins >= session_time_in_minutes && time_in_mins < session_time_in_minutes_variation)
                  {
                      send_pending_reconciled_items_mail();
                      break;
                  }
              }
          }
      });
}

function send_pending_reconciled_items_mail() {

    console.log("################################################### send_pending_reconciled_items_mail functionality called");
    var pending_reconcile_items = [];
    var reconcile_redis_items = [];
    // Get PO details

    request({
        url: outlet_url + '/outlet_app/get_po_details/',
        method: "GET"
    },
     function (error, response, data) {
         if (error || (response && response.statusCode != 200))
         {
             // console.log("send_pending_reconciled_items_mail function :: get_po_details Error:: ################################################### Error:: " + error);
             console.error('{}: {} {}'.format(outlet_url, error, ""));
             return;
         }

         console.log("********************************************* send_pending_reconciled_items_mail :: json_parsed_po_in_redis:: " + JSON.stringify(data));
         var json_data = JSON.parse(data);

         var json_parsed_po_in_redis = JSON.parse(json_data.json_result);
         var reconcile_redis_stock = json_data.reconcile_stock_count;
         console.log("********************************************* send_pending_reconciled_items_mail :: json_parsed_po_in_redis:: " + JSON.stringify(json_parsed_po_in_redis));
         console.log("********************************************* send_pending_reconciled_items_mail :: reconcile_redis_stock:: " + JSON.stringify(reconcile_redis_stock));

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
                 var po_scheduled_time = po_master_data.scheduled_time;
                 var session_start_time = po_master_data.start_time;
                 var session_end_time = po_master_data.end_time;
                 var po_items = po_list[po_id];

                 var session_time_in_minutes;
                 var current_time = new Date();
                 var time_in_mins = current_time.getHours() * 60 + current_time.getMinutes();
                                  
                 var s1 = session_end_time.split(":");
                 session_time_in_minutes = s1[0] * 60 + Number(s1[1]);

                 console.log("************************* send_pending_reconciled_items_mail :: current_time: " + time_in_mins + "session_time_in_minutes: " + session_time_in_minutes);
                 for (var item_count = 0; item_count < po_items.length; item_count++)
                 {
                     var scanned_item_count = 0;
                     // PO Item values   
                     var item_id = po_items[item_count].food_item_id;
                     var item_po_qty = po_items[item_count].qty;
                     var item_name = po_items[item_count].item_name;

                     // filter reconcile_stock_count based on po_id and item_id   
                     var reconcile_stock_item_data = _.where(reconcile_redis_stock, { 'po_id': po_id_pad, 'item_id': item_id.toString(), 'is_reconciled': false });

                     //$.each(reconcile_stock_item_data, function () {
                     //    scanned_item_count += this.count;
                     //});

                     var groups = _.groupBy(reconcile_stock_item_data, function (value) {
                         return value.po_id + '#' + value.item_id;
                     });

                     var data = _.map(groups, function (group) {
                         return {
                             count: _(group).reduce(function (m, x) { return m + x.count; }, 0)
                         }
                     });

                     if (session_time_in_minutes <= time_in_mins)
                     {
                         if (data != undefined && data.length > 0)
                         {
                             scanned_item_count = Number(data[0].count);
                         }

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

             console.log("********************************************* send_pending_reconciled_items_mail :: pending_reconcile_items:: " + JSON.stringify(pending_reconcile_items));
         }
         send_pending_reconcile_po_mail_main(pending_reconcile_items, function (err, res) {
             if (err)
             {
                 console.error('send_pending_reconcile_po_mail: ' + err);
             }
             else
             {
                 console.log('send_pending_reconcile_po_mail sent successfully');
             }
         });
     });
}

function send_pending_reconcile_po_mail_main(items) {
    console.log("####################################################### send_pending_reconcile_po_mail ==========" + JSON.stringify(items));
    var mail_content = "";

    for (var item in items)
    {
        var po_id = items[item].po_id;
        var restaurant_name = items[item].restaurant_name;
        var session_name = items[item].session_name;
        var item_name = items[item].item_name;
        var po_qty = items[item].po_qty;
        var scanned_qty = items[item].scanned_qty;

        var undelivered_quantity = Number(po_qty) - Number(scanned_qty);

        console.log("started send_pending_reconcile_po_mail ===" + JSON.stringify(items[item]));
        if (Number(undelivered_quantity) > 0)
        {
            mail_content += "<tr style=\"font-size: 14px;color: #333333;\"><td style=\"padding: 5px;\">" + po_id + "</td><td style=\"padding: 5px;\">" + restaurant_name + "</td>";
            mail_content += "<td style=\"padding: 5px;\">" + session_name + "</td><td style=\"padding: 5px;\">" + item_name + "</td>";
            mail_content += "<td style=\"padding: 5px;\">" + po_qty + "</td><td style=\"padding: 5px;\">" + scanned_qty + "</td>";
            mail_content += "<td style=\"padding: 5px;\">" + undelivered_quantity + "</td></tr>";
        }
    }
    send_pending_reconcile_po_mail(mail_content, items.length, function (err, res) {
        if (err)
        {
            console.error('send_pending_reconcile_po_mail_main: ' + err);
        }
        else
        {
            console.log('send_pending_reconcile_po_mail sent successfully');
        }
    });
}

function send_pending_reconcile_po_mail(mail_content, items_count, callback) {
    if (Number(items_count) > 0)
    {
        // console.log("#################************############*************#### send_pending_reconcile_po_mail items_count:: ==========" + items_count);
        redisClient.get(helper.outlet_config_node, function (err, reply) {
            if (err)
            {
                console.log('error while retreiving from redis- {}'.format(err), null);
                return;
            }

            // console.log("#################************############*************####  outlet_config :: " + reply);
            outlet_config = JSON.parse(reply);

            // console.log("outlet_config automatic_eod_time:: " + outlet_config.automatic_eod_time);
            // var store_managers_mail_id = outlet_config.store_managers_mail_id;

            // console.log("#################************############*************####  outlet_config :: " + outlet_config.name + "store_managers_mail_id : " + outlet_config.store_managers_mail_id);

            request({
                url: outlet_url + "/outlet_app/send_pending_reconcile_po_mail",
                method: "POST",
                json: {
                    "mail_content": mail_content, "outlet_id": outlet_id, "outlet_name": outlet_config.name,
                    "store_managers_mail_id": outlet_config.store_managers_mail_id, "city": outlet_config.city
                }
            });

            items = [];
            callback(null, 'done');
        });
    }
}

Number.prototype.pad = function (size) {
    var s = String(this);
    while (s.length < (size || 2)) { s = "0" + s; }
    return s;
}