// Semantic head parts. Original pixels, independent pivots, registered underpaint.
const NS='http://www.w3.org/2000/svg';let serial=0;
export const headParts=[
 {id:'ahoge',root:[675,195],path:'M570 0H800V232H570Z'},
 {id:'rear-temple-hair',root:[457,470],path:'M340 350H484C472 389 466 427 467 463C463 495 472 536 496 560Q472 552 457 533H340Z'},
 {id:'ear-left',root:[457,515],path:'M393 506L457 479Q456 508 481 542Q420 538 393 512Z',clip:'M391 504L459 477Q458 510 484 544Q418 540 391 514Z'},
 {id:'bangs',root:[704,242],path:'M678 210Q718 197 751 229C783 271 797 341 784 412Q780 440 770 466Q769 489 783 502Q754 501 741 485Q727 500 698 502Q711 490 710 477Q689 460 671 435L683 465Q651 434 646 387Q639 341 646 301Q648 246 678 210Z'}
];
export function createSecondary(root,config,canvas,picture,earBefore){
 const make=(tag,attrs={})=>{const n=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
 const defs=make('defs');root.prepend(defs);const prefix='semantic-head-'+(++serial),joints=[],rearEars=[];
 const channels=Object.fromEntries(['hair','seatedHair','wings','tail','ears','ahoge','bangs'].map(name=>[name,{x:0,v:0,c:config[name==='seatedHair'?'hair':name]}]));
 function wrap(element,names){
  if(!names.includes('ahoge'))return element;
  const id=prefix+'-'+joints.length,outer=make('g',{'data-part':'head-components'}),base=make('g'),mask=make('mask',{id:id+'-base',maskUnits:'userSpaceOnUse',x:0,y:0,width:1254,height:1254});
  mask.append(make('rect',{width:1254,height:1254,fill:'white'}));
  const seated=element.getAttribute('visibility')==='hidden';element.replaceWith(outer);base.append(element);base.setAttribute('mask',`url(#${id}-base)`);
  const parts=[],tendrils=[];
  // Warp the continuous source below the cheeks. No old-hair underpaint or cutout swap.
  mask.append(make('rect',{x:0,y:601,width:1254,height:653,fill:'black'}));
  const tipLayer=make('g',{'data-part':'front-tendrils'});
  const rows=[600,615,630,645,660,675,690,705,720,740,760,1254];
  for(let side=0;side<2;side++)for(let i=0;i<rows.length-1;i++){
   const y0=rows[i],y1=rows[i+1],cid=id+'-tendril-'+side+'-'+i;
   const clip=make('clipPath',{id:cid,clipPathUnits:'userSpaceOnUse'});clip.append(make('rect',{x:side?700:0,y:y0-.5,width:side?554:700,height:y1-y0+1}));defs.append(clip);
   const g=make('g'),im=element.cloneNode(false);im.removeAttribute('visibility');im.removeAttribute('clip-path');im.setAttribute('clip-path',`url(#${cid})`);g.append(im);tipLayer.append(g);tendrils.push({g,im,side,y0,y1});
  }

  for(const p of headParts){
   // The former bangs polygon crossed the new source contour and exposed old
   // underpaint/eye pixels. Keep bangs in the continuous head until a genuinely
   // independent matching source exists; no cutout and no fake reconstruction.
   if(p.id==='bangs')continue;
   if(p.id!=='ahoge')mask.append(make('path',{d:p.path,fill:'black'}));
   const clip=make('clipPath',{id:id+'-'+p.id,clipPathUnits:'userSpaceOnUse'});clip.append(make('path',{d:p.clip||p.path}));defs.append(clip);
   // Ears have their own depth. Old underpaint here would put ear pixels back
   // above the waving palm; the original continuous hair remains in the base.
   if(!['ear-left','ahoge','rear-temple-hair'].includes(p.id)){const under=picture('head-underpaint');under.setAttribute('clip-path',`url(#${id}-${p.id})`);outer.append(under);}
   const joint=make('g',{'data-part':p.id}),im=p.id==='ahoge'?picture('ahoge-clean'):element.cloneNode(false);im.removeAttribute('visibility');im.removeAttribute('clip-path');if(p.id!=='ahoge')im.setAttribute('clip-path',`url(#${id}-${p.id})`);
   if(p.id==='rear-temple-hair'){
    // Same source pixels, complementary ownership. A 2px overlap only covers
    // antialias samples on this shared boundary; no generated fill is introduced.
    const rearMask=make('mask',{id:id+'-temple-owner',maskUnits:'userSpaceOnUse',x:0,y:0,width:1254,height:1254});
    rearMask.append(make('rect',{width:1254,height:1254,fill:'black'}),make('path',{d:p.path,fill:'white',stroke:'white','stroke-width':2}));rearMask.append(make('path',{d:headParts.find(part=>part.id==='ear-left').path,fill:'black'}));defs.append(rearMask);im.removeAttribute('clip-path');im.setAttribute('mask',`url(#${id}-temple-owner)`);
   }joint.append(im);
   const external=['ear-left','rear-temple-hair'].includes(p.id)&&!seated;
   if(external){const earLayer=make('g',{'data-part':p.id==='ear-left'?'rear-ear-layer':'rear-temple-layer'});earLayer.append(joint);root.insertBefore(earLayer,earBefore||root.querySelector('[data-arm-slot]'));rearEars.push(earLayer);}
   parts.push({joint,p,im,external});
  }
  defs.append(mask);parts.filter(p=>['ear-left','rear-temple-hair'].includes(p.p.id)&&!p.external).forEach(({joint})=>outer.append(joint));outer.append(base,tipLayer);parts.filter(p=>!['ear-left','rear-temple-hair'].includes(p.p.id)&&!p.external).forEach(({joint})=>outer.append(joint));joints.push({outer,seated,parts,element,tendrils});return outer;
 }
 let previousAngle=0,ahogeAngle=0;
 return {wrap,impulse(direction=1){channels.ahoge.v=Math.max(-380,Math.min(380,channels.ahoge.v+direction*260));},syncHeadTransform(transform,visible){for(const ears of rearEars){ears.setAttribute('transform',transform);ears.setAttribute('visibility',visible?'visible':'hidden');}},step(o,dt,enabled=true){
  const walking=['walk','run'].includes(o.mode),sleep=o.mode==='sleep',tiltVel=dt?((o.headAngle||0)-previousAngle)/dt:0;previousAngle=o.headAngle||0;
  const h=Math.min(dt,.05)/4;
  for(const[name,s]of Object.entries(channels)){
   const phase={hair:.4,seatedHair:.4,wings:2,tail:1.1,ears:1.7,ahoge:.8,bangs:1.3}[name],freq=walking?(o.mode==='run'?9:6):1.7;
   const target=!enabled?0:name==='ahoge'?-tiltVel*.12+Math.max(-1.6,Math.min(1.6,(o.swing||0)/26))*18+(o.face==='surprised'?-16:o.face==='confused'?20:sleep?22:0):(sleep?.3:1)*(s.c.idle*Math.sin(o.t*1.7+phase)+(walking?s.c.motion*.55*Math.sin(o.t*freq+phase):0)+(o.mode==='air'?-s.c.motion:0));
   for(let i=0;i<4;i++){s.v+=((target-s.x)*(name==='ahoge'?140:s.c.k)-s.v*(name==='ahoge'?6:s.c.damping))*h;s.x+=s.v*h;s.x=Math.max(-s.c.limit,Math.min(s.c.limit,s.x));}
  }
  ahogeAngle=enabled?channels.ahoge.x*.5+Math.sin(o.t*2.1)*2:0;
  for(const entry of joints){
   for(const {g,im,side,y0,y1} of entry.tendrils){
    im.setAttribute('href',entry.element.getAttribute('href'));
    const amp=enabled?(sleep?.45:1)*(3.5*Math.sin(o.t*1.7+side*.9)+Math.max(-2,Math.min(2,channels.hair.x*.13))):0;
    const weight=y=>{const k=Math.max(0,Math.min(1,(y-600)/135));return k*k*(3-2*k);};
    const a=amp*weight(y0),b=amp*weight(y1),shear=(b-a)/(y1-y0);g.setAttribute('transform',`matrix(1 0 ${shear} 1 ${a-shear*y0} 0)`);
   }
   if(entry.seated)entry.outer.setAttribute('visibility',o.sit>.5?'visible':'hidden');for(const {joint,p,im}of entry.parts){
   if(p.id!=='ahoge')im.setAttribute("href",entry.element.getAttribute("href"));
   const angle=!enabled||p.id==='rear-temple-hair'?0:p.id==='ahoge'?ahogeAngle:p.id==='ear-left'?Math.max(-1.6,Math.min(1.6,channels.ears.x*.18)):Math.max(-.6,Math.min(.6,channels.bangs.x*.08));joint.setAttribute('transform',`rotate(${angle} ${p.root.join(' ')})`);
  }}
 },values(){return Object.fromEntries(Object.entries(channels).map(([k,s])=>[k,k==='ahoge'?ahogeAngle:s.x]));}};
}
