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

  if (!window.FFmpeg || !window.FFmpegUtil) {
    throw new Error('FFmpeg libraries failed to initialize. Check your internet connection or try disabling ad blockers.');
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
  // Prevent duplicate script loading
  const existing = document.querySelector(`script[src="${src}"]`);
  if (existing) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error(
      `Failed to load FFmpeg from CDN (${src.split('/').pop()}). ` +
      'This may be caused by a network issue, ad blocker, or corporate firewall.'
    ));
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

/**
 * Validates a blob before passing it to FFmpeg.
 * Prevents crashes from empty or corrupted recordings.
 */
function validateBlob(blob, operation) {
  if (!blob) throw new Error(`${operation}: No recording data provided.`);
  if (blob.size < 1024) throw new Error(`${operation}: Recording is too short or empty (${blob.size} bytes). Record for at least a few seconds.`);
}

export async function convertToMP4(webmBlob, onProgress) {
  validateBlob(webmBlob, 'MP4 conversion');
  const ff = await loadFFmpeg();
  
  setProgressHandler(ff, onProgress);

  const inputName = 'input.webm';
  const outputName = 'output.mp4';

  await ff.writeFile(inputName, await fetchFileFunc(webmBlob));
  
  try {
    await ff.exec(['-i', inputName, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-c:a', 'aac', outputName]);
    const data = await ff.readFile(outputName);
    return new Blob([data.buffer], { type: 'video/mp4' });
  } finally {
    await ff.deleteFile(inputName).catch(() => {});
    await ff.deleteFile(outputName).catch(() => {});
    setProgressHandler(ff, null);
  }
}

export async function extractAudio(webmBlob) {
  validateBlob(webmBlob, 'Audio extraction');
  const ff = await loadFFmpeg();
  
  const inputName = 'input_audio.webm';
  const outputName = 'output_audio.mp3';

  await ff.writeFile(inputName, await fetchFileFunc(webmBlob));
  
  try {
    await ff.exec(['-i', inputName, '-vn', '-c:a', 'libmp3lame', '-b:a', '64k', outputName]);
    const data = await ff.readFile(outputName);
    return new Blob([data.buffer], { type: 'audio/mpeg' });
  } finally {
    await ff.deleteFile(inputName).catch(() => {});
    await ff.deleteFile(outputName).catch(() => {});
  }
}

export async function trimVideo(webmBlob, startTime, endTime) {
  validateBlob(webmBlob, 'Video trimming');
  const ff = await loadFFmpeg();
  
  const inputName = 'input_trim.webm';
  const outputName = 'output_trim.webm';

  await ff.writeFile(inputName, await fetchFileFunc(webmBlob));
  
  try {
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
    return new Blob([data.buffer], { type: 'video/webm' });
  } finally {
    await ff.deleteFile(inputName).catch(() => {});
    await ff.deleteFile(outputName).catch(() => {});
  }
}

export async function addWatermark(webmBlob, text, onProgress) {
  validateBlob(webmBlob, 'Watermark');
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
  
  // Escape characters that have meaning to ffmpeg's filtergraph & drawtext.
  const safeText = String(text)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\u2019")
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
  validateBlob(webmBlob, 'GIF conversion');
  const ff = await loadFFmpeg();
  
  setProgressHandler(ff, onProgress);

  const inputName = 'input_gif.webm';
  const outputName = 'output.gif';

  await ff.writeFile(inputName, await fetchFileFunc(webmBlob));
  
  // Strategy: Try the high-quality single-pass split+palette approach first.
  // If it fails (some ffmpeg.wasm builds don't support complex filtergraphs),
  // fall back to a simple direct GIF conversion.
  
  let success = false;

  // Attempt 1: High-quality single-pass with palette optimization
  try {
    await ff.exec([
      '-i', inputName,
      '-vf', 'fps=10,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
      '-loop', '0',
      '-y', outputName
    ]);
    success = true;
  } catch (e) {
    console.warn('[GIF] High-quality palette method failed, trying fallback:', e.message);
  }

  // Attempt 2: Two-step palette (separate file)
  if (!success) {
    const paletteName = 'palette.png';
    try {
      await ff.exec([
        '-i', inputName,
        '-vf', 'fps=10,scale=480:-1:flags=lanczos,palettegen',
        '-y', paletteName
      ]);
      await ff.exec([
        '-i', inputName,
        '-i', paletteName,
        '-lavfi', '[0:v]fps=10,scale=480:-1:flags=lanczos[v];[v][1:v]paletteuse',
        '-loop', '0',
        '-y', outputName
      ]);
      success = true;
      await ff.deleteFile(paletteName).catch(() => {});
    } catch (e2) {
      console.warn('[GIF] Two-step palette method failed, trying simple fallback:', e2.message);
      await ff.deleteFile(paletteName).catch(() => {});
    }
  }

  // Attempt 3: Simple direct conversion (lower quality but guaranteed to work)
  if (!success) {
    try {
      await ff.exec([
        '-i', inputName,
        '-vf', 'fps=10,scale=480:-1',
        '-loop', '0',
        '-y', outputName
      ]);
      success = true;
    } catch (e3) {
      console.error('[GIF] All conversion methods failed:', e3);
    }
  }

  if (!success) {
    await ff.deleteFile(inputName).catch(() => {});
    setProgressHandler(ff, null);
    throw new Error('GIF conversion failed. The recording may be too long or your browser ran out of memory. Try a shorter clip.');
  }

  const data = await ff.readFile(outputName);
  
  // Validate output
  if (!data || data.length < 100) {
    await ff.deleteFile(inputName).catch(() => {});
    await ff.deleteFile(outputName).catch(() => {});
    setProgressHandler(ff, null);
    throw new Error('GIF output was empty. Try recording a shorter clip.');
  }

  // Cleanup
  await ff.deleteFile(inputName).catch(() => {});
  await ff.deleteFile(outputName).catch(() => {});
  setProgressHandler(ff, null);
  
  return new Blob([data.buffer], { type: 'image/gif' });
}
