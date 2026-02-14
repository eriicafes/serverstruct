import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "./src/index.ts",
    "./src/openapi.ts",
    "./src/openapi.scalar.ts",
    "./src/otel.ts",
  ],
  format: ["esm", "cjs"],
});
