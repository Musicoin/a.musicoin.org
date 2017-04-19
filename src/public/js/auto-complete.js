var autocomplete = {
  split: function (val) {
    return val.split(/,\s*/);
  },

  extractLast: function (term) {
    return autocomplete.split(term).pop();
  },

  linkAutoComplete: function (selector, list, minLength, mustMatch) {

    function makeCanonical(v) {
      return v ? v.trim().toLowerCase() : v;
    }

    var lcaseMap = [];
      list.forEach(function(t) {
        lcaseMap[makeCanonical(t)] = t;
      });

    $(selector)
      .on("keydown", function (event) {
        if (event.keyCode === $.ui.keyCode.TAB &&
          $(this).autocomplete("instance").menu.active) {
          event.preventDefault();
        }
      })
      .autocomplete({
        minLength: minLength,
        source: function (request, response) {
          // delegate back to autocomplete, but extract the last term
          response($.ui.autocomplete.filter(
            list, autocomplete.extractLast(request.term)));
        },
        change: function (event, ui) {
          var terms = autocomplete.split(this.value);
          var newTerms = [];
          terms.forEach(function(t) {
            var canonicalValue = lcaseMap[makeCanonical(t)];
            var finalValue = canonicalValue
              ? canonicalValue
              : mustMatch ? null: t;

            if (finalValue && newTerms.indexOf(finalValue) < 0) {
              newTerms.push(finalValue);
            }
          });
          this.value = newTerms.join(", ");
        },
        focus: function () {
          // prevent value inserted on focus
          return false;
        },
        select: function (event, ui) {
          var terms = autocomplete.split(this.value);
          // remove the current input
          terms.pop();
          // add the selected item
          terms.push(ui.item.value);
          // add placeholder to get the comma-and-space at the end
          terms.push("");
          this.value = terms.join(", ");
          return false;
        }
      });
  }
};

