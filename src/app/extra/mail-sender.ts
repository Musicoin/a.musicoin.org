import { Promise } from 'bluebird';
import * as ejs from 'ejs';
import { mail as helper } from 'sendgrid';

import serviceEventEmitter from '../rest-api/eventing';
import { SEND_EMAIL } from '../rest-api/eventing/events';

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
    serviceEventEmitter.on(SEND_EMAIL, (payload) => this.handleSendEmailEvent(payload));
  }

  private handleSendEmailEvent(payload: any) {

    return this.sendTemplate(`${appDir}/views/${payload.template}`, payload.recipient, payload.subject, payload.data)
      .then(null, () => { });

  }

  sendEmailConfirmationCode(recipient: string, code: string): Promise<any> {
    const subject = `Your Musicoin confirmation code`;
    return this.sendTemplate(`${appDir}/views/mail/email-confirmation.ejs`, recipient, subject, { code: code });
  }

  sendWelcomeEmail(recipient: string): Promise<any> {
    const subject = `Welcome to Musicoin!`
    return this.sendTemplate(`${appDir}/views/mail/invite.ejs`, recipient, subject, { invite: 'invite' });
  }
  sendPasswordReset(recipient: string, link: string): Promise<any> {
    const subject = `Musicoin password reset request`;
    return this.sendTemplate(`${appDir}/views/mail/password-reset.ejs`, recipient, subject, { link: link });
  }

  sendInvite(recipient: string, invite: Invite): Promise<any> {
    const subject = `${invite.invitedBy} wants to you join Musicoin!`;
    return this.sendTemplate(`${appDir}/views/mail/invite.ejs`, recipient, subject, { invite: invite });
  }

  sendMessageNotification(recipient: string, notification: MessageNotification): Promise<any> {
    const subject = notification.trackName ?
      `${notification.senderName} commented on '${notification.trackName}'` :
      `${notification.senderName} sent you a message!`;
    return this.sendTemplate(`${appDir}/views/mail/message.ejs`, recipient, subject, { notification: notification });
  }

  sendActivityReport(recipient: string, report: any): Promise<any> {
    const subject = report.description;
    return this.sendTemplate(`${appDir}/views/mail/activity-report.ejs`, recipient, subject, { report: report });
  }

  private sendTemplate(template: string, recipient: string, subject: string, data: any) {
    return renderFile(template, data)
      .then(html => {
        const from_email = new helper.Email("musicoin@musicoin.org");
        const to_email = new helper.Email(recipient);
        const content = new helper.Content("text/html", html);
        const mail = new helper.Mail(from_email, subject, to_email, content);
        console.log("sg key load test: " + process.env.SENDGRID_API_KEY);
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