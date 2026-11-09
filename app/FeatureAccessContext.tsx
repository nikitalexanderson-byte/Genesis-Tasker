"use client";
import {createContext,useContext,useEffect,useRef,useCallback} from 'react';
import type {FeatureAccess} from './feature-access';
import {allowDataTransfer,dataTransferAllowed} from './data-transfer-access';

/** The current server snapshot is shared by nested editors, including portalled dialogs. */
export const FeatureAccessContext=createContext<FeatureAccess|undefined>(undefined);
export const useFeatureAccess=()=>useContext(FeatureAccessContext);

/** A pending file read must use the latest account entitlement when it completes. */
export function useDataTransferGuard() {
  const access=useFeatureAccess(), latest=useRef(access);
  useEffect(()=>{latest.current=access;return()=>{latest.current=undefined;};},[access]);
  const check=useCallback(()=>allowDataTransfer(latest.current),[]);
  return {allowed:dataTransferAllowed(access),check};
}
