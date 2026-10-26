import {
  BufferAttribute,
  BufferGeometry,
  Color,
  CustomBlending,
  Group,
  MaxEquation,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';

// The glass cube: 12 edges drawn as quads with analytic anti-aliasing, so they are smooth at any
// width without multisampling. Front edges are laid over the smoke. Back edges use max blending:
// over dark air they show, behind bright smoke they disappear, as if the smoke were in front.
//
// Each edge is a crisp line (it can also take the lens's blur, though the app keeps the frame sharp).
// It dims a little with distance, is a touch thicker where it is near, meets the next edge with a
// round join, and carries a faint glow, like light caught on the rim of glass.

// sRGB, written straight to the screen. Red is the reference clip's edge colour.
const colors = { white: new Color(0.95, 0.95, 0.95), red: new Color(0.78, 0.02, 0.1), off: new Color(0.95, 0.95, 0.95) };

const vertexShader = /* glsl */ `
  attribute vec3 other;
  attribute float side;
  attribute float end;
  uniform vec2 uResolution;
  uniform float uWidth;
  uniform float uBlur;
  uniform float uFocusDepth;
  uniform float uCentreDepth;
  uniform float uDepthShade;
  uniform float uGlowRadius;
  varying float vAcross;
  varying float vAlong;
  varying float vLength;
  varying float vHalf;
  varying float vSoft;
  varying float vShade;
  void main() {
    vec4 va = modelViewMatrix * vec4(position, 1.0);
    vec4 a = projectionMatrix * va;
    vec4 b = projectionMatrix * modelViewMatrix * vec4(other, 1.0);
    vec2 sa = a.xy / a.w * 0.5 * uResolution;
    vec2 sb = b.xy / b.w * 0.5 * uResolution;
    vec2 along = normalize(sb - sa);
    vec2 across = vec2(-along.y, along.x);

    float depth = -va.z;
    // A touch thicker near the camera, thinner far away (perspective lens only).
    float near = projectionMatrix[3][3] == 0.0 ? pow(uCentreDepth / depth, 0.7) : 1.0;
    float width = uWidth * near;
    // The same circle of confusion as the grains: the line widens and keeps its light.
    float coc = min(uBlur * abs(depth - uFocusDepth) * 18.0, 28.0) * uResolution.y / 1280.0;
    float wide = sqrt(width * width + coc * coc);

    // Half the width, the glow and a pixel for the soft edge, on both sides and past each end.
    float reach = wide * 0.5 + uGlowRadius + 1.0;
    vec2 s = sa + across * side * reach - along * reach;
    // w = 1 keeps every varying linear on screen, so distances stay in true pixels.
    gl_Position = vec4(s / (0.5 * uResolution), a.z / a.w, 1.0);

    float len = length(sb - sa);
    vAcross = side * reach;
    vAlong = end < 0.5 ? -reach : len + reach;
    vLength = len;
    vHalf = wide * 0.5;
    vSoft = coc / wide;
    float fade = mix(1.0, 0.72, smoothstep(uCentreDepth - 1.5, uCentreDepth + 1.5, depth) * uDepthShade);
    vShade = (width / wide) * fade;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uPremultiply;
  uniform float uGlow;
  uniform float uGlowRadius;
  varying float vAcross;
  varying float vAlong;
  varying float vLength;
  varying float vHalf;
  varying float vSoft;
  varying float vShade;
  void main() {
    // Distance to the segment, with round ends, so two edges meet in one clean corner.
    float d = vAlong < 0.0 ? length(vec2(vAlong, vAcross))
            : vAlong > vLength ? length(vec2(vAlong - vLength, vAcross))
            : abs(vAcross);
    // In focus: a one-pixel anti-aliased edge. Out of focus: a soft falloff across the whole width.
    float soft = mix(0.5, vHalf, vSoft);
    float core = (1.0 - smoothstep(vHalf - soft, vHalf + 0.5, d)) * min(vHalf * 2.0, 1.0);
    float glow = uGlow * exp(-(d * d) / max(uGlowRadius * uGlowRadius, 1e-4));
    float a = clamp((core + glow) * vShade * uOpacity, 0.0, 1.0);
    if (a <= 0.002) discard;
    gl_FragColor = vec4(uPremultiply > 0.5 ? uColor * a : uColor, a);
  }`;

function edgeGeometry(a, b) {
  // Two vertices at each end, one either side of the line.
  const positions = [...a, ...a, ...b, ...b];
  const others = [...b, ...b, ...a, ...a];
  const sides = [-1, 1, 1, -1];
  const ends = [0, 0, 1, 1];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('other', new BufferAttribute(new Float32Array(others), 3));
  geometry.setAttribute('side', new BufferAttribute(new Float32Array(sides), 1));
  geometry.setAttribute('end', new BufferAttribute(new Float32Array(ends), 1));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

export function createCube() {
  const uniforms = () => ({
    uColor: { value: new Color() },
    uOpacity: { value: 1 },
    uWidth: { value: 1.4 },
    uResolution: { value: new Vector2(1, 1) },
    uPremultiply: { value: 0 },
    uBlur: { value: 0 },
    uFocusDepth: { value: 11.5 },
    uCentreDepth: { value: 11.5 },
    uDepthShade: { value: 1 },
    uGlow: { value: 0 },
    uGlowRadius: { value: 3 },
  });
  const front = new ShaderMaterial({
    vertexShader, fragmentShader, uniforms: uniforms(),
    transparent: true, depthTest: false, depthWrite: false, blending: NormalBlending,
  });
  const back = new ShaderMaterial({
    vertexShader, fragmentShader, uniforms: uniforms(),
    transparent: true, depthTest: false, depthWrite: false,
    blending: CustomBlending, blendEquation: MaxEquation, blendEquationAlpha: MaxEquation,
  });
  back.uniforms.uPremultiply.value = 1;
  const materials = [front, back];

  const group = new Group();
  const edges = [];
  // An edge runs along one axis; its two neighbouring faces face along the other two.
  for (let axis = 0; axis < 3; axis++) {
    const [u, v] = [0, 1, 2].filter((i) => i !== axis);
    for (const su of [-1, 1]) {
      for (const sv of [-1, 1]) {
        const a = [0, 0, 0];
        const b = [0, 0, 0];
        a[axis] = -1; b[axis] = 1;
        a[u] = b[u] = su;
        a[v] = b[v] = sv;
        const line = new Mesh(edgeGeometry(a, b), front);
        line.frustumCulled = false;
        group.add(line);
        const faces = [new Vector3(), new Vector3()];
        faces[0].setComponent(u, su);
        faces[1].setComponent(v, sv);
        edges.push({ line, faces });
      }
    }
  }

  const color = colors.white.clone();
  let strength = 1;
  const toCamera = new Vector3();
  const view = new Vector3();

  return {
    object: group,
    // Size of the output in device pixels, and the line width in device pixels.
    setOutput(width, height, lineWidth) {
      for (const m of materials) {
        m.uniforms.uResolution.value.set(width, height);
        m.uniforms.uWidth.value = lineWidth;
        m.uniforms.uGlowRadius.value = (2.5 * height) / 1280;
      }
    },
    // Called every frame with the edge choice, how strong the back edges are, the camera, and the
    // lens: { blur, focusDepth, glow, depthShade }. dt = Infinity jumps straight to the choice.
    update(choice, backStrength, camera, dt, lens = { blur: 0, focusDepth: 0, glow: 0, depthShade: 0 }) {
      const k = dt === Infinity ? 1 : 1 - Math.exp(-dt * 12);
      if (choice !== 'off') color.lerp(colors[choice], k);
      strength += ((choice === 'off' ? 0 : 1) - strength) * k;
      const centreDepth = camera.position.length();
      for (const m of materials) {
        const u = m.uniforms;
        u.uColor.value.copy(color);
        u.uBlur.value = lens.blur;
        u.uFocusDepth.value = lens.focusDepth;
        u.uCentreDepth.value = centreDepth;
        u.uDepthShade.value = lens.depthShade;
        u.uGlow.value = lens.glow;
      }
      front.uniforms.uOpacity.value = strength;
      back.uniforms.uOpacity.value = strength * backStrength;
      group.visible = strength > 0.005;
      camera.getWorldDirection(view).negate();
      const orthographic = camera.isOrthographicCamera;
      for (const { line, faces } of edges) {
        // A face looks at the camera when the camera is in front of its plane.
        const seen = faces.some((n) => (orthographic ? view.dot(n) : toCamera.copy(camera.position).sub(n).dot(n)) > 0);
        line.material = seen ? front : back;
        // Back edges first, so the front ones always lie on top.
        line.renderOrder = seen ? 2 : 1;
      }
    },
  };
}
