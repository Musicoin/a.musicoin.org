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
    else if (data.authenticated == false || data.profile == false) {
      element.text(element.attr('text-not-following'));
      element.removeClass(element.attr('class-following'));
      element.addClass(element.attr('class-not-following'));
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
    var licenseAddress = element.attr('licenseAddress');
    $.post('/follow', {profileAddress: toFollow, licenseAddress: licenseAddress}, function(data) {
      handleResponse(element, data);
      if (data.authenticated == false) {
        new Message("You need to login to send a tip", "warning", 5000)
          .button("Login", () => {
            window.top.location = "/welcome";
          });
      }
      else if (data.profile == false) {
        new Message("You need to save your profile before you can tip", "warning", 5000)
          .button("Go to my profile", () => {
            window.location = "/profile";
          });
      }
    })
  });
});