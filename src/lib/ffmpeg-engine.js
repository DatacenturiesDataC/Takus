// Takus — FFmpeg Engine (WebM to MP4 & Audio Extraction)

let ffmpeg = null;
let FFmpegClass = null;
let fetchFileFunc = null;

async function loadFFmpeg() {
  if (ffmpeg) return ffmpeg;

  // Dynamically load ffmpeg scripts if not loaded
  if (!window.FFmpeg) {
    await loadScript('https://unpkg.com/@ffmpeg/ffmpeg@0.12.7/dist/umd/ffmpeg.js');
    await loadScript('https://unpkg.com/@ffmpeg/util@0.12.1/dist/umd/index.js');
  }

  FFmpegClass = window.FFmpeg.FFmpeg;
  fetchFileFunc = window.FFmpegUtil.fetchFile;

  ffmpeg = new FFmpegClass();
  
  // Use single-threaded core which doesn't require SharedArrayBuffer
  await ffmpeg.load({
    coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.4/dist/umd/ffmpeg-core.js',
    wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.4/dist/umd/ffmpeg-core.wasm',
  });

  return ffmpeg;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(el);
  });
}

export async function convertToMP4(webmBlob, onProgress) {
  const ff = await loadFFmpeg();
  
  ff.on('progress', ({ progress }) => {
    if (onProgress) onProgress(progress);
  });

  const inputName = 'input.webm';
  const outputName = 'output.mp4';

  await ff.writeFile(inputName, await fetchFileFunc(webmBlob));
  
  // Fast copy if codecs allow, otherwise re-encode. WebM usually is VP8/VP9. MP4 needs H.264.
  // We'll re-encode to be safe and compatible.
  await ff.exec(['-i', inputName, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-c:a', 'aac', outputName]);
  
  const data = await ff.readFile(outputName);
  
  // Cleanup
  await ff.deleteFile(inputName);
  await ff.deleteFile(outputName);
  
  return new Blob([data.buffer], { type: 'video/mp4' });
}

export async function extractAudio(webmBlob) {
  const ff = await loadFFmpeg();
  
  const inputName = 'input_audio.webm';
  const outputName = 'output_audio.mp3';

  await ff.writeFile(inputName, await fetchFileFunc(webmBlob));
  
  // Extract audio as 64kbps MP3 for Whisper API (keeps file size small)
  await ff.exec(['-i', inputName, '-vn', '-c:a', 'libmp3lame', '-b:a', '64k', outputName]);
  
  const data = await ff.readFile(outputName);
  
  await ff.deleteFile(inputName);
  await ff.deleteFile(outputName);
  
  return new Blob([data.buffer], { type: 'audio/mpeg' });
}
