import { defineConfig } from "vite";
import { VitePWA } from 'vite-plugin-pwa'
import react from "@vitejs/plugin-react-swc";
import path from "path";
import basicSsl from '@vitejs/plugin-basic-ssl'

import { execSync } from "child_process";

// Get git commit hash
const commitHash = execSync("git rev-parse --short HEAD").toString().trim();

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __COMMIT_HASH__: JSON.stringify(commitHash),
  },
  server: {
    host: "::",
    port: 8080,
    allowedHosts: ["ccred.xyz", "localhost", "192.168.0.3"],
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  plugins: [
    react(),
    basicSsl(),
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
