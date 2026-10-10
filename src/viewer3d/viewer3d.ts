// viewer3d.ts — THE overlay lifecycle owner. open() renders a SNAPSHOT of the room as of the
// moment it's called: no store subscription, no live sync while open. Reopen to see edits.
// Every resource open() creates (renderer, controls, listeners, the rAF loop, the overlay DOM)
// is torn down by close() — the overlay must be openable/closable indefinitely with nothing
// left running or leaking in between.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { store } from "../model/store";
import { buildScene } from "./buildScene";

interface Session {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  controls: OrbitControls;
  overlay: HTMLDivElement;
  animationFrame: number;
  onResize: () => void;
  onKeydown: (e: KeyboardEvent) => void;
}

let session: Session | null = null;

/** Open the 3D overlay over a snapshot of the current room. No-op if already open. */
export function open(): void {
  if (session) return;
  const room = store.getState().room;
  if (!room) return;

  const overlay = document.createElement("div");
  overlay.className = "viewer3d";

  const canvas = document.createElement("canvas");
  canvas.className = "viewer3d__canvas";
  overlay.appendChild(canvas);

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "btn viewer3d__close";
  closeButton.textContent = "Close 3D view";
  closeButton.addEventListener("click", close);
  overlay.appendChild(closeButton);

  document.body.appendChild(overlay);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 5000);
  const center = new THREE.Vector3(room.width / 2, room.wallHeight / 3, room.length / 2);
  const diagonal = Math.hypot(room.width, room.length, room.wallHeight);
  camera.position.set(
    center.x + diagonal * 0.6,
    center.y + diagonal * 0.45,
    center.z + diagonal * 0.6,
  );
  camera.lookAt(center);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(center);
  controls.update();

  const scene = buildScene(room);

  const onResize = () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  };
  window.addEventListener("resize", onResize);

  const onKeydown = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  window.addEventListener("keydown", onKeydown);

  // tick() re-schedules into session.animationFrame (not a local variable) so close() — which
  // reads session.animationFrame — always cancels the CURRENTLY pending frame, not the stale id
  // from the very first schedule. By the time the first frame fires, `session` below has
  // already been assigned (rAF callbacks run after the current synchronous script finishes).
  const tick = () => {
    controls.update();
    renderer.render(scene, camera);
    if (session) session.animationFrame = requestAnimationFrame(tick);
  };
  const firstFrame = requestAnimationFrame(tick);

  session = { renderer, scene, controls, overlay, animationFrame: firstFrame, onResize, onKeydown };
}

/** Close the overlay and dispose every GPU/DOM/listener resource open() created. No-op if not open. */
export function close(): void {
  if (!session) return;
  const { renderer, scene, controls, overlay, animationFrame, onResize, onKeydown } = session;

  cancelAnimationFrame(animationFrame);
  window.removeEventListener("resize", onResize);
  window.removeEventListener("keydown", onKeydown);
  controls.dispose();

  disposeSceneResources(scene);
  renderer.dispose();

  overlay.remove();
  session = null;
}

/** Walk the scene graph and dispose every geometry/material it holds, so nothing leaks on GPU. */
function disposeSceneResources(scene: THREE.Scene): void {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) material.dispose();
  });
}
