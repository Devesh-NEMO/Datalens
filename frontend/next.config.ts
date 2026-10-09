import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* The dev indicator ("N" badge) defaults to bottom-left, where it covers the
     sidebar's account block. Move it to bottom-right so the user block stays
     fully visible and clickable during development. */
  devIndicators: {
    position: "bottom-right",
  },
};

export default nextConfig;