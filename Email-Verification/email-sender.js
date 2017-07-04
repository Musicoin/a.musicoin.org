const sendEmail = require('./email-helper');
var subject = "Welcome Aboard!!"
var message = 'Hello there! <br><br>Greetings from the Musicoin team. We are pleased to let you know that your account is now verified on the Musicoin blockchain. <br><br>Click <a href="https://musicoin.org">here</a> to get started, and join the music revolution! Feel free to contact  <a href="mailto:support@musicoin.org?Subject=Issues">support</a> if you face any issues. <br><br>Rock on!<br>The Musicoin Team';
for (var i=2; i< process.argv.length; i++) {
  sendEmail(process.argv[i], subject, message);
}
