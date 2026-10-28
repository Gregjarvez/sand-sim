import { sharedGlsl } from './geometry';

// Height-field state, one texel per cell:
//   r, g  height in HEIGHT_UNIT steps around ZERO (high byte, low byte)
//   b     loose (1) or still compacted from the last fresh tray (0)
//   a     flowing flag (128) + static friction variation (0-127)
const cellGlsl = `
${sharedGlsl}
vec2 center(vec2 cell) { return (cell+0.5)/CELLS*2.0-1.0; }
bool inside(vec2 cell) {
  vec2 p=center(cell);
  float r2=dot(p,p);
  return r2>HUB_RADIUS*HUB_RADIUS && r2<SAND_RADIUS*SAND_RADIUS;
}
vec4 encode(float height, float loose, float flowing, float friction) {
  float high=floor(height/256.0);
  return vec4(high/255.0,(height-high*256.0)/255.0,loose,(flowing*128.0+friction)/255.0);
}`;

export const simInitShader = `
precision highp float;
${cellGlsl}
// A freshly smoothed tray: shallow, irregular undulations and compacted sand.
void main() {
  vec2 cell=floor(gl_FragCoord.xy);
  vec2 p=center(cell);
  float r=length(p);
  float edge=smoothstep(0.07,0.12,r)*(1.0-smoothstep(0.90,0.96,r));
  float relief=(noise(p*5.5+vec2(13.2,7.8))-0.5)*0.009+(noise(p*12.7+vec2(3.1,19.4))-0.5)*0.0035;
  float height=relief*edge+(noise(p*28.0)-0.5)*0.0014;
  float friction=floor(noise(p*21.0+vec2(5.1,9.7))*127.0+0.5);
  gl_FragColor=encode(ZERO+floor(height/HEIGHT_UNIT+0.5),0.0,0.0,friction);
}`;

// One explicit step of granular transport. Every edge flux is an integer
// computed by the same function from both sides, so each cell's loss is
// exactly its neighbor's gain and the total volume never changes.
export const simStepShader = `
precision highp float;
uniform sampler2D state;
uniform vec2 barFrom;
uniform vec2 barTo;
uniform float offsetFrom;
uniform float offsetTo;
uniform float direction;
uniform float sweep;
uniform float blade;
uniform float band;
${cellGlsl}
// Illustrative dry-sand angles: flow starts above 36° and, once moving,
// continues down to 29° (frictional hysteresis), scaled by local friction.
const float START_SLOPE=0.7265;
const float STOP_SLOPE=0.5543;
const float RELAX_RATE=0.1;
const float PLOW_RATE=0.5;
const float PUSHING=0.25;
const float SOLID=0.1;
// Sand can't be piled above the tool: beyond this it spills back over it.
const float CEILING=ZERO+20000.0;

vec4 cellState(vec2 cell) { return texture2D(state,(cell+0.5)/CELLS); }
float heightOf(vec4 s) { return floor(s.r*255.0+0.5)*256.0+floor(s.g*255.0+0.5); }
float frictionCode(vec4 s) { return mod(floor(s.a*255.0+0.5),128.0); }
float flowingOf(vec4 s) { return step(127.5,floor(s.a*255.0+0.5)); }
float cross2(vec2 a, vec2 b) { return a.x*b.y-a.y*b.x; }
// Passes may be confined to a band around the bar; neither side of an edge
// leaving the band moves sand across it.
bool inBand(vec2 cell) { return band<=0.0 || abs(cross2(barTo,center(cell)))<band; }

// The tool's coverage of a cell (x), the direction it pushes that cell's
// sand (yz), and the tool's lower edge in height units (w). Each pass sweeps
// the tool along a short segment. Coverage below PUSHING marks cells the tool
// fills but doesn't push: sand behind its starting point is left in place as
// the tool moves away.
vec4 plow(vec2 cell) {
  vec2 p=center(cell);
  float arm=dot(p,barTo)<0.0 ? -1.0 : 1.0;
  float along=length(p)-arm*offsetTo;
  float radius, tip, reach;
  if(blade>0.5) {
    // A blade acts as a continuous row of teeth: each cell meets it at its
    // own radius, and its ends are rounded.
    radius=clamp(along,BLADE_INNER,BLADE_OUTER);
    tip=bladeEdge(radius,arm);
    reach=BLADE_HALF_THICKNESS;
  } else {
    float k=clamp(floor((along-INNER_TOOTH)/TOOTH_SPACING+0.5),0.0,TEETH-1.0);
    // Teeth are individually slightly bent and uneven in length.
    vec2 id=vec2(k,arm);
    radius=INNER_TOOTH+k*TOOTH_SPACING+(hash(id)-0.5)*0.0012;
    tip=TOOTH_TIP+(hash(id+7.3)-0.5)*0.0016;
    reach=TOOTH_RADIUS;
  }
  vec2 a=(arm*radius+offsetFrom)*barFrom;
  vec2 b=(arm*radius+offsetTo)*barTo;
  vec2 forward=arm*direction*vec2(-barTo.y,barTo.x);
  vec2 ab=b-a;
  float t=clamp(dot(p-a,ab)/max(dot(ab,ab),1e-12),0.0,1.0);
  vec2 away=p-a-ab*t;
  float dist=length(away);
  // Barely grazed cells behave as free sand, so they can't drain endlessly.
  // The solid tool is then at least two cells across, so sand on either side
  // can never be diagonal neighbors and slip through it.
  if(dist>reach+0.25*CELL) return vec4(0);
  if(dot(p-a,forward)<0.0) return vec4(SOLID,forward,0.0);
  float cover=clamp((reach+0.5*CELL-dist)/CELL,PUSHING,1.0);
  // Along the blade's face, sand goes straight ahead; it spills round the ends.
  vec2 dir=dist>1e-6 && (blade<0.5 || radius!=along) ? away/dist : forward;
  return vec4(cover,dir,ZERO+floor(tip/HEIGHT_UNIT));
}
float weight(vec2 dir, vec2 o, float scale) {
  float w=max(0.0,dot(dir,o)*scale);
  return w*w;
}
float spread(vec2 cell, vec2 dir, vec2 o, float scale) {
  return inside(cell+o) ? weight(dir,o,scale) : 0.0;
}
// Integer volume a tooth pushes from a cell to its neighbor at offset o:
// sand above the tip is shoved away from the tooth, ahead and to the sides.
// Up to eight neighbors may push into one cell, so each takes an eighth of
// the room left below the ceiling.
float pushed(vec2 cell, float height, vec2 o, float scale, float target) {
  vec4 tooth=plow(cell);
  if(tooth.x<PUSHING || !inside(cell+o)) return 0.0;
  // A blade scrapes cleanly; a thin tooth lets some sand flow around it.
  float excess=floor((blade>0.5 ? 1.0 : PLOW_RATE)*tooth.x*max(height-tooth.w,0.0));
  if(excess<=0.0) return 0.0;
  vec2 dir=tooth.yz;
  const float D=0.70710678;
  float total=spread(cell,dir,vec2(1,0),1.0)+spread(cell,dir,vec2(-1,0),1.0)
    +spread(cell,dir,vec2(0,1),1.0)+spread(cell,dir,vec2(0,-1),1.0)
    +spread(cell,dir,vec2(1,1),D)+spread(cell,dir,vec2(-1,-1),D)
    +spread(cell,dir,vec2(1,-1),D)+spread(cell,dir,vec2(-1,1),D);
  return min(floor(excess*weight(dir,o,scale)/max(total,1e-6)),floor(max(CEILING-target,0.0)/8.0));
}
// Volume sliding from a cell to a neighbor at a given distance (in cells).
float slide(float height, float other, float friction, float otherFriction, float flowing, float dist) {
  float drop=abs(height-other);
  float resistance=0.85+0.3*(friction+otherFriction)/254.0;
  float stop=STOP_SLOPE*resistance*dist*CELL/HEIGHT_UNIT;
  if(drop<=(flowing>0.5 ? stop : START_SLOPE*resistance*dist*CELL/HEIGHT_UNIT)) return 0.0;
  return sign(height-other)*floor(RELAX_RATE*(drop-stop));
}

vec2 cell;
float height, friction, flowing, cover, net, moved;
bool near;
void edge(vec2 o, float dist, float scale) {
  vec2 other=cell+o;
  if(!inside(other) || !inBand(other)) return;
  vec4 s=cellState(other);
  float otherHeight=heightOf(s);
  float flow=0.0;
  float otherCover=near ? plow(other).x : 0.0;
  // A tooth is solid: grains don't slide into or out of the space it fills.
  if(max(cover,otherCover)<=0.0) {
    flow=slide(height,otherHeight,friction,frictionCode(s),max(flowing,flowingOf(s)),dist);
  }
  if(near) flow+=pushed(cell,height,o,scale,otherHeight)-pushed(other,otherHeight,-o,scale,height);
  net+=flow;
  if(flow!=0.0) moved=1.0;
}

void main() {
  cell=floor(gl_FragCoord.xy);
  vec4 s=cellState(cell);
  if(!inside(cell) || !inBand(cell)) {
    gl_FragColor=s;
    return;
  }
  height=heightOf(s);
  friction=frictionCode(s);
  flowing=flowingOf(s);
  // Only cells close to the bar's path during this pass can meet a tooth.
  vec2 p=center(cell);
  near=min(abs(cross2(barFrom,p)),abs(cross2(barTo,p)))<TOOTH_RADIUS+3.0*CELL+sweep;
  cover=near ? plow(cell).x : 0.0;
  net=0.0;
  moved=0.0;
  const float D=0.70710678;
  edge(vec2(1,0),1.0,1.0);
  edge(vec2(-1,0),1.0,1.0);
  edge(vec2(0,1),1.0,1.0);
  edge(vec2(0,-1),1.0,1.0);
  edge(vec2(1,1),1.41421356,D);
  edge(vec2(-1,-1),1.41421356,D);
  edge(vec2(1,-1),1.41421356,D);
  edge(vec2(-1,1),1.41421356,D);
  // Teeth loosen the sand they move; a blade's edge leaves it smooth.
  float loose=blade>0.5 && cover>=0.5 ? 0.0 : max(s.b,moved);
  gl_FragColor=encode(clamp(height-net,0.0,65535.0),loose,moved,friction);
}`;
