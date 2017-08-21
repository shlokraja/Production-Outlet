var express = require('express');
var path = require('path');
var favicon = require('serve-favicon');
var logger = require('morgan');
var cookieParser = require('cookie-parser');
var bodyParser = require('body-parser');
var cors = require('cors');

var routes = require('./routes/index');
var menu_display = require('./routes/menu_display');
var order_app = require('./routes/order_app');
var plcio = require('./routes/plcio');
var outlet_app = require('./routes/outlet_app');
var beverage_orders = require('./routes/beverage_orders');

var app = express();

app.engine('hjs', require('hogan-express'));
if (app.get('env') === 'production') {
  app.enable('view cache');
}
// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'hjs');

// uncomment after placing your favicon in /public
//app.use(favicon(__dirname + '/public/favicon.ico'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(logger('[:date[web]] ":method :url HTTP/:http-version" :status'));

// Enabling cors for all origins
app.use(cors());

// Setting up the routes here
app.use('/', routes);
app.use('/menu_display', menu_display);
app.use('/order_app', order_app);
app.use('/plcio', plcio);
app.use('/outlet_app', outlet_app);
app.use('/beverage_orders', beverage_orders);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handlers

// development error handler
// will print stacktrace
if (app.get('env') === 'development') {
  app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', {
      message: err.message,
      error: err
    });
  });
}

// production error handler
// no stacktraces leaked to user
app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.render('error', {
    message: err.message,
    error: {}
  });
});


process.on('uncaughtException', function(err) {
    // handle the error safely
    console.log("Process Error :" + err)
})

module.exports = app;
