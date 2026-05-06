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

/**
 * Registers a progress handler that replaces any previous one.
 * Prevents listener stacking from multiple calls.
 */
let _currentProgressHandler = null;
function setProgressHandler(ff, onProgress) {
  // Remove previous listener to prevent stacking
  if (_currentProgressHandler) {
    ff.off('progress', _currentProgressHandler);
  }
  if (onProgress) {
    _currentProgressHandler = ({ progress }) => onProgress(progress);
    ff.on('progress', _currentProgressHandler);
  } else {
    _currentProgressHandler = null;
  }
}

export async function convertToMP4(webmBlob, onProgress) {
  const ff = await loadFFmpeg();
  
  setProgressHandler(ff, onProgress);

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
  setProgressHandler(ff, null);
  
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

export async function trimVideo(webmBlob, startTime, endTime) {
  const ff = await loadFFmpeg();
  
  const inputName = 'input_trim.webm';
  const outputName = 'output_trim.webm';

  await ff.writeFile(inputName, await fetchFileFunc(webmBlob));
  
  // Trim without re-encoding by using stream copy (-c copy)
  // This is extremely fast but requires keyframes at the cut points. 
  // WebM usually has frequent keyframes so it's acceptable.
  const args = ['-i', inputName];
  if (startTime > 0) {
    args.push('-ss', startTime.toString());
  }
  if (endTime > 0) {
    args.push('-to', endTime.toString());
  }
  args.push('-c', 'copy', outputName);
  
  await ff.exec(args);
  
  const data = await ff.readFile(outputName);
  
  await ff.deleteFile(inputName);
  await ff.deleteFile(outputName);
  
  return new Blob([data.buffer], { type: 'video/webm' });
}

export async function addWatermark(webmBlob, text, onProgress) {
  const ff = await loadFFmpeg();
  
  setProgressHandler(ff, onProgress);

  const inputName = 'input_wm.webm';
  const outputName = 'output_wm.webm';
  const fontName = 'font.ttf';

  await ff.writeFile(inputName, await fetchFileFunc(webmBlob));
  
  // Download font if not exists
  try {
    await ff.readFile(fontName);
  } catch (e) {
    const fontData = await fetchFileFunc('https://raw.githubusercontent.com/google/fonts/main/ofl/roboto/Roboto-Regular.ttf');
    await ff.writeFile(fontName, fontData);
  }
  
  // drawtext requires re-encoding video. We use libvpx-vp9 for high speed.
  // Escape characters that have meaning to ffmpeg's filtergraph & drawtext.
  const safeText = String(text)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\u2019") // curly apostrophe — drawtext can't escape ' inside a quoted string
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 120);

  await ff.exec([
    '-i', inputName,
    '-vf', `drawtext=fontfile=${fontName}:text='${safeText}':x=w-tw-20:y=h-th-20:fontsize=32:fontcolor=white@0.5:box=1:boxcolor=black@0.3:boxborderw=5`,
    '-c:v', 'libvpx-vp9', '-crf', '35', '-b:v', '0', '-cpu-used', '4',
    '-c:a', 'copy',
    outputName
  ]);
  
  const data = await ff.readFile(outputName);
  
  await ff.deleteFile(inputName);
  await ff.deleteFile(outputName);
  setProgressHandler(ff, null);
  
  return new Blob([data.buffer], { type: 'video/webm' });
}

export async function convertToGIF(webmBlob, onProgress) {
  const ff = await loadFFmpeg();
  
  setProgressHandler(ff, onProgress);

  const inputName = 'input_gif.webm';
  const paletteName = 'palette.png';
  const outputName = 'output.gif';

  await ff.writeFile(inputName, await fetchFileFunc(webmBlob));
  
  // Two-step GIF generation for compatibility with ffmpeg.wasm.
  // The single-pass `split[s0][s1]` filtergraph crashes in WASM builds,
  // so we generate the palette as a separate file first, then apply it.

  // Step 1: Generate color palette
  await ff.exec([
    '-i', inputName,
    '-vf', 'fps=10,scale=480:-1:flags=lanczos,palettegen',
    '-y', paletteName
  ]);

  // Step 2: Apply palette to create high-quality GIF
  await ff.exec([
    '-i', inputName,
    '-i', paletteName,
    '-filter_complex', 'fps=10,scale=480:-1:flags=lanczos[v];[v][1:v]paletteuse',
    '-loop', '0',
    '-y', outputName
  ]);
  
  const data = await ff.readFile(outputName);
  
  // Cleanup
  await ff.deleteFile(inputName);
  await ff.deleteFile(paletteName).catch(() => {});
  await ff.deleteFile(outputName);
  setProgressHandler(ff, null);
  
  return new Blob([data.buffer], { type: 'image/gif' });
}
