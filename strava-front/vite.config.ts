import fs from "fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "fabrun.test",
    port: 5173,
    https: {
      key: fs.readFileSync("certs/fabrun.test-key.pem"),
      cert: fs.readFileSync("certs/fabrun.test.pem"),
    },
  },
});
