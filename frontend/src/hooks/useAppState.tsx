"use client";

import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

type AnalysisState = {
  analysis: unknown;
  fileName: string;
  page: string;
  setPage: (page: string) => void;
  reset: () => void;
};

const PAGE_MAP: Record<string, string> = {
  "/": "upload",
  "/overview": "overview",
  "/explorer": "explorer",
  "/products": "products",
  "/analytics": "analytics",
  "/quality": "quality",
  "/profile": "profile",
  "/insights": "insights",
  "/ask": "ask",
  "/reports": "reports",
  "/library": "library",
  "/compare": "compare",
  "/settings": "settings",
};

export function useAppState(): AnalysisState {
  const router = useRouter();
  const pathname = usePathname();

  const derivedPage: string = pathname in PAGE_MAP ? PAGE_MAP[pathname] : "upload";

  const [analysis, setAnalysis] = useState<unknown>(null);
  const [fileName, setFileName] = useState("");

  const setPage = (page: string) => {
    const href = `/${page}`;
    router.push(href);
  };

  const reset = () => {
    setAnalysis(null);
    setFileName("");
    router.push("/upload");
  };

  return { analysis, fileName, page: derivedPage, setPage, reset };
}