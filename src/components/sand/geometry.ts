// Tray and rake geometry shared by the CPU, the sand simulation, and the
// renderer. World units: the tray's sand is a disc of radius ~0.96 in xz,
// with height along y.
export const TEETH = 12;
export const INNER_TOOTH = 0.12;
export const TOOTH_SPACING = 0.073;
export const TOOTH_RADIUS = 0.008;
export const TOOTH_TIP = -0.013;
// The alternative tool: a thin flat plate on each arm whose lower edge is cut
// into V-shaped lobes. The edge averages just below the tray's mean sand level,
// so the sand it scrapes from the troughs builds the ridges between them.
export const BLADE_INNER = 0.105;
export const BLADE_OUTER = 0.935;
export const BLADE_HALF_THICKNESS = 0.003;
export const BLADE_EDGE = -0.0002;
const BLADE_LOBES = 9;
export const BLADE_SCALLOP = (BLADE_OUTER - BLADE_INNER) / BLADE_LOBES;
// Crest to trough, before the lobe's rounded tip. The flanks are cut just
// under the angle dry sand can hold, so the ridges they leave stand.
export const BLADE_SCALLOP_DEPTH = 0.022;
// The rounded part of each lobe, as a fraction of its half-width.
const BLADE_TIP = 0.2;
export const HUB_RADIUS = 0.078;
export const SAND_RADIUS = 0.965;

// The height field covers [-1, 1]² in square cells (~0.6 mm on a 30 cm tray).
// Heights are integers of HEIGHT_UNIT around ZERO, packed into two bytes.
export const CELLS = 512;
export const CELL = 2 / CELLS;
export const HEIGHT_UNIT = 2e-6;

// Relaxation runs at a fixed rate, so slips take the same time at any frame
// rate. Faster rake motion adds passes until each tooth advances <0.8 cells.
const PASSES_PER_SECOND = 240;
const MAX_PASSES = 40;
const OUTER_TOOTH = INNER_TOOTH + (TEETH - 1) * TOOTH_SPACING;

export function planPasses(fromAngle: number, toAngle: number, dt: number) {
  const travel = Math.abs(toAngle - fromAngle) * (OUTER_TOOTH + TOOTH_RADIUS);
  return Math.min(MAX_PASSES, Math.max(1, Math.ceil(dt * PASSES_PER_SECOND), Math.ceil(travel / (0.8 * CELL))));
}

// Play in the hub shifts the rigid rake along its bar. Odd harmonics keep both
// arms on one slightly eccentric path; the small even term separates them.
export function rakeOffset(angle: number) {
  return 0.0011 * Math.sin(angle + 0.4) + 0.0005 * Math.sin(3 * angle + 1.9) + 0.0002 * Math.sin(2 * angle + 0.3);
}

const float = (value: number) => (Number.isInteger(value) ? `${value}.0` : `${value}`);

export const sharedGlsl = `
const float TEETH=${float(TEETH)};
const float INNER_TOOTH=${float(INNER_TOOTH)};
const float TOOTH_SPACING=${float(TOOTH_SPACING)};
const float TOOTH_RADIUS=${float(TOOTH_RADIUS)};
const float TOOTH_TIP=${float(TOOTH_TIP)};
const float BLADE_INNER=${float(BLADE_INNER)};
const float BLADE_OUTER=${float(BLADE_OUTER)};
const float BLADE_HALF_THICKNESS=${float(BLADE_HALF_THICKNESS)};
const float BLADE_EDGE=${float(BLADE_EDGE)};
const float BLADE_SCALLOP=${float(BLADE_SCALLOP)};
const float BLADE_SCALLOP_DEPTH=${float(BLADE_SCALLOP_DEPTH)};
const float BLADE_TIP=${float(BLADE_TIP)};
const float HUB_RADIUS=${float(HUB_RADIUS)};
const float SAND_RADIUS=${float(SAND_RADIUS)};
const float CELLS=${float(CELLS)};
const float CELL=${float(CELL)};
const float HEIGHT_UNIT=${float(HEIGHT_UNIT)};
const float ZERO=32768.0;
float hash(vec2 p) {
  vec3 p3=fract(vec3(p.xyx)*0.1031);
  p3+=dot(p3,p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
}
float noise(vec2 p) {
  vec2 i=floor(p), f=fract(p);
  f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),
    mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);
}
// The blade's lower edge at a distance along an arm: straight flanks rising
// from rounded lobe tips to sharp notches, averaging BLADE_EDGE.
float bladeEdge(float along, float arm) {
  float lobes=(along-BLADE_INNER)/BLADE_SCALLOP;
  float u=abs(2.0*fract(lobes)-1.0);
  // Hand-cut lobes differ slightly in depth.
  float depth=BLADE_SCALLOP_DEPTH*(0.92+0.16*hash(vec2(floor(lobes),arm)));
  float shape=u>BLADE_TIP ? u : (u*u+BLADE_TIP*BLADE_TIP)/(2.0*BLADE_TIP);
  return BLADE_EDGE+depth*(shape-0.5-BLADE_TIP*BLADE_TIP/6.0);
}`;
