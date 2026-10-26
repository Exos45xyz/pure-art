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

// sRGB, written straight to the screen. Red is the reference clip's edge colour.
const colors = { white: new Color(0.95, 0.95, 0.95), red: new Color(0.78, 0.02, 0.1), off: new Color(0.95, 0.95, 0.95) };

const vertexShader = /* glsl */ `
  attribute vec3 other;
  attribute float side;
  uniform vec2 uResolution;
  uniform float uWidth;
  varying float vAcross;
  void main() {
    vec4 a = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vec4 b = projectionMatrix * modelViewMatrix * vec4(other, 1.0);
    vec2 sa = a.xy / a.w * 0.5 * uResolution;
    vec2 sb = b.xy / b.w * 0.5 * uResolution;
    vec2 along = normalize(sb - sa);
    vec2 across = vec2(-along.y, along.x);
    // Half the width plus a pixel for the soft edge, on both sides and past each end.
    float reach = uWidth * 0.5 + 1.0;
    vec2 s = sa + across * side * reach - along * reach;
    gl_Position = vec4(s / (0.5 * uResolution) * a.w, a.z, a.w);
    vAcross = side * reach;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  uniform float uWidth;
  uniform float uPremultiply;
  varying float vAcross;
  void main() {
    // How much of this pixel the line covers; lines thinner than a pixel fade instead of thinning.
    float cover = clamp(uWidth * 0.5 + 0.5 - abs(vAcross), 0.0, 1.0) * min(uWidth, 1.0);
    float a = cover * uOpacity;
    if (a <= 0.0) discard;
    gl_FragColor = vec4(uPremultiply > 0.5 ? uColor * a : uColor, a);
  }`;

function edgeGeometry(a, b) {
  // Two vertices at each end, one either side of the line.
  const positions = [...a, ...a, ...b, ...b];
  const others = [...b, ...b, ...a, ...a];
  const sides = [-1, 1, 1, -1];
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('other', new BufferAttribute(new Float32Array(others), 3));
  geometry.setAttribute('side', new BufferAttribute(new Float32Array(sides), 1));
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
      for (const m of [front, back]) {
        m.uniforms.uResolution.value.set(width, height);
        m.uniforms.uWidth.value = lineWidth;
      }
    },
    // Called every frame with the edge choice, how strong the back edges are, and the camera.
    // dt = Infinity jumps straight to the choice (first frame, exports).
    update(choice, backStrength, camera, dt) {
      const k = dt === Infinity ? 1 : 1 - Math.exp(-dt * 12);
      if (choice !== 'off') color.lerp(colors[choice], k);
      strength += ((choice === 'off' ? 0 : 1) - strength) * k;
      for (const m of [front, back]) m.uniforms.uColor.value.copy(color);
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
