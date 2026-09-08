import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Only an alias. Vitest ran with no config at all, so a test could not import
 * anything through "@/..." -- which is how most of lib/ imports its
 * neighbours, and so which modules were testable was decided by their import
 * style rather than by whether they were worth testing.
 *
 * Matches the "@/*" -> "./*" mapping in tsconfig.json. Nothing else is set,
 * so every other Vitest default is unchanged.
 */
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
