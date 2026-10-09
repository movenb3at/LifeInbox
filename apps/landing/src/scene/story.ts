import type { InboxModel } from "./model";

type Pose = { x: number; y: number; z: number; rx: number; ry: number; rz: number; scale: number };
const pose = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, scale = 1): Pose => ({ x, y, z, rx, ry, rz, scale });
const rootRotations = [-.2, .12, -.08, -.35, .2, -.12, -.05, -.18];

function cardPose(chapter: number, index: number): Pose {
  const angle = index / 12 * Math.PI * 2;
  if (chapter === 0) {
    if (index === 0) return pose(.05, 2.1, .65, -.25, .4, -.13, 1.04);
    const ring = index % 3;
    return pose(Math.cos(angle) * (2.1 + ring * .32), 1.35 + Math.sin(angle) * 1.15 + ring * .3,
      Math.sin(angle) * 1.1 - .5, -.6 - ring * .15, Math.cos(angle) * .35, Math.sin(angle) * .28, .67);
  }
  if (chapter === 1 || chapter === 7) {
    return pose(Math.sin(index * 1.9) * .16, .35 + index * .096, Math.cos(index * 1.8) * .12,
      -Math.PI / 2, 0, Math.sin(index) * .11, .91);
  }
  if (chapter === 2) {
    const slot = index % 3, layer = Math.floor(index / 3);
    return pose((slot - 1) * 2.5, .34 + layer * .09, .1, -Math.PI / 2, 0, Math.sin(index) * .08, .61);
  }
  if (chapter === 3) {
    if (index === 1) return pose(-.2, 2.1, .95, -.2, .8, .03, 1.5);
    return pose(1.8 + (index % 2) * .22, .35 + index * .06, -.65, -Math.PI / 2, 0, .08, .58);
  }
  if (chapter === 4) {
    return pose(-2.5 + index * .45, .6 + Math.sin(index / 11 * Math.PI) * 2,
      -.2 + Math.cos(index / 11 * Math.PI) * .4, -.7, -.2 + index * .035, -.1 + index * .02, .63);
  }
  if (chapter === 5) {
    return pose((index % 4 - 1.5) * 1.33, 2.55 - Math.floor(index / 4) * .98,
      -.4 - Math.floor(index / 4) * .25, -.5, 0, 0, .57);
  }
  if (index === 1) return pose(.1, 1.7, 1.8, -.2, .5, -.05, 1.3);
  return pose(Math.cos(angle) * 2.35, 1.4 + Math.sin(angle) * .8, -1.5,
    -.55, Math.cos(angle) * .18, Math.sin(angle) * .15, .48);
}

function trayPose(chapter: number, index: number): Pose {
  if (chapter === 2) return pose((index - 1) * 2.5, -.12, 0, 0, 0, 0, .68);
  if (chapter === 4) return pose(index === 0 ? -2.6 : index === 1 ? 2.6 : 0,
    -.2, index === 2 ? -1.2 : 0, 0, 0, 0, index === 2 ? .001 : .65);
  if (chapter === 5 || chapter === 6) return pose(0, -.8, -1, 0, 0, 0, .001);
  if (index === 0) return pose(0, -.2, 0, 0, 0, 0, chapter === 3 ? .72 : 1);
  return pose(0, -.4, -1, 0, 0, 0, .001);
}

function blend(a: Pose, b: Pose, t: number, group: InboxModel["root"]) {
  const lerp = (x: number, y: number) => x + (y - x) * t;
  group.position.set(lerp(a.x, b.x), lerp(a.y, b.y), lerp(a.z, b.z));
  group.rotation.set(lerp(a.rx, b.rx), lerp(a.ry, b.ry), lerp(a.rz, b.rz));
  group.scale.setScalar(lerp(a.scale, b.scale));
}

export function applyStory(model: InboxModel, progress: number) {
  const clamped = Math.max(0, Math.min(7, progress));
  const chapter = Math.min(6, Math.floor(clamped));
  const raw = clamped - chapter;
  const t = raw * raw * (3 - 2 * raw);
  model.root.rotation.y = rootRotations[chapter] + (rootRotations[chapter + 1] - rootRotations[chapter]) * t;
  model.cards.forEach((card, index) => blend(cardPose(chapter, index), cardPose(chapter + 1, index), t, card));
  model.trays.forEach((tray, index) => blend(trayPose(chapter, index), trayPose(chapter + 1, index), t, tray));
  const scannerPose = (value: number) => value === 3 ? pose(-.15, 2.11, 1, -.2, .8, .03, 1.55) : pose(0, 2, 0, 0, 0, 0, .001);
  blend(scannerPose(chapter), scannerPose(chapter + 1), t, model.scanner);
}
