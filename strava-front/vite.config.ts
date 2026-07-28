import fs from "fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  plugins: [react()],
  server: {
    host: "localhost",
    port: 5173,
    https:
      command === "serve"
        ? {
            key: fs.readFileSync("certs/fabrun.test-key.pem"),
            cert: fs.readFileSync("certs/fabrun.test.pem"),
          }
        : undefined,
  },
}));
