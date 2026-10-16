const MAX_EDGE = 1024;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_PIXELS = 60_000_000;

self.onmessage = async (event: MessageEvent<File>) => {
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(event.data, { imageOrientation: 'from-image' });
    if (bitmap.width * bitmap.height > MAX_PIXELS) {
      throw new Error('이미지가 너무 커서 사용할 수 없습니다. 다른 사진을 선택해 주세요.');
    }
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    );
    const context = canvas.getContext('2d');
    if (!context) throw new Error('이미지를 처리할 수 없습니다.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let blob: Blob | null = null;
    for (const quality of [0.9, 0.8, 0.7, 0.6, 0.5, 0.4]) {
      blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      if (blob.size <= MAX_BYTES) break;
    }
    if (!blob || blob.size > MAX_BYTES) throw new Error('이미지 용량이 커서 사용할 수 없습니다.');
    self.postMessage({ blob, width: canvas.width, height: canvas.height });
    canvas.width = 0;
    canvas.height = 0;
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : '이미지를 처리할 수 없습니다.',
    });
  } finally {
    bitmap?.close();
  }
};
