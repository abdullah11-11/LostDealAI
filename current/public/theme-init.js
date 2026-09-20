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
})();
