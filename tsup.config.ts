import { defineConfig } from "tsup";

export default defineConfig([
  {
    //entry: ["src/index.ts"],
    entry: ["src/index.ts", "src/main.ts"],
    clean: true,
    minify: true,
    skipNodeModulesBundle: true,
    format: ["cjs", "esm"],
    dts: true,
  },
  /*{
    entry: ["src/main.ts"],
    minify: true,
    skipNodeModulesBundle: true,
    format: ["esm"],
  },*/
]);
