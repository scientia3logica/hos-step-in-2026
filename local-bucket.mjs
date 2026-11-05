import {mkdir,readFile,writeFile,rename,unlink,readdir} from 'node:fs/promises';
import {join} from 'node:path';
// Local-only R2-compatible adapter. Production continues to use env.BUCKET.
export function localBucket(directory){
 const path=key=>join(directory,Buffer.from(key).toString('base64url'));
 return {
 async put(key,value){await mkdir(directory,{recursive:true});const bytes=typeof value==='string'?Buffer.from(value):Buffer.from(await new Response(value).arrayBuffer());const tmp=path(key)+'.tmp-'+crypto.randomUUID();await writeFile(tmp,bytes);await rename(tmp,path(key));},
 async get(key,{range}={}){let bytes;try{bytes=await readFile(path(key));}catch(e){if(e.code==='ENOENT')return null;throw e;}const size=bytes.length;let selected;
 const header=range?.get?.('Range');if(header){const m=/^bytes=(\d+)-(\d*)$/.exec(header);if(m){const offset=Number(m[1]),end=m[2]?Math.min(Number(m[2]),size-1):size-1;if(offset<size&&end>=offset){selected={offset,length:end-offset+1};bytes=bytes.subarray(offset,end+1);}}}
 return {body:bytes,size,range:selected,json:async()=>JSON.parse(bytes.toString())};},
 async list({prefix,limit=1000}){await mkdir(directory,{recursive:true});const keys=(await readdir(directory)).filter(n=>!n.includes('.tmp-')).map(n=>Buffer.from(n,'base64url').toString()).filter(k=>k.startsWith(prefix)).sort().slice(0,limit);return {objects:keys.map(key=>({key}))};},
 async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])try{await unlink(path(key));}catch(e){if(e.code!=='ENOENT')throw e;}}
 };
}
