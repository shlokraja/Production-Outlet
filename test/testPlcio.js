var app = require('../app');
var should = require('should');
var supertest = require('supertest');
var format = require('string-format');
var redis = require('redis');
var helper = require('../routes/helper');

format.extend(String.prototype);

describe('plcio tests', function(){

  it('should push an order to HQ', function(done){
    supertest(app)
      .post('/plcio/push_order')
      .expect(200)
      .end(function (err, res){
        res.status.should.equal(200);
        done();
      });
  });

  it('should post the stock count to local cloud', function(done){
    var stockData = {"data" : [
      {"id": 3, "count": 4},
      {"id": 2, "count": 5}
    ]}
    supertest(app)
      .post('/plcio/stock')
      .set('Content-Type', 'application/json')
      .send(stockData)
      .expect(200)
      .end(function (err, res){
        res.status.should.equal(200);
        res.text.should.equal('success');

        var redisClient = redis.createClient();
        redisClient.get(helper.stock_count_node, function(err, reply){
          should.not.exist(err);
          JSON.stringify(stockData.data).should.be.equal(reply||'');
          done();
        });
      });
  });

  it('should fail to post stock count because of no Content-Type', function(done){
    var stockData = '{"data" : [ \
          {"id": 3, "count": 4}, \
          {"id": 2, "count": 5} \
        ]}'
    supertest(app)
      .post('/plcio/stock')
      .send(stockData)
      .expect(415)
      .end(function (err, res){
        res.status.should.equal(415);
        res.text.should.equal('');
        done();
      });
  });

  it('should post the dispenser status to local cloud', function(done){
  var dispenserStatus = {"status" : "loading"}
  supertest(app)
    .post('/plcio/dispenser_status')
    .set('Content-Type', 'application/json')
    .send(dispenserStatus)
    .expect(200)
    .end(function (err, res){
      res.status.should.equal(200);
      res.text.should.equal('success');

      var redisClient = redis.createClient();
      redisClient.get(helper.dispenser_status_node, function(err, reply){
        should.not.exist(err);
        dispenserStatus.status.should.be.equal(reply||'');
        done();
      });
    });
  });

  it('should fail to post dispenserStatus because of no Content-Type', function(done){
    var dispenserStatus = '{"status" : "loading"}'
    supertest(app)
      .post('/plcio/dispenser_status')
      .send(dispenserStatus)
      .expect(415)
      .end(function (err, res){
        res.status.should.equal(415);
        res.text.should.equal('');
        done();
      });
  });

});
