import "./styles.css";
import { connectStory, observeChapters } from "./scroll";

const stage = document.getElementById("scene-stage")!;
const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
let disposeScene: (() => void) | undefined;
let disposeScroll: (() => void) | undefined;
let generation = 0;
const disposeChapters = observeChapters();

async function initialize() {
  const current = ++generation;
  disposeScroll?.(); disposeScroll = undefined;
  disposeScene?.(); disposeScene = undefined;
  stage.dataset.renderer = motion.matches ? "static" : "loading";
  if (motion.matches) return;
  try {
    const { createInboxScene } = await import("./scene/renderer");
    if (current !== generation) return;
    const failed = () => {
      generation++;
      disposeScroll?.(); disposeScroll = undefined;
      disposeScene?.(); disposeScene = undefined;
      stage.dataset.renderer = "fallback";
    };
    const scene = createInboxScene(stage, failed);
    disposeScene = scene.dispose;
    disposeScroll = connectStory(scene.setProgress);
  } catch {
    if (current !== generation) return;
    disposeScroll?.(); disposeScroll = undefined;
    disposeScene?.(); disposeScene = undefined;
    stage.dataset.renderer = "fallback";
  }
}
motion.addEventListener("change", initialize);
void initialize();
window.addEventListener("pagehide", () => {
  generation++;
  disposeScroll?.(); disposeScene?.(); disposeChapters();
  motion.removeEventListener("change", initialize);
});
// Restore the scene and section tracking after the browser's back/forward cache.
window.addEventListener("pageshow", event => {
  if (event.persisted) window.location.reload();
});
