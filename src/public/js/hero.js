$( document ).ready(function() {
  $(document).on('click', '.hero-toggle', function() {
    console.log("Toggling hero")
    var miniHero = $(".mini-hero");
    var wasMinimizeHeroInFeed = miniHero.is( ":visible" );
    var minimizeHeroInFeed = !wasMinimizeHeroInFeed;
    miniHero.css("display", minimizeHeroInFeed ? "block" : "none");
    $(".hero").css("display", !minimizeHeroInFeed ? "flex" : "none");
    $.post("/preferences/update", {
      minimizeHeroInFeed: minimizeHeroInFeed
    }, function (data) {
      if (data.success) {

      }
      else {
        new Message("Failed to update preferences", "error", 3000);
        $("#messagePreference")[0].checked = !checked;
      }
    })
  })
});