/** @type {import('tailwindcss').Config} */
// Onboarding, RPC setup, and a few overlays use Tailwind utilities.
// The Electron window loads file:// and must work with no network, so the
// CDN build is not an option. Scan the renderer and commit the CSS it emits
// (`npm run build:css`).
module.exports = {
  content: [
    './electron/renderer/index.html',
    './electron/renderer/renderer.js',
    './electron/renderer/i18n.js',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
