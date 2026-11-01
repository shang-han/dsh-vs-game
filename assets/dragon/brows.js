// Independent expression brows, clipped to exposed forehead skin under the bangs.
const NS='http://www.w3.org/2000/svg';let serial=0;
export function createBrows(parent){
 const node=(tag,attrs)=>{const n=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
 const group=node('g',{'data-part':'expression-brows','pointer-events':'none'}),id='brow-skin-'+(++serial);
 const defs=node('defs',{}),clip=node('clipPath',{id,clipPathUnits:'userSpaceOnUse'});
 clip.append(node('path',{d:'M558 455L582 427L608 395L635 362L650 360L657 418L671 450L695 480H558Z M768 469L782 433L790 366L807 401L822 447L830 470L837 459L838 482H768Z'}));defs.append(clip);group.append(defs);group.setAttribute('clip-path',`url(#${id})`);parent.append(group);
 // outer, middle, inner y for the left brow; inner, middle, outer for right.
 const poses={neutral:[420,410,417,418,412,424],happy:[421,404,413,415,405,424],love:[420,402,411,413,402,422],shy:[433,423,413,412,422,435],surprised:[405,389,403,402,390,408],angry:[423,431,446,443,431,419],determined:[422,426,438,436,428,420],sad:[442,430,414,414,430,442],worried:[441,420,409,410,421,442],flustered:[439,415,406,407,416,440],scared:[440,409,399,400,412,441],cry:[444,425,408,409,425,445],smug:[411,399,412,433,430,438],confused:[408,398,412,435,430,438],thinking:[414,405,419,433,429,438],working:[422,424,433,431,424,421],listening:[413,404,414,414,404,419],pout:[427,428,438,437,426,423],excited:[408,390,404,404,391,410],sleepy:[432,427,431,430,427,435],sleep:[436,430,433,434,429,436],dizzy:[429,424,427,427,424,429]};
 const paths=[0,1].map(()=>{const n=node('path',{fill:'none',stroke:'#ac95c5','stroke-width':4.6,'stroke-linecap':'round','stroke-linejoin':'round',opacity:.86});group.append(n);return n;});
 let ys=[...poses.neutral],lastT=null;
 return {group,step(face,t){const target=poses[face]||poses.neutral,dt=lastT===null?1:Math.max(0,Math.min(.1,t-lastT));lastT=t;const k=1-Math.exp(-dt*20);ys=ys.map((v,i)=>v+(target[i]-v)*k);const tremble=face==='flustered'?.65*Math.sin(t*16):0;
 paths[0].setAttribute('d',`M597 ${ys[0]+tremble}Q629 ${ys[1]+tremble} 665 ${ys[2]+tremble}`);
 paths[1].setAttribute('d',`M778 ${ys[3]-tremble}Q800 ${ys[4]-tremble} 824 ${ys[5]-tremble}`);
 group.setAttribute('data-face',face);
 }};
}
