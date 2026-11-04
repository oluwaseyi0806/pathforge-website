// =====================================================================
//  PathForge website settings - THE ONLY FILE YOU NEED TO EDIT
//  Everything here is public (anyone can see it). Never put secret keys
//  here - secrets go in Vercel -> Settings -> Environment Variables.
// =====================================================================
window.PATHFORGE_CONFIG = {
  // Your WhatsApp number, international format, digits only, no "+".
  // Nigeria example: 0803 123 4567  ->  "2348031234567"
  whatsappNumber: "",

  // Cloudflare Turnstile SITE key (public). Guide part D.
  // Leave empty until you have it.
  turnstileSiteKey: "0x4AAAAAAFoWffxbChZcLBbH",

  // Naira per 1 US dollar, to show "About N..." under the prices.
  // Update it now and then. Leave 0 to hide.
  ngnPerUsd: 0,

  // Link to your demo video on YouTube (guide part G). Leave "" to hide.
  demoVideoUrl: "",

  // Screenshots of the app (guide part F). Put the image files in the
  // "screenshots" folder, then list them here, for example:
  //   { src: "screenshots/main-window.png", caption: "The main window" },
  screenshots: [
    { src: "screenshots/v46-main.webp", small: "screenshots/v46-main-800.webp", w: 1300, h: 890, caption: "Import an STL and see it in G-code coordinates, with the stock and X0 Y0 Z0" },
    { src: "screenshots/v46-check.webp", small: "screenshots/v46-check-800.webp", w: 1200, h: 760, caption: "Every program is checked on a virtual block before you save it: two end mills and a drill, PASSED" },
    { src: "screenshots/v46-player.webp", small: "screenshots/v46-player-800.webp", w: 1200, h: 740, caption: "The G-code player: watch the material come off, line by line" },
    { src: "screenshots/v46-tool-library.webp", w: 900, h: 560, caption: "Tool library with feeds and speeds by material" },
  ],

  // SHOWCASE page: real parts cut with PathForge (only with the maker's permission).
  // Put photos in the "showcase" folder (WebP, about 1200 px wide), then add e.g.:
  //   { img: "showcase/bracket.webp", title: "Aluminium bracket", material: "6061 aluminium",
  //     machine: "Tormach 770", time: "21 min", by: "Name, City" },
  showcase: [],

  // VirusTotal: scan PathForgeCAM_Windows.zip at virustotal.com, then paste the report
  // link here (it starts with https://www.virustotal.com/). Leave "" to hide the link.
  virusTotalUrl: "",

  // FREE DOWNLOAD (see RELEASE_GUIDE.md in the software folder).
  // Set downloadReady to true once the zip is uploaded to the GitHub release,
  // and paste the code from PathForgeCAM_Windows.zip.sha256.txt.
  downloadReady: true,
  downloadUrl: "https://github.com/oluwaseyi0806/pathforge-website/releases/latest/download/PathForgeCAM_Windows.zip",
  downloadVersion: "4.6 Free Beta",
  downloadSizeMb: 70,         // e.g. 95 - shown on the button; 0 hides it
  downloadSha256: "E181DF0D109388662EEF1E578A9B72613C875B37E4B29806EE3D5E0BFC79788C",

  // Visitor statistics. Turn on in Vercel first (guide part H), then set true.
  vercelAnalytics: false
};
