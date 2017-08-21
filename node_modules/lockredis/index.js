var crypto = require("crypto");
var fs = require("fs");
var path = require("path");

var releaseLua = fs.readFileSync(path.join(__dirname, './release.lua'));

module.exports = function (client) {
  if (!client || !client.set) {
    try {
      var redis = require("redis");
      client = redis.createClient();
    } catch(e) {
      throw new Error("Provide a redis client instance to lockredis constructor.")
    }
  }

  return function acquire(name, options, next) {
    if (typeof options == 'function') {
      next = options;
      options = {};
    }

    options.timeout = (typeof options.timeout === 'undefined') ? 5000 : options.timeout;
    options.retries = (typeof options.retries === 'undefined') ? Infinity : options.retries;
    options.retryDelay = (typeof options.retryDelay === 'undefined') ? 250 : options.retryDelay;
    options.token = crypto.randomBytes(16).toString('hex');

    client.set(['lockredis:' + name, options.token, 'NX', 'PX', options.timeout], function (err, res) {
      if (err) return next(err);

      if (res !== 'OK') {
        if (options.retries > 0) {
          return setTimeout(function() {
            options.retries--;
            acquire(name, options, next);
          }, options.retryDelay)
        }

        return next(new Error("Unable to acquire lock " + name));
      }

      next(null, function(next) {
        next = next || function() {};
        client.eval([releaseLua, 1, 'lockredis:' + name, options.token], next);
      });
    });
  }
}
