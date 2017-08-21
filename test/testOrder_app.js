var app = require('../app');
var should = require('should');
var supertest = require('supertest');
var format = require('string-format');

format.extend(String.prototype);

describe('Order app tests', function(){

  it('should place an order', function(done){
    supertest(app)
      .post('/order_app/place_order')
      .expect(200)
      .end(function (err, res){
        res.status.should.equal(200);
        done();
      });
  });

});
