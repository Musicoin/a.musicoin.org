var tipModule = {
  tipButtonClicked: function (tipButton) {
    tipModule.sendTip(
      tipButton.attr("recipient"),
      tipButton.attr("amount"),
      function(err, result) {
        if (err) {
          tipButton.html(tipButton.attr("text-fail"));
        }
        else {
          tipButton.html(tipButton.attr("text-success"));
        }
        window.setTimeout(() => tipButton.html(tipButton.attr("text-default")), 3000);
      }
    )
  },

  sendTip: function (recipient, amount, callback) {
    $.post('/tip', {
      recipient: recipient,
      amount: amount,
    }, function (data) {
      if (data.success) {
        callback(null, data);
      }
      else {
        callback(new Error("Failed to send tip"));
      }
    })
  }
};

$( document ).ready(function() {
  $(document).on('click', '.tip-button', function() {
    tipModule.tipButtonClicked($(this))
  })
});