// Adapted from official whale figure.js @ 91293b3, AGPL-3.0-or-later.
// All tail inputs are retained. Output is retargeted to dragon wings, never arms.
export const WAG={happy:1,love:1,wink:.7,surprised:.2,angry:.15,sad:0,shy:.3,
 sleepy:0,sleep:0,dizzy:0,dragged:.6,content:.25,listening:.2,thinking:.15,
 run:.4,waking:0,squeeze:0,neutral:.25,smug:.6,pout:0,worried:.1,
 determined:.3,flustered:.8,scared:0,excited:1,cry:0,confused:.1,bowing:.2};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const smooth=(a,b,x)=>{x=clamp((x-a)/(b-a),0,1);return x*x*(3-2*x);};
export function createWhaleTailDriver(){
 let wag=0,mood=0,x=0,v=0,sit=0,last=null;
 return {step(o){
  const t=o.t,dt=last===null?1/60:clamp(t-last,0,.05);last=t;
  const face=o.face==='working'?'thinking':o.face||'neutral',mode=o.mode||'idle';
  wag+=( (WAG[face]??WAG.neutral)-wag)*(1-Math.exp(-3*dt));
  mood+=((mode==='sleep'||['sad','cry','scared'].includes(face)?-1:0)-mood)*(1-Math.exp(-3*dt));
  sit+=(clamp(o.sit||0,0,1)-sit)*(1-Math.exp(-12*dt));
  const sway=clamp((o.swing||0)/26,-1.6,1.6),target=sway*14+mood*12;
  v+=((target-x)*40-v*5)*dt;x+=v*dt;if(Math.abs(x)>32){x=Math.sign(x)*32;v=0;}
  const k=o.gesture?.k||0,flap=o.gesture?.kind==='flap'?smooth(0,.05,k)*(1-smooth(.75,1,k)):0;
  const idle=Math.sin(t*1.3)*3,emotion=wag*13*Math.sin(t*(4+5*wag)),flutter=flap*14*Math.sin(t*17);
  const tail=x+emotion+idle+flutter;
  return {face,mode,wag,mood,sway,sit,idle,emotion,flutter,spring:x,tail,rotation:tail-10*sit,bend:-tail*.5};
 }};
}
