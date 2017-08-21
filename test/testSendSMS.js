var should = require('should');
var format = require('string-format');
var request = require('request');

format.extend(String.prototype);

describe('send sms test', function(){
  it('should send an sms', function(done){
    var mobile_num = '9986158795';
    var queryString = {
      UserName: 'atchayam',
      password: '123456',
      MobileNo: mobile_num,
      SenderID: 'FOODBX',
      CDMAHeader: 'FOODBX',
      Message: 'Thanks for Order #23 \n Rs. 44 at HelloCentral \n View your bill at http://flofl/fdf \n Call us at 04498238498 \n Enjoy your meal!'
    };
    request({
      url: 'http://whitelist.smsapi.org/SendSMS.aspx',
      qs: queryString
    }, function(sms_error, sms_response, sms_body) {
      if (sms_error || (sms_response && sms_response.statusCode != 200)) {
        console.error('{}: {} {}'.format(hq_url, sms_error, sms_body));
        return;
      }
      console.log(sms_body);
      done();
    });
  });

});
