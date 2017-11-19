var tipModule = {
  tipButtonClicked: function (tipButton) {
    if (tipButton.attr("text-pending")) {
      tipButton.html(tipButton.attr("text-pending"))
    }
    tipModule.sendTip(
      tipButton.attr("recipient"),
      tipButton.attr("amount"),
      tipButton.attr("context-type"),
      tipButton.attr("context-id"),
      function(err, result) {
        if (err) {
          tipButton.html(tipButton.attr("text-fail"));
          if (result.authenticated == false) {
            new Message("You need to login to send a tip", "warning", 5000)
              .button("Login", function() {
                window.top.location = "/welcome";
              });
          }
          else if (result.profile == false) {
            new Message("You need to save your profile before you can tip", "warning", 5000)
              .button("Go to my profile", function() {
                window.location = "/profile";
              });
          }
        }
        else {
          tipButton.html(tipButton.attr("text-success"));
          var successCallback = tipButton.attr("on-success");
          if (successCallback) {
            window.eval(successCallback);
          }
        }
        window.setTimeout(function() {tipButton.html(tipButton.attr("text-default"))}, 3000);
      }
    )
  },

  sendTip: function (recipient, amount, contextType, contextId, callback) {
    $.post('/tip', {
      recipient: recipient,
      amount: amount,
      contextType: contextType,
      contextId: contextId
    }, function (data) {
      if (data.success) {
        callback(null, data);
      }
      else if (data.self) {
        new Message("Sorry, you can't tip your own profile", 'warning', 5000);
        callback(new Error("Failed to send tip"), data);
      }
      else {
        callback(new Error("Failed to send tip"), data);
      }
    })
  },

  accumulateTips: function(element) {
    var count = element.attr('count') || 0;
    var amount = element.attr('amount') || 0;
    element.attr('count', ++count % 5);
    var firstClick = (count == 1 && amount == 0);
    var generateTip = true; //count == 5 || firstClick;
    if (generateTip) {
      var amount = element.attr('amount') || 0;
      element.attr('amount', ++amount);
    }
    var b = Math.floor((Math.random() * 100) + 1);
    var d = ["flowOne", "flowTwo", "flowThree"];
    var a = ["colOne", "colTwo", "colThree", "colFour", "colFive", "colSix"];
    var c = (Math.random() * (1.6 - 1.2) + 1.2).toFixed(1);
    var col = a[Math.floor((Math.random() * 6))];
    var size = Math.floor(Math.random() * (50 - 22) + 22);
    var anim = d[Math.floor((Math.random() * 3))];
    // var icon = generateTip ? 'Tip!' : '<i class="fa fa-music"></i>';
    var icon = amount;// '<i class="fa fa-music"></i>';

    $('<div class="heart part-' + b + " " + col + '" style="font-size:' + size + 'px;">' + icon + '</div>').appendTo(".hearts").css({
      animation: "" + anim + " " + c + "s linear"
    });
    $(".part-" + b).show();
    setTimeout(function() {
      $(".part-" + b).remove()
    }, c * 900)

    if (firstClick) {
      setTimeout(function() {
        var finalAmount = element.attr('amount') || 0;
        if (finalAmount > 0) {
          tipModule.sendTip(
            element.attr("recipient"),
            finalAmount,
            element.attr("context-type"),
            element.attr("context-id"),
            function(err, result) {
              if (err) {
                new Message("Tip failed to send", "error", 3000);
              }
              else {
                if (finalAmount == 1) {
                  new Message("You tipped 1 coin!", "success", 3000);
                }
                else {
                  new Message("You tipped " + finalAmount + " coins!", "success", 3000);
                }
              }
            }
          )
        }
        element.attr('amount', 0);
        element.attr('count', 0);
      }, 3000)
    }
  },

  initialize: function initialize() {
    
    var queryOptions = musicoin.utils.queryParamsToObject();

    if(queryOptions.autoTip === 'true') {

      var mainFrameDocument = musicoin.utils.getFrameDocument('mainFrame');

      if(!mainFrameDocument) {
        return;
      }

      $(mainFrameDocument).ready(function onReady() {
        
        var playerDocument = musicoin.utils.getFrameDocument('playerFrame');

        if(!playerDocument) {
          return;
        }

        $(playerDocument).ready(function onReady() {

          setTimeout(function f() {
            tipModule.accumulateTips($(playerDocument.getElementById('player-tip-button')));
          }, 3000);

        });

      });

    }

  }

};

$( document ).ready(function() {

  tipModule.initialize();

  $(document).on('click', '.tip-button', function() {
    var tipButton = $(this);
    if ($(this).attr('confirm-message')) {
      new Message($(this).attr('confirm-message'), 'success', 5000)
        .button('Yes!', function() {
          tipModule.tipButtonClicked(tipButton)
        })
        .button('No', function() {
          new Message("Ok, maybe next time", 'success', 1000)
        })
    }
    else {
      tipModule.tipButtonClicked($(this))
    }
  });
});