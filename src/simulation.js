import { HalfFloatType, Vector3 } from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import { hash, noise } from './glsl.js';

// The smoke lives on the GPU: one texel per grain, in two textures.
// position = xyz inside the cube (-1..1) and w = age (0 at birth, 1 at death)
// velocity = xyz and w = a fixed random seed

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
  float open = d < 0.0 ? 1.0 : openness(p, t);
  const float W = 0.35;
  float R = mix(ramp(d / W), 1.0, open);
  // The ramp's own term is softened: the flow still only runs along the glass, with gentler
  // currents next to it.
  float slope = (1.0 - open) * rampSlope(clamp(d / W, 0.0, 1.0)) / W * 0.6;

  // Calm smoke turns in bigger rolls; turbulent smoke in smaller ones.
  vec3 v = octave(p, mix(0.55, 0.95, uTurbulence), vec3(0.0, t * 0.06, t * 0.035), R, slope, gradD);
  v += octave(p, 1.9, vec3(t * 0.11, 3.7, -t * 0.08), R, slope, gradD) * 0.65 * uTurbulence;
  v += octave(p, 4.3, vec3(-7.1, t * 0.19, t * 0.15), R, slope, gradD) * 0.4 * uTurbulence * uTurbulence;
  vec3 target = v * uSpeed;
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
    // While the pulse pushes, the bodies let go.
    float hold = uGather * (1.0 - 0.95 * min(uPulse, 1.0));
    target += toCentre * hold * 3.36 - cross(axis, toCentre) * hold * 2.24;
    // The pulse: the mass swells until it fills the glass. Each grain moves in proportion to its
    // distance from the middle, so the whole shape scales up and fills the cube instead of
    // leaving it hollow; the glass then holds it flat against the faces.
    vec3 swell = p - c * 0.4;
    // About 2.6 per second over the push: the mass grows two to three times, just enough to reach
    // the glass.
    target += swell * uPulse * 2.6 * (1.0 - smoothstep(0.85, 1.0, max(a.x, max(a.y, a.z))));
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

  // A grain that was just born takes the current at once; the others ease into it.
  float response = pos.w < 0.015 ? 1.0 : 1.0 - exp(-uDt * 9.0);
  gl_FragColor = vec4(mix(vel.xyz, target, response), vel.w);
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
  if (before < 1.0 && reach >= 0.995 && openness(p, uTime) < 0.5) {
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

  const velocity = gpu.addVariable('textureVelocity', velocityShader, velocity0);
  const position = gpu.addVariable('texturePosition', positionShader, position0);
  gpu.setVariableDependencies(velocity, [velocity, position]);
  gpu.setVariableDependencies(position, [velocity, position]);

  Object.assign(velocity.material.uniforms, {
    uTime: { value: 0 },
    uDt: { value: 0 },
    uSpeed: { value: 0 },
    uTurbulence: { value: 0 },
    uSpread: { value: 0 },
    uGather: { value: 0 },
    uPulse: { value: 0 },
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
    uEscape: { value: 0 },
  });

  const error = gpu.init();
  if (error) throw new Error(error);

  const vu = velocity.material.uniforms;
  const pu = position.material.uniforms;
  let time = Math.random() * 100;

  return {
    size,
    count: size * size,
    // live: the eased control values. stir: { origin, direction, velocity } in cube space.
    // pulse: how hard the smoke is pushed out right now (0 = not at all).
    step(dt, live, source, stir, pulse = 0) {
      const speed = 0.06 + live.flow * 0.62;
      // The swirls change faster when the smoke moves faster, so fast smoke churns
      // instead of racing along fixed paths. At the studio's usual speed the pace is 1.
      time += dt * (0.5 + speed * 1.5);
      vu.uTime.value = pu.uTime.value = time;
      vu.uDt.value = pu.uDt.value = dt;
      vu.uSource.value = pu.uSource.value = sources[source];
      vu.uSpeed.value = speed;
      vu.uTurbulence.value = live.turbulence;
      vu.uSpread.value = pu.uSpread.value = live.spread;
      vu.uGather.value = pu.uGather.value = live.gather;
      vu.uPulse.value = pu.uPulse.value = pulse;
      vu.uEscape.value = pu.uEscape.value = live.escape;
      if (stir) {
        vu.uRayOrigin.value.copy(stir.origin);
        vu.uRayDirection.value.copy(stir.direction);
        vu.uStir.value.copy(stir.velocity);
      }
      gpu.compute();
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
    dispose() {
      gpu.dispose();
    },
  };
}
