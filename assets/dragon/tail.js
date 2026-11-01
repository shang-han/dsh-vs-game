// Independently edited tail, registered once; animation uses rigid root rotation.
const NS='http://www.w3.org/2000/svg';let serial=0;
export function createTail(root,config,canvas,picture){
 const make=(tag,attrs={})=>{const n=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
 const defs=make('defs');root.prepend(defs);const id='dragon-tail-'+(++serial);
 const poses=[
  {id:'stand',root:[520,915],source:'tail-clean',cut:'M0 830H456V880H509L494 900Q442 967 394 1050L407 1064H0Z',clip:'M250 839H416V877L503 884L417 1068H250Z'},
  {id:'sit',root:[520,940],source:'tail-clean',cut:'M235 837L317 825L368 826L358 858L377 887L433 903L457 897L438 926L407 939L377 965L364 984L318 1018H235Z',clip:'M235 837L317 825L368 826L358 858L377 887L433 903L477 891L465 935L431 949L403 978L387 1000L335 1032H235Z'}
 ];
 const groups=poses.map(p=>{
  const mask=make('mask',{id:`${id}-${p.id}-body`,maskUnits:'userSpaceOnUse',x:0,y:0,width:canvas[0],height:canvas[1]});mask.append(make('rect',{x:0,y:0,width:canvas[0],height:canvas[1],fill:'white'}),make('path',{d:p.cut,fill:'black'}));defs.append(mask);
  const clip=make('clipPath',{id:`${id}-${p.id}-tail`,clipPathUnits:'userSpaceOnUse'});clip.append(make('path',{d:p.clip}));defs.append(clip);
  const joint=make('g',{'data-tail':p.id}),im=picture(p.source);im.setAttribute('transform',p.id==='stand'?'translate(170 650) scale(.36)':'translate(170 675) scale(.36)');joint.append(im);root.insertBefore(joint,defs.nextSibling);return joint;
 });
 let angle=0,velocity=0,currentPose='stand';
 return {wrap(element,seated=false){
  const g=make('g',{mask:`url(#${id}-${seated?'sit':'stand'}-body)`});element.replaceWith(g);g.append(element);return g;
 },step(o,dt,enabled){
  const seated=o.sit>.5,current=seated?1:0;currentPose=poses[current].id;
  const walking=['walk','run'].includes(o.mode),sleep=o.mode==='sleep';
  const target=enabled?(sleep?.35:1)*(config.idle_degrees*Math.sin(o.t*1.55)+(walking?config.stride_degrees*Math.sin(o.t*(o.mode==='run'?7:5)):0)+Math.max(-1,Math.min(1,(o.swing||0)/26))*.8+(o.mode==='air'?-.6:0)):0;
  const h=Math.min(.05,dt)/4;
  for(let i=0;i<4;i++){velocity+=((target-angle)*40-velocity*10)*h;angle+=velocity*h;}
  angle=Math.max(-config.limit_degrees,Math.min(config.limit_degrees,angle));
  groups.forEach((g,i)=>{g.setAttribute('visibility',i===current?'visible':'hidden');g.setAttribute('transform',`rotate(${enabled?angle:0} ${poses[i].root.join(' ')})`);});
 },values:()=>({angle,pose:currentPose,method:'registered-independent-source'})};
}
