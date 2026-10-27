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
    { src: "screenshots/main-window.webp",     w: 1593, h: 852, caption: "Import an STL and see it in 3D" },
    { src: "screenshots/passed.webp",          w: 1245, h: 869, caption: "Every program is checked on a virtual block before you save it" },
    { src: "screenshots/settings-panels.webp", w: 669, h: 740, caption: "Set your tool, feeds, zero point and machine, then generate" },
  ],

  // FREE DOWNLOAD (see RELEASE_GUIDE.md in the software folder).
  // Set downloadReady to true once the zip is uploaded to the GitHub release,
  // and paste the code from PathForgeCAM_Windows.zip.sha256.txt.
  downloadReady: true,
  downloadUrl: "https://github.com/oluwaseyi0806/pathforge-website/releases/latest/download/PathForgeCAM_Windows.zip",
  downloadVersion: "4.4.1 Free Beta",
  downloadSizeMb: 70,         // e.g. 95 - shown on the button; 0 hides it
  downloadSha256: "4D8C08006F7A0C55F6C59020CE2C93162DE0F374DB57C510920BB1F30F6D363D",

  // Visitor statistics. Turn on in Vercel first (guide part H), then set true.
  vercelAnalytics: false
};
