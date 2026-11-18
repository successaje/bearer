// Lets Node run the app's TypeScript directly (node --experimental-transform-types): resolves the
// "@/" alias to src/, and imports written without an extension, as the bundler does.
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = fileURLToPath(new URL("../src/", import.meta.url));

registerHooks({
  resolve(specifier, context, next) {
    let base = null;
    if (specifier.startsWith("@/")) base = pathToFileURL(SRC + specifier.slice(2)).href;
    else if (
      (specifier.startsWith("./") || specifier.startsWith("../")) &&
      context.parentURL?.startsWith("file:") &&
      !context.parentURL.includes("/node_modules/")
    ) {
      base = new URL(specifier, context.parentURL).href;
    }
    if (base && !/\.[cm]?[jt]sx?$/.test(base)) {
      for (const ext of [".ts", ".tsx", "/index.ts"])
        if (existsSync(fileURLToPath(base + ext))) return next(base + ext, context);
    }
    return next(specifier.startsWith("@/") && base ? base : specifier, context);
  },
});
