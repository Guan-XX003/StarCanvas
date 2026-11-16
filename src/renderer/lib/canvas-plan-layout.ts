import {CANVAS_PLANNING_NEW_BOUNDS} from '../../../electron/shared/canvas-planning-protocol.mjs';
/** Fit conservative expanded editor bounds, not only ReactFlow's small media
 * card. Reserve an actual visible float when possible; this changes viewport
 * only, never node positions, project content or plan authority.
 */
export function canvasPlanFocusViewport(nodes:any[],area:{width:number;height:number},float?:{left:number;right:number;top:number;bottom:number}) {
 if(!nodes.length||nodes.some(n=>n.parentId)||area.width<=0||area.height<=0)return null;
 let left=24,top=24,width=area.width-48,height=area.height-48;
 if(float&&float.top<area.height&&float.bottom>0){
  const leftWidth=float.left-48,rightWidth=area.width-float.right-48;
  if(Math.max(leftWidth,rightWidth)>280){
   if(leftWidth>=rightWidth)width=Math.min(width,leftWidth);
   else {left=Math.max(left,float.right+24);width=Math.min(width,rightWidth);}
  }
 }
 if(width<100||height<100)return null;
 let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
 for(const n of nodes){
  const base=n.type==='textNode'?CANVAS_PLANNING_NEW_BOUNDS.text:n.type==='promptNode'?CANVAS_PLANNING_NEW_BOUNDS.image:n.type==='videoNode'?CANVAS_PLANNING_NEW_BOUNDS.video:CANVAS_PLANNING_NEW_BOUNDS.reference;
  const w=Math.max(Number(n.style?.width)||Number(n.measured?.width)||0,base.width),h=Math.max(Number(n.style?.height)||Number(n.measured?.height)||0,base.height);
  minX=Math.min(minX,n.position.x);minY=Math.min(minY,n.position.y);maxX=Math.max(maxX,n.position.x+w);maxY=Math.max(maxY,n.position.y+h);
 }
 const zoom=Math.max(0.1,Math.min(0.8,width/(maxX-minX+160),height/(maxY-minY+160)));
 return {x:left+width/2-(minX+maxX)/2*zoom,y:top+height/2-(minY+maxY)/2*zoom,zoom};
}
