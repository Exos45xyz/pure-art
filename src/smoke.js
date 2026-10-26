import {
  BufferAttribute,
  DataTexture,
  BufferGeometry,
  CustomBlending,
  HalfFloatType,
  LinearFilter,
  Mesh,
  OneFactor,
  OrthographicCamera,
  Vector3,
  PlaneGeometry,
  Points,
  Scene,
  ShaderMaterial,
  WebGLRenderTarget,
} from 'three';

// How the grains are drawn: each one is a soft dot, lit from above. The light is dimmed by
// the smoke above it, read from a stack of 16 horizontal density slices (an opacity shadow map).

const TILE = 64;
const GRID = 4;
const ATLAS = TILE * GRID;

const shadowLookup = /* glsl */ `
uniform sampler2D tShadow;
vec2 sliceUv(float slice, vec2 local) {
  return (vec2(mod(slice, 4.0), floor(slice / 4.0)) + local) / 4.0;
}
float opticalDepth(vec3 p) {
  vec2 local = clamp(p.xz * 0.5 + 0.5, 0.5 / 64.0, 63.5 / 64.0);
  float s = clamp((1.0 - p.y) * 8.0 - 0.5, 0.0, 15.0);
  float s0 = floor(s);
  float s1 = min(s0 + 1.0, 15.0);
  float d = mix(texture2D(tShadow, sliceUv(s0, local)).r, texture2D(tShadow, sliceUv(s1, local)).r, s - s0);
  return d * smoothstep(1.04, 0.98, p.y);
}
`;

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

// type: FloatType where the GPU can blend into it. With millions of faint grains, half floats lose the
// small additions once a pixel is bright, so dense smoke would band.
export function createSmoke(size, type = HalfFloatType) {
  const count = size * size;
  const geometry = grainGeometry(size);
  // Keep the look the same at any particle count: more grains, each a little fainter.
  const share = 262144 / count;

  // 1. Density, sliced along the light.
  const densityTarget = new WebGLRenderTarget(ATLAS, ATLAS, {
    type, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter,
  });
  const densityMaterial = new ShaderMaterial({
    ...additive,
    uniforms: { tPosition: { value: null }, uWeight: { value: 0.03 * share } },
    vertexShader: /* glsl */ `
      uniform sampler2D tPosition;
      uniform float uWeight;
      varying float vWeight;
      ${fade}
      void main() {
        vec4 pos = texture2D(tPosition, position.xy);
        vec3 p = pos.xyz;
        float inside = step(max(abs(p.x), max(abs(p.y), abs(p.z))), 1.0);
        float slice = floor(clamp((1.0 - p.y) * 8.0, 0.0, 15.999));
        vec2 local = clamp(p.xz * 0.5 + 0.5, 0.0, 0.999);
        vec2 atlas = (vec2(mod(slice, 4.0), floor(slice / 4.0)) + local) / 4.0;
        gl_Position = vec4(atlas * 2.0 - 1.0, 0.0, 1.0);
        gl_PointSize = 1.0;
        vWeight = uWeight * lifeFade(pos.w) * inside;
      }`,
    fragmentShader: /* glsl */ `
      varying float vWeight;
      void main() { gl_FragColor = vec4(vWeight, 0.0, 0.0, 1.0); }`,
  });
  const densityScene = new Scene();
  const densityPoints = new Points(geometry, densityMaterial);
  densityPoints.frustumCulled = false;
  densityScene.add(densityPoints);

  // 2. Light reaching each slice: the sum of everything above it, softened a little.
  const shadowTarget = new WebGLRenderTarget(ATLAS, ATLAS, {
    type, depthBuffer: false, minFilter: LinearFilter, magFilter: LinearFilter,
  });
  const sumMaterial = new ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    uniforms: { tDensity: { value: densityTarget.texture } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDensity;
      varying vec2 vUv;
      float tap(vec2 tile, vec2 local) {
        vec2 lo = (tile * 64.0 + 0.5) / 256.0;
        vec2 hi = (tile * 64.0 + 63.5) / 256.0;
        vec2 uv = (tile + local) / 4.0;
        vec2 o = vec2(1.5 / 256.0, 0.0);
        return texture2D(tDensity, clamp(uv, lo, hi)).r * 0.4
          + texture2D(tDensity, clamp(uv + o.xy, lo, hi)).r * 0.15
          + texture2D(tDensity, clamp(uv - o.xy, lo, hi)).r * 0.15
          + texture2D(tDensity, clamp(uv + o.yx, lo, hi)).r * 0.15
          + texture2D(tDensity, clamp(uv - o.yx, lo, hi)).r * 0.15;
      }
      void main() {
        vec2 px = vUv * 256.0;
        vec2 tile = floor(px / 64.0);
        vec2 local = (px - tile * 64.0) / 64.0;
        float slice = tile.x + tile.y * 4.0;
        float sum = 0.0;
        for (int i = 0; i < 16; i++) {
          float fi = float(i);
          if (fi > slice) break;
          sum += tap(vec2(mod(fi, 4.0), floor(fi / 4.0)), local) * (fi == slice ? 0.5 : 1.0);
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
      tPosition: { value: null },
      tVelocity: { value: null },
      tShadow: { value: shadowTarget.texture },
      uSize: { value: 0.006 },
      uHeight: { value: 1000 },
      uAlpha: { value: 0.1 },
      uShadow: { value: 1 },
      uBlur: { value: 0 },
      uFocusDepth: { value: 11.5 },
      uOutline: { value: Array.from({ length: 6 }, () => new Vector3(0, 0, 1)) },
      uOutlineSides: { value: 0 },
      tColour: { value: white },
      uRibbon: { value: new Vector3(1, 1, 1) },
      uColourClock: { value: 0 },
      uColour: { value: 0 },
      uColourGain: { value: 1 },
    },
    vertexShader: /* glsl */ `
      uniform sampler2D tPosition;
      uniform sampler2D tVelocity;
      uniform float uSize;
      uniform float uHeight;
      uniform float uAlpha;
      uniform float uShadow;
      uniform float uBlur;
      uniform float uFocusDepth;
      uniform sampler2D tColour;
      uniform vec3 uRibbon;
      uniform float uColourClock;
      uniform float uColour;
      uniform float uColourGain;
      varying float vAlpha;
      varying float vLight;
      varying float vSoft;
      varying vec3 vColour;
      ${fade}
      ${shadowLookup}
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

        vLight = 0.06 + 0.94 * exp(-opticalDepth(p) * uShadow);
        vAlpha = alpha;
        // The grain's colour: where the image's colour ribbon was when it was born. The ribbon turns
        // once every 6 s, so smoke born together shares a colour; a little of the seed keeps it lively.
        float birth = uColourClock - pos.w * mix(3.0, 7.0, seed);
        float along = fract(birth / 6.0 + seed * 0.12);
        float idx = floor(along * uRibbon.z);
        vec2 ribbonUv = (vec2(mod(idx, uRibbon.x), floor(idx / uRibbon.x)) + 0.5) / uRibbon.xy;
        vColour = mix(vec3(1.0), texture2D(tColour, ribbonUv).rgb * uColourGain, uColour);
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
      densityMaterial.uniforms.tPosition.value = simulation.positions;
      material.uniforms.tPosition.value = simulation.positions;
      material.uniforms.tVelocity.value = simulation.velocities;
      material.uniforms.uHeight.value = height;
      // Linear up to 0.6, then steeper, so the top of the slider reaches the original's big grains.
      material.uniforms.uSize.value = 0.0035 + live.grain * 0.009 + 0.1944 * Math.max(live.grain - 0.6, 0) ** 2;
      // Bigger grains cover more pixels each; keep the total light the same.
      material.uniforms.uAlpha.value = (0.8 * share * 0.0071 * 0.0071) / (material.uniforms.uSize.value ** 2);
      material.uniforms.uShadow.value = live.shadows * 2.4;
    },
    // ribbon: the image's colour ribbon (palette.js), or null for white. gain: lifts dark images so
    // the smoke keeps about the brightness it has in white.
    setColours(ribbon, gain = 1) {
      colours = ribbon?.texture ?? null;
      material.uniforms.tColour.value = colours ?? white;
      if (ribbon) material.uniforms.uRibbon.value.set(ribbon.width, ribbon.height, ribbon.count);
      material.uniforms.uColourGain.value = gain;
    },
    // The cube's outline in drawing-buffer pixels: up to 6 lines a*x + b*y + c >= 0 inside.
    setOutline(lines) {
      lines.forEach((l, i) => material.uniforms.uOutline.value[i].copy(l));
      material.uniforms.uOutlineSides.value = lines.length;
    },
    set colourClock(seconds) {
      material.uniforms.uColourClock.value = seconds;
    },
    // 0 = white, 1 = the image's colours; eased by the caller.
    set colourMix(value) {
      material.uniforms.uColour.value = colours ? value : 0;
    },
    renderShadow(renderer) {
      renderer.setRenderTarget(densityTarget);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(densityScene, flatCamera);
      renderer.setRenderTarget(shadowTarget);
      renderer.render(sumScene, flatCamera);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      densityMaterial.dispose();
      sumMaterial.dispose();
      densityTarget.dispose();
      shadowTarget.dispose();
    },
  };
}
