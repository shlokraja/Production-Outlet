var should = require('should');
var format = require('string-format');

var printer = require('../misc/printer');

format.extend(String.prototype);

describe('bill print test', function(){
  it('should create a pdf', function(done){
    var bill_dict = [];
    bill_dict.push({
      "name": "Chicken biriyani",
      "count": 2,
      "amount": 100,
      "side_order": "pick up raitha"
    });

    bill_dict.push({
      "name": "Chicken lasagna",
      "count": 1,
      "amount": 176,
      "side_order": "do not pick up"
    });

    printer(bill_dict, 100, 'Tue Jul 07 2015', '18:43:16', 0, '9986158795');
    setTimeout(function () {
      done();
    }, 10000);
  });

  it('should handle null in side order', function(done){
    var bill_dict = [];
    bill_dict.push({
      "name": "Chicken biriyani",
      "count": 2,
      "amount": 100,
      "side_order": null
    });

    printer(bill_dict, 100, 'Tue Jul 07 2015', '18:43:16', 0, '9986158795');
    setTimeout(function () {
      done();
    }, 10000);
  });
});
