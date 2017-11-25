var chai = require('chai');
var chaiHttp = require('chai-http');
var app = require('../src/server.js');
var expect = chai.expect;
chai.use(chaiHttp);
const request = chai.request(app);

it('Main App', function() {
  request.get('/')
    .end(function(err, res) {
      expect(res).to.have.status(200);
    });
});
it('Sign Up Page', function() {
  request.get('/welcome')
    .end(function(err, res) {
      expect(res).to.have.status(200);
    });
});
it('How It Works Page is Up, but this is a static site', function() {
  request.get('/howitworks.html')
    .end(function(err, res) {
      expect(res).to.have.status(200);
    });
});
it('Password Reset page is up', function() {
  request.get('/login/forgot')
    .end(function(err, res) {
      expect(res).to.have.status(200);
    });
});
