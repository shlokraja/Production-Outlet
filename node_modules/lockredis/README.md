# lockredis
Barebones locking utility for Redis. Uses the algorithm described in [Redis Documentation](http://redis.io/commands/SET).

## install

	npm install lockredis

## usage

```javascript
var lockredis = require('lockredis');
var locker = lockredis(redis.createClient());

locker('lockname', {
	timeout: 5000, // Time for a lock to expire on its own in milliseconds
	retries: Infinity, // Number of retries in case the lock is already acquired
	retryDelay: 250 // Time between retry attempts in milliseconds
}, function(err, done) {
	if (err) {
		// Lock could not be acquired for some reason.
	}

	// do stuff...

	done() // release lock
});
```

## license
MIT
