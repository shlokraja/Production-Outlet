var app = require('../app');
var should = require('should');
var supertest = require('supertest');
var format = require('string-format');
var redis = require('redis');
var helper = require('../routes/helper');

format.extend(String.prototype);

describe('Menu display tests', function(){

  it('should return the stock quantity', function(done){
    supertest(app)
      .get('/menu_display/stock')
      .expect(200)
      .end(function (err, res){
        res.status.should.equal(200);

        var redisClient = redis.createClient();
        redisClient.get(helper.stock_count_node, function(err, reply){
          should.not.exist(err);
          res.text.should.be.equal(reply||'');
          done();
        });
      });
  });

  it('should return the dispenser status', function(done){
    supertest(app)
      .get('/menu_display/dispenser_status')
      .expect(200)
      .end(function (err, res){
        res.status.should.equal(200);

        var redisClient = redis.createClient();
        redisClient.get(helper.dispenser_status_node, function(err, reply){
          should.not.exist(err);
          res.text.should.be.equal(reply||'');
          done();
        });
      });
  });

  it('should return start of day page', function(done){
    supertest(app)
      .get('/menu_display/additional_stats')
      .expect(200)
      .end(function (err, res){
        res.status.should.equal(200);
        done();
      });
  });

});
