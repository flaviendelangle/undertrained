"use client";

import dynamic from "next/dynamic";

export const PaceCard = dynamic(() => import("./PaceCard"), {
  ssr: false,
});
