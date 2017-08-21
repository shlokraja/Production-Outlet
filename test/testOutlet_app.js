var app = require('../app');
var should = require('should');
var supertest = require('supertest');
var format = require('string-format');

format.extend(String.prototype);

describe('Outlet tests', function(){

  it('should remove expired items', function(done){
    supertest(app)
      .post('/outlet_app/remove_expired_items')
      .expect(200)
      .end(function (err, res){
        res.status.should.equal(200);
        done();
      });
  });

  it('should return start of day page', function(done){
    supertest(app)
      .get('/outlet_app/start_of_day')
      .expect(200)
      .end(function (err, res){
        res.status.should.equal(200);
        done();
      });
  });

  it('should push the inventory data', function(done){
    supertest(app)
      .post('/outlet_app/push_inventory_request')
      .expect(200)
      .end(function (err, res){
        res.status.should.equal(200);
        done();
      });
  });

  it('should return end of day page', function(done){
    supertest(app)
      .get('/outlet_app/end_of_day')
      .expect(200)
      .end(function (err, res){
        res.status.should.equal(200);
        done();
      });
  });

  it('should send start_of_day signal', function(done){
    supertest(app)
      .post('/outlet_app/start_of_day_signal')
      .expect(200)
      .end(function (err, res){
        res.status.should.equal(200);
        done();
      });
  });


  it('should send end_of_day signal', function(done){
    supertest(app)
      .post('/outlet_app/end_of_day_signal')
      .expect(200)
      .end(function (err, res){
        res.status.should.equal(200);
        done();
      });
  });

  it('should test force failure of entire stock', function(done){
    supertest(app)
      .post('/outlet_app/force_fail_entire_stock')
      .send({fail_all:false})
      .expect(200)
      .end(function(err, res){
        res.status.should.equal(200);
        done();
      });
  });

});
