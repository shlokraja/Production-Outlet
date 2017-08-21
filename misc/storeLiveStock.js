var debug = require('debug')('outlet_app:server');
var format = require('string-format');
var request = require('request');
var firebase = require('firebase');

var helper = require('../routes/helper');

function storeLiveStock() {
  var rootref = new firebase(process.env.FIREBASE_CONN);
  var stock_count_node = rootref.child('{}/{}'.format(process.env.OUTLET_ID,helper.stock_count_node));
  var item_data = [];
  // Getting the stock data
  stock_count_node.once("value", function(data) {
    var data = data.val();
    for (key in data) {
      // ignore if the item is in test mode
      if (isTestModeItem(Number(key))) {
        continue;
      }
      totalItems = 0;
      // If there are no items, just continue
      if (data[key]["item_details"] == undefined) {
        continue;
      }
      data[key]["item_details"].map(function(item) {
        totalItems += item.count;
      });
      item_data.push({
        food_item_id: key,
        count: totalItems
      });
    }
    debug("Item data for live stock count is- " + JSON.stringify(item_data));

    // Posting it to HQ
    var hq_url = process.env.HQ_URL;
    var outlet_id = process.env.OUTLET_ID;
    var REPLACE_ITEMS_URL = hq_url + '/outlet/stock_data/' + outlet_id;
    request({
      url: REPLACE_ITEMS_URL,
      method: "POST",
      json: {"item_data": item_data}
      }, function(error, response, body) {
        if (error || (response && response.statusCode != 200)) {
          console.error('{}: {} {}'.format(hq_url, error, body));
          return;
        }
        debug(body);
    });
  });
}

function isTestModeItem(item_code) {
  if (item_code>=9000 && item_code<=9099) {
    return true;
  } else {
    return false;
  }
}

module.exports = storeLiveStock;
