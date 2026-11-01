// Registered continuous rear-hair texture; only the outer tips deform.
// Triangle overlap is antialias coverage of the same source, never missing-part fill.
export function createHairMotion(root,node,picture,standing,sitting,rearParent){
 const id='hair-mesh-'+Math.random().toString(36).slice(2),defs=node('defs'),source=picture('rear-hair');source.setAttribute('id',id+'-source');source.setAttribute('transform','translate(0 -116)');defs.append(source);root.prepend(defs);
 const layer=node('g',{'data-part':'outer-hair-mesh'});const ownerClip=node('clipPath',{id:id+'-owner',clipPathUnits:'userSpaceOnUse'});ownerClip.append(node('rect',{x:0,y:510,width:1254,height:744}));defs.append(ownerClip);rearParent.append(layer);
 // Keep the reference node for the figure's existing expression texture updates.
 // The existing standing node now draws only front tendrils.
 const xs=[0,250,310,370,430,490,550,610,730,790,850,910,970,1030,1254],ys=[0,540,580,610,660,710,760,810,860,930,1254],tris=[];
 function add(p){
  const n=tris.length,cx=p.reduce((s,v)=>s+v[0],0)/3,cy=p.reduce((s,v)=>s+v[1],0)/3;
  const clip=node('clipPath',{id:id+'-'+n,clipPathUnits:'userSpaceOnUse'});
  // Tiny shared-edge overlap suppresses raster cracks; all triangles sample the same texture.
  clip.append(node('polygon',{points:p.map(([x,y])=>`${cx+(x-cx)*1.06},${cy+(y-cy)*1.06}`).join(' ')}));defs.append(clip);
  const g=node('g'),use=node('use',{href:'#'+id+'-source','clip-path':`url(#${id}-${n})`});g.append(use);layer.append(g);tris.push({p,g});
 }
 for(let j=0;j<ys.length-1;j++)for(let i=0;i<xs.length-1;i++){
  const a=[xs[i],ys[j]],b=[xs[i+1],ys[j]],c=[xs[i+1],ys[j+1]],d=[xs[i],ys[j+1]];add([a,b,c]);add([a,c,d]);
 }
 const smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
 function move([x,y],amount){
  const left=smooth((490-x)/100)*smooth((x-250)/50),right=smooth((x-880)/80)*smooth((1030-x)/50);
  const vertical=smooth((y-610)/100)*(1-smooth((y-835)/95));
  return [x+amount*(left+right)*vertical,y];
 }
 let previous=null;
 return {step(value,enabled,isSeated){
  const amount=enabled?Math.max(-14,Math.min(14,-value*.65)):0;if(amount===previous)return;previous=amount;
  for(const {p,g} of tris){
   const [a,b,c]=p,[u,v,w]=p.map(q=>move(q,amount));
   const x1=b[0]-a[0],y1=b[1]-a[1],x2=c[0]-a[0],y2=c[1]-a[1],det=x1*y2-x2*y1;
   const A=((v[0]-u[0])*y2-(w[0]-u[0])*y1)/det,C=(x1*(w[0]-u[0])-x2*(v[0]-u[0]))/det,E=u[0]-A*a[0]-C*a[1];
   g.setAttribute('transform',`matrix(${A} 0 ${C} 1 ${E} 0)`);
  }
 }};
}
