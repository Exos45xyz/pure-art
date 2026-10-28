import { defineConfig } from 'vite';

// The two typefaces are only found once the stylesheet arrives, so on a slow line the name on the loading
// screen was set late and swapped typeface. Preloading them from the page's head starts them at once.
const preloadFonts = () => ({
  name: 'preload-fonts',
  transformIndexHtml(html, ctx) {
    if (!ctx.bundle) return html;
    const fonts = Object.keys(ctx.bundle).filter((file) => /(archivo-latin-wdth|inter-latin-wght)-normal-.*\.woff2$/.test(file));
    return {
      html,
      tags: fonts.map((file) => ({ tag: 'link', attrs: { rel: 'preload', href: `/${file}`, as: 'font', type: 'font/woff2', crossorigin: '' }, injectTo: 'head' })),
    };
  },
});

// three.js is most of the bundle; one file is fine for a single page.
export default defineConfig({
  plugins: [preloadFonts()],
  build: { chunkSizeWarningLimit: 800 },
});
