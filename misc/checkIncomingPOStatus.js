var debug = require('debug')('outlet_app:server');
var format = require('string-format');
var request = require('request');
var helper = require('../routes/helper');
var _ = require('underscore');
format.extend(String.prototype);

// get all outstanding POs in the last 15mins
// get the dict of rest_id, po_id and batch_id from the HQ
// pass that along to the browser
// when the user click, store that item against the rest_id as the key in the outlet
/*
2. during unscanned items, show the list of item ids from what was selected for the incoming po button and is stored in redis
 let the user select what item id was unscanned and put the quantity

then get the barcodes from that po_id and batch_id

the query shall group by po-id, batch-id, rest-id and sum the items and qty
*/

function checkIncomingPO() {
    var outlet_host = process.env.OUTLET_HOST;
    var port = process.env.PORT;
    var outlet_url = outlet_host + port;

    var outlet_id = process.env.OUTLET_ID;
    var hq_url = process.env.HQ_URL;
    var GET_PO_URL = '/outlet/get_outstanding_po/';
    // Getting the response from HQ
    request(hq_url + GET_PO_URL + outlet_id,
      { forever: true },
      function (error, response, body) {
          if (error || (response && response.statusCode != 200))
          {
              console.error('{}: {} {}'.format(hq_url, error, body));
              return;
          }

          var result_pos = _.groupBy(JSON.parse(body), "po_id");

          request({
              url: outlet_url + '/outlet_app/store_po_details_in_redis',
              method: "POST",
              json: { "po_details": result_pos }
          },
           function (error, response, data) {
               if (error || (response && response.statusCode != 200))
               {
                   console.error("store_po_details_in_redis failed: " + err_msg);
                   return;
               }

              // console.log(result_pos);
           });

          io.emit('incoming_po', JSON.parse(body));
      });
}

module.exports = checkIncomingPO;
