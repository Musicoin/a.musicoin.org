$( document ).ready(function() {

  $(document).on('click', '.modal-trigger', function() {
    var modal = $("#" + $(this).attr('target'));
    modal.find(".modal-content").load($(this).attr('source'), {}, function() {
      modal.show();
    });
  });

  $(document).on('click', '.modal-close', function() {
    var modal = $("#" + $(this).attr('target'));
    modal.hide();
  });

  // When the user clicks anywhere outside of the modal, close it
  window.onclick = function(event) {
    if ($(event.target).hasClass("modal")) {
      $(".modal").hide();
    }
  }
});
