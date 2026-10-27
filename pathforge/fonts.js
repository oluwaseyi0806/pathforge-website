// fonts.js - loads the Google fonts WITHOUT holding up the first paint.
// The page shows straight away in the system font, then switches to Barlow
// when it arrives (font-display: swap). Loaded with "async" in each page's <head>.
(function () {
  var l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&family=Barlow+Semi+Condensed:wght@600;700;800&display=swap";
  document.head.appendChild(l);
})();
