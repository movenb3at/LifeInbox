import * as THREE from "three";
import { createModel } from "./model";
import { applyStory } from "./story";

export function createInboxScene(stage: HTMLElement, onFailure: () => void) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute("aria-hidden", "true");
  stage.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(33, 1, .1, 80);
  camera.position.set(6.7, 6.4, 10);
  camera.lookAt(0, 1.3, 0);
  scene.add(new THREE.HemisphereLight("#fffef8", "#a8ba96", 1.6));
  const light = new THREE.DirectionalLight("#fffaf0", 2.6);
  light.position.set(-4, 8, 7);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  Object.assign(light.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: .1, far: 30 });
  light.shadow.normalBias = .035;
  light.shadow.bias = -.00015;
  scene.add(light);
  const fill = new THREE.DirectionalLight("#d8e6c9", .8);
  fill.position.set(7, 3, -4);
  scene.add(fill);
  const ground = new THREE.Mesh(new THREE.CircleGeometry(7, 64), new THREE.ShadowMaterial({ opacity: .13 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -.35;
  ground.receiveShadow = true;
  scene.add(ground);
  const model = createModel();
  const pointerGroup = new THREE.Group();
  pointerGroup.add(model.root);
  scene.add(pointerGroup);
  let progress = 0, visible = true, disposed = false;
  const pointer = { x: 0, y: 0 };
  const desktop = window.matchMedia("(min-width: 768px) and (pointer: fine)");
  function onPointer(event: PointerEvent) {
    if (!desktop.matches) return;
    pointer.x = (event.clientX / window.innerWidth - .5) * .075;
    pointer.y = (event.clientY / window.innerHeight - .5) * .045;
  }
  function resetPointer() { pointer.x = 0; pointer.y = 0; }
  function resize() {
    const { width, height } = stage.getBoundingClientRect();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, window.innerWidth < 768 ? 1 : 1.5));
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(1, height);
    // Keep all three spaces visible in narrow and wide canvas shapes.
    camera.position.set(6.7, 6.4, 10).multiplyScalar(camera.aspect < 1.1 ? 1.13 : 1);
    camera.lookAt(0, 1.3, 0);
    camera.updateProjectionMatrix();
  }
  function render() {
    if (disposed) return;
    applyStory(model, progress);
    pointerGroup.rotation.y += (pointer.x - pointerGroup.rotation.y) * .08;
    pointerGroup.rotation.x += (pointer.y - pointerGroup.rotation.x) * .08;
    renderer.render(scene, camera);
    stage.dataset.progress = progress.toFixed(3);
    stage.dataset.pose = model.cards[1].position.toArray().map(n => n.toFixed(2)).join(",");
  }
  function syncLoop() {
    const running = visible && !document.hidden && !disposed;
    renderer.setAnimationLoop(running ? render : null);
    stage.dataset.running = String(running);
  }
  const visibility = new IntersectionObserver(entries => {
    visible = entries[0]?.isIntersecting ?? false;
    syncLoop();
  });
  const story = document.getElementById("story");
  if (story) visibility.observe(story);
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(stage);
  document.addEventListener("visibilitychange", syncLoop);
  window.addEventListener("pointermove", onPointer, { passive: true });
  document.documentElement.addEventListener("pointerleave", resetPointer);
  const lostContext = (event: Event) => { event.preventDefault(); onFailure(); };
  renderer.domElement.addEventListener("webglcontextlost", lostContext);
  resize(); render(); syncLoop();
  stage.dataset.renderer = "webgl";
  return {
    setProgress(value: number) { progress = value; },
    dispose() {
      disposed = true;
      renderer.setAnimationLoop(null);
      visibility.disconnect(); resizeObserver.disconnect();
      document.removeEventListener("visibilitychange", syncLoop);
      window.removeEventListener("pointermove", onPointer);
      document.documentElement.removeEventListener("pointerleave", resetPointer);
      renderer.domElement.removeEventListener("webglcontextlost", lostContext);
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      const textures = new Set<THREE.Texture>();
      scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        geometries.add(object.geometry);
        const list = Array.isArray(object.material) ? object.material : [object.material];
        list.forEach(material => {
          materials.add(material);
          const map = (material as THREE.MeshStandardMaterial).map;
          if (map) textures.add(map);
        });
      });
      textures.forEach(texture => texture.dispose());
      materials.forEach(material => material.dispose());
      geometries.forEach(geometry => geometry.dispose());
      renderer.dispose();
      renderer.domElement.remove();
      stage.dataset.running = "false";
    },
  };
}
