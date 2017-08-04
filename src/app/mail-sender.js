"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const bluebird_1 = require("bluebird");
const sendgrid_1 = require("sendgrid");
const ejs = require("ejs");
const renderFile = bluebird_1.Promise.promisify(ejs.renderFile);
const path = require('path');
const appDir = path.dirname(require.main.filename);
class MailSender {
    constructor() {
        console.log("AppDir: " + appDir);
    }
    sendEmailConfirmationCode(recipient, code) {
        const subject = `Your Musicoin confirmation code`;
        return this.sendTemplate(`${appDir}/views/mail/email-confirmation.ejs`, recipient, subject, { code: code });
    }
    sendWelcomeEmail(recipient) {
        const subject = `Welcome to Musicoin!`;
        return this.sendTemplate(`${appDir}/views/mail/invite.ejs`, recipient, subject, { invite: 'invite' });
    }
    sendPasswordReset(recipient, link) {
        const subject = `Musicoin password reset request`;
        return this.sendTemplate(`${appDir}/views/mail/password-reset.ejs`, recipient, subject, { link: link });
    }
    sendInvite(recipient, invite) {
        const subject = `${invite.invitedBy} wants to you join Musicoin!`;
        return this.sendTemplate(`${appDir}/views/mail/invite.ejs`, recipient, subject, { invite: invite });
    }
    sendMessageNotification(recipient, notification) {
        const subject = notification.trackName
            ? `${notification.senderName} commented on '${notification.trackName}'`
            : `${notification.senderName} sent you a message!`;
        return this.sendTemplate(`${appDir}/views/mail/message.ejs`, recipient, subject, { notification: notification });
    }
    sendActivityReport(recipient, report) {
        const subject = report.description;
        return this.sendTemplate(`${appDir}/views/mail/activity-report.ejs`, recipient, subject, { report: report });
    }
    sendTemplate(template, recipient, subject, data) {
        console.log("Loading template: " + template);
        return renderFile(template, data)
            .then(html => {
            const from_email = new sendgrid_1.mail.Email("musicoin@musicoin.org");
            const to_email = new sendgrid_1.mail.Email(recipient);
            const content = new sendgrid_1.mail.Content("text/html", html);
            const mail = new sendgrid_1.mail.Mail(from_email, subject, to_email, content);
            const sg = require('sendgrid')(process.env.SENDGRID_API_KEY);
            const request = sg.emptyRequest({
                method: 'POST',
                path: '/v3/mail/send',
                body: mail.toJSON()
            });
            return sg.API(request)
                .then(response => {
                if (response.statusCode < 300) {
                    return response;
                }
                throw new Error(`Failed to send e-mail, template: ${template}, server returned status code: ${response.statusCode}`);
            });
        });
    }
}
exports.MailSender = MailSender;
//# sourceMappingURL=mail-sender.js.map