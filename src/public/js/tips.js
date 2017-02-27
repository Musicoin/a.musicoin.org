var tipModule = {
  tipButtonClicked: function (tipButton) {
    tipModule.sendTip(
      tipButton.attr("recipient"),
      tipButton.attr("amount"),
      tipButton.attr("context-type"),
      tipButton.attr("context-id"),
      function(err, result) {
        if (err) {
          tipButton.html(tipButton.attr("text-fail"));
        }
        else {
          tipButton.html(tipButton.attr("text-success"));
          var successCallback = tipButton.attr("on-success");
          if (successCallback) {
            window.eval(successCallback);
          }
        }
        window.setTimeout(() => tipButton.html(tipButton.attr("text-default")), 3000);
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
      else {
        callback(new Error("Failed to send tip"));
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
  }
};

$( document ).ready(function() {
  $(document).on('click', '.tip-button', function() {
    tipModule.tipButtonClicked($(this))
  })
});