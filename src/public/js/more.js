$(document).ready(function() {
  var maxHeight = 60;
  $('.more').each(function() {
    var element = $(this);
    if(element.height() >= maxHeight) {
      var content = element.find(".more-content");
      content.css('max-height', maxHeight + 'px');
      content.css('overflow', 'hidden');
      element.find(".morelink").show();
    }
  });

  $(".morelink").click(function(){
    var link = $(this);
    if (link.text() == "show less") {
      var content = $(this).parent().find('.more-content');
      content.css('max-height', maxHeight + 'px');
      content.css('overflow', 'hidden');
      link.text("show more");
    }
    else {
      var content = $(this).parent().find('.more-content');
      content.css('max-height', '1000px');
      content.css('overflow', '');
      link.text("show less");
    }
    return false;
  });
});