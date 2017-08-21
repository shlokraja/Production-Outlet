var request = require('request');
var format = require('string-format');
format.extend(String.prototype);

function sendUpdatedSMS(item_name, bill_no, mobile_num) {
  var sms_details = {
    'bill_no': bill_no,
    'item_name': item_name
  };
  var sms_message = 'Item- {item_name} has been cancelled from order #{bill_no}\nPlease contact outlet staff.'.format(sms_details);
  console.log("Resending updated sms as - ", sms_message);
  var queryString = {
      UserName: "atchayam",
      password: "123456",
      MobileNo: mobile_num,
      SenderID: 'FOODBX',
      CDMAHeader: 'FOODBX',
      Message: sms_message
    };
  request({
    url: process.env.SMS_URL,
    qs: queryString
  }, function(sms_error, sms_response, sms_body) {
    if (sms_error || (sms_response && sms_response.statusCode != 200)) {
      console.error('{}: {} {}'.format(process.env.HQ_URL, sms_error, sms_body));
      return;
    }
    console.log(sms_body);
  });
}

sendUpdatedSMS("chili garlic", 4, "9841404163");
