import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: { environment: "node", include: ["src/**/*.test.ts", "supabase/**/*.test.ts", "api/**/*.test.ts", "scripts/**/*.test.ts"] },
} as never);
