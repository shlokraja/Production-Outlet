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
               else
               {
		console.log('loggedinuserid  ' + loggedinuserid);
                redisClient.del("loginuserid", function (del_err, del_reply)
                {
                     if (del_err)
                     {
                         console.error("error while deleting loginuserid in redis- {}".format(del_err));
                         return;
                     }
		    console.log('loggedinuserid  ' + del_reply);
		    if(del_reply!=undefined || del_reply!=null){
			if(del_reply!= 0) { 
                   		eod_user_session_logout(del_reply);
			}
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

function eod_user_session_logout(user_id)
{
    var hq_url = process.env.HQ_URL;
    var outlet_id = process.env.OUTLET_ID;
    var login_Url = "/users/salesdetails/";
console.log("****************************" + hq_url + login_Url + loggedinuserid + '/' + outlet_id);
    requestretry({
        url: hq_url + login_Url + user_id + '/' + outlet_id,
        method: "GET",
        forever: true,
    },
        function (error, response, body)
        {
            if (error || (response && response.statusCode != 200))
            {
                console.error('{}: {} {}'.format(hq_url, error, body));
                return;
            }
            data = JSON.parse(body);
            if (data != null)
            {
		console.log("****************************" + hq_url + login_Url + user_id + '/' + outlet_id);

                var sales_html = "";
                var cashTotal = 0;
                var cardTotal = 0;
                var sodexocardTotal = 0;
                var sodexocouponTotal = 0;
                var creditTotal = 0;
                var gprscardTotal = 0;
                var walletTotal = 0;
                var Total = 0;

                var ScannedCount = 0;
                var UnscannedCount = 0;
                var DamagedCount = 0;
                var ExpiryCount = 0;
                var UndeliveredCount = 0;
                var RestaurantFaultCount = 0;

                var Totaltaken = 0;
                var TotalSold = 0;


                sales_html += "<table class='table table-striped table-hover' style='table-layout:fixed;font-size:small'>";
                sales_html += "<thead>";
                sales_html += "<tr class='tableheader'>";
                sales_html += "<th style='width:60px'>PO id</th>";
                sales_html += "<th style='width:50px'>Res Name</th>";
                sales_html += "<th style='width:70px'>Session</th>";
                sales_html += "<th style='width:70px'>Food Item Id</th>";
                sales_html += "<th style='width:200p'>Food Name</th>";
                sales_html += "<th style='width:70px'>Scanned</th>";
                sales_html += "<th style='width:70px'>Unscanned</th>";
                sales_html += "<th style='width:70px'>Damaged</th>";
                sales_html += "<th style='width:50px'>Expiry</th>";
                sales_html += "<th style='width:50px'>Res Fault</th>";
                sales_html += "<th style='width:100p'>Undelivered</th>";
                sales_html += "<th style='width:50px'>Taken</th>";
                sales_html += "<th style='width:40px'>Sold</th>";
                sales_html += "<th style='width:50px'>Cash</th>";
                sales_html += "<th style='width:50px'>Card</th>";
                sales_html += "<th style='width:50px'>Sodexo Card</th>   ";
                sales_html += "<th style='width:50px'>Sodexo Coupon</th> ";
                sales_html += "<th style='width:50px'>Credit</th>";
                sales_html += "<th style='width:50px'>Gprs Card</th>";
                sales_html += "<th style='width:50px'>Wallet</th>";
                sales_html += "<th style='width:50px'>Total</th>";
                sales_html += "</tr>";
                sales_html += "</thead>";
                sales_html += "<tbody id='Sales_details_table'>";
                for (var i = 0; i < data.length; i++)
                {
                    var item_Total = 0;
                    var salesdata = data[i];
                    sales_html += "<tr>";

                    sales_html += "<td style='text-align:center;'>" + salesdata.po_id + "</td>";
                    sales_html += "<td style='text-align:center;'>" + salesdata.restaurantname + "</td>";
                    sales_html += "<td style='text-align:center;'>" + salesdata.session + "</td>";
                    sales_html += "<td style='text-align:center;'>" + salesdata.item_id + "</td>";
                    sales_html += "<td style='text-align:left; width:200px'>" + salesdata.name + "</td>";
                    sales_html += "<td style='text-align:right;'>" + salesdata.scanned + "</td>";
                    sales_html += "<td style='text-align:right;'>" + salesdata.unscanned + "</td>";
                    sales_html += "<td style='text-align:right;'>" + salesdata.damaged + "</td>";
                    sales_html += "<td style='text-align:right;'>" + salesdata.expiry + "</td>";
                    sales_html += "<td style='text-align:right;'>" + salesdata.restaurantfault + "</td>";
                    sales_html += "<td style='text-align:right;'>" + salesdata.undelivered + "</td>";
                    sales_html += "<td style='text-align:right;'>" + salesdata.taken + "</td>";
                    sales_html += "<td style='text-align:right;'>" + salesdata.sold + "</td>";
                    sales_html += "<td style='text-align:right;'>" + salesdata.cash + "</td>";
                    sales_html += "<td style='text-align:right;'>" + salesdata.card + "</td>";
                    sales_html += "<td style='text-align:right;'>" + salesdata.sodexocard + "</td>";
                    sales_html += "<td style='text-align:right;'>" + salesdata.sodexocoupon + "</td>";
                    sales_html += "<td style='text-align:right;'>" + salesdata.credit + "</td>";
                    sales_html += "<td style='text-align:right;'>" + salesdata.gprscard + "</td>";
                    sales_html += "<td style='text-align:right;'>" + salesdata.wallet + "</td>";
                    item_Total = salesdata.cash + salesdata.card + salesdata.sodexocard + salesdata.sodexocoupon + salesdata.credit + salesdata.gprscard + salesdata.wallet;
                    sales_html += "<td style='text-align:right;'>" + item_Total + "</td>";
                    sales_html += "</tr>";
                    cashTotal += salesdata.cash;
                    cardTotal += salesdata.card;
                    sodexocardTotal += salesdata.sodexocard;
                    sodexocouponTotal += salesdata.sodexocoupon;
                    creditTotal += salesdata.credit;
                    gprscardTotal += salesdata.gprscard;
                    walletTotal += salesdata.wallet;
                    Total += item_Total;
                    Totaltaken += Number(salesdata.taken);
                    TotalSold += Number(salesdata.sold);

                    ScannedCount += Number(salesdata.scanned);
                    UnscannedCount += Number(salesdata.unscanned);
                    DamagedCount += Number(salesdata.damaged);
                    ExpiryCount += Number(salesdata.expiry);
                    RestaurantFaultCount += Number(salesdata.restaurantfault);
                    UndeliveredCount += Number(salesdata.undelivered);

                }

                sales_html += "<tr style='font-weight: bolder;'>";
                sales_html += "<td>Total: </td>";
                sales_html += "<td></td>";
                sales_html += "<td></td>";
                sales_html += "<td></td>";
                sales_html += "<td style='text-align:right;'>" + ScannedCount + "</td>";
                sales_html += "<td style='text-align:right;'>" + UnscannedCount + "</td>";
                sales_html += "<td style='text-align:right;'>" + DamagedCount + "</td>";
                sales_html += "<td style='text-align:right;'>" + ExpiryCount + "</td>";
                sales_html += "<td style='text-align:right;'>" + RestaurantFaultCount + "</td>";
                sales_html += "<td style='text-align:right;'>" + UndeliveredCount + "</td>";
                sales_html += "<td style='text-align:right;'>" + Totaltaken + "</td>";
                sales_html += "<td style='text-align:right;'>" + TotalSold + "</td>";
                sales_html += "<td style='text-align:right;'>" + cashTotal + "</td>";
                sales_html += "<td style='text-align:right;'>" + cardTotal + "</td>";
                sales_html += "<td style='text-align:right;'>" + sodexocardTotal + "</td>";
                sales_html += "<td style='text-align:right;'>" + sodexocouponTotal + "</td>";
                sales_html += "<td style='text-align:right;'>" + creditTotal + "</td>";
                sales_html += "<td style='text-align:right;'>" + gprscardTotal + "</td>";
                sales_html += "<td style='text-align:right;'>" + walletTotal + "</td>";
                sales_html += "<td style='text-align:right;'>" + Total + "</td>";
                sales_html += "</tr>";
                sales_html += "</tbody>";
                sales_html += "</table>";

                var remarks = "User Not logged Out.Triggering Auto logout";
                var username = "";
                redisClient.get("loginuserdetails",
                function (set_err, set_reply)
                {
                    if (set_err)
                    {
                        console.error('error while inserting in redis- {}'.format(set_err));
                        return;
                    }
                    set_reply = JSON.parse(set_reply);
                    username = set_reply.username;



               request({
                   url: outlet_url + '/users/Logout',
		   json:{ "remarks": "User Not logged Out.Triggering Auto logout", "mailcontent": sales_html, "username": username },
                   method: "POST"
               },
                  function (error, response_expire_all_items, body) {
                      if (error || (response_expire_all_items && response_expire_all_items.statusCode != 200))
                      {
                          console.error("System Logout Failed" + error);
                          return;
                      }

                            redisClient.del("loginuserdetails", function (del_err, del_reply)
                            {
                                if (del_err)
                                {
                                    console.error("error while deleting loginuserdetails in redis- {}".format(del_err));
                                    return;
                                }
                            });
                            redisClient.del("loginuserid", function (del_err, del_reply)
                            {
                                if (del_err)
                                {
                                    console.error("error while deleting loginuserid in redis- {}".format(del_err));
                                    return;
                                }
                            });
                  });

                });
            }
        });
}

