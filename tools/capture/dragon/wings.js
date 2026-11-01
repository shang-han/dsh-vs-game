import {createWhaleTailDriver} from './whale-tail-driver.js';
// Standing and seated wings share the complete upstream tail driver, but have their own roots.
export function createWings(root,picture,node,config){
 const group=node('g',{'data-part':'dragon-wings'});// Rear hair is a continuous independent layer owned by the hair rig.
 const defs=node('defs');root.prepend(defs);const uid='wings-'+Math.random().toString(36).slice(2);
 const registration=[{s:1,x:35,y:-110},{s:.9,x:-8,y:-50}];
 function wing(i,seated=false){
  const clip=node('clipPath',{id:uid+'-'+i+'-'+seated,clipPathUnits:'userSpaceOnUse'});clip.append(node('rect',{x:i?700:0,y:0,width:i?554:700,height:1254}));defs.append(clip);
  const image=picture('wings-clean');image.setAttribute('clip-path',`url(#${uid}-${i}-${seated})`);const registered=node('g'),r=registration[i];registered.setAttribute('transform',`translate(${r.x} ${r.y+(seated&&i===0?10:0)}) scale(${r.s})`);registered.append(image);
  const joint=node('g',{'data-wing':(seated?'sit-':'')+config.parts[i].id});joint.append(registered);return joint;
 }
 const wings=config.parts.map((_,i)=>wing(i));wings.forEach(w=>group.append(w));root.append(group);
 const seatedGroup=node('g',{'data-part':'seated-dragon-wings'}),driver=createWhaleTailDriver();let seatedWings=[],values=[],signal={},lastTime=null,phase=0,flutterPhase=0,dragBlend=0,dragPhase=0,energy=0,wingRate=1.1,accent=0,previousFace='';
 const seatRoots=[[628,750],[766,751]];
 return {group,seatedGroup,mountSeated(sitting){
  seatedWings=config.parts.map((_,i)=>wing(i,true));seatedWings.forEach(w=>seatedGroup.append(w));sitting.before(seatedGroup);
 },step(o,enabled,seated){
  signal=driver.step(o);group.setAttribute('visibility',seated?'hidden':'visible');seatedGroup.setAttribute('visibility',seated?'visible':'hidden');
  const c=config.tempo,dt=lastTime===null?1/60:Math.max(0,Math.min(.05,o.t-lastTime));lastTime=o.t;
  // r12 is the baseline: preserve its three signals, reduce rates only 15%,
  // enlarge its rendered angular excursion 20%. Integrate phase across mood changes.
  phase+=dt*(4+5*signal.wag)*c.rate_scale;
  flutterPhase+=dt*17*c.rate_scale;
  dragBlend+=((o.mode==='drag'?1:0)-dragBlend)*(1-Math.exp(-dt*18));
  dragPhase+=dt*Math.PI*2*4;
  const k=o.gesture?.k||0,smooth=x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);};
  const envelope=o.gesture?.kind==='flap'?smooth(k/.05)*(1-smooth((k-.75)/.25)):0;
  // Fast joyful beats have a firm downstroke and a slower recovery. Phase never
  // resets on mood changes, and the energy envelope has a soft release.
  const moods={happy:1,excited:1,love:.8,smug:.4,wink:.55,shy:.25,surprised:.45};
  const joy=o.mode==='drag'?0:(moods[o.face]||0);
  if(o.face!==previousFace){if(joy>.7)accent=1;previousFace=o.face;}
  accent*=Math.exp(-dt*2.2);
  const targetEnergy=Math.max(envelope,joy);
  energy+=(targetEnergy-energy)*(1-Math.exp(-dt*(targetEnergy>energy?10:4.5)));
  const targetRate=1.1+energy*2.1+accent*.35;
  wingRate+=(targetRate-wingRate)*(1-Math.exp(-dt*7));
  flutterPhase+=dt*(Math.PI*2*wingRate-17*c.rate_scale);
  const idle=Math.sin(o.t*1.3*c.rate_scale)*3;
  const emotion=signal.wag*13*Math.sin(phase),flutter=envelope*14*Math.sin(flutterPhase);
  const gain=seated?config.seated_gain:config.tail_gain;
  const raw=(signal.spring+idle+emotion+flutter-10*signal.sit)*gain;
  const calm=c.amplitude_scale*config.limit*Math.tanh(raw/config.limit);
  const beat=Math.sin(flutterPhase)+.2*Math.sin(2*flutterPhase);
  const lively=(seated?.8:1)*((14+accent*3)*beat-3);
  const usual=calm*(1-energy*.85)+lively*energy;
  const a=enabled?usual*(1-dragBlend)+dragBlend*(22*Math.sin(dragPhase)-4):0;
  const fold=enabled?1-Math.min(.055,Math.abs(a)*.004):1;
  signal={...signal,wingPhase:phase,wingAngle:a,dragBlend,dragPhase,wingFlutter:envelope,energy,wingRate,accent,rateScale:c.rate_scale,amplitudeScale:c.amplitude_scale};
  values=(seated?seatedWings:wings).map((joint,i)=>{const [x,y]=seated?seatRoots[i]:config.parts[i].root,angle=(i===0?1:-1)*a;joint.setAttribute('transform',`translate(${x} ${y}) rotate(${angle}) scale(${fold} 1) translate(${-x} ${-y})`);return {id:config.parts[i].id,pose:seated?'sit':'stand',root:[x,y],angle,fold};});
 },values:()=>values,signal:()=>signal};
}
