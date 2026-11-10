import {useEffect,useRef} from 'react';
import type {solarWaterState,WaterSurface} from './solar-water';

type WaterState=NonNullable<ReturnType<typeof solarWaterState>>;

function surfaceMask(width:number,height:number,surface:WaterSurface) {
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d')!;
  ctx.fillStyle='#fff';ctx.filter=`blur(${Math.max(2,width/110)}px)`;
  const points=surface.points.map(([x,y])=>[x*width,y*height]);
  const first=points[0],last=points.at(-1)!;
  ctx.beginPath();ctx.moveTo((last[0]+first[0])/2,(last[1]+first[1])/2);
  points.forEach(([x,y],index)=>{const next=points[(index+1)%points.length];ctx.quadraticCurveTo(x,y,(x+next[0])/2,(y+next[1])/2);});
  ctx.closePath();ctx.fill();ctx.filter='none';ctx.globalCompositeOperation='destination-out';
  for(const [x,y,rx,ry]of surface.rocks){ctx.beginPath();ctx.ellipse(x*width,y*height,rx*width,ry*height,0,0,Math.PI*2);ctx.fill();}
  return canvas;
}

function iceTexture(width:number,height:number,frost:number) {
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d')!,pixels=ctx.createImageData(width,height);
  let seed=328329;
  const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296;};
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const index=(y*width+x)*4,grain=random(),cloud=Math.sin(x*.019+Math.sin(y*.037))*Math.sin(y*.023+x*.006);
    pixels.data[index]=190+grain*24+cloud*11;pixels.data[index+1]=212+grain*22+cloud*9;pixels.data[index+2]=225+grain*20+cloud*6;
    pixels.data[index+3]=(frost+(grain-.5)*.10+cloud*.035)*255;
  }
  ctx.putImageData(pixels,0,0);
  ctx.strokeStyle='rgba(64,102,124,.17)';ctx.lineWidth=Math.max(.6,width/1800);
  for(let vein=0;vein<8;vein++){
    let x=width*(.15+random()*.7),y=height*(.64+random()*.28);
    ctx.beginPath();ctx.moveTo(x,y);
    for(let step=0;step<9;step++){x+=(random()-.48)*width*.075;y+=(random()-.48)*height*.045;ctx.lineTo(x,y);}
    ctx.stroke();
  }
  return canvas;
}

/** A bounded surface redraw leaves the original plate and all land untouched. */
export default function SolarWaterSurface({url,water,displayWidth,paused}:{url:string;water:WaterState;displayWidth:number;paused:boolean}) {
  const canvasRef=useRef<HTMLCanvasElement>(null);
  const {surface,phase,amplitude,speed,frost,rain}=water;
  useEffect(()=>{
    const canvas=canvasRef.current,ctx=canvas?.getContext('2d');
    if(!canvas||!ctx)return;
    ctx.clearRect(0,0,canvas.width,canvas.height);delete canvas.dataset.waterPhase;canvas.dataset.motion='paused';
    const image=new Image(),motion=window.matchMedia('(prefers-reduced-motion: reduce)');
    const compact=window.matchMedia('(max-width:760px)').matches;
    const lowPower=navigator.hardwareConcurrency>0&&navigator.hardwareConcurrency<=4;
    const maxWidth=lowPower?640:compact?768:1280,framesPerSecond=lowPower?14:compact?18:24,strip=compact||lowPower?3:2;
    let disposed=false,ready=false,intersecting=false,frame=0,lastFrame=0;
    let mask:HTMLCanvasElement,ice:HTMLCanvasElement|null=null;
    const paint=(time:number)=>{
      const width=canvas.width,height=canvas.height;
      ctx.clearRect(0,0,width,height);
      if(phase==='ice'){
        ctx.drawImage(image,0,0,width,height);ctx.drawImage(ice!,0,0);
      }else{
        const scale=image.naturalWidth/width;
        for(let y=Math.max(0,Math.floor(surface.top*height)-strip);y<Math.min(height,Math.ceil(surface.bottom*height)+strip);y+=strip){
          const depth=Math.max(0,(y/height-surface.top)/(1-surface.top));
          const wave=Math.sin(y*.43-time*speed*2.1)+Math.sin(y*.17+time*speed*1.3)*.45;
          const dx=wave*amplitude*(.35+depth),dy=Math.sin(y*.31-time*speed*1.7)*amplitude*.22*depth;
          const sourceY=Math.max(0,Math.min(image.naturalHeight-strip*scale,(y+dy)*scale));
          ctx.drawImage(image,0,sourceY,image.naturalWidth,strip*scale,dx,y,width,strip);
        }
        // Small perspective ellipses use the same surface mask as the moving reflections.
        const drops=Math.round(rain*(compact||lowPower?10:20));
        for(let index=0;index<drops;index++){
          const progress=(time*.65+index*.61803398875)%1;
          const depth=.12+((index*.38196601125)%1)*.82;
          const x=((index*.754877666+time*.002)%1)*width,y=(surface.top+(surface.bottom-surface.top)*depth)*height;
          const radius=(2+progress*8)*(.35+depth);
          ctx.strokeStyle=`rgba(210,230,242,${(1-progress)*.22*rain})`;ctx.lineWidth=.65;
          ctx.beginPath();ctx.ellipse(x,y,radius,radius*.24,0,0,Math.PI*2);ctx.stroke();
        }
      }
      ctx.globalCompositeOperation='destination-in';ctx.drawImage(mask,0,0);ctx.globalCompositeOperation='source-over';
    };
    const tick=(timestamp:number)=>{
      if(disposed||paused||!intersecting||document.visibilityState!=='visible'||motion.matches||phase==='ice')return;
      if(timestamp-lastFrame>=1000/framesPerSecond){paint(timestamp/1000);lastFrame=timestamp;}
      frame=requestAnimationFrame(tick);
    };
    const sync=()=>{
      cancelAnimationFrame(frame);
      if(disposed||!ready)return;
      const running=!paused&&intersecting&&document.visibilityState==='visible'&&!motion.matches&&phase!=='ice';
      if(phase==='ice')paint(0);
      else if(motion.matches)ctx.clearRect(0,0,canvas.width,canvas.height);
      else if(!paused&&intersecting&&document.visibilityState==='visible')paint(performance.now()/1000);
      canvas.dataset.waterPhase=phase;canvas.dataset.motion=running?'running':'paused';
      if(running)frame=requestAnimationFrame(tick);
    };
    image.onload=()=>{
      if(disposed)return;
      canvas.width=Math.max(1,Math.min(maxWidth,Math.round(displayWidth||image.naturalWidth)));
      canvas.height=Math.max(1,Math.round(canvas.width*image.naturalHeight/image.naturalWidth));
      mask=surfaceMask(canvas.width,canvas.height,surface);
      if(phase==='ice')ice=iceTexture(canvas.width,canvas.height,frost);
      canvas.dataset.frameLimit=String(framesPerSecond);ready=true;sync();
    };
    const intersection=new IntersectionObserver(entries=>{intersecting=entries[0]?.isIntersecting??false;sync();});
    intersection.observe(canvas);
    image.src=url;
    motion.addEventListener('change',sync);document.addEventListener('visibilitychange',sync);
    return()=>{disposed=true;cancelAnimationFrame(frame);intersection.disconnect();motion.removeEventListener('change',sync);document.removeEventListener('visibilitychange',sync);image.onload=null;};
  },[url,phase,amplitude,speed,frost,rain,displayWidth,paused,surface]);
  return <canvas ref={canvasRef} className="solar-landscape-water" aria-hidden="true"/>;
}
