var chai = require('chai');
var chaiHttp = require('chai-http');
var app = require('../src/server.js');
var expect = chai.expect;
chai.use(chaiHttp);

it('Main App', function(done) {
  chai.request(app)
    .get('/')
    .end(function(err, res) {
      expect(res).to.have.status(200);
      done();
    });
});
it('Sign Up Page', function(done) {
  chai.request(app)
    .get('/welcome')
    .end(function(err, res) {
      expect(res).to.have.status(200);
      done();
    });
});
it('How It Works Page is Up, but this is a static site', function(done) {
  chai.request(app)
    .get('/howitworks.html')
    .end(function(err, res) {
      expect(res).to.have.status(200);
      done();
    });
});
it('Password Reset page is up', function(done) {
  chai.request(app)
    .get('/login/forgot')
    .end(function(err, res) {
      expect(res).to.have.status(200);
      done();
    });
});
