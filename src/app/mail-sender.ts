import {Promise} from 'bluebird';
import {mail as helper} from 'sendgrid';
import * as ejs from 'ejs';
const renderFile = Promise.promisify(ejs.renderFile);
const path = require('path');
const appDir = path.dirname(require.main.filename);

export interface Invite {
  invitedBy: string,
  acceptUrl: string
}

export interface MessageNotification {
  senderName: string,
  message: string,
  trackName: string,
  actionUrl: string
}

export class MailSender {
  constructor() {
    console.log("AppDir: " + appDir);
  }

  sendEmailConfirmationCode(recipient: string, code: string): Promise<any> {
    const subject = `Your Musicoin confirmation code`;
    return this.sendTemplate(`${appDir}/views/mail/email-confirmation.ejs`, recipient, subject, {code: code});
  }

  sendInvite(recipient: string, invite: Invite): Promise<any> {
    const subject = `${invite.invitedBy} wants to you join Musicoin!`;
    return this.sendTemplate(`${appDir}/views/mail/invite.ejs`, recipient, subject, {invite: invite});
  }

  sendMessageNotification(recipient: string, notification: MessageNotification): Promise<any> {
    const subject = notification.trackName
      ? `${notification.senderName} commented on '${notification.trackName}'`
      : `${notification.senderName} sent you a message!`;
    return this.sendTemplate(`${appDir}/views/mail/message.ejs`, recipient, subject, {notification: notification});
  }

  sendActivityReport(recipient: string, report: any): Promise<any> {
    const subject = report.description;
    return this.sendTemplate(`${appDir}/views/mail/activity-report.ejs`, recipient, subject, {report: report});
  }

  private sendTemplate(template: string, recipient: string, subject: string, data: any) {
    console.log("Loading template: " + template);
    return renderFile(template, data)
      .then(html => {
        const from_email = new helper.Email("musicoin@musicoin.org");
        const to_email = new helper.Email(recipient);
        const content = new helper.Content("text/html", html);
        const mail = new helper.Mail(from_email, subject, to_email, content);

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


