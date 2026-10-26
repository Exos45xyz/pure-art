// The last pass: turns the accumulated light into the final image.
// Soft highlight roll-off, a black studio with a faint lift behind the cube, film grain.

export const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null },
    uExposure: { value: 1 },
    uFilm: { value: 0.35 },
    uLift: { value: 1 },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uCenter: { value: [0.5, 0.5] },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uExposure;
    uniform float uFilm;
    uniform float uLift;
    uniform float uTime;
    uniform float uAspect;
    uniform vec2 uCenter;
    varying vec2 vUv;

    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec3 light = texture2D(tDiffuse, vUv).rgb * uExposure;
      // Highlights roll off like film instead of clipping, then a gentle S-curve. The roll-off follows
      // the brightest channel, so dense coloured smoke keeps its colour instead of bleaching to white;
      // a quarter of it goes channel by channel, so the hottest highlights still whiten a little, as on
      // film. White smoke is the same either way.
      float peak = max(light.r, max(light.g, light.b));
      vec3 keep = light / max(peak, 1e-5) * (1.0 - exp(-peak));
      vec3 c = mix(keep, 1.0 - exp(-light), 0.25);
      c = mix(c, c * c * (3.0 - 2.0 * c), 0.3);

      vec2 q = (vUv - uCenter) * vec2(uAspect, 1.0);
      float r = length(q);
      // A faint studio lift behind the cube, which comes with the glow (none means pure black).
      c += vec3(0.022) * uLift * (1.0 - smoothstep(0.0, 0.85, r)) * (1.0 - c);
      c *= 1.0 - 0.35 * smoothstep(0.35, 1.3, r);

      // Film grain, strongest in the mid-tones, new every frame.
      vec2 seed = gl_FragCoord.xy + fract(uTime * 7.31) * 517.0;
      float n = hash(seed) + hash(seed + 71.3) - 1.0;
      c += n * uFilm * 0.075 * (0.25 + c * (1.0 - c) * 3.0);
      // Dither so the dark gradient never bands.
      c += (hash(gl_FragCoord.xy + 13.7) - 0.5) / 255.0 * min(1.0, uLift + uFilm);

      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};
