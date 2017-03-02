import {Promise} from 'bluebird';
import {mail as helper} from 'sendgrid';
import * as ejs from 'ejs';
const renderFile = Promise.promisify(ejs.renderFile);

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
  }

  sendInvite(recipient: string, invite: Invite): Promise<any> {
    const subject = `${invite.invitedBy} wants to you join Musicoin!`;
    return this.sendTemplate("views/mail/invite.ejs", recipient, subject, {invite: invite});
  }

  sendMessageNotification(recipient: string, notification: MessageNotification): Promise<any> {
    const subject = notification.trackName
      ? `${notification.senderName} commented on '${notification.trackName}'`
      : `${notification.senderName} sent you a message!`
    return this.sendTemplate("views/mail/message.ejs", recipient, subject, {notification: notification});
  }

  private sendTemplate(template: string, recipient: string, subject: string, data: any) {
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


