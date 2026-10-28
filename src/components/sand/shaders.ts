import { sharedGlsl } from './geometry';

// Renders the simulated height field, the walnut tray, and the brass rake.
// The sand's shape comes from the simulation; grains, glints, and lighting
// supply the material.
export const fragmentShader = `
precision highp float;
varying vec2 uv;
uniform vec2 resolution;
uniform float angle;
uniform float rakeOffset;
uniform float direction;
uniform float blade;
uniform sampler2D sand;
${sharedGlsl}
const vec3 LIGHT=vec3(-0.48,0.79,-0.38);
// A slightly warm key light and a cooler, dimmer studio fill.
const vec3 SUN=vec3(1.04,1.0,0.94);
const vec3 SKY=vec3(0.93,0.97,1.05);

// Most grains are one sand with slight variation; dark mineral grains are
// sparse and clear quartz grains rarer still.
float grainTone(float m) {
  if(m<0.03) return -0.22-m*3.0;
  if(m>0.975) return 0.14;
  return (m-0.5)*0.12;
}
// Irregular, individually lit grains. The gap to the next grain supplies
// contact shade, rather than laying flat color noise over a smooth surface.
vec4 sandGrain(vec2 p, float period) {
  vec2 cell=floor(p), local=fract(p), offset=vec2(0);
  float nearest=8.0, second=8.0, mineral=0.0;
  for(int y=-1;y<=1;y++) {
    for(int x=-1;x<=1;x++) {
      vec2 neighbor=vec2(float(x),float(y));
      // Periodic grain IDs let transported grains wrap without a texture jump.
      vec2 id=mod(cell+neighbor,period);
      vec2 center=vec2(hash(id),hash(id+37.2));
      vec2 delta=local-neighbor-center;
      float d=dot(delta,delta);
      if(d<nearest) {
        second=nearest;
        nearest=d;
        offset=delta;
        mineral=hash(id+91.7);
      } else {
        second=min(second,d);
      }
    }
  }
  return vec4(offset,sqrt(second)-sqrt(nearest),grainTone(mineral));
}
vec4 filteredGrain(vec2 p, float footprint, float period) {
  vec2 e=vec2(footprint*0.3,-footprint*0.3);
  vec4 grain=0.25*(sandGrain(p+e.xx,period)+sandGrain(p+e.xy,period)
    +sandGrain(p+e.yx,period)+sandGrain(p+e.yy,period));
  // Subpixel grains become a matte average instead of flashing between samples.
  return mix(grain,vec4(0,0,0.16,-0.004),smoothstep(0.8,2.2,footprint));
}
vec4 sandDetail(vec2 p, float footprint) {
  vec4 fine=filteredGrain(p,footprint,64.0);
  // Half-frequency grains share the same world-space repeat as the fine layer.
  vec4 coarse=filteredGrain(p*0.5,footprint*0.5,32.0);
  // About a fifth of the coarse grains, the lighter ones, are drawn larger.
  float larger=smoothstep(0.03,0.06,coarse.w)
    *(1.0-smoothstep(0.18,0.40,length(coarse.xy)));
  return mix(fine,coarse,larger*0.75);
}
// A few quartz grains have a flat face turned toward the light. They stay put
// on resting sand and only change as the surface beneath them moves.
float glint(vec2 p, vec3 n, vec3 halfway, float footprint) {
  vec2 cell=floor(p), local=fract(p), id=vec2(0);
  float nearest=8.0;
  for(int y=-1;y<=1;y++) {
    for(int x=-1;x<=1;x++) {
      vec2 neighbor=vec2(float(x),float(y));
      vec2 candidate=mod(cell+neighbor,64.0);
      vec2 delta=local-neighbor-vec2(hash(candidate),hash(candidate+37.2));
      float d=dot(delta,delta);
      if(d<nearest) {
        nearest=d;
        id=candidate;
      }
    }
  }
  if(hash(id+13.1)<0.94) return 0.0;
  vec2 tilt=(vec2(hash(id+5.3),hash(id+71.9))-0.5)*0.8;
  vec3 facet=normalize(n+vec3(tilt.x,0.0,tilt.y));
  float body=1.0-smoothstep(0.04,0.20,nearest);
  return pow(max(dot(facet,halfway),0.0),300.0)*body*(1.0-smoothstep(0.7,1.5,footprint));
}
vec3 sandAlbedo(float tone, vec2 p) {
  // Broad, faint tint drift, as between batches of the same sand.
  vec3 base=vec3(0.78,0.74,0.65)*(0.97+0.06*noise(p*3.1+vec2(4.0,1.0)));
  vec3 color=base*(1.0+tone);
  float dark=clamp(-tone*3.0-0.45,0.0,1.0);
  return mix(color,vec3(dot(color,vec3(0.32,0.5,0.18)))*vec3(0.95,0.96,1.0),dark*0.55);
}
// Rough diffuse reflection (Oren-Nayar, sigma 0.4 rad) for unresolved
// grain-scale roughness; resolved grains are lit individually above.
float roughDiffuse(vec3 n, vec3 l, vec3 v) {
  const float A=0.837, B=0.288;
  float nl=max(dot(n,l),0.0), nv=max(dot(n,v),0.001);
  vec3 lt=l-n*dot(n,l), vt=v-n*dot(n,v);
  float cosPhi=max(dot(lt,vt),0.0)/max(length(lt)*length(vt),1e-4);
  float thetaI=acos(nl), thetaR=acos(nv);
  float alpha=max(thetaI,thetaR), beta=min(min(thetaI,thetaR),1.5);
  return nl*(A+B*cosPhi*sin(alpha)*tan(beta));
}
// Smooth highlight roll-off: identity below the knee, approaching 1 above it.
vec3 shoulder(vec3 c) {
  vec3 over=max(c-0.8,0.0);
  return min(c,0.8)+over/(1.0+over/0.2);
}
vec2 rakeSpace(vec2 p) {
  float c=cos(angle), s=sin(angle);
  return vec2(c*p.x+s*p.y, -s*p.x+c*p.y);
}
// Bilinear filtering is linear, so the split 16-bit height interpolates exactly.
float heightAt(vec2 p) {
  vec4 s=texture2D(sand,p*0.5+0.5);
  return (s.r*65280.0+s.g*255.0-ZERO)*HEIGHT_UNIT;
}
float sandShadow(vec3 p) {
  float shade=1.0;
  for(int i=1;i<=12;i++) {
    vec3 sampleP=p+LIGHT*(float(i)*0.005);
    float clearance=sampleP.y-heightAt(sampleP.xz);
    shade=min(shade,smoothstep(-0.0015,0.004,clearance));
  }
  return shade;
}
// Height above (+) or below (-) the surrounding bed: troughs see less fill
// light and receive more light reflected from the grains around them.
float localRelief(vec2 p, float h) {
  float a=2.5*CELL, b=6.0*CELL;
  float around=heightAt(p+vec2(a,0))+heightAt(p-vec2(a,0))+heightAt(p+vec2(0,a))+heightAt(p-vec2(0,a))
    +heightAt(p+vec2(b,b))+heightAt(p-vec2(b,b))+heightAt(p+vec2(b,-b))+heightAt(p-vec2(b,-b));
  return h-around*0.125;
}
vec2 microSlope(vec2 p) {
  const float E=0.002;
  float c=noise(p*125.0);
  return vec2(noise((p+vec2(E,0))*125.0)-c,noise((p+vec2(0,E))*125.0)-c)*(0.0006/E);
}
float cylinder(vec3 p, float radius, float halfHeight) {
  vec2 d=abs(vec2(length(p.xz),p.y))-vec2(radius,halfHeight);
  return min(max(d.x,d.y),0.0)+length(max(d,0.0));
}
vec2 objects(vec3 p) {
  vec2 rim=abs(vec2(length(p.xz)-1.015,p.y+0.047))-vec2(0.047,0.073);
  float wood=min(max(rim.x,rim.y),0.0)+length(max(rim,0.0))-0.008;
  vec2 q=rakeSpace(p.xz);
  // The rake rides with a little play along its bar; the hub cap stays put.
  q.x-=rakeOffset;
  float bar=length(vec3(q.x-clamp(q.x,-0.945,0.945),p.y-0.055,q.y))-0.012;
  float cap=cylinder(p-vec3(0,0.075,0),0.071,0.019)-0.003;
  float tool;
  if(blade>0.5) {
    // A thin plate hanging from the bar on each arm, down to its scalloped
    // edge. It is drawn a cell thicker than it acts, to cover the cells it
    // fills. The edge term is scaled down because the lobes' flanks are steep.
    float along=abs(q.x);
    float edgeY=bladeEdge(clamp(along,BLADE_INNER,BLADE_OUTER),sign(q.x));
    tool=max(max(abs(q.y)-BLADE_HALF_THICKNESS-CELL,max(BLADE_INNER-along,along-BLADE_OUTER)),
      max((edgeY-p.y)*0.6,p.y-0.055));
  } else {
    float toothX=mod(abs(q.x)-INNER_TOOTH+TOOTH_SPACING*0.5,TOOTH_SPACING)-TOOTH_SPACING*0.5;
    tool=length(vec3(toothX,p.y-clamp(p.y,TOOTH_TIP,0.055),q.y))-TOOTH_RADIUS;
    tool=max(tool,max(INNER_TOOTH-0.015-abs(q.x),abs(q.x)-(INNER_TOOTH+(TEETH-1.0)*TOOTH_SPACING+0.017)));
  }
  float brass=min(min(bar,cap),tool);
  return wood<brass ? vec2(wood,1.0) : vec2(brass,2.0);
}
vec3 objectNormal(vec3 p) {
  vec2 e=vec2(0.0006,0);
  return normalize(vec3(objects(p+e.xyy).x-objects(p-e.xyy).x,
    objects(p+e.yxy).x-objects(p-e.yxy).x,
    objects(p+e.yyx).x-objects(p-e.yyx).x));
}
float shadow(vec3 p) {
  float result=1.0, t=0.012;
  for(int i=0;i<20;i++) {
    float d=objects(p+LIGHT*t).x;
    result=min(result,14.0*d/t);
    t+=clamp(d,0.008,0.065);
    if(result<0.02 || t>0.5) break;
  }
  return clamp(result,0.0,1.0);
}
void main() {
  vec2 screen=(uv-0.5)*2.0;
  screen.x*=resolution.x/resolution.y;
  // Orthographic product-photography camera, tilted to expose the wooden rim.
  vec3 ray=vec3(0,-0.80,-0.60);
  vec3 view=-ray;
  vec3 halfway=normalize(LIGHT+view);
  vec3 origin=vec3(screen.x*1.04,2.8+screen.y*1.04*0.60,2.10-screen.y*1.04*0.80);
  float floorT=(-0.145-origin.y)/ray.y;
  vec3 floorP=origin+ray*floorT;
  float contact=exp(-pow(length((floorP.xz-vec2(0.035,0.065))/vec2(1.04,1.01)),8.0)*1.6);
  float ambient=exp(-dot(floorP.xz-vec2(0.1,0.13),floorP.xz-vec2(0.1,0.13))*1.5);
  vec3 color=pow(vec3(0.949,0.937,0.910),vec3(2.2))*(1.0-contact*0.23-ambient*0.10);
  float sandT=-origin.y/ray.y;
  vec3 sandP=origin+ray*sandT;
  bool onSand=length(sandP.xz)<0.975;
  if(onSand) {
    // Find the first surface crossing, then refine it, so banks hide what
    // lies behind them.
    float topT=(0.05-origin.y)/ray.y;
    float stepT=0.075/(-ray.y*40.0);
    float lowT=topT;
    float highT=topT;
    for(int i=1;i<=40;i++) {
      highT=topT+float(i)*stepT;
      vec3 sampleP=origin+ray*highT;
      if(sampleP.y<=heightAt(sampleP.xz)) break;
      lowT=highT;
    }
    for(int i=0;i<6;i++) {
      float midT=(lowT+highT)*0.5;
      vec3 sampleP=origin+ray*midT;
      if(sampleP.y>heightAt(sampleP.xz)) lowT=midT;
      else highT=midT;
    }
    sandT=(lowT+highT)*0.5;
    sandP=origin+ray*sandT;
    vec2 p=sandP.xz;
    float h=heightAt(p);
    vec3 n=normalize(vec3(heightAt(p-vec2(CELL,0))-heightAt(p+vec2(CELL,0)),
      2.0*CELL,heightAt(p-vec2(0,CELL))-heightAt(p+vec2(0,CELL))));
    float loose=texture2D(sand,p*0.5+0.5).b;
    float relief=localRelief(p,h);
    float cavity=smoothstep(0.0,0.004,-relief);
    // Raked sand is loose and lumpier than the compacted, smoothed tray.
    vec2 micro=microSlope(p)*mix(0.6,1.5,loose);
    n=normalize(n-vec3(micro.x,0.0,micro.y));
    float footprint=2.08/resolution.y*240.0/max(n.y,0.35);
    vec4 grain=sandDetail(p*240.0,footprint);
    // Grains in the heap ahead of a tooth or blade travel with it. Blend grain
    // shading, never the two coordinate maps, which would fold the texture.
    vec2 q=rakeSpace(p);
    q.x-=rakeOffset;
    float tooth=clamp(floor((abs(q.x)-INNER_TOOTH)/TOOTH_SPACING+0.5),0.0,TEETH-1.0);
    float across=blade>0.5 ? max(max(BLADE_INNER-abs(q.x),abs(q.x)-BLADE_OUTER),0.0)
      : abs(q.x)-INNER_TOOTH-tooth*TOOTH_SPACING;
    float reach=blade>0.5 ? 0.045 : 0.024;
    float front=q.y*sign(q.x)*direction;
    float carried=(1.0-smoothstep(reach*0.4,reach,length(vec2(across,max(front,0.0)*0.8))))
      *smoothstep(-TOOTH_RADIUS,0.0,front)*smoothstep(0.0003,0.002,relief);
    if(carried>0.001) {
      vec4 heap=sandDetail(vec2(q.x,front)*240.0,footprint);
      heap.y*=sign(q.x)*direction;
      heap.xy=vec2(cos(angle)*heap.x-sin(angle)*heap.y,sin(angle)*heap.x+cos(angle)*heap.y);
      grain=mix(grain,heap,carried);
    }
    n=normalize(n+vec3(grain.x,0.0,grain.y)*mix(0.45,0.62,loose)+vec3(0,0.12,0));
    float objectShade=shadow(sandP+vec3(0,0.004,0));
    float shade=min(objectShade,mix(0.4,1.0,sandShadow(sandP)));
    float rimAO=1.0-smoothstep(0.913,0.963,length(p));
    float hubAO=smoothstep(0.062,0.105,length(p));
    vec3 albedo=sandAlbedo(grain.w,p);
    float grainShade=mix(0.72,1.0,smoothstep(0.015,0.20,grain.z));
    // A large soft key: shadowed sand still sees part of the light.
    float direct=roughDiffuse(n,LIGHT,view)*0.85*mix(0.3,1.0,shade);
    // Light bounced between grains is tinted by them, warming shaded troughs.
    vec3 fill=SKY*(0.30+0.06*n.y)*(1.0-0.5*cavity)+albedo*0.10*cavity;
    color=albedo*grainShade*(SUN*direct+fill);
    color*=mix(0.58,1.0,rimAO)*mix(0.52,1.0,hubAO);
    color+=SUN*glint(p*240.0,n,halfway,footprint)*1.6*shade;
    color=shoulder(color);
  }
  float end=onSand ? sandT : floorT;
  float t=max(0.0,(0.14-origin.y)/ray.y);
  float material=0.0;
  vec3 p=origin+ray*t;
  for(int i=0;i<80;i++) {
    p=origin+ray*t;
    vec2 hit=objects(p);
    if(hit.x<0.0006) {material=hit.y; break;}
    t+=hit.x;
    if(t>end) break;
  }
  if(material>0.0 && t<end) {
    vec3 n=objectNormal(p);
    float diffuse=max(dot(n,LIGHT),0.0);
    float shade=shadow(p+n*0.003);
    if(material<1.5) {
      float warp=noise(p.xz*vec2(3.0,10.0));
      float grain=noise(vec2(p.x*14.0+warp*2.5,p.z*150.0+p.y*100.0));
      float lines=sin(p.z*390.0+p.x*22.0+warp*19.0+p.y*250.0);
      vec3 wood=mix(vec3(0.105,0.043,0.020),vec3(0.30,0.155,0.073),grain);
      wood*=0.90+0.10*lines;
      color=wood*(0.42+0.75*diffuse*shade);
      color+=vec3(0.10,0.073,0.045)*pow(max(dot(n,halfway),0.0),30.0)*shade;
    } else {
      float brushing=noise(p.xz*650.0)*0.025;
      vec3 brass=vec3(0.52,0.335,0.11);
      float spec=pow(max(dot(n,halfway),0.0),65.0);
      float broad=pow(max(dot(n,halfway),0.0),8.0);
      color=brass*(0.35+0.65*diffuse*shade+brushing);
      color+=vec3(0.75,0.62,0.35)*(spec*0.65+broad*0.22)*shade;
      color+=vec3(0.14,0.105,0.048)*pow(1.0-max(dot(n,view),0.0),3.0);
    }
    color=shoulder(color);
  }
  gl_FragColor=vec4(pow(max(color,0.0),vec3(1.0/2.2)),1.0);
}`;
