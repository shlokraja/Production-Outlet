var debug = require('debug')('outlet_app:server');
var format = require('string-format');
var redis = require('redis');
var requestretry = require('requestretry');

format.extend(String.prototype);

function storeItemIds() {
  var outlet_id = process.env.OUTLET_ID;
  var hq_url = process.env.HQ_URL;
  var PRICE_INFO = '/food_item/price_info/';
  // Getting the response from HQ
  requestretry(hq_url + PRICE_INFO + outlet_id,
    function (error, response, body) {
    if (error || (response && response.statusCode != 200)) {
      console.error('{}: {} {}'.format(PRICE_INFO, error, body));
      return;
    }
    var parsed_response = JSON.parse(body);
    parsed_response.map(function(item) {
      OUTLET_ITEM_IDS.push(item.id);
    });
  });
}

module.exports = storeItemIds;
