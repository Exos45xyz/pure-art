import {
  BufferAttribute,
  DataTexture,
  BufferGeometry,
  CustomBlending,
  HalfFloatType,
  LinearFilter,
  Matrix4,
  Mesh,
  OneFactor,
  OrthographicCamera,
  PerspectiveCamera,
  Vector2,
  Vector3,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  WebGLRenderTarget,
} from 'three';

// How the grains are drawn: each one is a soft dot of smoke lit by one studio lamp, a point light up
// and to the left of the camera, in front of the cube. The light is physical: it falls off with the
// square of the distance, the smoke between a grain and the lamp shades it, and the smoke between a
// grain and the camera hides it. Both come from opacity maps (Kim & Neumann 2001): the smoke's density
// seen from an eye (the lamp, or the camera), in 16 slices across the cube's bounding sphere, each
// summed with every slice in front of it.

const TILE = 64;
const GRID = 4;
const ATLAS = TILE * GRID;
// The cube's bounding sphere, a little generous: every corner is √3 ≈ 1.732 from the middle.
const REACH = 1.75;
// The lamp, seen from the camera: up and to the left, a little in front of the cube, 4.5 from its
// middle, like the reference clip's key light. It turns with the camera, like a studio light with the
// cube turning under it.
const LAMP = new Vector3(-0.7, 0.65, 0.35).normalize().multiplyScalar(4.5);
// The shadows slider sets how dense the smoke is. Light from the lamp is shaded by 1.6 times that
// density, so its shadows read clearly; the camera sees through 0.8 times it, so thick smoke hides
// what is behind it while thin veils stay see-through.
const LAMP_DENSITY = 1.6;
const SEEN_DENSITY = 0.8;

// The opacity maps' shared GLSL: where a point falls in an eye's map, and how much smoke lies between
// it and that eye. lens = (tan of the half-angle that fits the sphere, or 0 for a flat lens; distance
// from the eye to the cube's middle).
export const opacityGlsl = /* glsl */ `
uniform sampler2D tLightMap;
uniform mat4 uLightEye;
uniform vec2 uLightLens;
uniform sampler2D tViewMap;
uniform mat4 uViewEye;
uniform vec2 uViewLens;
uniform vec3 uLamp;
uniform float uLampDist2;
uniform float uShadow;
vec3 mapCoord(vec3 p, mat4 eye, vec2 lens) {
  vec3 e = (eye * vec4(p, 1.0)).xyz;
  float depth = -e.z;
  vec2 uv = (lens.x > 0.0 ? e.xy / (max(depth, 0.1) * lens.x) : e.xy / ${REACH.toFixed(3)}) * 0.5 + 0.5;
  return vec3(uv, (depth - lens.y + ${REACH.toFixed(3)}) / ${(2 * REACH).toFixed(3)} * 16.0);
}
vec2 sliceUv(float slice, vec2 local) {
  return (vec2(mod(slice, ${GRID}.0), floor(slice / ${GRID}.0)) + local) / ${GRID}.0;
}
float smokeBetween(sampler2D map, mat4 eye, vec2 lens, vec3 p) {
  vec3 m = mapCoord(p, eye, lens);
  vec2 local = clamp(m.xy, 0.5 / ${TILE}.0, 1.0 - 0.5 / ${TILE}.0);
  float s = clamp(m.z - 0.5, 0.0, 15.0);
  float s0 = floor(s);
  float s1 = min(s0 + 1.0, 15.0);
  return mix(texture2D(map, sliceUv(s0, local)).r, texture2D(map, sliceUv(s1, local)).r, s - s0);
}
// The lamp's light at p: 1 at the cube's middle with no smoke in the way.
float lampLight(vec3 p) {
  vec3 toLamp = uLamp - p;
  return uLampDist2 / dot(toLamp, toLamp) * exp(-smokeBetween(tLightMap, uLightEye, uLightLens, p) * uShadow * ${LAMP_DENSITY.toFixed(2)});
}
// How much of p the camera still sees through the smoke in front of it.
float seenThrough(vec3 p) {
  return exp(-smokeBetween(tViewMap, uViewEye, uViewLens, p) * uShadow * ${SEEN_DENSITY.toFixed(2)});
}
`;

// The lamp and the two maps. The cube's edges read the same uniforms, so they are lit and hidden by
// the same smoke. type: FloatType where the GPU can blend into it; with millions of faint grains, half
// floats lose the small additions once a cell is dense.
export function createLighting(type = HalfFloatType) {
  const target = () => new WebGLRenderTarget(ATLAS, ATLAS, {
    type, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter,
  });
  const maps = {
    light: { density: target(), sum: target(), eye: new Matrix4(), lens: new Vector2() },
    view: { density: target(), sum: target(), eye: new Matrix4(), lens: new Vector2() },
  };
  const uniforms = {
    tLightMap: { value: maps.light.sum.texture },
    uLightEye: { value: maps.light.eye },
    uLightLens: { value: maps.light.lens },
    tViewMap: { value: maps.view.sum.texture },
    uViewEye: { value: maps.view.eye },
    uViewLens: { value: maps.view.lens },
    uLamp: { value: new Vector3() },
    uLampDist2: { value: LAMP.lengthSq() },
    uShadow: { value: 1 },
  };
  const lampCamera = new PerspectiveCamera();
  // An eye's lens fits the bounding sphere: a cone just wide enough, or the flat lens's square.
  const fit = (lens, distance, perspective) => lens.set(perspective ? Math.tan(Math.asin(Math.min(REACH / distance, 0.99))) : 0, distance);
  return {
    maps,
    uniforms,
    // camera: the view's camera, already placed for this frame. shadows: the eased slider.
    update(camera, shadows) {
      camera.updateMatrixWorld();
      uniforms.uLamp.value.copy(LAMP).applyQuaternion(camera.quaternion);
      lampCamera.position.copy(uniforms.uLamp.value);
      lampCamera.up.copy(camera.up);
      lampCamera.lookAt(0, 0, 0);
      lampCamera.updateMatrixWorld();
      maps.light.eye.copy(lampCamera.matrixWorldInverse);
      fit(maps.light.lens, LAMP.length(), true);
      maps.view.eye.copy(camera.matrixWorldInverse);
      fit(maps.view.lens, camera.position.length(), camera.isPerspectiveCamera);
      uniforms.uShadow.value = shadows * 2.4;
    },
    dispose() {
      for (const m of Object.values(maps)) {
        m.density.dispose();
        m.sum.dispose();
      }
    },
  };
}


const white = new DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
white.needsUpdate = true;

const fade = /* glsl */ `
// Fade in slowly, so a newborn cloud is already spreading by the time it shows.
float lifeFade(float age) { return smoothstep(0.0, 0.25, age) * (1.0 - smoothstep(0.7, 1.0, age)); }
`;

function grainGeometry(size) {
  // Each point only carries where its grain lives in the simulation textures.
  const refs = new Float32Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3;
      refs[i] = (x + 0.5) / size;
      refs[i + 1] = (y + 0.5) / size;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(refs, 3));
  return geometry;
}

const additive = {
  transparent: true,
  depthTest: false,
  depthWrite: false,
  blending: CustomBlending,
  blendSrc: OneFactor,
  blendDst: OneFactor,
};

// lighting: from createLighting, shared with the cube's edges.
export function createSmoke(size, lighting) {
  const count = size * size;
  const geometry = grainGeometry(size);
  // Keep the look the same at any particle count: more grains, each a little fainter.
  const share = 262144 / count;

  // 1. Density seen from each eye: every grain lands in the slice at its depth, at its place in the
  // eye's view. Weighted so a cell holds the same smoke per unit of area whatever the eye.
  const splat = (map) => {
    const material = new ShaderMaterial({
      ...additive,
      uniforms: { ...lighting.uniforms, tPosition: { value: null }, uWeight: { value: 0 }, uEye: { value: map.eye }, uLens: { value: map.lens } },
      vertexShader: /* glsl */ `
        uniform sampler2D tPosition;
        uniform float uWeight;
        uniform mat4 uEye;
        uniform vec2 uLens;
        varying float vWeight;
        ${fade}
        ${opacityGlsl}
        void main() {
          vec4 pos = texture2D(tPosition, position.xy);
          vec3 p = pos.xyz;
          vec3 m = mapCoord(p, uEye, uLens);
          float inside = step(max(abs(p.x), max(abs(p.y), abs(p.z))), 1.0);
          float onMap = step(0.0, m.x) * step(m.x, 1.0) * step(0.0, m.y) * step(m.y, 1.0);
          float slice = floor(clamp(m.z, 0.0, 15.999));
          vec2 atlas = sliceUv(slice, clamp(m.xy, 0.0, 0.999));
          gl_Position = vec4(atlas * 2.0 - 1.0, 0.0, 1.0);
          gl_PointSize = 1.0;
          vWeight = uWeight * lifeFade(pos.w) * inside * onMap;
        }`,
      fragmentShader: /* glsl */ `
        varying float vWeight;
        void main() { gl_FragColor = vec4(vWeight, 0.0, 0.0, 1.0); }`,
    });
    const scene = new Scene();
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    scene.add(points);
    return { material, scene };
  };
  const splats = { light: splat(lighting.maps.light), view: splat(lighting.maps.view) };
  // The smoke's density scale: 0.03 per grain in a cell 2/64 of a unit across, kept per unit of area.
  const cellArea = (lens) => (2 * (lens.x > 0 ? lens.y * lens.x : REACH) / TILE) ** 2;
  const weight = (lens) => (0.03 * share * (2 / 64) ** 2) / cellArea(lens);

  // 2. How much smoke lies in front of each slice: the sum of every slice before it, softened a little.
  const sumMaterial = new ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: { tDensity: { value: null } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDensity;
      varying vec2 vUv;
      float tap(vec2 tile, vec2 local) {
        vec2 lo = (tile * ${TILE}.0 + 0.5) / ${ATLAS}.0;
        vec2 hi = (tile * ${TILE}.0 + ${TILE}.0 - 0.5) / ${ATLAS}.0;
        vec2 uv = (tile + local) / ${GRID}.0;
        vec2 o = vec2(1.5 / ${ATLAS}.0, 0.0);
        return texture2D(tDensity, clamp(uv, lo, hi)).r * 0.4
          + texture2D(tDensity, clamp(uv + o.xy, lo, hi)).r * 0.15
          + texture2D(tDensity, clamp(uv - o.xy, lo, hi)).r * 0.15
          + texture2D(tDensity, clamp(uv + o.yx, lo, hi)).r * 0.15
          + texture2D(tDensity, clamp(uv - o.yx, lo, hi)).r * 0.15;
      }
      void main() {
        vec2 px = vUv * ${ATLAS}.0;
        vec2 tile = floor(px / ${TILE}.0);
        vec2 local = (px - tile * ${TILE}.0) / ${TILE}.0;
        float slice = tile.x + tile.y * ${GRID}.0;
        float sum = 0.0;
        for (int i = 0; i < 16; i++) {
          float fi = float(i);
          if (fi > slice) break;
          sum += tap(vec2(mod(fi, ${GRID}.0), floor(fi / ${GRID}.0)), local) * (fi == slice ? 0.5 : 1.0);
        }
        gl_FragColor = vec4(sum, 0.0, 0.0, 1.0);
      }`,
  });
  const sumScene = new Scene();
  const sumQuad = new Mesh(new PlaneGeometry(2, 2), sumMaterial);
  sumQuad.frustumCulled = false;
  sumScene.add(sumQuad);
  const flatCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // 3. The grains themselves, accumulated as light in a float buffer.
  const material = new ShaderMaterial({
    ...additive,
    uniforms: {
      ...lighting.uniforms,
      tPosition: { value: null },
      tVelocity: { value: null },
      tDye: { value: null },
      uSize: { value: 0.006 },
      uHeight: { value: 1000 },
      uAlpha: { value: 0.1 },
      uBlur: { value: 0 },
      uFocusDepth: { value: 11.5 },
      uOutline: { value: Array.from({ length: 6 }, () => new Vector3(0, 0, 1)) },
      uOutlineSides: { value: 0 },
      tColour: { value: white },
      uRibbon: { value: new Vector3(1, 1, 1) },
      uColour: { value: 0 },
      uColourGain: { value: 1 },
      // The palette the grains are turning from, and how far the turn is (1 = done).
      tColourFrom: { value: white },
      uRibbonFrom: { value: new Vector3(1, 1, 1) },
      uColourGainFrom: { value: 1 },
      uTurn: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform sampler2D tPosition;
      uniform sampler2D tVelocity;
      uniform sampler2D tDye;
      uniform float uSize;
      uniform float uHeight;
      uniform float uAlpha;
      uniform float uBlur;
      uniform float uFocusDepth;
      uniform sampler2D tColour;
      uniform vec3 uRibbon;
      uniform float uColour;
      uniform float uColourGain;
      uniform sampler2D tColourFrom;
      uniform vec3 uRibbonFrom;
      uniform float uColourGainFrom;
      uniform float uTurn;
      varying float vAlpha;
      varying float vLight;
      varying float vSoft;
      varying vec3 vColour;
      ${fade}
      ${opacityGlsl}
      // The colour at a place along a palette's ribbon (palette.js).
      vec3 ribbonColour(sampler2D map, vec3 ribbon, float gain, float along) {
        float idx = min(floor(along * ribbon.z), ribbon.z - 1.0);
        vec2 uv = (vec2(mod(idx, ribbon.x), floor(idx / ribbon.x)) + 0.5) / ribbon.xy;
        return texture2D(map, uv).rgb * gain;
      }
      void main() {
        vec4 pos = texture2D(tPosition, position.xy);
        float seed = texture2D(tVelocity, position.xy).w;
        vec3 p = pos.xyz;
        vec4 view = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * view;

        // Perspective grains shrink with distance; orthographic ones (the flat lens) don't.
        float perspective = projectionMatrix[3][3] == 0.0 ? 1.0 / -view.z : 1.0;
        float px = uSize * (0.6 + 0.8 * seed) * uHeight * projectionMatrix[1][1] * 0.5 * perspective;
        float reach = max(abs(p.x), max(abs(p.y), abs(p.z)));
        float alpha = uAlpha * lifeFade(pos.w) * (1.0 - smoothstep(1.0, 1.7, reach));
        // Below 1.6 px a dot would shimmer; keep the size and dim it by the area it lost instead.
        if (px < 1.6) { alpha *= px * px / 2.56; px = 1.6; }

        // Depth of field: away from the focus plane a grain opens into a soft disc. It keeps the same
        // total light, so blurred smoke gets softer, not brighter.
        float coc = min(uBlur * abs(-view.z - uFocusDepth) * 18.0, 28.0) * uHeight / 1280.0;
        float blurred = sqrt(px * px + coc * coc);
        alpha *= (px * px) / (blurred * blurred);
        vSoft = coc / blurred;
        gl_PointSize = blurred;

        // The lamp's light, shaded by the smoke on its way in; then hidden by the smoke in front of it.
        vLight = 0.06 + 0.94 * lampLight(p);
        vAlpha = alpha * seenThrough(p);
        // The grain's colour: the pigment it carries (simulation.js), a phase that walks the image's
        // colour ribbon up and back down, so neighbouring phases are neighbouring colours. A touch of
        // the seed gives each grain its own shade within its region's colour.
        vec2 dye = texture2D(tDye, position.xy).xy;
        float phase = atan(dye.y, dye.x) / 6.2831853 + 0.5 + (seed - 0.5) * 0.03;
        float along = 1.0 - abs(2.0 * fract(phase) - 1.0);
        vec3 pigment = ribbonColour(tColour, uRibbon, uColourGain, along);
        // Turning to a new palette, every grain crossfades from its colour in the old one.
        if (uTurn < 1.0) pigment = mix(ribbonColour(tColourFrom, uRibbonFrom, uColourGainFrom, along), pigment, uTurn);
        vColour = mix(vec3(1.0), pigment, uColour);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uOutline[6];
      uniform float uOutlineSides;
      varying float vAlpha;
      varying float vLight;
      varying float vSoft;
      varying vec3 vColour;
      void main() {
        // The cube's outline on screen: any part of a dot beyond it is not drawn, so the smoke never
        // shows outside the glass, and every grain keeps its own shape and softness.
        for (int i = 0; i < 6; i++) {
          if (float(i) < uOutlineSides && dot(uOutline[i], vec3(gl_FragCoord.xy, 1.0)) < 0.0) discard;
        }
        vec2 c = gl_PointCoord - 0.5;
        float d = dot(c, c) * 4.0;
        if (d > 1.0) discard;
        // In focus a soft dot; out of focus a flatter disc with a soft rim, scaled to the same light.
        float dot_ = exp(-d * 3.0);
        float disc = (1.0 - smoothstep(0.45, 1.0, d)) * 0.42;
        gl_FragColor = vec4(vColour * (vLight * vAlpha * mix(dot_, disc, vSoft)), 1.0);
      }`,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  let colours = null;

  return {
    object: points,
    // live: eased control values. height: drawing-buffer height in pixels. camera: for the focus plane.
    update(simulation, live, height, camera) {
      material.uniforms.uBlur.value = live.blur;
      // Focus 0.5 is the middle of the cube; 0 and 1 reach just past its front and back corners.
      material.uniforms.uFocusDepth.value = camera.position.length() + (0.5 - live.focus) * -3.6;
      for (const { material: m } of Object.values(splats)) m.uniforms.tPosition.value = simulation.positions;
      material.uniforms.tPosition.value = simulation.positions;
      material.uniforms.tVelocity.value = simulation.velocities;
      material.uniforms.tDye.value = simulation.dyes;
      material.uniforms.uHeight.value = height;
      // Linear up to 0.6, then steeper, so the top of the slider reaches the original's big grains.
      material.uniforms.uSize.value = 0.0035 + live.grain * 0.009 + 0.1944 * Math.max(live.grain - 0.6, 0) ** 2;
      // Bigger grains cover more pixels each; keep the total light the same. Smoke in front hides what
      // is behind it, so each grain carries enough light for the picture to keep its brightness.
      material.uniforms.uAlpha.value = (2.0 * share * 0.0071 * 0.0071) / (material.uniforms.uSize.value ** 2);
    },
    // ribbon: the image's colour ribbon (palette.js), or null for white. gain: lifts dark images so
    // the smoke keeps about the brightness it has in white. turn: the grains turn from the palette
    // they wear to this one (see turnColours) instead of changing in one frame.
    setColours(ribbon, gain = 1, turn = false) {
      const u = material.uniforms;
      const next = ribbon?.texture ?? null;
      if (next === colours) return;
      if (turn && colours && next) {
        // Turn from what the grains mostly wear: past halfway through a turn, that is its new palette.
        if (u.uTurn.value >= 0.5) {
          u.tColourFrom.value = colours;
          u.uRibbonFrom.value.copy(u.uRibbon.value);
          u.uColourGainFrom.value = u.uColourGain.value;
        }
        u.uTurn.value = 0;
      } else {
        this.endTurn();
      }
      colours = next;
      u.tColour.value = colours ?? white;
      if (ribbon) u.uRibbon.value.set(ribbon.width, ribbon.height, ribbon.count);
      u.uColourGain.value = gain;
    },
    // Move a palette turn on by dt seconds. It eases like the change to and from white (main.js).
    turnColours(dt) {
      const u = material.uniforms;
      if (u.uTurn.value >= 1) return;
      u.uTurn.value += (1 - u.uTurn.value) * (1 - Math.exp(-dt * 6));
      if (u.uTurn.value > 0.998) this.endTurn();
    },
    endTurn() {
      material.uniforms.uTurn.value = 1;
      material.uniforms.tColourFrom.value = white;
    },
    // A palette the grains may still be turning from, so its texture must stay alive.
    get turning() { return material.uniforms.uTurn.value < 1; },
    // The cube's outline in drawing-buffer pixels: up to 6 lines a*x + b*y + c >= 0 inside.
    setOutline(lines) {
      lines.forEach((l, i) => material.uniforms.uOutline.value[i].copy(l));
      material.uniforms.uOutlineSides.value = lines.length;
    },
    // 0 = white, 1 = the image's colours; eased by the caller.
    set colourMix(value) {
      material.uniforms.uColour.value = colours ? value : 0;
    },
    // Fill both opacity maps for this frame; lighting.update has placed the lamp and the camera.
    renderShadow(renderer) {
      renderer.setClearColor(0x000000, 0);
      for (const [name, { material: m, scene }] of Object.entries(splats)) {
        const map = lighting.maps[name];
        m.uniforms.uWeight.value = weight(map.lens);
        renderer.setRenderTarget(map.density);
        renderer.clear();
        renderer.render(scene, flatCamera);
        sumMaterial.uniforms.tDensity.value = map.density.texture;
        renderer.setRenderTarget(map.sum);
        renderer.render(sumScene, flatCamera);
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      for (const { material: m } of Object.values(splats)) m.dispose();
      sumMaterial.dispose();
    },
  };
}
