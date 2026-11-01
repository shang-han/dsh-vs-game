// Complete independent image-edited components. Only separation through empty space.
export async function prepareCleanSources(textures,registration){
 const size=1254,canvas=()=>{const c=document.createElement('canvas');c.width=c.height=size;return c;};
 const load=src=>new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=src;});
 const names=['head-underpaint','brow-underpaint','arms-wave-master','master-reference','arms-master','legs-clean','dress-clean','dress-front','dress-fold-clean','head-front',...['head'].flatMap(p=>['open','half','closed','wink','flustered'].map(e=>p+'-'+e))];
 const images=Object.fromEntries(await Promise.all(names.map(async n=>[n,await load(textures[n])])));
 const registered=(name,m,half)=>{const c=canvas(),ctx=c.getContext('2d');ctx.setTransform(...m);if(half!==undefined){ctx.beginPath();const split=name==='legs-clean'?675:650;ctx.rect(half?split:0,0,half?size-split:split,size);ctx.clip();}ctx.drawImage(images[name],0,0);ctx.resetTransform();return c;};
 for(const [i,n]of ['arm-left','arm-right'].entries()){
  const [a,b,c,d]=registration[n];
  if(Math.abs(a*c+b*d)>1e-6||Math.abs(Math.hypot(a,b)-Math.hypot(c,d))>1e-6||a*d-b*c<=0)throw new Error(n+': arm registration must preserve proportions; shear/nonuniform scale/reflection rejected');
  textures[n]=registered('arms-master',registration[n],i).toDataURL();
 }
 for(const [i,n]of ['leg-left','leg-right'].entries())textures[n]=registered('legs-clean',registration['legs-clean'],i).toDataURL();
 // Retain the original wide sleeve/shoulder; only the existing palm difference changes.
 const waveSource=canvas(),wc=waveSource.getContext('2d');wc.drawImage(images['arms-master'],0,0);
 wc.save();wc.beginPath();wc.rect(0,805,650,449);wc.clip();wc.clearRect(0,805,650,449);wc.drawImage(images['arms-wave-master'],0,0);wc.restore();
 images['arms-wave-master']=waveSource;textures['arm-wave']=registered('arms-wave-master',registration['arm-left'],0).toDataURL();
 const dress=registered('dress-front',registration['dress-front']);
 // Restore the original neckline and shoulder sockets from their own master pixels.
 // This is not a legacy alpha applied to newly generated contours.
 const dc=dress.getContext('2d');dc.clearRect(0,0,size,700);
 const core=canvas(),cc=core.getContext('2d');cc.save();cc.clip(new Path2D('M642 578L699 580L699 601Q704 615 720 625Q748 648 754 685L757 712L622 712L621 699Q640 663 637 645Q634 628 616 622L632 614L635 596L643 596Z'));cc.drawImage(images['master-reference'],0,0);cc.restore();
 const cm=canvas(),cx=cm.getContext('2d'),fade=cx.createLinearGradient(0,698,0,712);fade.addColorStop(0,'white');fade.addColorStop(1,'transparent');cx.fillStyle='white';cx.fillRect(0,0,size,698);cx.fillStyle=fade;cx.fillRect(0,698,size,14);
 const upper=canvas(),uc=upper.getContext('2d');uc.drawImage(core,0,0);uc.globalCompositeOperation='destination-in';uc.drawImage(cm,0,0);
 dc.globalCompositeOperation='destination-out';dc.drawImage(cm,0,0);dc.globalCompositeOperation='lighter';dc.drawImage(upper,0,0);dc.globalCompositeOperation='source-over';
 // One edited continuous lower dress, including its own inward fold and shading.
 // The supplied sprite is in master coordinates; do not register it a second time.
 dc.clearRect(0,820,size,size-820);dc.drawImage(images['dress-fold-clean'],0,820,size,size-820,0,820,size,size-820);
 for(const n of ['body-covered-underpaint','body-without-arms','body-without-legs','body-without-limbs'])textures[n]=dress.toDataURL();
 const lining=registered('dress-clean',registration['dress-clean']);lining.getContext('2d').clearRect(0,0,size,900);textures['skirt-hole-fill']=lining.toDataURL();
 textures['arm-hole-fill']=canvas().toDataURL();
 const head=registered('head-front',registration['head-front']);
 // Remove the source tuft once in head coordinates; blend the matching scalp
 // before animation so no polygon edge or old tuft root follows a second transform.
 const scalpMask=canvas(),sm=scalpMask.getContext('2d');
 const sx=sm.createLinearGradient(555,0,815,0);sx.addColorStop(0,'transparent');sx.addColorStop(.08,'white');sx.addColorStop(.92,'white');sx.addColorStop(1,'transparent');sm.fillStyle=sx;sm.fillRect(555,0,260,260);
 sm.globalCompositeOperation='destination-in';const sy=sm.createLinearGradient(0,210,0,260);sy.addColorStop(0,'white');sy.addColorStop(1,'transparent');sm.fillStyle=sy;sm.fillRect(555,0,260,260);
 const scalp=canvas(),sc=scalp.getContext('2d');sc.drawImage(images['head-underpaint'],0,0);sc.globalCompositeOperation='destination-in';sc.drawImage(scalpMask,0,0);
 const hc=head.getContext('2d');hc.globalCompositeOperation='destination-out';hc.drawImage(scalpMask,0,0);hc.globalCompositeOperation='lighter';hc.drawImage(scalp,0,0);hc.globalCompositeOperation='source-over';

 // Existing expression eye pixels are blended only inside the face, never across outer hair contours.
 const mask=canvas(),mc=mask.getContext('2d');
 const gx=mc.createLinearGradient(550,0,880,0);gx.addColorStop(0,'transparent');gx.addColorStop(.03,'white');gx.addColorStop(.97,'white');gx.addColorStop(1,'transparent');mc.fillStyle=gx;mc.fillRect(550,400,330,205);
 mc.globalCompositeOperation='destination-in';const gy=mc.createLinearGradient(0,400,0,605);gy.addColorStop(0,'transparent');gy.addColorStop(.05,'white');gy.addColorStop(.95,'white');gy.addColorStop(1,'transparent');mc.fillStyle=gy;mc.fillRect(550,400,330,205);
 for(const n of ['head','sitting'].flatMap(p=>['open','half','closed','wink','flustered'].map(e=>p+'-'+e))){
  if(n==='head-front')continue;
  const c=canvas(),ctx=c.getContext('2d');ctx.drawImage(head,0,0);ctx.globalCompositeOperation='destination-out';ctx.drawImage(mask,0,0);
  const face=canvas(),fc=face.getContext('2d');fc.drawImage(images[n.startsWith('sitting-')?n.replace('sitting-','head-'):n],0,0);fc.globalCompositeOperation='destination-in';fc.drawImage(mask,0,0);
  ctx.globalCompositeOperation='lighter';ctx.drawImage(face,0,0);ctx.globalCompositeOperation='source-over';ctx.drawImage(images['brow-underpaint'],0,0);textures[n]=c.toDataURL();
 }
 textures['empty']=canvas().toDataURL();
}
