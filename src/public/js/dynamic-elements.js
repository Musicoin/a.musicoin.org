if (typeof dynamic == "undefined") {
  (function(old) {
    $.fn.attr = function() {
      if(arguments.length === 0) {
        if(this.length === 0) {
          return null;
        }

        var obj = [];
        $.each(this[0].attributes, function() {
          if(this.specified) {
            obj.push({
              name: this.name,
              value: this.value
            });
          }
        });
        return obj;
      }

      return old.apply(this, arguments);
    };
  })($.fn.attr);

  var dynamic = {
    getPrefix: function() { return "de-"},
    getBasePeriod: function() { return 1000},

    isReady: function(element, periodIdx) {
      if (element.attr("de-refresh-period") == "none") return false;
      var period = parseInt(element.attr("de-refresh-period"));
      var offset = parseInt(element.attr("de-refresh-offset"));
      if (!offset) offset = 0;
      if (!period) {
        console.log("element does not have a de-refresh-period defined, " + element.id);
        return false;
      }
      return (periodIdx+offset) % period == 0;
    },

    refreshAll: function(forceUpdate) {
      var periodIdx = Math.floor(new Date().getTime() / dynamic.getBasePeriod());
      $(".dynamic-element").each(function(index, element) {
        if (forceUpdate || dynamic.isReady($(this), periodIdx)) {
          dynamic.refreshElement($(this));
        }
      })
    },

    refreshElement: function(element) {
      var params = {};
      var prefix = dynamic.getPrefix();
      element.attr().forEach(function(param) {
        if (param.name.startsWith(prefix)) {
          params[param.name.substring(prefix.length)] = param.value;
        }
      });

      console.log("Refreshing element with " + JSON.stringify(params));
      element.load( params.url, params )
    }
  };

  $( document ).ready(function() {
    console.log("Setting up dynamic elements, with period: " + dynamic.getBasePeriod());
    window.setInterval(function() { dynamic.refreshAll();}, dynamic.getBasePeriod());


    $(document).on('click', '.de-refresh-button', function() {
      var item = $(this);
      var targetId = item.attr('de-target-id');
      var target = targetId ? $("#" + item.attr('de-target-id')) : item.parentsUntil(".dynamic-element").parent();
      dynamic.refreshElement(target);
    })
  });
}
