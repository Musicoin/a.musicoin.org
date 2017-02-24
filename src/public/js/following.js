$( document ).ready(function() {

  function handleResponse(element, data) {
    if (data.success) {
      if (data.following) {
        element.text(element.attr('text-following'));
        element.removeClass(element.attr('class-not-following'));
        element.addClass(element.attr('class-following'));
      }
      else {
        element.text(element.attr('text-not-following'));
        element.removeClass(element.attr('class-following'));
        element.addClass(element.attr('class-not-following'));
      }
    }
    else {
      new Message("Sorry, an error occurred", 'error', 5000)
    }
  }

  $(".follow-toggle-button").each(function() {
    var element = $(this);
    var toFollow = element.attr('user');
    $.post('/follows', {profileAddress: toFollow}, function(data) {
      handleResponse(element, data);
    });
  });

  $(document).on('click', '.follow-toggle-button', function() {
    var element = $(this);
    var toFollow = element.attr('user');
    $.post('/follow', {profileAddress: toFollow}, function(data) {
      handleResponse(element, data);
    })
  });
});