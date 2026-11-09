"use client";
import { createContext, useContext } from "react";

export const SacredFeaturesContext = createContext(true);
export const useSacredFeaturesEnabled = () => useContext(SacredFeaturesContext);
