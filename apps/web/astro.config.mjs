import { defineConfig } from "astro/config"
import svelte from "@astrojs/svelte"
import tailwindcss from "@tailwindcss/vite"

// https://astro.build/config
export default defineConfig({
  integrations: [svelte()],
  vite: {
    plugins: [tailwindcss()],
  },
  server: {
    port: 4321,
    host: "127.0.0.1",
  },
})
