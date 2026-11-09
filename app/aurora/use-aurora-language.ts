import { useLayoutEffect,useEffect,useState,type RefObject } from 'react';
import { auroraLanguage,createAuroraTranslator,loadAuroraLocale } from './localization';

/** Mirrors the existing app's text-node localization, scoped to authored method content only. */
export function useAuroraLanguage(root:RefObject<HTMLElement|null>,requested:string) {
  const language=auroraLanguage(requested);
  const [loaded,setLoaded]=useState<{language:string;translate:(text:string)=>string}|null>(null);
  const [failure,setFailure]=useState<{language:string;attempt:number}|null>(null),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let live=true;
    void loadAuroraLocale(language).then(pack=>{const translate=createAuroraTranslator(language,pack);if(live)setLoaded({language,translate});})
      .catch(()=>{if(live)setFailure({language,attempt});});
    return()=>{live=false;};
  },[language,attempt]);
  const ready=language==='ru'||loaded?.language===language;
  useLayoutEffect(()=>{
    const element=root.current;if(!element||!ready||language==='ru'||!loaded)return;
    const texts=new Map<Text,{source:string;rendered:string}>();
    const attributes=new Map<Element,Map<string,{source:string;rendered:string}>>();
    const excluded=(node:Element)=>{
      // React serializes a conditional data attribute as the string "false".
      // Only an enabled marker protects user content from translation.
      const owner=node.closest('[data-no-translate]:not([data-no-translate="false"])');
      return node.matches('script,style')||Boolean(owner&&owner!==element);
    };
    const apply=(node:Node)=>{
      if(node instanceof Text){
        if(!node.parentElement||excluded(node.parentElement)||node.parentElement.matches('textarea,input'))return;
        const previous=texts.get(node),current=node.nodeValue??'';
        const source=previous&&current===previous.rendered?previous.source:current;
        const rendered=loaded.translate(source);texts.set(node,{source,rendered});
        if(current!==rendered)node.nodeValue=rendered;return;
      }
      if(!(node instanceof Element)||excluded(node))return;
      const saved=attributes.get(node)??new Map();attributes.set(node,saved);
      for(const key of ['aria-label','placeholder','title','alt']){
        const current=node.getAttribute(key);if(current===null)continue;
        const previous=saved.get(key),source=previous&&current===previous.rendered?previous.source:current;
        const rendered=loaded.translate(source);saved.set(key,{source,rendered});if(rendered!==current)node.setAttribute(key,rendered);
      }
      node.childNodes.forEach(apply);
    };
    apply(element);
    const observer=new MutationObserver(changes=>{for(const change of changes){
      if(change.type==='characterData'||change.type==='attributes')apply(change.target);else change.addedNodes.forEach(apply);
    }});
    observer.observe(element,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','placeholder','title','alt','data-no-translate']});
    return()=>{
      observer.disconnect();
      for(const [node,value]of texts)if(element.contains(node)&&node.nodeValue===value.rendered)node.nodeValue=value.source;
      for(const [node,values]of attributes)if(element.contains(node))for(const [key,value]of values)if(node.getAttribute(key)===value.rendered)node.setAttribute(key,value.source);
    };
  },[root,ready,language,loaded]);
  return {language,ready,failed:failure?.language===language&&failure.attempt===attempt,retry:()=>setAttempt(value=>value+1)};
}
