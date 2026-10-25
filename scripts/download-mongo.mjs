// Download only the server binary and notices from the official release ZIP.
// HTTP byte ranges avoid downloading hundreds of MB of unused debug symbols.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inflateRawSync} from 'node:zlib';
const url='https://fastdl.mongodb.org/windows/mongodb-windows-x86_64-8.0.34.zip';
const root=fileURLToPath(new URL('../.runtime/mongodb/',import.meta.url));
async function range(start,end){
 const r=await fetch(url,{headers:{Range:'bytes='+start+'-'+end},signal:AbortSignal.timeout(120000)});
 if(r.status!==206)throw Error('Official download server must support byte ranges');
 return Buffer.from(await r.arrayBuffer());
}
const tailResponse=await fetch(url,{headers:{Range:'bytes=-65557'},signal:AbortSignal.timeout(20000)});
if(tailResponse.status!==206)throw Error('Unable to read release archive directory');
const tail=Buffer.from(await tailResponse.arrayBuffer());let eocd=-1;
for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50){eocd=i;break}
if(eocd<0)throw Error('ZIP directory not found');
const directorySize=tail.readUInt32LE(eocd+12),directoryOffset=tail.readUInt32LE(eocd+16);
const directory=await range(directoryOffset,directoryOffset+directorySize-1),entries=[];
for(let i=0;i<directory.length;){
 if(directory.readUInt32LE(i)!==0x02014b50)throw Error('Invalid ZIP directory entry');
 const nameLength=directory.readUInt16LE(i+28),extraLength=directory.readUInt16LE(i+30),commentLength=directory.readUInt16LE(i+32);
 const name=directory.subarray(i+46,i+46+nameLength).toString('utf8');
 entries.push({name,method:directory.readUInt16LE(i+10),crc:directory.readUInt32LE(i+16),size:directory.readUInt32LE(i+20),expanded:directory.readUInt32LE(i+24),offset:directory.readUInt32LE(i+42)});
 i+=46+nameLength+extraLength+commentLength;
}
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0});
function crc32(b){let crc=0xffffffff;for(const byte of b)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0}
const selected=entries.filter(x=>/\/bin\/(mongod\.exe|[^/]+\.dll)$/i.test(x.name)||(/license|copying|third.?party|readme/i.test(x.name)&&x.size<2000000&&!x.name.endsWith('/')));
if(!selected.some(x=>x.name.endsWith('/bin/mongod.exe')))throw Error('Server executable is absent from official archive');
for(const entry of selected){
 if(entry.size>200000000||entry.expanded>300000000)throw Error('Unexpected release entry size');
 const basename=path.posix.basename(entry.name);
 if(!/^[A-Za-z0-9._-]+$/.test(basename))throw Error('Unsafe archive entry name');
 console.log('Fetching '+basename+' ('+Math.round(entry.size/1024/1024)+' MB compressed)...');
 const header=await range(entry.offset,entry.offset+29);
 if(header.readUInt32LE(0)!==0x04034b50)throw Error('Invalid ZIP local header');
 const start=entry.offset+30+header.readUInt16LE(26)+header.readUInt16LE(28);
 const compressed=await range(start,start+entry.size-1);
 const bytes=entry.method===8?inflateRawSync(compressed,{maxOutputLength:300000000}):entry.method===0?compressed:null;
 if(!bytes||bytes.length!==entry.expanded||crc32(bytes)!==entry.crc)throw Error('Release entry failed integrity check');
 const destination=path.join(root,entry.name.includes('/bin/')?'bin':'notices',basename);
 await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,bytes);
}
await fs.writeFile(path.join(root,'release.json'),JSON.stringify({version:'8.0.34',source:url,integrity:'HTTPS official source; per-entry ZIP CRC32 and uncompressed size verified'},null,2));
console.log('Local MongoDB server files are ready.');
