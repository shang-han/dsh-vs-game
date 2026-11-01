import {prepareCleanSources} from './clean-sources.js';
import {createHairMotion} from './hair-motion.js';
import {createTail} from './tail.js';
import {createWings} from './wings.js';
import {createOfficialEffects} from './official-effects.js';
import {createExpressionLayer,expressions} from './expressions.js';
import {createSecondary} from './secondary.js';
// GPT Dragon v005-r08: original-coordinate layered prototype.
// Behaviour comes from host kit; no whale facial geometry is used.
const NS='http://www.w3.org/2000/svg';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const textureCache=new Map(); // One page load; reset/seek never re-encodes unchanged art.
export async function createDragonBody(base,opts){
 const model=opts.model||await(await fetch(new URL('model.json',base))).json();
 const asset=opts.asset||(p=>new URL(p,base));
 const load=opts.loadImage||(url=>new Promise((ok,bad)=>{const im=new Image();im.onload=()=>ok(im);im.onerror=bad;im.src=url;}));
 const names=['hair-covered-underpaint','body-covered-underpaint','head-open','head-half','head-closed','leg-left','leg-right','body-without-legs','skirt-hole-fill','arm-left','arm-right','arm-hole-fill','body-without-arms','body-without-limbs'];
 names.push('ahoge-clean','head-flustered','brow-underpaint','master-reference','arms-master','arms-wave-master','legs-clean','dress-clean','dress-front','dress-fold-clean','head-front');
 const textures={};
 names.push('body-clean','head-side-clean','seated-body-rebuilt','seated-body-open-arms','tail-clean','wings-clean','head-underpaint','rear-hair','head-wink','wing-left','wing-right','wing-underpaint','wing-hair-fill');
 await Promise.all(names.map(async name=>{
  const url=asset('tex/'+name+'.png'),key=String(url);
  if(textureCache.has(key)){textures[name]=textureCache.get(key);return;}
  const im=await load(url);
  const cv=document.createElement('canvas');cv.width=im.naturalWidth||im.width;cv.height=im.naturalHeight||im.height;cv.getContext('2d').drawImage(im,0,0);
  textures[name]=cv.toDataURL('image/png');
  textureCache.set(key,textures[name]);
 }));
 const registration=model.part_registration;
 if(!registration)throw new Error('Missing model.part_registration');
 await prepareCleanSources(textures,registration);
 const S=.2,X=128-650*S,Y=256-model.standing_feet_y*S;
 let dizzyPose=false,seatedBody,seatedLayer,faceFX,seatedFX,neckBridge,officialFX,officialSeatedFX;
 let currentFace='neutral';
 let previousBlink=0,allowBlink=false,lastBlinkAt=-10,manualWinkUntil=-10,eyeState='open';
 let hairMotion,tail,wings,secondary,secondaryEnabled=true,waveTexture=false;
 let mounted=null,root,back,body,head,sitting,headGroup,lowerHairGroup,lowerHair,backGroup,prevEye='',prevSit=false;
 let articulation,fill,front,legNodes=[],lastT=0,airK=0,groundK=0,jumpWord='jump',dragK=0,attentionK=0;
 const cfg=model.leg_rig;
 const behavior=model.behavior_rig;
 const motion=model.motion_rig;let armNodes=[],armSlots=[],armFill,gaitK=0,armAngles=[0,0],armActivePrev=false,armLayers=[],runLayerK=0,armFillLayer,runArmMaskId,sitBlend=0;
 function node(tag,attrs={}){const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;}
 function picture(name){return node('image',{'data-source':name,href:textures[name],x:0,y:0,width:model.canvas[0],height:model.canvas[1]});}
 function mount(g){
  g.replaceChildren();root=node('g');root.setAttribute('transform',`translate(${X} ${Y}) scale(${S})`);g.append(root);
  backGroup=node('g');back=picture('hair-covered-underpaint');back.setAttribute('visibility','hidden');backGroup.append(back);root.append(backGroup);
  wings=createWings(root,picture,node,model.wing_rig);
  armFill=picture('arm-hole-fill');root.append(armFill);
  articulation=node('g');fill=picture('skirt-hole-fill');articulation.append(fill);
  legNodes=cfg.legs.map(l=>{const group=node('g');group.append(picture('leg-'+l.id));articulation.append(group);return group;});
  front=picture('body-without-legs');articulation.append(front);root.append(articulation);
  body=picture('body-covered-underpaint');root.append(body);
  armSlots=[];armLayers=[];
  armNodes=motion.arms.map(a=>{const slot=node('g',{'data-arm-slot':a.id}),n=node('g');n.append(picture('arm-'+a.id));slot.append(n);root.append(slot);armSlots.push(slot);return n;});
  const hairSplitY=model.secondary_rig.hair.split_y;
  const hairSplitId='hair-split-'+Math.random().toString(36).slice(2),hairDefs=node('defs');
  const upperClip=node('clipPath',{id:hairSplitId+'-upper',clipPathUnits:'userSpaceOnUse'}),lowerClip=node('clipPath',{id:hairSplitId+'-lower',clipPathUnits:'userSpaceOnUse'});
  upperClip.append(node('path',{d:'M0 0H1254V610H795V582L790 584L785 586L780 589L775 591L770 591L765 594L760 595L755 596L750 597L745 596L740 598L735 599L730 599L725 598L720 600L715 600L710 600L705 598L700 599L695 599L690 599L685 598L680 598L675 597L670 597L665 596L660 595L655 593L650 592L645 591L640 589L635 588L630 585L625 585L620 584L615 582L610 580V610H0Z'}));lowerClip.append(node('path',{d:'M533 610H622V738H544Q504 726 502 680Q501 655 527 638Z M765 610H838Q824 635 822 654Q822 664 843 678Q852 722 818 735H774Z'}));hairDefs.append(upperClip,lowerClip);root.append(hairDefs);
  // Arm-hole underpaint owns shoulder/cloth only; its old hair pixels are excluded.
  const fillClip=node('clipPath',{id:hairSplitId+'-body-fill',clipPathUnits:'userSpaceOnUse'});
  fillClip.append(node('path',{d:'M594 604H738L794 695L787 747L782 780L930 1000H465L590 790L595 730L578 704L574 648Z'}));
  hairDefs.append(fillClip);armFill.setAttribute('clip-path',`url(#${hairSplitId}-body-fill)`);
  lowerHairGroup=node('g');lowerHair=picture('empty');lowerHair.setAttribute('clip-path',`url(#${hairSplitId}-lower)`);lowerHairGroup.append(lowerHair);root.insertBefore(lowerHairGroup,armSlots[0]);root.insertBefore(wings.group,armFill);
  headGroup=node('g');head=picture('head-open');headGroup.append(head);root.append(headGroup);
  faceFX=createExpressionLayer(headGroup);officialFX=createOfficialEffects(headGroup);
  neckBridge=node('path',{d:'M645 587Q670 591 694 587L690 607Q668 601 646 603Z',fill:'#fbdacb','data-part':'neck-overlap'});root.insertBefore(neckBridge,lowerHairGroup);neckBridge.setAttribute('visibility','hidden');
  sitting=picture('sitting-open');const seatedClip=node('clipPath',{id:hairSplitId+'-seated-head',clipPathUnits:'userSpaceOnUse'});seatedClip.append(node('path',{d:'M0 0H1254V610H795V582L790 584L785 586L780 589L775 591L770 591L765 594L760 595L755 596L750 597L745 596L740 598L735 599L730 599L725 598L720 600L715 600L710 600L705 598L700 599L695 599L690 599L685 598L680 598L675 597L670 597L665 596L660 595L655 593L650 592L645 591L640 589L635 588L630 585L625 585L620 584L615 582L610 580V610H0Z M533 610H622V738H544Q504 726 502 680Q501 655 527 638Z M765 610H838Q824 635 822 654Q822 664 843 678Q852 722 818 735H774Z'}));hairDefs.append(seatedClip);sitting.setAttribute('visibility','hidden');root.append(sitting);wings.mountSeated(sitting);seatedBody=picture('seated-body-rebuilt');root.insertBefore(seatedBody,sitting);seatedBody.setAttribute('visibility','hidden');seatedFX=createExpressionLayer(root);officialSeatedFX=createOfficialEffects(root);
  runArmMaskId='run-torso-'+Math.random().toString(36).slice(2);
  const defs=node('defs'),mask=node('mask',{id:runArmMaskId,maskUnits:'userSpaceOnUse',x:0,y:0,width:1254,height:1254});
  mask.append(node('rect',{x:0,y:0,width:1254,height:1254,fill:'white'}));
  mask.append(node('path',{d:motion.gait.run_torso_occluder,fill:'black'}));
  // The near shoulder is the joint joining sleeve to torso, not an occluded crossing.
  mask.append(node('ellipse',{...motion.gait.run_shoulder_keep,fill:'white'}));defs.append(mask);root.prepend(defs);

  secondary=createSecondary(root,model.secondary_rig,model.canvas,picture,articulation);
  tail=createTail(root,model.tail_rig,model.canvas,picture);
  hairMotion=createHairMotion(root,node,picture,lowerHair,sitting,backGroup);
  secondary.wrap(lowerHair,['hair']);secondary.wrap(back,['hair']);secondary.wrap(head,['ears','ahoge','bangs']);seatedLayer=tail.wrap(secondary.wrap(sitting,['seatedHair','ears','ahoge','bangs']),true);
  // Body source is genuinely tail-free; no tail-removal mask can cut its skirt outline.
  armFillLayer=armFill;
  mounted=g;prevEye='';
 }
 const figure={
  colors:{z:'#a18acb'},gestures:['nod','shake','wave','flap','dragon-wing-flutter'],
  get extent(){return [45,25+18.6*sitBlend,225,257];},
  get hits(){const dy=18.6*sitBlend;return [[132,106+dy,69],[131,197+dy*.5,45],[133,243,25]];},
  get anchors(){const dy=18.6*sitBlend;return {gaze:[143,116+dy],bubble:[130,20+dy],z:[199,55+dy],tear:[160,129+dy],hearts:[100,176,70]};},
  draw(g,fc,o){
   if(mounted!==g)mount(g);
   // Drag is a visual override; release immediately returns to the host face.
   if(o.mode==='drag')o={...o,face:'flustered'};
   // Pack motion uses the kit gesture contract without its built-in jumping flap.
   if(o.gesture?.kind==='dragon-wing-flutter')o={...o,gesture:{...o.gesture,kind:'flap'}};
   // Preserve the native spring waveform with tunable amplitude and soft limits.
   // Apply about the foot anchor so the character never slides vertically.
   const scales=g.getAttribute('transform')?.match(/scale\(([-\d.]+)\s+([-\d.]+)\)/);
   let cx=1,cy=1;
   if(scales&&['idle','crouch','air','land'].includes(o.mode)&&Math.abs(o.facing)>.1){
    const hostScale=opts.host.bounds().S,sx=Number(scales[1])/(hostScale*o.facing),sy=Number(scales[2])/hostScale;
    const spring=cfg.elasticity;
    const elastic=(s,axis)=>{if(o.mode==='idle')return 1+(s-1)*spring.idle_strength;const d=(s-1)*spring.strength,limit=spring[axis][d<0?0:1];return 1+limit*Math.tanh(d/limit);};
    if(sx>0&&sy>0){cx=elastic(sx,'x')/sx;cy=elastic(sy,'y')/sy;}
   }
   root.setAttribute('transform',`translate(128 256) scale(${cx} ${cy}) translate(-128 -256) translate(${X} ${Y}) scale(${S})`);
   const dt=Math.max(0,Math.min(.05,o.t-lastT));lastT=o.t;tail.step(o,dt,secondaryEnabled);
   const smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x);};
   const duration=2*cfg[jumpWord].velocity/cfg[jumpWord].gravity;
   const airTarget=o.mode==='air'?1-smooth((o.modeT-(duration-cfg.timing.extend_before_landing_seconds))/cfg.timing.extend_before_landing_seconds):0;
   const groundTarget=o.mode==='crouch'?smooth(o.modeT/cfg.timing.crouch_seconds):o.mode==='land'?1-smooth(o.modeT/cfg.timing.land_seconds):0;
   airK+=(airTarget-airK)*(1-Math.exp(-dt*30));groundK+=(groundTarget-groundK)*(1-Math.exp(-dt*35));
   dragK+=((o.mode==='drag'?1:0)-dragK)*(1-Math.exp(-dt*12));
   const attentive=['thinking','working','listening'].includes(o.face)&&['idle','look'].includes(o.mode);
   attentionK+=((attentive?1:0)-attentionK)*(1-Math.exp(-dt*8));
   const walking=['walk','run','dance'].includes(o.mode);
   gaitK+=((walking?1:0)-gaitK)*(1-Math.exp(-dt*motion.gait.blend_rate));
   const running=o.mode==='run',gait=motion.gait;
   const gaitAngles=o.legs.map(l=>clamp(-(l[2]-l[0])/(running?17:10),-1,1)*(running?gait.run_angle:gait.walk_angle));
   if(['sit','sleep','wake','dizzy'].includes(o.mode)||sitBlend>.001)sitBlend=o.sit;
   if(o.mode==='dizzy')dizzyPose=true;else if(sitBlend<.01||o.mode==='sit'||o.mode==='sleep')dizzyPose=false;
   const poseName=dizzyPose?'seated-body-open-arms':'seated-body-rebuilt';
   seatedBody.setAttribute('href',textures[poseName]);seatedBody.setAttribute('data-seated-pose',poseName);
   const seated=sitBlend>.5;wings.step(o,secondaryEnabled,seated);
   const poseDrop=(model.standing_feet_y-model.sitting_feet_y)*sitBlend;
   const active=airK>.002||groundK>.002||gaitK>.002||sitBlend>.001||dragK>.002;
   const drop=groundK*(o.mode==='land'?cfg.landing_body_drop_px:cfg.crouch_body_drop_px);
   // Translate the torso; plant each sole during compression. Never scale the legs.
   root.setAttribute('transform',root.getAttribute('transform')+` translate(0 ${drop+poseDrop})`);
   cfg.legs.forEach((leg,i)=>{
    const angle=leg.air_angle*airK+leg.crouch_angle*groundK+gaitAngles[i]*gaitK+dragK*behavior.drag.leg_degrees*Math.sin(o.t*behavior.drag.rate+i*2.2),rad=angle*Math.PI/180,[px,py]=leg.pivot;
    const sole=i?[742,1188]:[597,1198],dx=sole[0]-px,dy=sole[1]-py;
    const rotationX=(Math.cos(rad)-1)*dx-Math.sin(rad)*dy,rotationY=Math.sin(rad)*dx+(Math.cos(rad)-1)*dy;
    const stride=(o.legs[i][2]-o.legs[i][0])*(running?gait.run_stride_gain:gait.walk_stride_gain);
    const tx=-rotationX*groundK+(stride-rotationX)*gaitK;
    const gaitLift=Math.max(0,241-o.legs[i][3])*(running?gait.run_lift_gain:gait.walk_lift_gain)*gaitK;
    const ty=-leg.air_lift*airK-rotationY*(groundK+gaitK)-drop-gaitLift-poseDrop;
    legNodes[i].setAttribute('transform',`translate(${tx} ${ty}) rotate(${angle} ${px} ${py})`);
   });
   const gest=o.gesture;
   const wave=gest?.kind==='wave'?smooth(gest.k/.18)*(1-smooth((gest.k-.78)/.22)):0;
   armAngles=armAngles.map((a,i)=>{
    let target=clamp(-gaitAngles[i]*motion.gait.arm_gain,-motion.gait.max_arm_angle,motion.gait.max_arm_angle)*gaitK+motion.air_arms[i]*airK;
    if(running)target=gait.run_arm_angles[i]*gaitK;
    if(i===motion.wave.arm)target=target*(1-wave)+wave*(motion.wave.raise_degrees+motion.wave.oscillation_degrees*Math.sin((gest?.k||0)*Math.PI*2*motion.wave.cycles));
    if(!walking&&o.mode!=='drag'&&wave<.01)target+=(expressions[o.face]?.arms?.[i]||0);
    if(o.mode==='dance')target+=(i?-1:1)*(14+8*Math.sin(o.t*7+i*Math.PI));
    if(gest?.kind==='bow')target+=(i?5:-5)*Math.sin(gest.k*Math.PI);
    if(gest?.kind==='flap')target=0; // Wings have their own joints; arms remain relaxed.
    if(attentive)target+=attentionK*(behavior[o.face].arms[i]+(o.face==='working'?behavior.working.pulse_degrees*Math.sin(o.t*behavior.working.rate+i*Math.PI):0));
    if(o.mode==='drag')target=(i?-1:1)*(25+8*Math.sin(o.t*10+i));
    return a+(target-a)*(1-Math.exp(-dt*14));
   });
   // Keep separate arms even at rest: the baked body hands sit behind lower hair.
   const armActive=!seated;
   // Complete original wave arm: in front of the separate ear layer, behind front hair.
   const raised=wave>.08||Math.abs(armAngles[motion.wave.arm])>45;
   const useWave=wave>.04||waveTexture&&Math.abs(armAngles[motion.wave.arm])>28;
   if(useWave!==waveTexture){armNodes[motion.wave.arm].firstElementChild.setAttribute('href',textures[useWave?'arm-wave':'arm-'+motion.arms[motion.wave.arm].id]);waveTexture=useWave;}
   runLayerK+=((running?1:0)-runLayerK)*(1-Math.exp(-dt*14));
   armNodes.forEach((n,i)=>{
    const layer=raised&&i===motion.wave.arm?'wave':runLayerK>.15?(i===motion.gait.run_near_arm?'run-near':'behind-body'):'normal';
    if(armLayers[i]!==layer){const slot=armSlots[i];root.insertBefore(slot,layer==='run-near'?seatedLayer:layer==='wave'||layer==='behind-body'||layer==='normal'&&i===1?articulation:headGroup);if(layer==='run-near')slot.setAttribute('mask',`url(#${runArmMaskId})`);else slot.removeAttribute('mask');armLayers[i]=layer;}
   });
   if(armActive!==armActivePrev){body.setAttribute('href',textures[armActive?'body-without-arms':'body-covered-underpaint']);front.setAttribute('href',textures[armActive?'body-without-limbs':'body-without-legs']);armActivePrev=armActive;}
   armFill.setAttribute('visibility',armActive?'visible':'hidden');
   armNodes.forEach((n,i)=>{n.setAttribute('visibility',armActive?'visible':'hidden');n.setAttribute('transform',`rotate(${armAngles[i]} ${motion.arms[i].pivot.join(' ')})`);});
   const face=expressions[o.face]||{};
   const shut=['sleep','bowing','squeeze'].includes(o.face)||face.eye==='closed'||o.drowse>.75;
   const nativeBlink=o.blink||0;
   if(nativeBlink>0&&previousBlink<=0){allowBlink=o.t-lastBlinkAt>2.8&&o.t>manualWinkUntil+.5;if(allowBlink)lastBlinkAt=o.t;}previousBlink=nativeBlink;
   const closure=shut?1:Math.max(allowBlink&&o.face!=='dizzy'?nativeBlink:0,face.eye==='half'?.5:0);
   const eye=closure>.75?'closed':closure>.25?'half':o.t<manualWinkUntil?'wink':'open';
   eyeState=eye;currentFace=o.face;
   const eyeTexture=o.face==='flustered'?'flustered':eye;
   if(eyeTexture!==prevEye||seated!==prevSit){head.setAttribute('href',textures['head-'+eyeTexture]);sitting.setAttribute('href',textures['sitting-'+eyeTexture]);prevEye=eyeTexture;prevSit=seated;}
   backGroup.setAttribute('visibility','visible');body.setAttribute('visibility',seated?'hidden':'visible');headGroup.setAttribute('visibility',seated?'hidden':'visible');lowerHairGroup.setAttribute('visibility',seated?'hidden':'visible');sitting.setAttribute('visibility',seated?'visible':'hidden');seatedBody.setAttribute('visibility',seated?'visible':'hidden');
   articulation.setAttribute('visibility',!seated?'visible':'hidden');
   body.setAttribute('visibility','hidden');
   // Seated art has its own shorter silhouette. Align feet, never squash the face.
   sitting.setAttribute('transform','translate(0 0)');
   officialFX.draw(fc,o.t);officialSeatedFX.draw(fc,o.t);officialSeatedFX.group.setAttribute('visibility',seated?'visible':'hidden');faceFX.step(o.face,o.t,eye);seatedFX.step(o.face,o.t,eye);seatedFX.group.setAttribute('visibility',seated?'visible':'hidden');neckBridge.setAttribute('visibility',seated?'hidden':'visible');
   const gesture=o.gesture;
   let angle=clamp((o.look?.[0]||0)*.16,-1.2,1.2),dy=clamp((o.look?.[1]||0)*.35,-2,2);
   if(gesture?.kind==='nod')dy+=3*Math.sin(gesture.k*Math.PI*2);
   if(gesture?.kind==='shake')angle+=2.3*Math.sin(gesture.k*Math.PI*4);
   if(gesture?.kind==='bow')dy+=3*Math.sin(gesture.k*Math.PI);
   angle+=face.tilt||0;
   if(attentive){angle+=behavior[o.face].head_degrees*attentionK;dy+=behavior[o.face].head_y*attentionK;}
   angle=clamp(angle,-model.rotation_limit_degrees,model.rotation_limit_degrees);dy=clamp(dy,-3,3);
   const [px,py]=model.head_pivot,t=`translate(0 ${dy}) rotate(${angle} ${px} ${py})`;
   secondary.step({...o,headAngle:angle,headY:dy},dt,secondaryEnabled);
   hairMotion.step(secondary.values().hair,secondaryEnabled,seated);
   secondary.syncHeadTransform(t,!seated);
   headGroup.setAttribute('transform',t);lowerHairGroup.setAttribute('transform',t);backGroup.setAttribute('transform',t);
  },
  dispose(){mounted=null;},
 };
 let clickStart=null;
 const native=opts.kit.createBody(opts.host,{figure,words:{'dragon-wing-flutter':{motion:{seconds:1.4,face:'happy',sound:'chirps'}},listening:{expression:{like:'listening',seconds:4}},working:{expression:{like:'thinking',seconds:4}}}});
 // Do not expose unsupported expressions/limb motions just because kit knows them.
 const supported=[...opts.kit.KIT_EXPRESSIONS,...opts.kit.KIT_MOTIONS,'working','listening'];
 return {...native,pointer(kind,point){const before=native.layout();const result=native.pointer(kind,point);if(kind==='down')clickStart=native.layout().pressing?{...point}:null;if(kind==='up'){if(clickStart&&before.mode!=='drag'&&Math.hypot(point.x-clickStart.x,point.y-clickStart.y)<10&&(point.t-clickStart.t)<500&&secondaryEnabled)secondary.impulse(point.x<(before.hit?.[0]?.x||point.x)?-1:1);clickStart=null;}if(kind==='cancel'||kind==='leave')clickStart=null;return result;},tailState:()=>tail?.values(),wingSignal:()=>wings?.signal(),wingState:()=>wings?.values(),secondaryState:()=>secondary?.values(),visualState:()=>({eye:eyeState,face:currentFace,lastBlinkAt,manualWinkUntil}),armLayerState:()=>({layers:[...armLayers],separateArms:armActivePrev,angles:[...armAngles],dragK,attentionK,waveTexture,maskSpace:'body',maskTransforms:armSlots.map(n=>n.getAttribute('transform'))}),setSecondary:enabled=>{secondaryEnabled=!!enabled;},words:supported,do(word){const ok=supported.includes(word)?native.do(word==='flap'?'dragon-wing-flutter':word):false;if(ok&&word==='wink'){manualWinkUntil=lastT+.28;lastBlinkAt=lastT;allowBlink=false;}if(ok&&['jump','hop'].includes(word))jumpWord=word;return ok;}};
}
