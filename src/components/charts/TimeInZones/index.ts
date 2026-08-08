"use client";

import dynamic from "next/dynamic";

export const TimeInZones = dynamic(() => import("./TimeInZones"), {
  ssr: false,
});
