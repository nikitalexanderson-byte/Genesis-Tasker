"use client";
import {useSyncExternalStore} from "react";

const query=()=>window.matchMedia("(max-width: 767px)");
const subscribe=(listener:()=>void)=>{const media=query();media.addEventListener("change",listener);return()=>media.removeEventListener("change",listener);};
const snapshot=()=>query().matches;
const serverSnapshot=()=>false;

export const useMobileLayout=()=>useSyncExternalStore(subscribe,snapshot,serverSnapshot);

const headerQuery = () => window.matchMedia("(max-width: 1399.98px)");
const subscribeHeader = (listener: () => void) => {
  const media = headerQuery(); media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
};
const headerSnapshot = () => headerQuery().matches;
export const useCompactHeader = () => useSyncExternalStore(subscribeHeader, headerSnapshot, serverSnapshot);
