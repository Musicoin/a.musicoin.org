const nodemailer = require('nodemailer');
const transport = nodemailer.createTransport({
  service: 'Gmail',
  auth: {
    user: 'your email',
    pass: 'yourpassword',
  },
});
module.exports = function sendEmail(to, subject, message) {
  const mailOptions = {
    from: 'varunram@musicoin.org',
    to,
    subject,
    html: message,
  };
  transport.sendMail(mailOptions, (error) => {
    if (error) {
      console.log(error);
    }
  });
};
