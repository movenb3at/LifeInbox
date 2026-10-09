import { animate, createTimeline, onScroll } from "animejs";

const captions = [
  "하나의 Inbox, 가벼워지는 일상.", "떠오른 정보가 하나씩 모이는 곳.",
  "개인적인 일과 함께하는 일을 나누세요.", "이미지 속 정보를 확인 가능한 기록으로.",
  "정리하는 기준을 나만의 규칙으로.", "다가오는 일정을 한눈에.",
  "필요한 기록이 다시 선명해지는 순간.", "생활의 작은 조각들, 이제 한곳에.",
];

export function observeChapters() {
  const chapters = Array.from(document.querySelectorAll<HTMLElement>(".chapter"));
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(".chapter-navigation a"));
  const index = document.querySelector<HTMLElement>(".scene-caption-index");
  const caption = document.getElementById("scene-caption-text");
  function update() {
    const marker = window.innerHeight * .6;
    let current = 0;
    chapters.forEach((chapter, i) => { if (chapter.getBoundingClientRect().top <= marker) current = i; });
    links.forEach((link, i) => {
      if (i === current) link.setAttribute("aria-current", "location");
      else link.removeAttribute("aria-current");
    });
    if (index) index.textContent = "0" + (current + 1) + " / 08";
    if (caption) caption.textContent = captions[current];
  }
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
  update();
  return () => {
    window.removeEventListener("scroll", update);
    window.removeEventListener("resize", update);
  };
}

export function connectStory(setProgress: (progress: number) => void) {
  const story = document.getElementById("story")!;
  const chapters = Array.from(story.querySelectorAll<HTMLElement>(".chapter"));
  let maxScroll = 1;
  let anchors: number[] = [];
  const state = { fraction: 0 };
  function measure() {
    maxScroll = Math.max(1, story.offsetHeight - window.innerHeight);
    anchors = chapters.map(chapter => Math.min(maxScroll, chapter.offsetTop));
  }
  function poseProgress() {
    const position = state.fraction * maxScroll;
    let current = 0;
    while (current < anchors.length - 2 && position >= anchors[current + 1]) current++;
    const start = anchors[current], end = anchors[current + 1];
    return Math.min(7, current + Math.max(0, Math.min(1, (position - start) / Math.max(1, end - start))));
  }
  measure();
  const observer = onScroll({ target: story, enter: "top top", leave: "bottom bottom", sync: .35 });
  const timeline = createTimeline({
    autoplay: observer,
    defaults: { ease: "linear" },
    onUpdate: () => setProgress(poseProgress()),
  }).add(state, { fraction: [0, 1], duration: 7000 });
  const entrances = chapters.slice(1).map(chapter => {
    const entranceObserver = onScroll({ target: chapter, enter: "bottom top+=70%", leave: "top bottom", repeat: true });
    const animation = animate(chapter.querySelector(".eyebrow")!, {
      opacity: [.45, 1], translateY: [10, 0], duration: 500, autoplay: entranceObserver,
    });
    return { observer: entranceObserver, animation };
  });
  function resize() {
    measure();
    observer.refresh();
    setProgress(poseProgress());
  }
  window.addEventListener("resize", resize);
  return () => {
    window.removeEventListener("resize", resize);
    observer.revert(); timeline.revert();
    entrances.forEach(({ observer, animation }) => { observer.revert(); animation.revert(); });
  };
}
