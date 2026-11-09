import { MAP_IMAGE_LIMIT } from "./mindmaps-model";

/** Decode and re-encode raster pixels; store the thumbnail inside the encrypted map. */
export async function prepareMindmapImage(file: File): Promise<string> {
  if(!["image/png","image/jpeg","image/webp"].includes(file.type)||file.size>10_000_000)
    throw new Error("invalid-type");
  let image: ImageBitmap;
  try { image=await createImageBitmap(file); }
  catch { throw new Error("invalid-image"); }
  try {
    if(!image.width||!image.height||image.width*image.height>40_000_000)
      throw new Error("too-large");
    for(const max of [720,540,360]) {
      const scale=Math.min(1,max/Math.max(image.width,image.height));
      const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
      const context=canvas.getContext("2d");if(!context)throw new Error("prepare-failed");
      context.drawImage(image,0,0,canvas.width,canvas.height);
      const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/webp",.84));
      if(!blob)throw new Error("prepare-failed");
      const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error("invalid-image"));reader.readAsDataURL(blob);});
      if(data.length<=MAP_IMAGE_LIMIT)return data;
    }
    throw new Error("too-large");
  } finally { image.close(); }
}
