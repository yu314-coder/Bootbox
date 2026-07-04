const zlib=require('zlib'),fs=require('fs');
const S=1024;
const buf=Buffer.alloc(S*S*4);
function set(x,y,r,g,b,a){const i=(y*S+x)*4;buf[i]=r;buf[i+1]=g;buf[i+2]=b;buf[i+3]=a;}
// background gradient (MiniOS blue)
for(let y=0;y<S;y++)for(let x=0;x<S;x++){
  const t=(x+y)/(2*S);
  set(x,y, Math.round(27+(6-27)*t), Math.round(58+(18-58)*t), Math.round(91+(31-91)*t),255);
}
// four rounded squares (Windows-like) in accent blue
function rect(cx,cy,w,h,r,g,b){for(let y=cy;y<cy+h;y++)for(let x=cx;x<cx+w;x++)set(x,y,r,g,b,255);}
const m=S*0.30, gap=S*0.05, sq=(S-2*m-gap)/2;
const col=[58,150,221];
rect(Math.round(m),Math.round(m),Math.round(sq),Math.round(sq),...col);
rect(Math.round(m+sq+gap),Math.round(m),Math.round(sq),Math.round(sq),...col);
rect(Math.round(m),Math.round(m+sq+gap),Math.round(sq),Math.round(sq),...col);
rect(Math.round(m+sq+gap),Math.round(m+sq+gap),Math.round(sq),Math.round(sq),...col);
// encode PNG (truecolor+alpha, filter 0 per row)
const raw=Buffer.alloc(S*(S*4+1));
for(let y=0;y<S;y++){raw[y*(S*4+1)]=0;buf.copy(raw,y*(S*4+1)+1,y*S*4,(y+1)*S*4);}
const idat=zlib.deflateSync(raw);
function chunk(type,data){const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const t=Buffer.from(type);const crc=Buffer.alloc(4);crc.writeUInt32BE(crc32(Buffer.concat([t,data]))>>>0);return Buffer.concat([len,t,data,crc]);}
function crc32(b){let c=~0;for(let i=0;i<b.length;i++){c^=b[i];for(let k=0;k<8;k++)c=(c>>>1)^(0xEDB88320&-(c&1));}return ~c;}
const sig=Buffer.from([137,80,78,71,13,10,26,10]);
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(S,0);ihdr.writeUInt32BE(S,4);ihdr[8]=8;ihdr[9]=6;
const png=Buffer.concat([sig,chunk('IHDR',ihdr),chunk('IDAT',idat),chunk('IEND',Buffer.alloc(0))]);
fs.writeFileSync('Bootbox/Assets.xcassets/AppIcon.appiconset/icon-1024.png',png);
console.log('wrote icon-1024.png',png.length,'bytes');
