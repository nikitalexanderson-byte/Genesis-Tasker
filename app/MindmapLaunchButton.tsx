"use client";
import {useEffect,useRef,useState,type PointerEvent} from "react";
import "./mindmap-launch-button.css";

export function MindmapLaunchButton({label,onClick,className=""}:{label:string;onClick:()=>void;className?:string}) {
  const button=useRef<HTMLButtonElement>(null);
  const [moving,setMoving]=useState(false);
  useEffect(()=>{
    let visible=false;
    const update=()=>setMoving(visible&&document.visibilityState==="visible");
    const observer=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;update();});
    if(button.current)observer.observe(button.current);
    document.addEventListener("visibilitychange",update);
    return()=>{observer.disconnect();document.removeEventListener("visibilitychange",update);};
  },[]);
  const follow=(event:PointerEvent<HTMLButtonElement>)=>{
    if(event.pointerType!=="mouse")return;
    const box=event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--map-pointer-x",`${((event.clientX-box.left)/box.width-.5)*3}px`);
    event.currentTarget.style.setProperty("--map-pointer-y",`${((event.clientY-box.top)/box.height-.5)*3}px`);
  };
  return <button ref={button} type="button" className={`primary-button mindmap-launch ${className}`}
    data-animating={moving} onClick={onClick} onPointerMove={follow}
    onPointerLeave={event=>{event.currentTarget.style.removeProperty("--map-pointer-x");event.currentTarget.style.removeProperty("--map-pointer-y");}}>
    <svg className="mindmap-launch-network" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true" focusable="false">
      <g className="mindmap-launch-links"><path d="M14 14 7 7M18 14l7-7M14 18l-7 7M18 18l7 7"/></g>
      <g className="mindmap-launch-flow"><path d="M14 14 7 7M18 14l7-7M14 18l-7 7M18 18l7 7"/></g>
      <circle className="mindmap-launch-pulse" cx="16" cy="16" r="7" strokeWidth="1"/>
      <g className="mindmap-launch-nodes"><circle cx="6" cy="6" r="2.5"/><circle cx="26" cy="6" r="2.5"/><circle cx="6" cy="26" r="2.5"/><circle cx="26" cy="26" r="2.5"/></g>
      <rect className="mindmap-launch-core" x="12" y="12" width="8" height="8" rx="2.5"/>
    </svg><span>{label}</span>
  </button>;
}
