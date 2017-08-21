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

getItemDetails();
// Get food item details every 30 mins
//setInterval(getItemDetails(), 30 * 600000);

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
var pflag = false;

//var hq_url = 'http://192.168.1.147:9000';
//var outlet_id = 6;
//var outlet_host = 'http://192.168.1.60:';
//var port = 8000;
//var outlet_url = outlet_host + port;

module.exports.InitEODAutomaticReconcile = function () {

    console.log("InitEODAutomaticReconcile function called");
    console.log("hq_url: " + hq_url + " outlet_id: " + outlet_id);
    var outlet_config;
    var automatic_reconcile_eod_time;
    var automatic_reconcile_eod_time_in_minutes;
    var automatic_reconcile_eod_time_in_minutes_variation;
    var is24hr;

    var current_time = new Date();
    var time_in_mins = current_time.getHours() * 60 + current_time.getMinutes();


    redisClient.get(helper.outlet_config_node, function (err, reply) {
        if (err)
        {
            console.log('error while retreiving from redis- {}'.format(err), null);
            return;
        }

        outlet_config = JSON.parse(reply);

        console.log("outlet_config :: " + outlet_config);
        // console.log("outlet_config automatic_reconcile_eod_time:: " + outlet_config.automatic_reconcile_eod_time);
        automatic_reconcile_eod_time = outlet_config.end_of_day;
        if (automatic_reconcile_eod_time != null)
        {
            var s1 = automatic_reconcile_eod_time.split(":");
            automatic_reconcile_eod_time_in_minutes = s1[0] * 60 + Number(s1[1]);
            // 35 mins time added with automatic_reconcile_eod_time
            automatic_reconcile_eod_time_in_minutes_variation = automatic_reconcile_eod_time_in_minutes + 20;

            console.log("InitEODAutomaticReconcile :: time_in_mins :" + time_in_mins + " automatic_reconcile_eod_time_in_minutes: " + automatic_reconcile_eod_time_in_minutes);

            if (time_in_mins >= automatic_reconcile_eod_time_in_minutes && time_in_mins < automatic_reconcile_eod_time_in_minutes_variation)
            {
                console.log("InitEODAutomaticReconcile :: Inside condition time_in_mins :" + time_in_mins + " automatic_reconcile_eod_time_in_minutes: " + automatic_reconcile_eod_time_in_minutes);

                GetPODetailsEOD(true, function (err, res) {
                    if (err)
                    {
                        //callback(err, null);
                        console.log("InitEODAutomaticReconcile: " + err);
                        return;
                    }
                    else
                    {
                        //callback(null, res);
                        console.log("InitEODAutomaticReconcile success");
                    }
                });
            }
        }
    });
}

//module.exports.InitEODAutomaticReconcile = function (callback) {
//    pflag = true;
//    console.log("InitEODAutomaticReconcile function called");
//    console.log("hq_url: " + hq_url + " outlet_id: " + outlet_id);
//    // GetPODetails(true, callback);
//    GetPODetailsEOD(true, callback);
//}

// AutomaticReconcile(true);
//function AutomaticReconcile(is_end_of_day,callback) {
//    console.log("AutomaticReconcile function :: ################################################### Automatic Reconcile functionality called");
//    GetPODetails(is_end_of_day);
//}


function GetPODetailsEOD(is_end_of_day, callback) {
    var reconcile_items = [];
    var excess_quantity_items = [];

    console.log("InitEODAutomaticReconcile GetPODetails function called" + outlet_url + " is_end_of_day: " + is_end_of_day);

    redisClient.get(helper.reconcile_stock_count_node,
        function (err, reply_reconcile_stock_count) {
            if (err)
            {
                console.error("outlet_app.js :: get_po_details " + err);
                callback(err, null);
                return;
            }
            else
            {

                //reconcile_stock_count = JSON.parse(reply_reconcile_stock_count);
                console.log("InitEODAutomaticReconcile :: reconcile_stock_count: " + JSON.stringify(reply_reconcile_stock_count));

                redisClient.get(helper.po_details_node, function (err, reply_po_details) {
                    if (err)
                    {
                        debug('error while retreiving from redis- {}'.format(err));
                        callback(err, null);
                        return;
                    }
                    else
                    {

                        var data = { "json_result": reply_po_details, "reconcile_stock_count": reply_reconcile_stock_count };





                        console.log("********************************************* json_data:: " + JSON.stringify(data));
                        //var json_data = JSON.parse(data);

                        console.log("********************************************* json_data:: " + JSON.stringify(data));
                        var json_parsed_po_in_redis = JSON.parse(data.json_result);
                        var reconcile_redis_stock = JSON.parse(data.reconcile_stock_count);
                        //console.log("********************************************* json_parsed_po_in_redis:: " + JSON.stringify(json_parsed_po_in_redis));
                        //console.log("********************************************* reconcile_redis_stock:: " + JSON.stringify(reconcile_redis_stock));
                        if (json_parsed_po_in_redis != undefined && json_parsed_po_in_redis != null)
                        {
                            console.log("***************** InitEODAutomaticReconcile :: condition true");
                            for (var po_id in json_parsed_po_in_redis)
                            {
                                // PO master values
                                var po_list = json_parsed_po_in_redis;
                                var po_master_data = po_list[po_id][0];
                                var po_id_pad = po_master_data.po_id.pad(8);
                                var po_scheduled_time = po_master_data.scheduled_time;
                                var session_start_time = po_master_data.start_time;
                                var session_end_time = po_master_data.end_time;
                                var restaurant_id = po_master_data.restaurant_id;
                                var restaurant_name = po_master_data.rest_name;
                                var po_reconciled_item_count = 0;
                                var reconcile_processed_by = 'auto';

                                var po_items = po_list[po_id];
                                for (var item_count = 0; item_count < po_items.length; item_count++)
                                {
                                    var scanned_item_count = 0;
                                    // PO Item values   
                                    var item_id = po_items[item_count].food_item_id;
                                    var item_tag = po_items[item_count].item_tag;
                                    var master_id = po_items[item_count].master_id;
                                    var item_po_qty = po_items[item_count].qty;
                                    var item_name = po_items[item_count].item_name;
                                    var is_reconciled_item = false;
                                    // filter reconcile_stock_count based on po_id and item_id   
                                    // var reconcile_stock_item_data = _.where(reconcile_redis_stock, { 'po_id': po_id_pad, 'item_id': item_id.toString(), 'is_reconciled': false });


                                    // console.log("********************************************* reconcile_stock_item_data:: " + JSON.stringify(reconcile_stock_item_data));

                                    //  if (reconcile_stock_item_data.length > 0)
                                    //  {
                                    //    var groups = _.groupBy(reconcile_stock_item_data, function (value) {
                                    //         return value.po_id + '#' + value.item_id;
                                    //     });

                                    //      var data = _.map(groups, function (group) {
                                    //         return {
                                    //            count: _(group).reduce(function (m, x) { return m + x.count; }, 0)
                                    //         }
                                    //     });

                                    //     console.log("********************************************* scanned_item_count :: data:: " + JSON.stringify(data));

                                    //    scanned_item_count = Number(data[0].count);

                                    console.log("InitEODAutomaticReconcile :: ********************************************* scanned_item_count :: " + scanned_item_count);
                                    console.log("InitEODAutomaticReconcile :: ********************************************* data :: " + data.length);
                                    //if (data != undefined && data.length > 0)
                                    // {

                                    console.log("InitEODAutomaticReconcile :: ********************************************* is_end_of_day :: " + is_end_of_day);
                                    if (is_end_of_day)
                                    {
                                        scanned_item_count = item_po_qty;
                                        reconcile_processed_by = 'autoNR';
                                    }

                                    console.log("InitEODAutomaticReconcile :: ********************************************* Updated new scanned_item_count :: " + scanned_item_count);
                                    if (scanned_item_count >= item_po_qty)
                                    {
                                        po_reconciled_item_count++;
                                        if (po_items.length == po_reconciled_item_count)
                                        {
                                            is_reconciled_item = true;
                                        }

                                        reconcile_items.push({
                                            po_id: po_id_pad,
                                            restaurant_id: restaurant_id,
                                            restaurant_name: restaurant_name,
                                            food_item_id: item_id,
                                            item_name: item_name,
                                            po_qty: item_po_qty,
                                            scanned_qty: scanned_item_count,
                                            unscanned_qty: 0,
                                            damaged_qty: 0,
                                            expiry_qty: 0,
                                            rest_fault_qty: 0,
                                            remarks: '',
                                            is_reconciled_item: is_reconciled_item,
                                            processed_by: reconcile_processed_by
                                        });
                                    }

                                    if (scanned_item_count > item_po_qty)
                                    {
                                        excess_quantity_items.push({
                                            po_id: po_id_pad,
                                            restaurant_id: restaurant_id,
                                            restaurant_name: restaurant_name,
                                            food_item_id: item_id,
                                            item_name: item_name,
                                            po_qty: item_po_qty,
                                            scanned_qty: scanned_item_count,
                                            unscanned_qty: 0,
                                            damaged_qty: 0,
                                            expiry_qty: 0,
                                            rest_fault_qty: 0,
                                            remarks: '',
                                        });
                                    }
                                    // }
                                    // }
                                }
                            }

                            console.log("InitEODAutomaticReconcile :: ********************************************* before save_reconcile_data_main reconcile_items :: " + JSON.stringify(reconcile_items));
                        }
                        save_reconcile_data_main(reconcile_items, excess_quantity_items, callback);
                    }
                });
            }
        });
};




function save_reconcile_data_main(reconcile_items, excess_quantity_items, callback) {
    console.log("InitEODAutomaticReconcile ::  function :: save_reconcile_data:: function started ################################################### reconcile_items:: " + JSON.stringify(reconcile_items));

    request({
        url: outlet_url + '/outlet_app/save_reconcile_data',
        method: "POST",
        json: { "reconcile_items": reconcile_items }
    },
        function (error, response, data) {
            if (error || (response && response.statusCode != 200))
            {
                console.error('{}: {} {}'.format(hq_url, error, ""));;
                callback(error, "Failed");
                return;
            }

            console.log("InitEODAutomaticReconcile ::  function :: save_reconcile_data:: function end ################################################### reconcile_items:: " + JSON.stringify(reconcile_items));
            //callback(null, "Success");
            update_received_time(reconcile_items, excess_quantity_items, callback);
        });

    //callback(null, "Success");
}


function update_received_time(reconcile_items, excess_quantity_items, callback) {
    console.log("InitEODAutomaticReconcile ::  function :: IncomingPOProcess::  function started ################################################### reconcile_items:: " + JSON.stringify(reconcile_items));
    IncomingPOProcess(null, null, reconcile_items);
    console.log("InitEODAutomaticReconcile ::  function :: IncomingPOProcess:: function end  ################################################### reconcile_items:: " + JSON.stringify(reconcile_items));
    //callback(null, "Success");
    update_reconcile_stock_count_automatic_main(reconcile_items, excess_quantity_items, callback);
}

function update_reconcile_stock_count_automatic_main(reconcile_items, excess_quantity_items, callback) {
    console.log("InitEODAutomaticReconcile ::  function :: update_reconcile_stock_count_automatic::  function started ################################################### reconcile_items:: " + JSON.stringify(reconcile_items));
    request({
        url: outlet_url + '/outlet_app/update_reconcile_stock_count_automatic',
        method: "POST",
        json: { "reconcile_items": reconcile_items }
    },
        function (error, response, data) {
            if (error || (response && response.statusCode != 200))
            {
                console.error('{}: {} {}'.format(hq_url, error, ""));
                callback(error, null);
                return;
            }

            console.log("InitEODAutomaticReconcile ::  function :: update_reconcile_stock_count_automatic::  function end ################################################### reconcile_items:: " + JSON.stringify(reconcile_items));
            reconcile_items = [];
            excess_quantity_items = [];
            callback(null, "Success");
        });

}

function send_restatrant_excess_po_mail(items) {
    console.log("InitEODAutomaticReconcile :: ####################################################### send_restatrant_excess_po_mail items==========" + JSON.stringify(items));
    var mail_response = "";
    var excess_mail_response = "";
    var excess_mail_content = "";
    var mail_message_count = 0;
    var total_undelivered_qty = 0;
    var total_excess_qty = 0;
    var restaurant_excess_mails = [];

    var restaurant_group_items = _.groupBy(items, function (value) {
        return value.po_id;
    });

    for (var po_id in restaurant_group_items)
    {
        excess_mail_response = "";
        excess_mail_content = "";
        var po_items = restaurant_group_items[po_id];
        for (var item_index = 0; item_index < po_items.length; item_index++)
        {
            console.log("started send_restatrant_undelivered_po_mail===" + JSON.stringify(po_items[item_index]));
            var food_item_id = po_items[item_index].food_item_id;
            var delivered_qty = Number(po_items[item_index].scanned_qty) + Number(po_items[item_index].unscanned_qty) + Number(po_items[item_index].damaged_qty);
            var undelivered_qty = Number(po_items[item_index].po_qty) - Number(delivered_qty);
            var excess_qty = Number(po_items[item_index].scanned_qty) - Number(po_items[item_index].po_qty);
            var item_name = po_items[item_index].item_name;
            var po_qty = po_items[item_index].po_qty;

            if (excess_qty > 0)
            {
                excess_mail_response += "<tr style=\"font-size: 14px;color: #333333;text-align:center;\"><td style=\"padding: 5px;\">" + item_name + "</td><td style=\"padding: 5px;\">" + po_qty + "</td><td style=\"padding: 5px;\">" + delivered_qty + "</td><td style=\"padding: 5px;\">" + excess_qty + "</td></tr>";
                console.log("send_restatrant_excess_quantity_po_mail mail_response==========" + JSON.stringify(excess_mail_response));
                total_excess_qty += excess_qty;
            }
        }

        if (total_excess_qty > 0)
        {
            excess_mail_content = '<html><body>';
            excess_mail_content += '<div>';
            excess_mail_content += 'Hi,<br/> Please find the following details of Excess Quantity against the PO(' + po_id + ') from your Restatrant. <br/><br/><br/><table class="reconsile" border="1" cellpadding="0" cellspacing="0" width="75%">';
            excess_mail_content += '<tr style="background-color: #fbb713;color: #4a4b4a;font-weight: bold;text-align:center;"><th style=\"padding: 5px;width:150px;\">Item Name</th><th style=\"padding: 5px;width:100px;\">PO Quantity</th><th style=\"padding: 5px;width:100px;\">Delivered Quantity</th><th style=\"padding: 5px;width:100px;\">Excess Quantity</th></tr>';
            excess_mail_content += excess_mail_response;
            excess_mail_content += '</table><br/><br/>';
            excess_mail_content += '<tr><td>  If you do not accept to any details mentioned the mail above, please respond to <a href=mailto:restaurantissues@owltech.in> restaurantissues@owltech.in </a> within 24 hours on receipt of mail stating the "date of delivery" and details of differences.</td></tr>';
            excess_mail_content += '<div><br/>Thanks,<br/>Frshly</div></body></html>';

            if (food_item_data != null)
            {
                //  console.log("#######################################################    food_item_data: " + JSON.stringify(food_item_data));
                if (food_item_data[food_item_id] != null)
                {
                    var restaurant_mail_id = food_item_data[food_item_id]["restaurant_details"].sender_email;
                    restaurant_excess_mails.push({
                        "po_id": po_id,
                        "restaurant_mail_id": restaurant_mail_id,
                        "excess_mail_content": excess_mail_content
                    });
                }
            }
        }
    }
    send_restautant_excess_mail(restaurant_excess_mails, function (err, res) {
        if (err)
        {
            console.error('send_restautant_excess_mail failed :' + err);
            //callback(err, null);
        }
        else
        {
            console.log("send_restautant_excess_mail: success");
            //callback(null, "success");
        }
    });
}

function send_restautant_excess_mail(restaurant_excess_mails, callback) {
    request({
        url: outlet_url + '/outlet_app/send_restautant_excess_mail',
        method: "POST",
        json: { "restaurant_excess_mails": restaurant_excess_mails }
    },
        function (error, response, data) {
            if (error || (response && response.statusCode != 200))
            {
                console.error('{}: {} {}'.format(outlet_url, error, ""));
                callback(error, null);
                return;
            }

            items = [];
            console.log("Excess items mail sent successfully");
            callback(null, 'done');
        });
}

// service for every 30 mins (To check and send pending reconciled items to store managers)
// setInterval(send_pending_reconcile_mail, 30 * 60000);

function send_pending_reconcile_mail() {
    console.log("InitEODAutomaticReconcile :: ################################################### send_pending_reconcile_mail functionality called");

    request({
        url: outlet_url + '/outlet_app/outlet_session_timings',
        method: "GET"
    },
      function (error, response, outlet_session_timings) {
          if (error || (response && response.statusCode != 200))
          {
              console.error('{}: {} {}'.format(hq_url, error, ""));;
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
                  session_time_in_minutes = s1[0] * 60 + Number(s1[1]);
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
             console.error('{}: {} {}'.format(outlet_url, error, ""));;
             return;
         }

         console.log("********************************************* send_pending_reconciled_items_mail :: json_parsed_po_in_redis:: " + JSON.parse(data));
         var json_data = JSON.parse(data);

         var json_parsed_po_in_redis = JSON.parse(json_data.json_result);
         var reconcile_redis_stock = json_data.reconcile_stock_count;
         // console.log("********************************************* send_pending_reconciled_items_mail :: json_parsed_po_in_redis:: " + JSON.stringify(json_parsed_po_in_redis));
         // console.log("********************************************* send_pending_reconciled_items_mail :: reconcile_redis_stock:: " + JSON.stringify(reconcile_redis_stock));

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

            // console.log("outlet_config automatic_reconcile_eod_time:: " + outlet_config.automatic_reconcile_eod_time);
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


function IncomingPOProcess(purchase_order_id, restaurant_id, reconcile_items) {
    var po_id = purchase_order_id;
    var batch_id = '';
    var rest_id = restaurant_id;

    request({
        url: outlet_url + '/outlet_app/store_last_load_info',
        method: "POST",
        json: { "po_id": po_id, "batch_id": batch_id, "rest_id": rest_id, "reconcile_items": reconcile_items }
    },
         function (error, response, data) {
             if (error || (response && response.statusCode != 200))
             {
                 console.error('{}: {} {}'.format(outlet_url, error, ""));;
                 return;
             }

             items = [];
             console.log("store_last_load_info successfully");
             // callback(null, 'done');
         });
}

//// This will return the prices and the veg/non-veg flag
function getItemDetails() {
    var hq_url = process.env.HQ_URL;
    var outlet_id = process.env.OUTLET_ID;
    var food_item_hq_url = hq_url + '/food_item/price_info/' + outlet_id;
    console.log("****************** food_item_hq_url:: food_item_hq_url " + food_item_hq_url);
    request({
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
                // console.log("****************** food_item_data:: HQ data " + JSON.stringify(data));
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
                            "tin_no": data[i]["r_tin_no"],
                            "sender_email": data[i]["r_sender_email"]
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

                //  console.log("****************** food_item_data:: " + JSON.stringify(food_item_data));

                return;
            }
        } catch (e)
        {
            general.genericError("mobileapp.js :: getItemDetails: " + e);
        }
    });
}

Number.prototype.pad = function (size) {
    var s = String(this);
    while (s.length < (size || 2)) { s = "0" + s; }
    return s;
}