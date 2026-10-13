(function () {
  var allowed = { light: true, dark: true, system: true };
  var theme = "light";

  try {
    var saved = window.localStorage.getItem("lostdeal-theme");
    if (saved && allowed[saved]) theme = saved;
  } catch {
    theme = "light";
  }

  document.documentElement.dataset.theme = theme;
  var density = "comfortable";
  var sidebar = "expanded";
  try {
    if (window.localStorage.getItem("lostdeal-density") === "compact") density = "compact";
    if (window.localStorage.getItem("lostdeal-sidebar") === "collapsed") sidebar = "collapsed";
  } catch { /* Use safe defaults when browser storage is unavailable. */ }
  document.documentElement.dataset.density = density;
  document.documentElement.dataset.sidebar = sidebar;
})();
