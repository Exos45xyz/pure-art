import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  Vector2,
  Vector3,
} from 'three';
import { opacityGlsl } from './smoke.js';

// The glass cube: 12 edges drawn as quads with analytic anti-aliasing, so they are smooth at any
// width without multisampling. Each edge is a plain stroke, one width from end to end, meeting the next
// edge with a round join.
//
// The edges belong to the scene: the smoke's lamp lights them (brighter close to it, darker away from
// it and where the smoke shades them), and smoke in front of an edge hides it, as much as it hides the
// smoke behind it. They read the same opacity maps as the grains (smoke.js).

// sRGB, written straight to the screen. Red is the reference clip's edge colour.
const colors = { white: new Color(0.95, 0.95, 0.95), red: new Color(0.78, 0.02, 0.1), off: new Color(0.95, 0.95, 0.95) };

const vertexShader = /* glsl */ `
  attribute vec3 other;
  attribute float side;
  attribute float end;
  uniform vec2 uResolution;
  uniform float uWidth;
  varying float vAcross;
  varying float vAlong;
  varying float vLength;
  varying float vHalf;
  varying vec3 vPoint;
  void main() {
    vec4 a = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    vec4 b = projectionMatrix * modelViewMatrix * vec4(other, 1.0);
    vec2 sa = a.xy / a.w * 0.5 * uResolution;
    vec2 sb = b.xy / b.w * 0.5 * uResolution;
    // One direction for the whole edge, start to end, so both ends agree which side is which and the
    // strip is a true rectangle (worked out from each end separately, it twisted into a bow tie).
    vec2 along = end < 0.5 ? normalize(sb - sa) : normalize(sa - sb);
    vec2 across = vec2(-along.y, along.x);

    // Half the width and a pixel for the soft edge, on both sides and past each end, so the round
    // joins have room.
    float reach = uWidth * 0.5 + 1.0;
    vec2 s = sa + across * side * reach + along * reach * (end < 0.5 ? -1.0 : 1.0);
    // w = 1 keeps every varying linear on screen, so distances stay in true pixels.
    gl_Position = vec4(s / (0.5 * uResolution), a.z / a.w, 1.0);

    float len = length(sb - sa);
    vAcross = side * reach;
    vAlong = end < 0.5 ? -reach : len + reach;
    vLength = len;
    vHalf = uWidth * 0.5;
    // Where along the edge this is, in the cube, for the light and the smoke in front of it.
    vPoint = position;
  }`;

const fragmentShader = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying float vAcross;
  varying float vAlong;
  varying float vLength;
  varying float vHalf;
  varying vec3 vPoint;
  ${opacityGlsl}
  void main() {
    // Distance to the segment, with round ends, so two edges meet in one clean corner.
    float d = vAlong < 0.0 ? length(vec2(vAlong, vAcross))
            : vAlong > vLength ? length(vec2(vAlong - vLength, vAcross))
            : abs(vAcross);
    float core = (1.0 - smoothstep(vHalf - 0.5, vHalf + 0.5, d)) * min(vHalf * 2.0, 1.0);
    // Lit by the lamp, never darker than a third: the frame always reads.
    float shade = clamp(0.35 + 0.65 * lampLight(vPoint), 0.35, 1.0);
    float a = clamp(core * seenThrough(vPoint) * uOpacity, 0.0, 1.0);
    if (a <= 0.002) discard;
    gl_FragColor = vec4(uColor * shade, a);
  }`;

function edgeGeometry(a, b) {
  // Two vertices at each end, one either side of the line.
  const positions = [...a, ...a, ...b, ...b];
  const others = [...b, ...b, ...a, ...a];
  // Corners in order around the strip: start right, start left, end left, end right.
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

// lighting: from createLighting (smoke.js), shared with the grains.
export function createCube(lighting) {
  // DoubleSide: the strips are flat on the screen, so which way they wind must never hide them.
  const material = new ShaderMaterial({
    vertexShader, fragmentShader, side: DoubleSide,
    uniforms: {
      ...lighting.uniforms,
      uColor: { value: new Color() },
      uOpacity: { value: 1 },
      uWidth: { value: 1.4 },
      uResolution: { value: new Vector2(1, 1) },
    },
    transparent: true, depthTest: false, depthWrite: false, blending: NormalBlending,
  });

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
        const line = new Mesh(edgeGeometry(a, b), material);
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
      material.uniforms.uResolution.value.set(width, height);
      material.uniforms.uWidth.value = lineWidth;
    },
    // Called every frame with the edge choice and the camera. dt = Infinity jumps straight to the choice.
    update(choice, camera, dt) {
      const k = dt === Infinity ? 1 : 1 - Math.exp(-dt * 12);
      if (choice !== 'off') color.lerp(colors[choice], k);
      strength += ((choice === 'off' ? 0 : 1) - strength) * k;
      material.uniforms.uColor.value.copy(color);
      material.uniforms.uOpacity.value = strength;
      group.visible = strength > 0.005;
      camera.getWorldDirection(view).negate();
      const orthographic = camera.isOrthographicCamera;
      for (const { line, faces } of edges) {
        // A face looks at the camera when the camera is in front of its plane. Back edges are drawn
        // first, so the front ones always lie on top.
        const seen = faces.some((n) => (orthographic ? view.dot(n) : toCamera.copy(camera.position).sub(n).dot(n)) > 0);
        line.renderOrder = seen ? 2 : 1;
      }
    },
  };
}
