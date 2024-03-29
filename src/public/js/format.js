var format = {
  formatNumber: function (value) {
    if (!value || value == 0) return 0;
    if (value < 1) return value.toFixed(1);
    const lookup = ["", "k", "M", "B", "T"];
    var order = Math.min(Math.floor(Math.log10(value) / 3), lookup.length - 1);
    var mult = value / Math.pow(10, 3 * order);
    var decimals = order > 0 ? 1 : 0;
    return mult.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + lookup[order];
  }
};