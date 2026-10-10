import { defineConfig } from "vite";

// Vanilla TS + Vite. The two 2D views are plain SVG — no framework, no Three.js this cycle.
export default defineConfig({
  server: {
    open: false,
  },
});
