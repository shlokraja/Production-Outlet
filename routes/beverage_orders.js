var express = require('express');
var router = express.Router();
var debug = require('debug')('outlet_app:server');
var format = require('string-format');
var async = require('async');
var _ = require('underscore');


router.get('/:fv_id', function(req, res, next){
  var fv_id = req.params.fv_id;
  res.render('beverage_orders', {hq_url: process.env.HQ_URL,
    outlet_id: process.env.OUTLET_ID,
    outlet_host: process.env.OUTLET_HOST,
    outlet_port: process.env.PORT,
    websocket_port: process.env.WEBSOCKET_PORT,
    fv_id: fv_id});
});

module.exports = router;

