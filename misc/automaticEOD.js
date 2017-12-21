var requestretry = require('requestretry');
var redis = require('redis');
var format = require('string-format');
var request = require('request');
var express = require('express');
var helper = require('../routes/helper');
var async = require('async');
var _ = require('underscore');

var debug = require('debug')('automaticEOD:server');

format.extend(String.prototype);


// Initiating the redisClient
var redisClient = redis.createClient({ connect_timeout: 2000, retry_max_delay: 5000 });
redisClient.on('error', function (msg) {
    console.error(msg);
});

var hq_url = process.env.HQ_URL;
var outlet_id = process.env.OUTLET_ID;
var outlet_host = process.env.OUTLET_HOST;
var port = process.env.PORT;
var outlet_url = outlet_host + port;

module.exports.InitAutomaticEOD = function () {
    console.log("InitAutomaticEOD function called");
    console.log("hq_url: " + hq_url + " outlet_id: " + outlet_id);
    AutomaticEOD();
}

function AutomaticEOD() {
    console.log("AutomaticEOD function called");
    var outlet_config;
    var automatic_eod_time;
    var automatic_eod_time_in_minutes;
    var automatic_eod_time_in_minutes_variation;
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
        // console.log("outlet_config automatic_eod_time:: " + outlet_config.automatic_eod_time);
        automatic_eod_time = outlet_config.automatic_eod_time;
        if (automatic_eod_time != null)
        {
            var s1 = automatic_eod_time.split(":");
            automatic_eod_time_in_minutes = s1[0] * 60 + Number(s1[1]);
            // 35 mins time added with automatic_eod_time
            automatic_eod_time_in_minutes_variation = automatic_eod_time_in_minutes + 35;

            console.log("time_in_mins :" + time_in_mins + " automatic_eod_time_in_minutes: " + automatic_eod_time_in_minutes);

            if (time_in_mins >= automatic_eod_time_in_minutes && time_in_mins < automatic_eod_time_in_minutes_variation)
            {
                console.log("Inside condition time_in_mins :" + time_in_mins + " automatic_eod_time_in_minutes: " + automatic_eod_time_in_minutes);

                async.waterfall([
                   function (callback) {
                       // AutomaticReconcile(true);
                       callback(null);
                   }, function (callback) {
                       checkAutomaticEOD(outlet_config.is24hr);
                       callback(null);                   
                   }], function (err, result) {
                       if (result)
                       {
                           console.log("Automatic EOD Done. Outlet Id: " + outlet_id + " Date and Time: " + new Date().toLocaleString());
                       }
                   });
            }
        }
    });
}

function checkAutomaticEOD(is24hr) {
    console.log("checkAutomaticEOD function called:: is24hr :" + is24hr);
    request({
        url: hq_url + '/outlet/get_eod_status/' + outlet_id,
        method: "GET"
    },
       function (error, response, data) {
           if (error || (response && response.statusCode != 200))
           {
               console.error('{}: {} {}'.format(hq_url, error, ""));;
               return;
           }

           // var tem = JSON.stringify(data);
           console.log('Received eod status data ' + data);
           if (data=="false")
           {               
               // automatic_sod_24hr_outlet
               if (is24hr)
               {
                   console.log("outlet_app/automatic_sod_24hr_outlet called");

                   request({
                       url: outlet_url + '/outlet_app/automatic_sod_24hr_outlet',
                       method: "POST"
                   },
               function (error, response_automatic_sod_24hr_outlet, body) {
                   if (error || (response_automatic_sod_24hr_outlet && response_automatic_sod_24hr_outlet.statusCode != 200))
                   {
                       console.error('{}: {} {}'.format(hq_url, error, ""));
                       return;
                   }
               });
               }

               // EOD status entry in outlet_register table
               // outlet_app.outlet_register("eod", true);
               var phase = 'eod';               
               var OUTLET_REGISTER_URL = hq_url + '/outlet_mobile/outlet_register_status';
               request({
                   url: OUTLET_REGISTER_URL,
                   method: "POST",
                   json: { "phase": phase, "outlet_id": outlet_id, "isautomaticEOD": true}
               }, function (error, response, body) {
                   if (error || (response && response.statusCode != 200))
                   {
                       console.error('{}: {} {}'.format(hq_url, error, body));
                       return;
                   }
                   //debug(body);
               });


               // expire_all_items
               request({
                   url: outlet_url + '/outlet_app/expire_all_items',
                   method: "POST"
               },
                  function (error, response_expire_all_items, body) {
                      if (error || (response_expire_all_items && response_expire_all_items.statusCode != 200))
                      {
                          console.error('{}: {} {}'.format(hq_url, error, ""));
                          return;
                      }

                      console.log("expire_all_items done");
                  });

               // update_reconcile_stock_count
               console.log("update_reconcile_stock_count called");
               request({
                   url: outlet_url + '/outlet_app/update_reconcile_stock_count',
                   method: "POST"
               },
               function (error, response_update_reconcile_stock_count, body) {
                   if (error || (response_update_reconcile_stock_count && response_update_reconcile_stock_count.statusCode != 200))
                   {
                       console.error('{}: {} {}'.format(hq_url, error, ""));
                       return;
                   }
               });

               // signal_expiry_item_removal
               request({
                   url: outlet_url + '/outlet_app/signal_expiry_item_removal',
                   method: "POST"
               },
                  function (error, response_expire_all_items, body) {
                      if (error || (response_expire_all_items && response_expire_all_items.statusCode != 200))
                      {
                          console.error('{}: {} {}'.format(hq_url, error, ""));
                          return;
                      }

                      console.log("signal_expiry_item_removal done");
                  });


               // Deleting the zero sales node
               redisClient.del(helper.zero_sales_count_node, function (del_err, del_reply) {
                   if (del_err)
                   {
                       console.error("error while deleting zero sales in redis- {}".format(b_err));
                       return;
                   }
               });

               // Resetting the bill_no to 1 because its at the end of the day
               redisClient.set(helper.bill_no_node, 1, function (b_err, b_reply) {
                   if (b_err)
                   {
                       console.error("error while setting bill_no in redis- {}".format(b_err));
                       return;
                   }

                   redisClient.get(helper.dispense_id_node, function (dis_err, dis_reply) {
                       // Store the recovery details in the HQ
                       var UPDATE_RECOVERY_DETAILS_URL = hq_url + '/outlet/update_recovery_details/' + outlet_id;
                       request({
                           url: UPDATE_RECOVERY_DETAILS_URL,
                           method: "POST",
                           json: {
                               "bill_no": 1,
                               "dispense_id": JSON.parse(dis_reply)
                           }
                       }, function (error, response, body) {
                           if (error || (response && response.statusCode != 200))
                           {
                               console.error('{}: {} {}'.format(hq_url, error, body));
                               return;
                           }
                           debug("Updated HQ with the recovery details");
                       });
                   });

                   // Setting the start of day flag to true
                   redisClient.set(helper.start_of_day_flag, true, function (sod_err, sod_reply) {
                       if (sod_err)
                       {
                           console.error("error while setting sod in redis- {}".format(sod_err));
                           res.status(500).send(sod_err);
                           return;
                       }
                   });

                   redisClient.del("loginuserdetails", function (del_err, del_reply)
                   {
                       if (del_err)
                       {
                           console.error("error while deleting loginuserdetails in redis- {}".format(b_err));
                           return;
                       }
                   });
                   redisClient.del("loginuserid", function (del_err, del_reply)
                   {
                       if (del_err)
                       {
                           console.error("error while deleting loginuserid in redis- {}".format(b_err));
                           return;
                       }
                   });

                   // delete_reconcile_stock_count
                   request({
                       url: outlet_url + '/outlet_app/delete_reconcile_stock_count',
                       method: "POST"
                   },
                      function (error, response, body) {
                          if (error || (response && response.statusCode != 200))
                          {
                              console.error('{}: {} {}'.format(hq_url, error, ""));
                              return;
                          }

                          console.log("signal_expiry_item_removal done");
                      });
               });
           }
       });
}

