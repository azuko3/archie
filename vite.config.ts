import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icon-maskable.svg", "og-image.png"],
      manifest: {
        name: "Archie — Aadam Jacobs Archive",
        short_name: "Archie",
        description: "A browser for the Aadam Jacobs live-recording archive on Archive.org.",
        theme_color: "#0a0a0a",
        background_color: "#0a0a0a",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
          { src: "/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff2}"],
        // Cache Archive.org metadata and cover images for offline browsing
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/archive\.org\/metadata\//,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "archive-metadata",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          {
            urlPattern: /^https:\/\/archive\.org\/download\//,
            handler: "CacheFirst",
            options: {
              cacheName: "archive-audio",
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 30 },
              rangeRequests: true,
            },
          },
        ],
        // catalog.json is bundled in JS; no separate caching needed
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
