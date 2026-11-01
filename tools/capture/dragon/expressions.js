import {createBrows} from './brows.js';
// Code-native expression accents, in the locked v005 source coordinates.
// No foreign face atlas, no resizing of the original eyes or head.
const NS='http://www.w3.org/2000/svg';
export const expressions={
 neutral:{label:'平静',eye:'open'},happy:{label:'开心',eye:'closed',blush:.25},wink:{label:'眨眼',eye:'wink'},
 love:{label:'喜欢',eye:'open',mark:'heart',blush:.65,tilt:1},
 shy:{label:'害羞',eye:'half',blush:.9,tilt:2,arms:[-8,7]},
 surprised:{label:'惊讶',eye:'open',mark:'bang',arms:[12,-12]},
 angry:{label:'生气',eye:'half',brow:'angry',mark:'anger',arms:[-10,10]},
 sad:{label:'难过',eye:'half',brow:'sad',tilt:-1.5,arms:[-4,4]},
 sleepy:{label:'犯困',eye:'half'},thinking:{label:'思考',eye:'half',mark:'thought'},
 smug:{label:'得意',eye:'half',brow:'smug',tilt:-2,blush:.2},
 pout:{label:'嘟嘴',eye:'half',mark:'pout',blush:.5,tilt:2},
 worried:{label:'担心',eye:'open',brow:'sad',mark:'sweat',tilt:-1,arms:[-5,5]},
 determined:{label:'认真',eye:'half',brow:'angry',arms:[-5,5]},
 flustered:{label:'慌张',eye:'closed',mark:'sweat',blush:.55,arms:[15,-15]},
 scared:{label:'害怕',eye:'open',brow:'sad',mark:'stress',arms:[-12,12]},
 excited:{label:'期待',eye:'open',mark:'sparkle',blush:.4,arms:[10,-10]},
 cry:{label:'大哭',eye:'closed',brow:'sad',mark:'tears',arms:[-8,8]},
 confused:{label:'疑惑',eye:'open',brow:'asymmetric',mark:'question',tilt:-2},
 working:{label:'工作',eye:'half'},listening:{label:'倾听',eye:'open',mark:'listen'},
 dizzy:{label:'晕乎',eye:'open',mark:'spiral',blush:.18},dragged:{eye:'closed',mark:'sweat'},
};
export function createExpressionLayer(parent){
 const container=document.createElementNS(NS,'g'),group=document.createElementNS(NS,'g');container.setAttribute('pointer-events','none');parent.append(container);container.append(group);const brows=createBrows(container);
 let previous='',iris=[],spirals=[],orbitStars=[],angerMark,mouthDetail,eyeDetails=[],cheeks=[],enteredAt=0;
 const add=(tag,attrs)=>{const n=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);group.append(n);return n;};
 const line=d=>add('path',{d,fill:'none',stroke:'#8e739d','stroke-width':3.2,'stroke-linecap':'round','stroke-linejoin':'round'});
 function star(x,y,r){return add('path',{d:`M${x} ${y-r}Q${x+2} ${y-2} ${x+r} ${y}Q${x+2} ${y+2} ${x} ${y+r}Q${x-2} ${y+2} ${x-r} ${y}Q${x-2} ${y-2} ${x} ${y-r}`,fill:'#fff4c6',stroke:'#b9a3dc','stroke-width':2});}
 return {group:container,step(face,t,eye='open'){const c=expressions[face]||{};brows.step(face,t);
  if(previous!==face){previous=face;enteredAt=t;group.replaceChildren();iris=[];spirals=[];orbitStars=[];angerMark=null;mouthDetail=null;eyeDetails=[];cheeks=[];
   if(c.blush)for(const[x,y]of [[615,550],[811,545]]){cheeks.push(add('ellipse',{cx:x,cy:y,rx:23,ry:8,fill:'#efafc4',opacity:c.blush*.6}));for(let i=0;i<3;i++)add('path',{d:`M${x-10+i*9} ${y-3}l-3 7`,stroke:'#d998b0','stroke-width':2,opacity:c.blush*.65});}
   // Existing tags gain facial detail; labels, external effects and body poses stay unchanged.
   const mouths={
    happy:['M720 554C725 560 736 560 742 553','smile'],
    love:['M718 553Q731 565 745 550','smile'],shy:['M722 555Q730 560 737 555','smile'],
    smug:['M717 558Q731 564 746 550','smirk'],pout:['M724 553Q732 550 738 554Q732 558 725 557','pout'],
    worried:['M719 559Q725 551 731 557Q737 552 743 559','tense'],
    scared:['M724 553Q730 550 736 553L740 562Q731 567 722 562Z','open'],
    surprised:['M726 550C741 545 741 568 728 566C722 563 722 554 726 550Z','open'],
    angry:['M720 560Q731 549 742 558','tense'],determined:['M722 557L740 555','firm'],
    sad:['M719 561Q731 551 743 561','sad'],cry:['M718 563Q721 548 731 550Q742 548 745 563Q731 559 718 563Z','open'],
    flustered:['M718 555l6-3 6 7 6-6 8 4','tense'],excited:['M716 549Q731 555 747 549Q742 574 731 572Q720 570 716 549Z','open'],
    dizzy:['M722 557Q727 552 732 557Q737 562 742 557','tense'],
    thinking:['M727 559Q735 555 744 557','firm'],working:['M722 557Q731 555 740 557','firm'],
    listening:['M720 553Q731 563 742 553','smile'],sleepy:['M727 554Q733 550 737 555Q738 562 732 563Q727 561 727 554Z','open']
   };
   if(mouths[face]){
    add('ellipse',{cx:731,cy:557,rx:20,ry:11,fill:'#fdf0e3'});
    const [d,kind]=mouths[face];mouthDetail=add('g',{'data-detail':'mouth'});
    const shape=document.createElementNS(NS,'path');Object.entries({d,fill:kind==='open'?'#b87e95':'none',stroke:'#aa8191','stroke-width':2.2,'stroke-linecap':'round','stroke-linejoin':'round'}).forEach(([k,v])=>shape.setAttribute(k,v));mouthDetail.append(shape);
    if(face==='excited'){const tongue=document.createElementNS(NS,'path');tongue.setAttribute('d','M725 565Q731 561 738 565Q731 570 725 565');tongue.setAttribute('fill','#efb0ba');mouthDetail.append(tongue);}
    if(face==='smug')line('M744 549q4 1 4 4').setAttribute('opacity','.55');
    if(face==='pout'){line('M712 548q-5 4-2 7').setAttribute('opacity','.4');line('M749 548q5 4 2 7').setAttribute('opacity','.4');}
   }
   if(['sad','worried','cry'].includes(face))for(const [x,y,rx] of [[650,522,18],[799,520,11]])eyeDetails.push(add('path',{d:`M${x-rx} ${y}Q${x} ${y+7} ${x+rx} ${y}`,fill:'none',stroke:'#d7e7f5','stroke-width':3,'stroke-linecap':'round',opacity:.7}));
   switch(['anger','orbit','bang','question','sweat','thought','listen'].includes(c.mark)?null:c.mark){
    case 'spiral':for(const [x,y,rx] of [[652,493,32],[799,493,19]]){
     const g=add('g',{'data-dizzy-eye':'true',transform:`translate(${x} ${y}) scale(${rx/32} 1)`});
     const make=(tag,attrs)=>{const n=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);g.append(n);return n;};
     make('ellipse',{rx:32,ry:38,fill:'#eee5ff'});let path='';for(let i=0;i<=90;i++){const a=i/90*Math.PI*4.6,r=2+i/90*27;path+=(i?'L':'M')+(r*Math.cos(a)).toFixed(2)+' '+(r*Math.sin(a)).toFixed(2)+' ';}
     const spiral=make('path',{d:path,fill:'none',stroke:'#8063ab','stroke-width':3.4,'stroke-linecap':'round'});iris.push(g);spirals.push(spiral);
    }break;
    case 'heart':for(const[x,y]of [[652,493],[799,493]])iris.push(add('path',{d:`M${x} ${y+14}C${x-30} ${y-5} ${x-10} ${y-25} ${x} ${y-11}C${x+12} ${y-25} ${x+30} ${y-5} ${x} ${y+14}`,fill:'#cb8ecc',stroke:'#936ea9','stroke-width':2}));break;
    case 'sparkle':iris.push(star(650,490,17),star(800,490,13));star(910,410,18);break;
    case 'bang':line('M897 362l3 25');add('circle',{cx:901,cy:398,r:3,fill:'#b59ad0'});break;
    case 'anger':angerMark=add('path',{d:'M-6 -6q-20 0-20-20 M6 -6q20 0 20-20 M-6 6q-20 0-20 20 M6 6q20 0 20 20',fill:'none',stroke:'#dc7997','stroke-width':9,'stroke-linecap':'round'});break;
    case 'sweat':add('path',{d:'M874 464Q861 484 872 489Q889 491 874 464',fill:'#b8dce8',stroke:'#91abc8','stroke-width':2});break;
    case 'stress':for(let i=0;i<3;i++)line(`M${853+i*8} 419v${25-i*4}`);break;
    case 'tears':for(const[x,y]of [[632,525],[806,522]])add('path',{d:`M${x} ${y}q-3 20-4 33q4 7 9 0l-1-33`,fill:'#b7e0ee',opacity:.8});break;
    case 'pout':line('M864 546q10-8 17 0 M866 555q13-3 18 5');break;
    case 'question':line('M884 389c-1-20 30-20 29-2c0 11-16 10-16 22');add('circle',{cx:897,cy:420,r:3,fill:'#a386ba'});break;
    case 'thought':for(const[x,y,r]of [[884,500,4],[900,481,6],[921,458,9]])add('circle',{cx:x,cy:y,r,fill:'#f6efff',stroke:'#bea5d8','stroke-width':2});break;
    case 'listen':line('M895 452q13 14 0 28 M904 443q23 22 0 44');break;
    case 'orbit':for(let i=0;i<3;i++)orbitStars.push(star(0,0,23));break;
   }
  }
  for(const n of eyeDetails)n.setAttribute('visibility',eye==='closed'?'hidden':'visible');
  cheeks.forEach(n=>n.setAttribute('opacity',String((c.blush||0)*(.55+.05*Math.sin((t-enteredAt)*2)))));
  if(mouthDetail)mouthDetail.setAttribute('transform',`translate(${['scared','flustered'].includes(face)?.55*Math.sin((t-enteredAt)*9):0} 0)`);
  spirals.forEach((n,i)=>n.setAttribute('transform',`rotate(${(t-enteredAt)*300+i*70+12*Math.sin((t-enteredAt)*8)})`));
  if(angerMark)angerMark.setAttribute('transform',`translate(970 310) rotate(${8*Math.sin(t*9)}) scale(${1+.1*Math.sin(t*8)})`);
  orbitStars.forEach((n,i)=>{const a=t*3+i*Math.PI*2/3;n.setAttribute('transform',`translate(${700+155*Math.cos(a)} ${45+28*Math.sin(a)}) rotate(${t*80})`);});
  for(const n of iris){n.setAttribute('data-expression-iris','true');n.setAttribute('visibility',eye==='open'?'visible':'hidden');}
  group.setAttribute('data-eye-state',eye);
  group.setAttribute('opacity',['love','excited'].includes(face)?String(.9+.1*Math.sin(t*5)):1);
 }};
}
