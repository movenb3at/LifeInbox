import { createWorker, OEM, type Worker } from "tesseract.js";

export async function readScreenshot(image: Blob, progress: (message: string) => void, signal: AbortSignal) {
  let worker: Worker | undefined;
  let finished = false;
  let rejectFailure: (error: Error) => void = () => {};
  const failure = new Promise<never>((_, reject) => { rejectFailure = reject; });
  const cancel = () => { rejectFailure(new Error("판독이 중단되었습니다. 원본은 보관한 스크린샷에서 다시 시도할 수 있습니다.")); };
  const timer = setTimeout(() => rejectFailure(new Error("이미지 판독 시간이 초과되었습니다. 필요한 부분만 캡처하거나 다시 시도해주세요.")), 120000);
  signal.addEventListener("abort", cancel, { once: true });
  try {
    const recognition = async () => {
      // 모델이 없을 때 라이브러리 초기화가 멈추는 경우를 먼저 차단합니다.
      await Promise.all(["/ocr/worker.min.js", "/ocr/lang/kor.traineddata", "/ocr/lang/eng.traineddata"].map(async path => {
        const response = await fetch(path, { method: "HEAD", cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
        if (!response.ok) throw new Error("OCR 파일을 불러오지 못했습니다. 서버 연결을 확인한 뒤 재시도해주세요.");
      }));
      const initialized = await createWorker(["kor", "eng"], OEM.LSTM_ONLY, {
        workerPath: "/ocr/worker.min.js", corePath: "/ocr/core", langPath: "/ocr/lang", gzip: false,
        errorHandler: () => rejectFailure(new Error("판독기를 실행하지 못했습니다. 서버 연결과 이미지 형식을 확인한 뒤 재시도해주세요.")),
        logger: entry => {
          if (finished) return;
          const value = Math.round(entry.progress * 100);
          progress(entry.status === "recognizing text" ? `글자를 읽고 있습니다… ${value}%` : "한국어·영어 판독기를 준비하고 있습니다…");
        },
      });
      if (finished || signal.aborted) { await initialized.terminate(); throw new Error("판독이 중단되었습니다."); }
      worker = initialized;
      const { data } = await worker.recognize(image);
      const text = data.text.trim();
      if (!text) throw new Error("이미지에서 글자를 찾지 못했습니다. 선명한 스크린샷으로 다시 시도해주세요.");
      if (text.length > 50000) throw new Error("판독한 내용이 너무 깁니다. 필요한 부분만 캡처해주세요.");
      return { text, confidence: data.confidence };
    };
    return await Promise.race([recognition(), failure]);
  } finally {
    finished = true; clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
    await worker?.terminate();
  }
}
