import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/openapi.ts", "./src/openapi.scalar.ts"],
  format: ["esm", "cjs"],
});
