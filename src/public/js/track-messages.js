$( document ).ready(function() {
  $(document).on('click', '.inline-reply-action', function() {
    var messageScroller = $(this).closest('[data-behavior~=chat-message-area].dynamic-element');
    messageScroller.removeClass('dynamic-element');
    messageScroller.addClass('dynamic-element-paused');

    var msg = $(this).closest('.chat-message');
    msg.find('.inline-reply')
      .show();

    msg.find('.inline-reply-input').focus();

  });

  $(document).on('click', '.inline-repost-intent-action', function() {
    var chatMessage = $(this).closest('.chat-message');
    var messageScroller = $(this).closest('[data-behavior~=chat-message-area]');
    messageScroller.toggleClass('dynamic-element');
    messageScroller.toggleClass('dynamic-element-paused');
    chatMessage.find('.inline-repost-action').toggle();
    chatMessage.find('.inline-repost-action').focus();
  });

  $(document).on('click', '.inline-delete-action', function() {
    var chatMessage = $(this).closest('.chat-message');
    var messages = $(this).closest('[data-behavior~=chat-message-area]');
    var repostMessage = chatMessage.attr("messageid");
    dynamic.refreshElement(messages, {
      deleteMessage: repostMessage});
  });

  $(document).on('click', '.inline-repost-action', function() {
    var chatMessage = $(this).closest('.chat-message');
    var messages = $(this).closest('[data-behavior~=chat-message-area]');
    var repostMessage = chatMessage.attr("messageid");
    dynamic.refreshElement(messages, {
      repostMessage: repostMessage});
    });

  $(document).on('keyup', '.inline-reply-input', function(e) {
    if(e.keyCode == 13) {
      var input = $(this);
      var chatMessage = input.closest('.chat-message');
      var releaseId = chatMessage.attr("releaseid");
      var address = chatMessage.attr("licenseAddress");
      var messageid = chatMessage.attr("messageid");
      var messages = input.closest('[data-behavior~=chat-message-area].dynamic-element-paused')
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

  $(document).on('keyup', '.general-post', function(e) {
    if(e.keyCode == 13 && !e.shiftKey) {
      var input = $(this);
      var messages = $("#" + input.attr('target'));
      var message = input.val();
      input.val("");
      dynamic.refreshElement(messages, {message: message});
    }
  });

  $(document).on('blur', '.inline-reply-input', function() {
    closeInlineReply($(this));
  })

  $(document).on('blur', '.inline-repost-action', function() {
    var chatMessage = $(this).closest('.chat-message');
    var messageScroller = $(this).closest('[data-behavior~=chat-message-area]');
    messageScroller.addClass('dynamic-element');
    messageScroller.removeClass('dynamic-element-paused');
    chatMessage.find('.inline-repost-action').hide();
  })

  function closeInlineReply(element) {
    var messageScroller = element.closest('[data-behavior~=chat-message-area].dynamic-element-paused')
    messageScroller.removeClass('dynamic-element-paused');
    messageScroller.addClass('dynamic-element');

    element.closest('.inline-reply')
      .hide();
  }
});