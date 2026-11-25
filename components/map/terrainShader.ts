export const terrainVertexShader = /* glsl */ `
attribute float aElev;
attribute float aSea;
attribute vec2 aGrid;
// True ground slope (dh/dx east, dh/dz south, metres per metre) and
// normalised curvature (positive in hollows/valleys), from the heightfield.
attribute vec2 aGrad;
attribute float aCurv;

uniform float uScale;
uniform float uExag;

varying float vElev;
varying float vSea;
varying vec2 vGrid;
varying vec2 vGrad;
varying float vCurv;
varying float vDist;

void main() {
  vec3 p = position;
  p.y = aElev * uScale * uExag;
  vec4 view = modelViewMatrix * vec4(p, 1.0);
  vElev = aElev;
  vSea = aSea;
  vGrid = aGrid;
  vGrad = aGrad;
  vCurv = aCurv;
  vDist = -view.z;
  gl_Position = projectionMatrix * view;
}
`;

export const terrainFragmentShader = /* glsl */ `
uniform float uMin;
uniform float uMax;
uniform float uMinor;
uniform float uMajor;
uniform float uExag;
uniform float uWire;
uniform float uContours;
uniform float uHover;
uniform float uHoverElev;
uniform vec2 uDims;
uniform vec3 uBg;
uniform float uFogNear;
uniform float uFogFar;

uniform vec3 uHypso[5];
uniform vec3 uSlope;
uniform vec3 uShadow;
uniform vec3 uHighlight;
uniform float uRelief;
uniform vec3 uSeaColor;
uniform vec3 uWireLow;
uniform vec3 uWireHigh;
uniform float uWireAlpha;
uniform vec3 uContourMinor;
uniform vec3 uContourMajor;
uniform float uContourAlpha;
uniform vec3 uAccent;

// OSM area fills, channel-encoded (see OsmLayer):
//   uOverlay: r water, g park, b wood (1) / open countryside (0.5)
//   uBuilt:   r residential, g commercial, b industrial
uniform sampler2D uOverlay;
uniform sampler2D uBuilt;
uniform float uOverlayOn;
uniform vec4 uFillOn; // water, park, wood, open
uniform vec3 uBuiltOn; // residential, commercial, industrial
uniform vec4 uWaterFill;
uniform vec4 uParkFill;
uniform vec4 uWoodFill;
uniform vec4 uOpenFill;
uniform vec4 uResidentialFill;
uniform vec4 uCommercialFill;
uniform vec4 uIndustrialFill;

varying float vElev;
varying float vSea;
varying vec2 vGrid;
varying vec2 vGrad;
varying float vCurv;
varying float vDist;

float isoLine(float v, float width) {
  float fw = max(fwidth(v), 1e-5);
  float d = abs(fract(v - 0.5) - 0.5) / fw;
  return 1.0 - min(d / width, 1.0);
}

float gridLine(vec2 g, float width) {
  vec2 fw = max(fwidth(g), vec2(1e-5));
  vec2 d = abs(fract(g - 0.5) - 0.5) / fw;
  return 1.0 - min(min(d.x, d.y) / width, 1.0);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

vec3 hypso(float t) {
  // Stops at 0, 0.12, 0.32, 0.6, 1: valleys and lowland get most of the ramp.
  if (t < 0.12) return mix(uHypso[0], uHypso[1], t / 0.12);
  if (t < 0.32) return mix(uHypso[1], uHypso[2], (t - 0.12) / 0.2);
  if (t < 0.6) return mix(uHypso[2], uHypso[3], (t - 0.32) / 0.28);
  return mix(uHypso[3], uHypso[4], (t - 0.6) / 0.4);
}

void main() {
  float land = 1.0 - vSea;
  float t = clamp((vElev - max(uMin, 0.0)) / max(uMax - max(uMin, 0.0), 1.0), 0.0, 1.0);

  // Hillshade from the real slope, exaggerated like the geometry. Light from
  // the north-west at ~40 degrees, the cartographic convention.
  vec3 n = normalize(vec3(-vGrad.x * uExag, 1.0, -vGrad.y * uExag));
  vec3 light = normalize(vec3(-0.6, 0.8, -0.6));
  float hs = dot(n, light);
  float flat_ = light.y;
  float rel = clamp((hs - flat_) * 2.2, -1.0, 1.0);
  float slope = length(vGrad);

  vec3 base = hypso(pow(t, 0.8));
  base = mix(base, uSlope, smoothstep(0.08, 0.45, slope) * 0.55);
  // Fine grain so flat ground isn't plastic; tied to the grid so it moves with it.
  float grain = noise(vGrid * 1.7) * 0.6 + noise(vGrid * 6.3) * 0.4;
  base *= 0.965 + grain * 0.07;

  vec3 tint = rel < 0.0 ? mix(vec3(1.0), uShadow * 1.6, -rel * uRelief) : mix(vec3(1.0), uHighlight * 1.08, rel * uRelief * 0.6);
  vec3 color = base * tint;
  // Curvature shading: hollows darker, crests a touch lighter.
  color *= 1.0 - clamp(vCurv, -1.0, 1.0) * 0.16;

  // OSM fills (shaded by the same relief so they sit on the land).
  vec2 uv = vec2((vGrid.x + 0.5) / uDims.x, 1.0 - (vGrid.y + 0.5) / uDims.y);
  vec4 ov = texture2D(uOverlay, uv) * uOverlayOn;
  vec3 bu = texture2D(uBuilt, uv).rgb * uOverlayOn * uBuiltOn;
  float wood = smoothstep(0.7, 0.9, ov.b);
  float open_ = smoothstep(0.25, 0.45, ov.b) * (1.0 - wood);
  vec3 shade = mix(vec3(1.0), tint, 0.7);
  color = mix(color, uOpenFill.rgb * shade, open_ * uOpenFill.a * uFillOn.w);
  color = mix(color, uResidentialFill.rgb * shade, bu.r * uResidentialFill.a);
  color = mix(color, uCommercialFill.rgb * shade, bu.g * uCommercialFill.a);
  color = mix(color, uIndustrialFill.rgb * shade, bu.b * uIndustrialFill.a);
  color = mix(color, uParkFill.rgb * shade, ov.g * uParkFill.a * uFillOn.y);
  color = mix(color, uWoodFill.rgb * shade, wood * uWoodFill.a * uFillOn.z);
  color = mix(color, uWaterFill.rgb, ov.r * uWaterFill.a * uFillOn.x);

  color = mix(color, uSeaColor, vSea);

  // Wireframe along the elevation grid; coarser strides take over as cells
  // shrink to a few pixels so distant views stay clean.
  vec2 fw = fwidth(vGrid);
  float density = max(fw.x, fw.y);
  float w1 = gridLine(vGrid, 0.9) * (1.0 - smoothstep(0.22, 0.5, density));
  float w4 = gridLine(vGrid / 4.0, 0.9) * (1.0 - smoothstep(0.9, 2.0, density));
  float w16 = gridLine(vGrid / 16.0, 0.9) * (1.0 - smoothstep(3.6, 8.0, density));
  float wire = max(w1 * 0.7, max(w4 * 0.9, w16));
  vec3 wireColor = mix(uWireLow, uWireHigh, pow(t, 0.8)) * (0.85 + 0.25 * max(rel, 0.0));
  color = mix(color, wireColor, wire * uWire * uWireAlpha * mix(0.45, 1.0, land));

  // Index (major) contours stronger; minors fade out before they crowd.
  float minorFade = 1.0 - smoothstep(0.18, 0.4, fwidth(vElev / uMinor));
  float minor = isoLine(vElev / uMinor, 0.8) * minorFade;
  float major = isoLine(vElev / uMajor, 1.3);
  vec3 cColor = major > minor * 0.5 ? uContourMajor : uContourMinor;
  float contour = max(minor * 0.45, major) * uContours * land * uContourAlpha;
  color = mix(color, cColor, contour);

  float hd = abs(vElev - uHoverElev) / max(fwidth(vElev), 1e-5);
  float hover = (1.0 - min(hd / 0.9, 1.0)) * uHover * land;
  color = mix(color, uAccent, hover * 0.45);

  vec2 edge = min(vGrid, uDims - 1.0 - vGrid) / uDims;
  float edgeFade = smoothstep(0.0, 0.035, min(edge.x, edge.y));
  float fog = smoothstep(uFogNear, uFogFar, vDist);
  color = mix(uBg, color, edgeFade * (1.0 - fog));

  gl_FragColor = vec4(color, 1.0);
  // Uniform colours are linear; convert like built-in materials do.
  #include <colorspace_fragment>
}
`;
