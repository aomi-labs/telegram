import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Workspace packages and the partner SDK are TypeScript sources; Next compiles them.
  transpilePackages: ["@aomi-telegram/core", "@aomi-telegram/tenant-world", "@wcm-inc/sdk", "@wcm-inc/abi", "@wcm-inc/tools"],
  serverExternalPackages: ["postgres", "ethers", "undici"],
};

export default nextConfig;
