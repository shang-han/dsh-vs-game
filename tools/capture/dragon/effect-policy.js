// Keep upstream visuals; dragon-specific effect eligibility is explicit.
export function effectFace(fc,face){return {...fc,sweat:!!fc.sweat&&['worried','flustered','scared'].includes(face)};}
