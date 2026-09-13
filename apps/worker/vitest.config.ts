import { defineConfig } from "vitest/config";
// The World tenant pulls @wcm-inc/abi, which ships raw TypeScript; vite must transform it.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], server: { deps: { inline: [/@wcm-inc\//] } } } });
