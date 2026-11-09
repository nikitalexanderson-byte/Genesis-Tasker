export function draftNumberValue(raw:string,{integer=false,min=-Infinity,max=Infinity,optional=false}:{integer?:boolean;min?:number;max?:number;optional?:boolean}={}):number|null|undefined{
 if(raw===''&&optional)return null;
 if(!(integer?/^-?\d+$/:/^-?(?:\d+(?:\.\d*)?|\.\d+)$/).test(raw))return undefined;
 const value=Number(raw);return Number.isFinite(value)&&(!integer||Number.isSafeInteger(value))&&value>=min&&value<=max?value:undefined;
}
