// fonts.js - loads the Google fonts WITHOUT holding up the first paint.
// display=optional: if Barlow arrives quickly it is used; on a slow first visit the
// page keeps the system font (no late re-draw), and Barlow is ready from the next page on.
// Loaded with "async" in each page's <head>.
(function () {
  var l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2?family=Barlow:wght@400;600;700&family=Barlow+Semi+Condensed:wght@600;700;800&display=optional";
  document.head.appendChild(l);
})();
