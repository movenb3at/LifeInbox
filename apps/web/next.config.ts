import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  logging: { incomingRequests: false },
  devIndicators: false,
  distDir: process.env.LIFEINBOX_E2E === "1" ? ".next-e2e" : ".next",
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "X-Frame-Options", value: "DENY" },
    ] }];
  },
};
export default config;
