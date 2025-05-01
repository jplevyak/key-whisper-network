import { defineConfig } from "vite";
import { VitePWA } from 'vite-plugin-pwa'
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    allowedHosts: [ "ccred.xyz", "localhost" ],
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      devOptions: {
         enabled: true, // Enable PWA in development (optional)
         type: 'module',
      },
      // Optional: Configure manifest options
      manifest: {
        name: 'CCred',
        short_name: 'CCred',
        description: 'CCred Secure Communication',
        theme_color: '#ffffff',
        icons: [
          {
            src: 'public/android-chrome-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'public/android-chrome-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    sourcemap: true,
  },
}));
