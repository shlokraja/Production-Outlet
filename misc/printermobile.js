var request = require('requestretry');
var fs = require('fs');
var debug = require('debug')('outlet_app:server');
var cheerio = require('cheerio');
var path = require('path');
var redis = require('redis');
var format = require('string-format');

var helper = require('../routes/helper');

format.extend(String.prototype);
var redisClient = redis.createClient({ connect_timeout: 2000, retry_max_delay: 5000 });
redisClient.on('error', function (msg) {
    console.error(msg);
});

function startPrint(bill_dict, bill_no, date, time, savings, mobile_num, outlet_phone_no) {
    // Opening the html file
    var filePath = path.join(__dirname, '/../');
    filePath = path.join(filePath, 'public/bill.html');
    var bill_text = '';
    var bill_total_amount = 0;
    for (restaurant_id in bill_dict)
    {
        var bill_item = bill_dict[restaurant_id];
        var html = fs.readFileSync(filePath, 'utf8');
        var $ = cheerio.load(html);
        // Updating the contents
        $("#date_time #date").text('Date - ' + date);
        $("#date_time #time").text('Time - ' + time);
        $("#order_no").text('ORDER NO: ' + bill_no);
        $("#tin_no").text('TIN No- ' + bill_item[0]["tin_no"]);
        $("#st_no").text('ST No- ' + bill_item[0]["st_no"]);
        $("#rest_name").text(bill_item[0]["restaurant_name"]);
        var total_amount = 0;
        for (var i = 0; i < bill_item.length; i++)
        {
            if (!bill_item[i]["side_order"])
            {
                bill_item[i]["side_order"] = "";
            }
            $("#items tbody").prepend("<tr><td>" + (bill_item.length - i) + "</td><td>" + bill_item[i]["name"] + "<div class='side_order'>" + bill_item[i]["side_order"] + "</div></td><td>" + bill_item[i]["count"].toString() + "</td><td>" + bill_item[i]["amount"].toString() + "</td></tr>");
            total_amount += bill_item[i]["amount"];
        }
        bill_total_amount += total_amount;
        $("#amount_num").text(total_amount.toString());

        // Showing the savings if any
        if (savings != 0)
        {
            $("#savings").text("You have saved INR " + savings);
        } else
        { // else do not show
            $("#savings").css("display", "none");
        }

        bill_text += $.html() + '<br /><br />'
    }

    // var hq_url = process.env.HQ_URL;
    // var hq_url = "http://192.168.0.141:9087";
var hq_url = "http://atchayam.gofrugal.com:8008";
    var CREATE_BILL_URL = hq_url + '/bill';
    // Posting the bill body to the HQ to create the pdf
    request({
        url: CREATE_BILL_URL,
        method: "POST",
        json: { "bill_text": bill_text }
    }, function (error, response, body) {
        if (error || (response && response.statusCode != 200))
        {
            console.error('{}: {} {}'.format(hq_url, error, body));
            return;
        }
        debug(body);
        var bill_location = body.bill_location;
        // send the SMS
        sendSMS(mobile_num, bill_no, bill_total_amount, bill_location, outlet_phone_no);
    });
}

function sendSMS(mobile_num, bill_no, amount, bill_location, outlet_phone_no) {
    // Send the bill sms
    debug("Mobile num for place order is " + mobile_num);
    // Getting the outlet config first
    redisClient.get(helper.outlet_config_node, function (err, reply) {
        if (err)
        {
            console.error('error while retreiving from redis- {}'.format(err));
            return;
        }
        var outlet_config = JSON.parse(reply);
        var outlet_name = outlet_config.name;

        var sms_details = {
            'bill_no': bill_no,
            'amount': amount,
            'outlet_name': outlet_name,
            //'hq_url': process.env.HQ_URL,
            'hq_url': "http://192.168.0.141:9087",
            'bill_url': bill_location,
            'outlet_phone_no': outlet_phone_no
        }
        var sms_message = 'Thanks for Order #{bill_no} \nRs. {amount} at {outlet_name} \nView your bill at {hq_url}{bill_url} \nCall us at {outlet_phone_no} \nEnjoy your meal!'.format(sms_details);
        var queryString = {
            //UserName: process.env.SMS_USERNAME,
            //password: process.env.SMS_PASSWORD,
            UserName: 'atchayam',
            password: '123456',
            MobileNo: mobile_num,
            SenderID: 'FRSHLY',
            CDMAHeader: 'FRSHLY',
            Message: sms_message
        };
        request({
            //url: process.env.SMS_URL,
            url: 'http://whitelist.smsapi.org/SendSMS.aspx',
            qs: queryString
        }, function (sms_error, sms_response, sms_body) {
            if (sms_error || (sms_response && sms_response.statusCode != 200))
            {
                console.error('{}: {} {}'.format(process.env.HQ_URL, sms_error, sms_body));
                return;
            }
            debug(sms_body);
        });
    });
}

function sendUpdatedSMS(item_name, bill_no, mobile_num) {
    var sms_details = {
        'bill_no': bill_no,
        'item_name': item_name
    };
    var sms_message = 'Item- {item_name} has been cancelled from order #{bill_no}\nPlease contact outlet staff.'.format(sms_details);
    debug("Resending updated sms as - ", sms_message);
    var queryString = {
        //UserName: process.env.SMS_USERNAME,
        //password: process.env.SMS_PASSWORD,
        UserName: 'atchayam',
        password: '123456',
        MobileNo: mobile_num,
        SenderID: 'FRSHLY',
        CDMAHeader: 'FRSHLY',
        Message: sms_message
    };
    request({
        //url: process.env.SMS_URL,
        url: 'http://whitelist.smsapi.org/SendSMS.aspx',
        qs: queryString
    }, function (sms_error, sms_response, sms_body) {
        if (sms_error || (sms_response && sms_response.statusCode != 200))
        {
            console.error('{}: {} {}'.format(process.env.HQ_URL, sms_error, sms_body));
            return;
        }
        debug(sms_body);
    });
}


module.exports = { startPrint: startPrint, sendUpdatedSMS: sendUpdatedSMS };
