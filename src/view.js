import { OrthographicCamera, PerspectiveCamera } from 'three';
import { ORIGINAL_CAMERA } from './settings.js';

// The camera rig: drag to orbit (with a little momentum), scroll to zoom, and a steady spin.
// Two lenses share it: "flat" is the reference clip's orthographic view, "depth" a 26° lens.

const DISTANCE = 11.5;
// Narrower than 9:16, the lens widens so the cube stays in frame. At 9:16 and wider, the cube
// keeps the same share of the frame's height, so any export format frames it the same way.
const NARROWEST = 9 / 16;

export function createView(canvas) {
  const depth = new PerspectiveCamera(26, 1, 0.1, 100);
  const flat = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
  const rig = { theta: 0, phi: 0, zoom: 1, zoomTarget: 1, vTheta: 0, vPhi: 0 };
  let lens = 'flat';
  let drag = null;

  function original() {
    rig.theta = ORIGINAL_CAMERA.theta0;
    rig.phi = Math.PI / 2 - ORIGINAL_CAMERA.tilt;
    rig.zoom = rig.zoomTarget = 1;
    rig.vTheta = rig.vPhi = 0;
  }
  original();

  canvas.addEventListener('pointerdown', (e) => {
    // One hand turns the cube: a second finger landing mid-drag must not take it over.
    if (e.button !== 0 || drag) return;
    canvas.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    rig.vTheta = rig.vPhi = 0;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const k = (2 * Math.PI * 0.5) / canvas.clientHeight;
    const dTheta = -(e.clientX - drag.x) * k;
    const dPhi = -(e.clientY - drag.y) * k;
    const now = performance.now();
    const dt = Math.max((now - drag.t) / 1000, 1 / 240);
    rig.theta += dTheta;
    rig.phi = tilt(rig.phi, dPhi);
    // Remember how fast the hand was moving, so a flick keeps turning after release.
    rig.vTheta = rig.vTheta * 0.5 + (dTheta / dt) * 0.5;
    rig.vPhi = rig.vPhi * 0.5 + (dPhi / dt) * 0.5;
    Object.assign(drag, { x: e.clientX, y: e.clientY, t: now });
  });
  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (performance.now() - drag.t > 80) rig.vTheta = rig.vPhi = 0;
    drag = null;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  // Capture can end without a pointerup (the browser takes the touch); never leave the drag stuck.
  canvas.addEventListener('lostpointercapture', release);
  let wheelAt = -Infinity;
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    wheelAt = performance.now();
    rig.zoomTarget = Math.min(2.2, Math.max(0.6, rig.zoomTarget * Math.exp(-e.deltaY * 0.0015)));
  }, { passive: false });

  const LIMIT = 0.12;
  // How far the tilt can stretch past a limit, so it stays clear of the poles (where lookAt flips).
  const BAND = 0.08;
  const clampPhi = (phi) => Math.min(Math.PI - LIMIT, Math.max(LIMIT, phi));
  // How far past the top or bottom limit the camera is (0 inside).
  const past = (phi) => Math.max(LIMIT - phi, phi - (Math.PI - LIMIT), 0);
  // Tilt by d, for the hand and for momentum alike. Inside the limits the camera follows exactly;
  // past one it stretches like a rubber band, slower the further it goes, and never beyond BAND.
  function tilt(phi, d) {
    const top = phi < Math.PI / 2;
    const over = top ? LIMIT - phi : phi - (Math.PI - LIMIT);
    const pulled = (over > 0 ? over / (1 - over / BAND) : over) + (top ? -d : d);
    const next = pulled > 0 ? pulled / (1 + pulled / BAND) : pulled;
    return top ? LIMIT - next : Math.PI - LIMIT + next;
  }

  return {
    get camera() { return lens === 'flat' ? flat : depth; },
    get dragging() { return drag !== null; },
    // The wheel is turning (its events come every frame or so while it does).
    get zooming() { return performance.now() - wheelAt < 200; },
    get lens() { return lens; },
    setLens(name) { lens = name; },
    // The camera's turn around the cube, read and set exactly (the loop recording drives it).
    get theta() { return rig.theta; },
    turnTo(theta) {
      rig.theta = theta;
      rig.vTheta = rig.vPhi = 0;
    },
    original,
    // For checks against the reference: the clip's camera at second t.
    atOriginalTime(t) {
      original();
      rig.theta += ORIGINAL_CAMERA.rate * t;
    },
    update(dt, spin) {
      if (!drag) {
        rig.theta += spin * dt + rig.vTheta * dt;
        rig.phi = tilt(rig.phi, rig.vPhi * dt);
        if (past(rig.phi) > 0) {
          // Let go past the limit: the tilt springs back inside it, and any momentum toward it stops.
          rig.vPhi = 0;
          rig.phi += (clampPhi(rig.phi) - rig.phi) * (1 - Math.exp(-dt * 14));
        }
        const decay = Math.exp(-dt * 4);
        rig.vTheta *= decay;
        rig.vPhi *= decay;
      }
      // The zoom glides to where the wheel asked for, so a mouse wheel's notches don't jump the camera.
      rig.zoom += (rig.zoomTarget - rig.zoom) * (1 - Math.exp(-dt * 12));
      for (const camera of [depth, flat]) {
        camera.position.setFromSphericalCoords(lens === 'depth' ? DISTANCE / rig.zoom : DISTANCE, rig.phi, rig.theta);
        camera.lookAt(0, 0, 0);
      }
      if (flat.zoom !== rig.zoom) {
        flat.zoom = rig.zoom;
        flat.updateProjectionMatrix();
      }
    },
    // How large the scene draws in a frame this size, up to a constant (both lenses fit it the same way).
    scale(width, height) {
      return height / Math.max(1, NARROWEST / (width / height));
    },
    // Fit both lenses to an output of width × height, shifted by the panel's offset.
    frame(width, height, offsetX = 0, offsetY = 0) {
      const aspect = width / height;
      const widen = Math.max(1, NARROWEST / aspect);
      depth.aspect = aspect;
      depth.fov = (2 * Math.atan(Math.tan((13 * Math.PI) / 180) * widen) * 180) / Math.PI;
      const half = ORIGINAL_CAMERA.halfHeight * widen;
      Object.assign(flat, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
      for (const camera of [depth, flat]) {
        camera.setViewOffset(width, height, offsetX, offsetY, width, height);
        camera.updateProjectionMatrix();
      }
    },
  };
}
