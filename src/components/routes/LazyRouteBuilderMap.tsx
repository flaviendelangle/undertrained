"use client";

import dynamic from "next/dynamic";

// Leaflet touches `window`, so load the builder map client-side only (same as
// ~/components/Map).
export const RouteBuilderMap = dynamic(() => import("./RouteBuilderMap"), {
  ssr: false,
});
