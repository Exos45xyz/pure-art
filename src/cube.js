import { Color, Group, Vector3 } from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';

// The glass cube: 12 crisp, anti-aliased edges. Edges at the back of the cube are drawn
// fainter, so it reads as a solid even though the smoke inside is see-through.

const colors = { white: new Color('#f2f2f2'), red: new Color('#e5262b'), off: new Color('#f2f2f2') };
const FRONT = 0.92;
const BACK = 0.3;

export function createCube() {
  const group = new Group();
  const front = new LineMaterial({ linewidth: 1.2, transparent: true, depthTest: false, depthWrite: false });
  const back = front.clone();
  const edges = [];

  // An edge runs along one axis; its two neighbouring faces face along the other two.
  for (let axis = 0; axis < 3; axis++) {
    const [u, v] = [0, 1, 2].filter((a) => a !== axis);
    for (const su of [-1, 1]) {
      for (const sv of [-1, 1]) {
        const a = [0, 0, 0];
        const b = [0, 0, 0];
        a[axis] = -1; b[axis] = 1;
        a[u] = b[u] = su;
        a[v] = b[v] = sv;
        const geometry = new LineSegmentsGeometry().setPositions([...a, ...b]);
        const line = new LineSegments2(geometry, front);
        line.renderOrder = 1;
        group.add(line);
        const faces = [new Vector3(), new Vector3()];
        faces[0].setComponent(u, su);
        faces[1].setComponent(v, sv);
        edges.push({ line, faces });
      }
    }
  }

  const color = new Color('#f2f2f2');
  let strength = 1;
  const toCamera = new Vector3();

  return {
    object: group,
    setResolution(width, height) {
      front.resolution.set(width, height);
      back.resolution.set(width, height);
    },
    // Called every frame with the eased edge colour and the camera.
    update(choice, camera, dt) {
      const k = 1 - Math.exp(-dt * 12);
      if (choice !== 'off') color.lerp(colors[choice], k);
      strength += ((choice === 'off' ? 0 : 1) - strength) * k;
      front.color.copy(color);
      back.color.copy(color);
      front.opacity = FRONT * strength;
      back.opacity = BACK * strength;
      group.visible = strength > 0.005;
      for (const { line, faces } of edges) {
        // A face looks at the camera when the camera is in front of its plane.
        const seen = faces.some((n) => toCamera.copy(camera.position).sub(n).dot(n) > 0);
        line.material = seen ? front : back;
      }
    },
  };
}
