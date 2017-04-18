$( document ).ready(function() {

  function formatNumber(value) {
    if (!value || value == 0) return 0;
    const lookup = ["", "k", "M", "B", "T"];
    var order = Math.min(Math.floor(Math.log10(value)/3), lookup.length-1);
    var mult = value / Math.pow(10, 3*order);
    var decimals = order > 0 ? 1 : 0;
    return mult.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + lookup[order];
  }

  function updateFollowerCountLabel(element) {
    var followerCountLabel = element.parent().find(".follower-count");
    followerCountLabel.text(formatNumber(parseInt(element.attr('follower-count'))));
  };

  function handleResponse(element, data) {
    if (data.success) {
      if (data.following) {
        updateFollowerCountLabel(element);
        element.text(element.attr('text-following'));
        element.removeClass(element.attr('class-not-following'));
        element.addClass(element.attr('class-following'));
        element.attr('following', 'true');
      }
      else {
        element.text(element.attr('text-not-following'));
        element.removeClass(element.attr('class-following'));
        element.addClass(element.attr('class-not-following'));
        element.attr('following', 'false');
      }
      updateFollowerCountLabel(element);
    }
    else if (data.authenticated == false || data.profile == false) {
      element.text(element.attr('text-not-following'));
      element.removeClass(element.attr('class-following'));
      element.addClass(element.attr('class-not-following'));
      element.attr('following', 'false');
    }
    else {
      new Message("Sorry, an error occurred", 'error', 5000)
    }
  }

  $(".follow-toggle-button").each(function() {
    var element = $(this);
    var toFollow = element.attr('user');
    updateFollowerCountLabel(element);
    $.post('/follows', {toFollow: toFollow}, function(data) {
      handleResponse(element, data);
    });
  });

  $(document).on('click', '.follow-toggle-button', function() {
    var element = $(this);
    if (element.hasClass("disabled")) return false;

    var toFollow = element.attr('user');
    var licenseAddress = element.attr('licenseAddress');
    var follow = element.attr('following') != "true";

    $.post('/follow', {toFollow: toFollow, licenseAddress: licenseAddress, follow: follow}, function(data) {
      var oldCount = parseInt(element.attr('follower-count'));
      if (data.success) {
        element.attr('follower-count', data.following ? oldCount+1 : oldCount-1);
      }
      handleResponse(element, data);
      if (data.authenticated == false) {
        new Message("You need to login to follow a user", "warning", 5000)
          .button("Login", function() {
            window.top.location = "/welcome";
          });
      }
      else if (data.profile == false) {
        new Message("You need to save your profile before you can tip", "warning", 5000)
          .button("Go to my profile", function() {
            window.location = "/profile";
          });
      }
    })
  });
});