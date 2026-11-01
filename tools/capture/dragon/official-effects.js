// Adapted from Pal-AI-Lab/Cortico whale/figure.js drawFx, commit
// 91293b3e31b94397a8f2eb79dffec40f4c6d8817. AGPL-3.0-or-later.
// Effect paths, colors, timing and stroke widths are unchanged.
const f1=n=>Math.round(n*100)/100;
export function createOfficialEffects(parent){
 const fxG=document.createElementNS('http://www.w3.org/2000/svg','g');
 fxG.setAttribute('data-official-fx','whale');
 fxG.setAttribute('transform','translate(60 -90) scale(5)');
 fxG.setAttribute('pointer-events','none');parent.append(fxG);
 let fx='';const accent=()=> '#4d6bfe';const at=(x,y)=>[x,y];
  function drawFx(fc, t) {
    let s = '';
    const ac = accent();
    const top = at(124, 34), side = at(204, 52);
    if (fc.orbit) {
      for (let i = 0; i < 3; i++) {
        const a = t * 3.2 + i * 2.094, sn = Math.sin(a);
        s += `<path fill="#ffd23f" stroke="#3a2f7a" stroke-width="1.6" stroke-linejoin="round" opacity="${sn < 0 ? .55 : 1}" transform="translate(${f1(top[0] + 56 * Math.cos(a))} ${f1(top[1] - 4 + 10 * sn)}) scale(${sn < 0 ? .7 : 1})" d="M0 -7L2 -2L7 -2L3 1L4.5 6.5L0 3.3L-4.5 6.5L-3 1L-7 -2L-2 -2Z"/>`;
      }
    }
    if (fc.listen) {
      for (let i = 0; i < 3; i++) {
        const p = (t * .9 + i / 3) % 1, r = 36 - 24 * p, c = at(214, 116);
        s += `<path fill="none" stroke="${ac}" stroke-width="5" stroke-linecap="round" opacity="${f1(Math.sin(Math.PI * p))}" d="M${f1(c[0] + r * Math.cos(-.55))} ${f1(c[1] + r * Math.sin(-.55))}A${f1(r)} ${f1(r)} 0 0 1 ${f1(c[0] + r * Math.cos(.55))} ${f1(c[1] + r * Math.sin(.55))}"/>`;
      }
    }
    if (fc.think) {
      for (let i = 0; i < 3; i++) {
        const k = (t * .8 + i / 3) % 1;
        s += `<circle fill="#e8f0ff" stroke="${ac}" stroke-width="3" cx="${f1(side[0] + 10 * i)}" cy="${f1(side[1] - 20 * i - 6 * k)}" r="${4 + 3 * i}" opacity="${f1(.4 + .6 * Math.sin(Math.PI * k))}"/>`;
      }
    }
    if (fc.sweat) {
      const c = at(196, 88 + 3 * Math.sin(t * 7));
      s += `<path fill="#8fd0ff" stroke="#2f5fae" stroke-width="1.4" transform="translate(${f1(c[0])} ${f1(c[1])}) scale(1.4)" d="M0 -9C4 -3 6 0 6 3.5A6 6 0 0 1 -6 3.5C-6 0 -4 -3 0 -9Z"/>`;
    }
    if (fc.anger) {
      const c = at(190, 62), k = 1 + .12 * Math.sin(t * 10);
      s += `<g transform="translate(${f1(c[0])} ${f1(c[1])}) scale(${f1(k)})" fill="none" stroke="#e5484d" stroke-width="5" stroke-linecap="round"><path d="M-11 -3Q-3 -3 -3 -11M3 -11Q3 -3 11 -3M11 3Q3 3 3 11M-3 11Q-3 3 -11 3"/></g>`;
    }
    if (fc.bang) {
      const c = at(206, 36);
      s += `<g transform="translate(${f1(c[0])} ${f1(c[1])})"><path fill="none" stroke="#252049" stroke-width="8" stroke-linecap="round" d="M0 -16V3"/><circle fill="#252049" cx="0" cy="14" r="4.5"/></g>`;
    }
    if (fc.question) {
      const c = at(206, 36), k = 1 + .06 * Math.sin(t * 3);
      s += `<g transform="translate(${f1(c[0])} ${f1(c[1])}) scale(${f1(k)})"><path fill="none" stroke="#252049" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" d="M-8 -9Q-8 -19 0 -19Q9 -19 9 -11Q9 -4 0 -1V4"/><circle fill="#252049" cx="0" cy="14" r="4.5"/></g>`;
    }
    if (fx !== s) { fxG.innerHTML = s; fx = s; }
  }
 return {group:fxG,draw:drawFx};
}
