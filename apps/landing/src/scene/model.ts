import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

export type InboxModel = {
  root: THREE.Group;
  cards: THREE.Group[];
  trays: THREE.Group[];
  scanner: THREE.Group;
};

const examples = [
  ["TASK", "도서관 책 반납", "내일 마감", "#6d8657"],
  ["EVENT", "전시 예약", "토요일 14:00", "#829573"],
  ["PAYMENT", "구독 결제", "KRW 12,000", "#9aab89"],
  ["DOCUMENT", "제품 보증서", "필요할 때 찾아보기", "#aab19c"],
  ["NOTE", "떠오른 아이디어", "나의 작은 기록", "#9aab89"],
  ["DELIVERY", "택배 도착", "배송 정보", "#829573"],
  ["TASK", "식물 물 주기", "이번 주 할 일", "#6d8657"],
  ["RESERVATION", "주말 약속", "일정과 함께 보관", "#aab19c"],
  ["PAYMENT", "정기 결제", "USD 9.99", "#9aab89"],
  ["NOTE", "읽고 싶은 책", "나중에 살펴보기", "#829573"],
  ["DOCUMENT", "여행 준비", "함께 준비하기", "#aab19c"],
  ["TASK", "작은 할 일", "하나씩 가볍게", "#6d8657"],
];

function cardTexture(index: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Card texture canvas is unavailable");
  const [type, title, detail, color] = examples[index];
  context.beginPath();
  context.roundRect(0, 0, 384, 512, 22);
  context.clip();
  context.fillStyle = index === 0 ? "#ebf0e3" : "#fafbf7";
  context.fillRect(0, 0, 384, 512);
  context.fillStyle = color;
  context.fillRect(0, 0, 384, 12);
  context.font = "14px Consolas, monospace";
  context.fillText("LIFEINBOX", 29, 57);
  context.beginPath();
  context.roundRect(29, 89, 64, 64, 13);
  context.fillStyle = color;
  context.fill();
  context.strokeStyle = "#ffffff";
  context.lineWidth = 2.5;
  if (index === 2 || index === 8) {
    context.font = "29px Arial";
    context.fillStyle = "#ffffff";
    context.fillText("$", 53, 132);
  } else if (index === 1 || index === 7) {
    context.strokeRect(47, 108, 27, 25);
    context.beginPath(); context.moveTo(47, 115); context.lineTo(74, 115); context.stroke();
  } else {
    context.beginPath(); context.moveTo(48, 121); context.lineTo(57, 129); context.lineTo(75, 110); context.stroke();
  }
  context.fillStyle = "#829172";
  context.font = "13px Consolas, monospace";
  context.fillText(type, 29, 191);
  context.fillStyle = "#3e5130";
  context.font = "500 24px Arial, Malgun Gothic, sans-serif";
  context.fillText(title, 29, 232);
  context.fillStyle = "#9ba88f";
  context.font = "15px Arial, Malgun Gothic, sans-serif";
  context.fillText(detail, 29, 263);
  for (let row = 0; row < 3; row++) {
    context.beginPath();
    context.roundRect(29, 315 + row * 22, row === 2 ? 178 : 290, 5, 3);
    context.fillStyle = "#e4e9dc";
    context.fill();
  }
  context.strokeStyle = "#e0e6d7";
  context.lineWidth = 1;
  context.beginPath(); context.moveTo(29, 428); context.lineTo(355, 428); context.stroke();
  context.fillStyle = color;
  context.font = "12px Arial, Malgun Gothic, sans-serif";
  context.fillText(index === 0 ? "개인 Inbox" : type, 29, 466);
  context.fillStyle = "#aab59e";
  context.font = "11px Consolas, monospace";
  context.fillText("0" + (index % 8 + 1), 330, 466);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function trayLabel(text: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 64;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Tray label is unavailable");
  context.fillStyle = "#6c8355";
  context.font = "24px Arial, Malgun Gothic, sans-serif";
  context.textAlign = "center";
  context.fillText(text, 128, 40);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(1.35, .34), new THREE.MeshBasicMaterial({ map: texture, transparent: true }));
}

export function createModel(): InboxModel {
  const root = new THREE.Group();
  const paper = new THREE.MeshStandardMaterial({ color: "#f6f8f0", roughness: .55, metalness: .04 });
  const porcelain = new THREE.MeshStandardMaterial({ color: "#d6e3c6", roughness: .38, metalness: .07 });
  const edge = new THREE.MeshStandardMaterial({ color: "#8ea976", roughness: .48, metalness: .08 });
  const cardBody = new RoundedBoxGeometry(1.62, 2.18, .085, 3, .055);
  const cardFace = new THREE.PlaneGeometry(1.59, 2.15);
  const cards = examples.map((_, index) => {
    const group = new THREE.Group();
    const body = new THREE.Mesh(cardBody, paper);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);
    const face = new THREE.Mesh(cardFace, new THREE.MeshBasicMaterial({
      map: cardTexture(index), transparent: true, toneMapped: false,
    }));
    face.position.z = .049;
    group.add(face);
    root.add(group);
    return group;
  });
  const base = new RoundedBoxGeometry(3.45, .18, 2.65, 4, .085);
  const side = new RoundedBoxGeometry(.16, .63, 2.65, 4, .075);
  const back = new RoundedBoxGeometry(3.45, .7, .16, 4, .075);
  const front = new RoundedBoxGeometry(3.45, .31, .16, 4, .07);
  const trays = ["PERSONAL", "WORK", "SHARED"].map((label, index) => {
    const group = new THREE.Group();
    const pieces: [THREE.BufferGeometry, THREE.Material, THREE.Vector3][] = [
      [base, porcelain, new THREE.Vector3(0, .04, 0)],
      [side, porcelain, new THREE.Vector3(-1.65, .36, 0)],
      [side, porcelain, new THREE.Vector3(1.65, .36, 0)],
      [back, porcelain, new THREE.Vector3(0, .4, -1.27)],
      [front, index === 0 ? edge : porcelain, new THREE.Vector3(0, .19, 1.27)],
    ];
    pieces.forEach(([geometry, material, position]) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(position);
      mesh.castShadow = true; mesh.receiveShadow = true;
      group.add(mesh);
    });
    const labelMesh = trayLabel(label);
    labelMesh.position.set(0, .18, 1.36);
    group.add(labelMesh);
    root.add(group);
    return group;
  });
  const scanner = new THREE.Group();
  const lineMaterial = new THREE.MeshBasicMaterial({ color: "#83a267", transparent: true, opacity: .8 });
  const horizontal = new THREE.BoxGeometry(.42, .02, .02);
  const vertical = new THREE.BoxGeometry(.02, .42, .02);
  for (const x of [-.92, .92]) for (const y of [-1.24, 1.24]) {
    const h = new THREE.Mesh(horizontal, lineMaterial);
    h.position.set(x - Math.sign(x) * .2, y, .1);
    const v = new THREE.Mesh(vertical, lineMaterial);
    v.position.set(x, y - Math.sign(y) * .2, .1);
    scanner.add(h, v);
  }
  root.add(scanner);
  return { root, cards, trays, scanner };
}
