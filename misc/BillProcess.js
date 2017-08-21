var requestretry = require('requestretry');
var redis = require('redis');
var format = require('string-format');
var firebase = require('firebase');
var request = require('request');
var express = require('express');
var debug = require('debug')('Bill_Check:server');
format.extend(String.prototype);


// Initiating the redisClient

var redisClient = redis.createClient({ connect_timeout: 2000, retry_max_delay: 5000 });
redisClient.on('error', function (msg) {
    console.error(msg);
});

//BillpushInit();

//function BillpushInit() {
//    setInterval(Start_Bill_push, (60000 * 5))
//}

exports.InitBillPush = function () {
    Start_Bill_push();
}

function Start_Bill_push() {
    console.log("Start Bill Push -Started" + new Date());
    redisClient.lrange("Bills", 0, -1, function (err, result) {
        if (err) {
            console.error("Selecting Db Failed" + err)
        } else {
            console.log("Total Bill Count :" + result.length)
            if (result.length > 0) {

                var arr = new Array();
                for (var i = 0; i < result.length; i++) {
                    result[i] = JSON.parse(result[i]);
                    //if (result[i].bill_status != "Success") {
                        arr.push(result[i]);
                    //}
                }
                if (arr.length > 0) {
                    console.log("Process Bill Count :" + arr.length)
                    var hq_url = process.env.HQ_URL;
                    var Check_Missing_Bills = hq_url + '/outlet/Check_Missing_Bills';
                    var obj = new Object();
                    obj.bills = arr;
                    requestretry({
                        url: Check_Missing_Bills,
                        method: "POST",
                        forever: true,
                        maxAttempts: 25,
                        json: obj
                    }, function (bill_error, bill_response, bill_body) {
                        if (bill_error || (bill_response && bill_response.statusCode != 200)) {
                            console.error('{}: {} {}'.format(Check_Missing_Bills, bill_error, bill_body));
                        }
                    });
                }
                else {
                    console.log("No Missing Record to Process")
                }
            }
            else {
                console.log("No Record to Process")
            }
        }
    })
}