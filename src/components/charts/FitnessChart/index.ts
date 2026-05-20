"use client";

import dynamic from "next/dynamic";

export const FitnessChart = dynamic(() => import("./FitnessChart"), {
  ssr: false,
});
