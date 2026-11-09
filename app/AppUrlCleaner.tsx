"use client";

import { useEffect } from "react";
import { cleanGenesisAppUrl } from "./app-url";

export function AppUrlCleaner() {
  useEffect(() => {
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const clean = cleanGenesisAppUrl(window.location.href);
    if (clean !== current) {
      window.history.replaceState(window.history.state, "", clean);
    }
  }, []);

  return null;
}
