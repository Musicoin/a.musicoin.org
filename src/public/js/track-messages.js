$( document ).ready(function() {
  $(document).on('click', '.inline-reply-action', function() {
    var messageScroller = $(this).closest('.message-scroller.dynamic-element');
    messageScroller.removeClass('dynamic-element');
    messageScroller.addClass('dynamic-element-paused');

    var msg = $(this).closest('.chat-message');
    msg.find('.inline-reply')
      .show();

    msg.find('.inline-reply-input').focus();

  });

  $(document).on('keyup', '.inline-reply-input', function(e) {
    if(e.keyCode == 13) {
      var input = $(this);
      var chatMessage = input.closest('.chat-message');
      var releaseId = chatMessage.attr("releaseid");
      var address = chatMessage.attr("licenseAddress");
      var messageid = chatMessage.attr("messageid");
      var messages = input.closest('.message-scroller.dynamic-element-paused')
      var message = input.val();
      input.val("");
      dynamic.refreshElement(messages, {
        message: message,
        releaseid: releaseId,
        address: address,
        replyto: messageid});
      closeInlineReply(input);
    }
    else if(e.keyCode == 27) {
      closeInlineReply($(this));
    }
  });

  $(document).on('blur', '.inline-reply-input', function() {
    closeInlineReply($(this));
  })

  function closeInlineReply(element) {
    var messageScroller = element.closest('.message-scroller.dynamic-element-paused')
    messageScroller.removeClass('dynamic-element-paused');
    messageScroller.addClass('dynamic-element');

    element.closest('.inline-reply')
      .hide();
  }
});