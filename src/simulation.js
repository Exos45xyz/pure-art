import {
  BufferAttribute, Camera, CustomBlending, FloatType, HalfFloatType, InstancedBufferGeometry, LinearFilter, Mesh, OneFactor,
  PlaneGeometry, Points, Scene, ShaderMaterial, Vector3, WebGLRenderTarget,
} from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import { compileAhead } from './compile.js';
import { hash, noise } from './glsl.js';

// The smoke lives on the GPU: one texel per grain, in two textures.
// position = xyz inside the cube (-1..1) and w = age (0 at birth, 1 at death)
// velocity = xyz and w = a fixed random seed
// dye = the grain's place on the image's colour map, as two angles: (cos, sin) of hue and of light

const sources = { volume: 0, plume: 1, core: 2 };

// Where the glass is open. Shared so grains and the flow agree on the same holes.
const holes = /* glsl */ `
uniform float uEscape;
float openness(vec3 p, float t) {
  float threshold = mix(1.05, 0.3, uEscape);
  float hole = snoise(p * 1.35 + vec3(0.0, -t * 0.09, t * 0.05)) * 0.5 + 0.5;
  return smoothstep(threshold, threshold + 0.08, hole);
}
`;

// Gather: two centres race around inside the cube on smooth, never-repeating paths. Each grain
// belongs to one of them for life, so the smoke moves as whole bodies that chase their centre,
// roll around it, and flatten against the glass when the centre comes close to a wall.
const bodies = /* glsl */ `
uniform float uGather;
uniform float uPulse;
uniform float uSwell;
uniform float uDrift;
uniform float uSwirl;
uniform float uEnergy;
uniform float uHold;
uniform vec3 uTowardCamera;
vec3 centre(float k, float t) {
  return 0.6 * vec3(
    sin(t * (0.53 + 0.17 * k) + k * 2.1) * cos(t * 0.21 + k),
    sin(t * (0.41 + 0.13 * k) + k * 4.3),
    cos(t * (0.47 + 0.11 * k) + k * 1.7));
}
float body(float seed) { return floor(fract(seed * 7.13) * 2.0); }
`;

const velocityShader = /* glsl */ `
uniform float uTime;
uniform float uDt;
uniform float uSpeed;
uniform float uTurbulence;
uniform float uSpread;
uniform float uRebound;
uniform float uSource;
uniform vec3 uRayOrigin;
uniform vec3 uRayDirection;
uniform vec3 uStir;

${noise}
${hash}
${holes}
${bodies}

// Curl-noise flow that respects the glass (Bridson et al., "Curl-Noise for Procedural Fluid Flow").
// v = grad(a * R) x grad(b) has no divergence, and where the ramp R reaches 0 at a wall the flow
// can only run along it. So smoke slides over the glass without piling up in corners.
float ramp(float x) { x = clamp(x, 0.0, 1.0); return x * (1.875 + x * x * (-1.25 + x * x * 0.375)); }
float rampSlope(float x) { return x >= 1.0 ? 0.0 : 1.875 + x * x * (-3.75 + x * x * 1.875); }

vec3 octave(vec3 p, float f, vec3 offset, float R, float slope, vec3 gradD) {
  vec3 ga, gb;
  float a = snoise(p * f + offset, ga);
  snoise(p * f + offset.zxy + vec3(31.416, -17.23, 12.71), gb);
  return cross(R * ga + a * slope * gradD / f, gb);
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 pos = texture2D(texturePosition, uv);
  vec4 vel = texture2D(textureVelocity, uv);
  vec3 p = pos.xyz;
  float t = uTime;

  // Distance to the nearest face, and which way that face is.
  vec3 a = abs(p);
  vec3 gaps = 1.0 - a;
  float d = min(gaps.x, min(gaps.y, gaps.z));
  vec3 gradD = gaps.x <= gaps.y && gaps.x <= gaps.z ? vec3(-sign(p.x), 0.0, 0.0)
             : gaps.y <= gaps.z ? vec3(0.0, -sign(p.y), 0.0) : vec3(0.0, 0.0, -sign(p.z));
  // Sealed glass (escape 0) skips the holes entirely: one noise less for every grain, every frame.
  float open = d < 0.0 ? 1.0 : uEscape < 0.001 ? 0.0 : openness(p, t);
  const float W = 0.35;
  float R = mix(ramp(d / W), 1.0, open);
  // The ramp's own term is softened: the flow still only runs along the glass, with gentler
  // currents next to it.
  float slope = (1.0 - open) * rampSlope(clamp(d / W, 0.0, 1.0)) / W * 0.6;

  // Calm smoke turns in bigger rolls; turbulent smoke in smaller ones.
  vec3 v = octave(p, mix(0.55, 0.95, uTurbulence), vec3(0.0, t * 0.06, t * 0.035), R, slope, gradD);
  v += octave(p, 1.9, vec3(t * 0.11, 3.7, -t * 0.08), R, slope, gradD) * 0.65 * uTurbulence;
  // The finest swirls only once they'd show; below that they cost two noises for nothing.
  if (uTurbulence > 0.15) v += octave(p, 4.3, vec3(-7.1, t * 0.19, t * 0.15), R, slope, gradD) * 0.4 * uTurbulence * uTurbulence;
  // The breath makes the turbulence livelier at the burst and calmer while the smoke floats.
  vec3 target = v * uSpeed * mix(1.0, uEnergy, uPulse);
  // Spread: each grain also wanders at random, a new direction every third of a second.
  // The flow alone stretches smoke into thin sheets; this puffs them back out into volumes.
  vec3 wander = hash33(vec3(gl_FragCoord.xy, floor(t * 3.0 + vel.w * 7.0))) * 2.0 - 1.0;
  target += wander * uSpread * (0.15 + 0.9 * uSpeed);
  // Grains that brushed the glass are eased back into the body of the smoke.
  target += gradD * (1.0 - R) * (0.12 + 0.5 * uSpeed) * step(0.0, d);

  if (uGather > 0.001 || uPulse > 0.001) {
    float k = body(vel.w);
    vec3 c = centre(k, t);
    vec3 toCentre = c - p;
    vec3 axis = normalize(vec3(sin(k * 2.3 + 1.0), 0.8, cos(k * 1.7)));
    // The bodies hold together; with the breath on, only while it collapses.
    float hold = uGather * mix(1.0, uHold, uPulse);
    target += toCentre * hold * 3.36 - cross(axis, toCentre) * hold * 2.24;
    // The breath, as measured: each grain moves in proportion to its distance from the middle, so the
    // whole shape scales up (swell > 0) or down (swell < 0) and fills the cube instead of going hollow.
    // The glass holds it at the faces. Then the whole mass drifts up or down and turns in the picture.
    vec3 fromMiddle = p - c * 0.4;
    float atGlass = smoothstep(0.85, 1.0, max(a.x, max(a.y, a.z)));
    // Squeezing needs more force than swelling: a compact mass's own turbulence pushes it back out.
    float gain = uSwell > 0.0 ? 0.6 * (1.0 - atGlass) : 1.2;
    target += fromMiddle * uSwell * uPulse * gain;
    target.y += uDrift * uPulse;
    target += cross(uTowardCamera, p) * uSwirl * uPulse;
  }

  // Sources shape the current: a plume rises and pools under the lid, a core breathes outward.
  float inside = step(0.0, d);
  if (uSource > 0.5 && uSource < 1.5) target.y += 0.55 * uSpeed * mix(1.0, smoothstep(0.0, W, 1.0 - p.y), inside * (1.0 - open));
  if (uSource > 1.5) target += normalize(p + 1e-4) * 0.4 * uSpeed * (1.0 - smoothstep(0.0, 0.9, length(p)));
  // Smoke that got out drifts up and away.
  target.y += (1.0 - inside) * 0.2;

  // The pointer stirs the smoke around its ray.
  vec3 q = p - uRayOrigin;
  vec3 across = q - uRayDirection * dot(q, uRayDirection);
  target += uStir * exp(-dot(across, across) * 16.0);

  // Rebound off the glass. Near a closed wall the current may only run along it, never into it;
  // a grain that reaches the glass moving outward bounces straight back (at rebound 0.5 with 90% of its
  // speed and a small kick, so even slow smoke springs off), and part of the impact splashes sideways
  // along the glass. Close to the glass the smoke eases back into the current slowly, so the bounce
  // carries. Rebound 0 lets the smoke settle on the glass; 1 throws it back hard and far.
  float rebound = uRebound * 2.0;
  float restitution = min(0.9 * rebound, 1.0);
  float kick = 0.25 * rebound * rebound;
  float carry = rebound <= 1.0 ? mix(9.0, 2.5, rebound) : mix(2.5, 1.2, rebound - 1.0);
  vec3 outward = -gradD;
  float sealed = (1.0 - open) * inside;
  float nearGlass = (1.0 - smoothstep(0.0, 0.15, d)) * sealed;
  target -= outward * max(dot(target, outward), 0.0) * nearGlass;
  // Along the faces the smoke runs fast, quicker than inside, instead of dragging on the glass: within
  // 0.05 of it the sideways current is 2.5 times stronger and never slower than 1 + 2.5 x the flow
  // speed, fading back to normal 0.2 in.
  vec3 alongFace = target - outward * dot(target, outward);
  float sweep = length(alongFace);
  vec3 sweepDir = sweep > 1e-4 ? alongFace / sweep : normalize(cross(outward, vec3(0.31, 0.83, 0.47)));
  float faceSpeed = max(sweep * 2.5, 1.0 + 2.5 * uSpeed);
  float onFace = (1.0 - smoothstep(0.05, 0.2, d)) * sealed;
  target += (sweepDir * faceSpeed - alongFace) * onFace;
  vec3 bounced = vel.xyz;
  float into = dot(bounced, outward);
  if (d < 0.05 && into > 0.0 && sealed > 0.5) {
    vec3 along = p - outward * dot(p, outward);
    vec3 splash = length(along) > 1e-4 ? normalize(along) : vec3(0.0);
    bounced += -outward * (into * (1.0 + restitution) + kick) + splash * into * 1.2 * min(rebound, 1.4);
  }

  // A grain that was just born takes the current at once; the others ease into it. Near the glass the
  // bounce off it eases out slowly, while the slide along it picks up speed quickly.
  float response = pos.w < 0.015 ? 1.0 : 1.0 - exp(-uDt * mix(9.0, carry, nearGlass));
  vec3 next = mix(bounced, target, response);
  vec3 slide = next - outward * dot(next, outward);
  vec3 slideTarget = target - outward * dot(target, outward);
  next += (slideTarget - slide) * (1.0 - exp(-uDt * 10.0)) * onFace;
  gl_FragColor = vec4(next, vel.w);
}
`;

const positionShader = /* glsl */ `
uniform float uTime;
uniform float uDt;
uniform float uSource;
uniform float uSpread;

${noise}
${hash}
${holes}
${bodies}

// Four sources wander slowly through the cube. Grains are born around them, so the flow has
// dense shapes to stretch into ribbons and sheets, with dark air in between.
vec3 emitter(float k, float t) {
  return 0.6 * vec3(
    sin(t * (0.11 + 0.031 * k) + k * 2.1),
    sin(t * (0.083 + 0.024 * k) + k * 4.3),
    cos(t * (0.097 + 0.019 * k) + k * 1.7));
}

vec3 ball(vec3 h) {
  vec3 d = normalize(hash33(h * 91.7 + 3.1) * 2.0 - 1.0 + 1e-4);
  return d * pow(h.x, 0.4);
}

vec3 spawn(float seed) {
  vec3 base = vec3(gl_FragCoord.xy, mod(uTime, 977.0) * 61.0 + seed * 97.0);
  vec3 h = hash33(base);
  if (uSource < 0.5) {
    if (seed < 0.05) return (h * 2.0 - 1.0) * 0.95;
    if (uGather > 0.001) return centre(body(seed), uTime) + ball(h) * (0.16 + 0.3 * uSpread);
    float k = floor(hash13(base + 5.3) * 4.0);
    return emitter(k, uTime) + ball(h) * (0.16 + 0.3 * uSpread);
  }
  if (uSource < 1.5) {
    float r = sqrt(h.x) * 0.28;
    float angle = h.y * 6.2831853;
    return vec3(cos(angle) * r, -0.9 + h.z * 0.12, sin(angle) * r);
  }
  return ball(h) * 0.24;
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 pos = texture2D(texturePosition, uv);
  vec4 vel = texture2D(textureVelocity, uv);
  float seed = vel.w;

  float life = uSource < 0.5 ? mix(3.0, 7.0, seed) : uSource < 1.5 ? mix(3.5, 6.5, seed) : mix(3.0, 7.0, seed);
  vec3 p = pos.xyz + vel.xyz * uDt;

  // A grain only leaves through an open hole; elsewhere the glass holds it.
  float before = max(abs(pos.x), max(abs(pos.y), abs(pos.z)));
  float reach = max(abs(p.x), max(abs(p.y), abs(p.z)));
  if (before < 1.0 && reach >= 0.995 && (uEscape < 0.001 || openness(p, uTime) < 0.5)) {
    // Bounce off the glass instead of sticking to it.
    vec3 over = max(abs(p) - 0.985, 0.0);
    p -= sign(p) * over * 2.0;
    reach = max(abs(p.x), max(abs(p.y), abs(p.z)));
  }
  // With escape at zero the glass is sealed: whatever the speed, nothing ends up outside.
  if (uEscape < 0.001 && before < 1.0) {
    p = clamp(p, -0.995, 0.995);
    reach = min(reach, 0.995);
  }

  // Smoke that got out fades three times faster.
  float age = pos.w + uDt / life * (1.0 + 2.5 * step(1.0, reach));
  if (age >= 1.0 || reach > 2.5) {
    p = spawn(seed);
    age = 0.0;
  }
  gl_FragColor = vec4(p, age);
}
`;

// The image's colours, as pigment in the smoke. Each grain carries a place on the image's colour map
// (palette.js, read in smoke.js) as two directions (cos, sin), so each can turn the short way round.
// Large, slow colour fields give every region of the cube its own neighbourhood of the map, and a grain
// eases toward its region's colour over about three seconds: the flow drags colours into strands and
// folds before they settle, so neighbouring smoke shares a colour and colours meet in folds, not in
// confetti. A newborn grain takes its region's colour at once.
// The two colour fields at p (hue, light), each about -1..1. Shared by the dye and the curve that evens
// them out over the grains. Hue changes over large regions (a line of sight through the cube crosses
// few of them, so colours stay saturated instead of averaging out); light changes within them, so a
// region of one colour shows the image's own range of tones.
const colourFieldsGlsl = /* glsl */ `
vec2 colourFields(vec3 p, float t) {
  vec3 g;
  float hue = snoise(p * 0.3 + vec3(t * 0.021, -t * 0.017, t * 0.013), g);
  float light = snoise(p * 0.9 + vec3(-41.0 - t * 0.015, 13.0 + t * 0.019, 29.0), g);
  return vec2(hue, light);
}
`;

const dyeShader = /* glsl */ `
uniform float uTime;
uniform float uDt;
uniform float uSnap;

${noise}
${colourFieldsGlsl}

// Where a grain sits on the image's colour map (palette.js): two smooth fields across the cube, hue
// and light, turning slowly. The smoke only fills part of the cube, so the field values its grains meet
// are spread unevenly; tCdf (made each step from the grains themselves, see measureColours) spreads them
// evenly over 0..1. Then every part of the map, so every pixel, colours exactly its share of the
// smoke at every moment, while neighbouring grains stay alike.
uniform sampler2D tCdf;
vec2 colourPlace(vec3 p, float t) {
  vec2 n = colourFields(p, t);
  return vec2(texture2D(tCdf, vec2(n.x * 0.5 + 0.5, 0.5)).r, texture2D(tCdf, vec2(n.y * 0.5 + 0.5, 0.5)).g) + t * 0.012;
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 pos = texture2D(texturePosition, uv);
  vec4 dye = texture2D(textureDye, uv);
  vec2 a = colourPlace(pos.xyz, uTime) * 6.2831853;
  vec4 target = vec4(cos(a.x), sin(a.x), cos(a.y), sin(a.y));
  // A newborn grain takes its place at once (and every grain, the first time); the others drift to it
  // over about three seconds.
  float k = pos.w < 0.02 || uSnap > 0.5 ? 1.0 : 1.0 - exp(-uDt * 0.35);
  vec4 next = mix(dye, target, k);
  gl_FragColor = vec4(next.xy / max(length(next.xy), 1e-4), next.zw / max(length(next.zw), 1e-4));
}
`;

export function createSimulation(renderer, size) {
  const gpu = new GPUComputationRenderer(size, size, renderer);
  if (!renderer.extensions.has('EXT_color_buffer_float')) gpu.setDataType(HalfFloatType);

  const position0 = gpu.createTexture();
  const velocity0 = gpu.createTexture();
  const p = position0.image.data;
  const v = velocity0.image.data;
  for (let i = 0; i < p.length; i += 4) {
    p[i] = Math.random() * 1.9 - 0.95;
    p[i + 1] = Math.random() * 1.9 - 0.95;
    p[i + 2] = Math.random() * 1.9 - 0.95;
    p[i + 3] = Math.random();
    v[i + 3] = Math.random();
  }

  const dye0 = gpu.createTexture();
  for (let i = 0; i < dye0.image.data.length; i += 4) dye0.image.data[i] = dye0.image.data[i + 2] = 1;

  const velocity = gpu.addVariable('textureVelocity', velocityShader, velocity0);
  const position = gpu.addVariable('texturePosition', positionShader, position0);
  const dye = gpu.addVariable('textureDye', dyeShader, dye0);
  gpu.setVariableDependencies(velocity, [velocity, position]);
  gpu.setVariableDependencies(position, [velocity, position]);
  gpu.setVariableDependencies(dye, [dye, position]);
  Object.assign(dye.material.uniforms, { uTime: { value: 0 }, uDt: { value: 0 }, uSnap: { value: 1 }, tCdf: { value: null } });

  Object.assign(velocity.material.uniforms, {
    uTime: { value: 0 },
    uDt: { value: 0 },
    uSpeed: { value: 0 },
    uTurbulence: { value: 0 },
    uSpread: { value: 0 },
    uRebound: { value: 0.5 },
    uGather: { value: 0 },
    uPulse: { value: 0 },
    uSwell: { value: 0 },
    uDrift: { value: 0 },
    uSwirl: { value: 0 },
    uEnergy: { value: 1 },
    uHold: { value: 1 },
    uTowardCamera: { value: new Vector3(0, 0, 1) },
    uEscape: { value: 0 },
    uSource: { value: 0 },
    uRayOrigin: { value: new Vector3(0, 0, 100) },
    uRayDirection: { value: new Vector3(0, 0, -1) },
    uStir: { value: new Vector3() },
  });
  Object.assign(position.material.uniforms, {
    uTime: { value: 0 },
    uDt: { value: 0 },
    uSource: { value: 0 },
    uSpread: { value: 0 },
    uGather: { value: 0 },
    uPulse: { value: 0 },
    uSwell: { value: 0 },
    uDrift: { value: 0 },
    uSwirl: { value: 0 },
    uEnergy: { value: 1 },
    uTowardCamera: { value: new Vector3(0, 0, 1) },
    uEscape: { value: 0 },
  });

  const error = gpu.init();
  if (error) throw new Error(error);

  const vu = velocity.material.uniforms;
  const pu = position.material.uniforms;
  const du = dye.material.uniforms;
  let time = Math.random() * 100;

  // (Made after the random start above: three gives every new object an id from Math.random.)
  // The colour curve: where the grains are in the two colour fields right now. Every 16th grain lands
  // in a 256-bin histogram of each field (hue in red, light in green); a second pass sums it bin by bin
  // into the share of grains below each value. Floats where the GPU can blend into them.
  const BINS = 256;
  const curveType = renderer.extensions.has('EXT_color_buffer_float') && renderer.extensions.has('EXT_float_blend') ? FloatType : HalfFloatType;
  const histogram = new WebGLRenderTarget(BINS, 1, { type: curveType, depthBuffer: false });
  const curve = new WebGLRenderTarget(BINS, 1, { type: curveType, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter });
  const sampleSide = Math.max(1, Math.floor(size / 4));
  const refs = new Float32Array(sampleSide * sampleSide * 3);
  for (let i = 0; i < sampleSide * sampleSide; i++) {
    refs[i * 3] = ((i % sampleSide) * 4 + 0.5) / size;
    refs[i * 3 + 1] = (Math.floor(i / sampleSide) * 4 + 0.5) / size;
  }
  const sampleGeometry = new InstancedBufferGeometry();
  sampleGeometry.instanceCount = 2;
  sampleGeometry.setAttribute('position', new BufferAttribute(refs, 3));
  const histogramMaterial = new ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false,
    blending: CustomBlending, blendSrc: OneFactor, blendDst: OneFactor,
    uniforms: { tPosition: { value: null }, uTime: { value: 0 }, uWeight: { value: 1 / (sampleSide * sampleSide) } },
    vertexShader: /* glsl */ `
      uniform sampler2D tPosition;
      uniform float uTime;
      ${noise}
      ${colourFieldsGlsl}
      varying vec2 vField;
      void main() {
        vec2 n = colourFields(texture2D(tPosition, position.xy).xyz, uTime) * 0.5 + 0.5;
        // One point per field: the first draw counts hue, the second light (gl_InstanceID).
        float field = float(gl_InstanceID);
        float x = clamp(field < 0.5 ? n.x : n.y, 0.0, 0.9999);
        vField = vec2(1.0 - field, field);
        gl_Position = vec4((floor(x * ${BINS}.0) + 0.5) / ${BINS}.0 * 2.0 - 1.0, 0.0, 0.0, 1.0);
        gl_PointSize = 1.0;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uWeight;
      varying vec2 vField;
      void main() { gl_FragColor = vec4(vField * uWeight, 0.0, 1.0); }`,
  });
  const histogramPoints = new Points(sampleGeometry, histogramMaterial);
  histogramPoints.frustumCulled = false;
  const curveMaterial = new ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { tHistogram: { value: histogram.texture } },
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      uniform sampler2D tHistogram;
      void main() {
        // The share of grains below this bin's middle: every bin before it, and half of its own.
        float here = floor(gl_FragCoord.x);
        vec2 below = vec2(0.0), total = vec2(0.0);
        for (int i = 0; i < ${BINS}; i++) {
          vec2 h = texture2D(tHistogram, vec2((float(i) + 0.5) / ${BINS}.0, 0.5)).rg;
          total += h;
          below += h * (float(i) < here ? 1.0 : float(i) == here ? 0.5 : 0.0);
        }
        gl_FragColor = vec4(below / max(total, vec2(1e-6)), 0.0, 1.0);
      }`,
  });
  const curveQuad = new Mesh(new PlaneGeometry(2, 2), curveMaterial);
  curveQuad.frustumCulled = false;
  const histogramScene = new Scene().add(histogramPoints);
  const curveScene = new Scene().add(curveQuad);
  const passCamera = new Camera();
  const clearColour = new Vector3();
  function measureColours(time) {
    const before = renderer.getRenderTarget();
    const alpha = renderer.getClearAlpha();
    renderer.getClearColor(clearColour);
    histogramMaterial.uniforms.tPosition.value = gpu.getCurrentRenderTarget(position).texture;
    histogramMaterial.uniforms.uTime.value = time;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(histogram);
    renderer.clear();
    renderer.render(histogramScene, passCamera);
    renderer.setRenderTarget(curve);
    renderer.render(curveScene, passCamera);
    renderer.setRenderTarget(before);
    renderer.setClearColor(clearColour, alpha);
  }


  return {
    size,
    count: size * size,
    // live: the eased control values. stir: { origin, direction, velocity } in cube space.
    // breath: the measured breath at this moment ({ swell, drift, swirl, energy }), scaled by live.pulse.
    step(dt, live, source, stir, breath = null, towardCamera = null) {
      const speed = 0.06 + live.flow * 0.62;
      // The swirls change faster when the smoke moves faster, so fast smoke churns
      // instead of racing along fixed paths. At the studio's usual speed the pace is 1.
      time += dt * (0.5 + speed * 1.5);
      vu.uTime.value = pu.uTime.value = du.uTime.value = time;
      vu.uDt.value = pu.uDt.value = du.uDt.value = dt;
      vu.uSource.value = pu.uSource.value = sources[source];
      vu.uSpeed.value = speed;
      vu.uTurbulence.value = live.turbulence;
      vu.uSpread.value = pu.uSpread.value = live.spread;
      vu.uRebound.value = live.rebound;
      vu.uGather.value = pu.uGather.value = live.gather;
      vu.uPulse.value = pu.uPulse.value = breath ? live.pulse : 0;
      if (breath) {
        vu.uSwell.value = breath.swell;
        vu.uDrift.value = breath.drift;
        vu.uSwirl.value = breath.swirl;
        vu.uEnergy.value = breath.energy;
        vu.uHold.value = breath.hold;
      }
      if (towardCamera) vu.uTowardCamera.value.copy(towardCamera);
      vu.uEscape.value = pu.uEscape.value = live.escape;
      if (stir) {
        vu.uRayOrigin.value.copy(stir.origin);
        vu.uRayDirection.value.copy(stir.direction);
        vu.uStir.value.copy(stir.velocity);
      }
      measureColours(time);
      du.tCdf.value = curve.texture;
      gpu.compute();
      du.uSnap.value = 0;
    },
    // Every pass a step draws, compiled ahead (compile.js): nothing is drawn and nothing moves on.
    compile() {
      return compileAhead(renderer, () => {
        for (const v of [velocity, position, dye]) gpu.doRenderTarget(v.material, v.renderTargets[0]);
        measureColours(time);
      });
    },
    // The simulation's own clock, so a copy can replay the same steps (the loop recording).
    get time() { return time; },
    // Take over another simulation's grains and clock (same size): from here both run the same steps.
    copyFrom(other) {
      gpu.renderTexture(other.positions, gpu.getCurrentRenderTarget(position));
      gpu.renderTexture(other.velocities, gpu.getCurrentRenderTarget(velocity));
      gpu.renderTexture(other.dyes, gpu.getCurrentRenderTarget(dye));
      time = other.time;
    },
    get positionTarget() {
      return gpu.getCurrentRenderTarget(position);
    },
    get velocityTarget() {
      return gpu.getCurrentRenderTarget(velocity);
    },
    get positions() {
      return gpu.getCurrentRenderTarget(position).texture;
    },
    get velocities() {
      return gpu.getCurrentRenderTarget(velocity).texture;
    },
    // For checks: the dye's render target and the colour curve.
    get dyeTarget() {
      return gpu.getCurrentRenderTarget(dye);
    },
    get colourCurve() {
      return curve;
    },
    // Each grain's place on the colour map, as (cos, sin) of its hue phase and of its light phase.
    get dyes() {
      return gpu.getCurrentRenderTarget(dye).texture;
    },
    dispose() {
      gpu.dispose();
      histogram.dispose();
      curve.dispose();
      sampleGeometry.dispose();
      histogramMaterial.dispose();
      curveMaterial.dispose();
      curveQuad.geometry.dispose();
    },
  };
}
