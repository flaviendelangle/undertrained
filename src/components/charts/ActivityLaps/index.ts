"use client";

import dynamic from "next/dynamic";

export const ActivityLaps = dynamic(() => import("./ActivityLaps"), {
  ssr: false,
});
