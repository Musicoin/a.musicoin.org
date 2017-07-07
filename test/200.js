var chai = require('chai');
var chaiHttp = require('chai-http');
var app = require('../src/server.js');

var expect = chai.expect;

chai.use(chaiHttp);

describe('Running Fine', function() {
  describe('/', function() {
    it('responds with status 200', function(done) {
      chai.request(app)
        .get('/')
        .end(function(err, res) {
          expect(res).to.have.status(200);
          done();
        });
    });
  });
});
