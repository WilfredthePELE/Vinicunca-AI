const { execSync, spawn } = require('child_process');
const fs = require('fs');

console.log('Loading forward frame...');
const rawBuffer = execSync('ffmpeg -i public/test_frames/forward_frame.jpg -f rawvideo -pix_fmt rgb24 -', { maxBuffer: 50 * 1024 * 1024 });

const W = 1920;
const H = 1080;
const FPS = 30;
const DURATION_SEC = 3.6; // 108 frames, perfect loop
const TOTAL_FRAMES = Math.round(FPS * DURATION_SEC);

const cx = 1378;
const cy = 445;
const rx = 36;
const chinY = 525;

function createMouthFrame(jawDrop, headTiltX = 0, headTiltY = 0) {
  const out = Buffer.from(rawBuffer);

  // 1. Lower jaw deformation
  if (jawDrop > 0.05) {
    for (let x = cx - 65; x <= cx + 65; x++) {
      const dx = (x - cx) / 65;
      if (Math.abs(dx) >= 1) continue;
      
      const hFactor = 0.5 * (1 + Math.cos(dx * Math.PI));

      for (let y = chinY; y >= cy + 1; y--) {
        const vProgress = (y - cy) / (chinY - cy);
        const vFactor = Math.cos(vProgress * Math.PI * 0.45);
        
        const shift = jawDrop * hFactor * vFactor;
        const srcY = y - shift;
        
        if (srcY >= cy && srcY < H) {
          const y0 = Math.floor(srcY);
          const y1 = Math.min(H - 1, y0 + 1);
          const wy1 = srcY - y0;
          const wy0 = 1 - wy1;

          const dstIdx = (y * W + x) * 3;
          const srcIdx0 = (y0 * W + x) * 3;
          const srcIdx1 = (y1 * W + x) * 3;

          for (let c = 0; c < 3; c++) {
            out[dstIdx + c] = Math.round(rawBuffer[srcIdx0 + c] * wy0 + rawBuffer[srcIdx1 + c] * wy1);
          }
        }
      }
    }

    // 2. Inner oral cavity
    for (let y = cy - 1; y <= cy + Math.ceil(jawDrop) + 3; y++) {
      for (let x = cx - rx - 2; x <= cx + rx + 2; x++) {
        const normX = (x - cx) / rx;
        if (Math.abs(normX) > 1.0) continue;

        const openHeight = jawDrop * Math.pow(1 - normX * normX, 0.85);
        const upperLipY = cy - 0.5 * Math.sin(Math.abs(normX) * Math.PI) * (jawDrop * 0.15);
        const lowerLipY = upperLipY + openHeight;

        if (y >= upperLipY && y <= lowerLipY) {
          const innerProgress = (y - upperLipY) / Math.max(1, lowerLipY - upperLipY);
          const edgeDist = Math.min(
            Math.min(y - upperLipY, lowerLipY - y),
            (1 - Math.abs(normX)) * rx * 0.35
          );
          const alpha = Math.min(1.0, Math.max(0.0, edgeDist / 1.4));

          const idx = (y * W + x) * 3;
          
          let targetR = 11;
          let targetG = 9;
          let targetB = 15;
          
          if (innerProgress > 0.5) {
            const tFactor = (innerProgress - 0.5) / 0.5;
            targetR += Math.round(tFactor * 16);
            targetG += Math.round(tFactor * 8);
            targetB += Math.round(tFactor * 12);
          }

          out[idx] = Math.round(out[idx] * (1 - alpha) + targetR * alpha);
          out[idx + 1] = Math.round(out[idx + 1] * (1 - alpha) + targetG * alpha);
          out[idx + 2] = Math.round(out[idx + 2] * (1 - alpha) + targetB * alpha);
        }
      }
    }
  }

  return out;
}

// Generate syllable cadence for 108 frames
// Sequence of natural human conversational phonemes
const syllables = [
  // Syllable 1: "Wel" (open)
  { start: 0, peak: 5, end: 11, maxDrop: 5.5 },
  // Syllable 2: "come" (bilabial closure)
  { start: 10, peak: 14, end: 18, maxDrop: 2.2 },
  // Syllable 3: "to" (moderate)
  { start: 17, peak: 21, end: 25, maxDrop: 4.2 },
  // Syllable 4: "the" (soft)
  { start: 24, peak: 28, end: 32, maxDrop: 3.5 },
  // Syllable 5: "Vi-" (wide)
  { start: 31, peak: 37, end: 43, maxDrop: 6.0 },
  // Syllable 6: "-ni-" (moderate)
  { start: 42, peak: 47, end: 51, maxDrop: 4.0 },
  // Syllable 7: "-cun-" (open resonant)
  { start: 50, peak: 56, end: 62, maxDrop: 6.5 },
  // Syllable 8: "-ca" (open taper)
  { start: 61, peak: 67, end: 73, maxDrop: 5.2 },
  // Micro pause at 74..78 (resting closure)
  // Syllable 9: "What" (open)
  { start: 79, peak: 84, end: 89, maxDrop: 5.8 },
  // Syllable 10: "is" (half)
  { start: 88, peak: 92, end: 96, maxDrop: 3.8 },
  // Syllable 11: "your" (round)
  { start: 95, peak: 100, end: 105, maxDrop: 4.8 },
  // Syllable 12: "name" (gentle closure into loop start)
  { start: 104, peak: 106, end: 108, maxDrop: 1.5 },
];

function getJawDropAtFrame(frameIdx) {
  let drop = 0;
  for (const syl of syllables) {
    if (frameIdx >= syl.start && frameIdx <= syl.end) {
      if (frameIdx <= syl.peak) {
        const t = (frameIdx - syl.start) / Math.max(1, syl.peak - syl.start);
        drop = Math.max(drop, syl.maxDrop * Math.sin(t * Math.PI * 0.5));
      } else {
        const t = (frameIdx - syl.peak) / Math.max(1, syl.end - syl.peak);
        drop = Math.max(drop, syl.maxDrop * Math.cos(t * Math.PI * 0.5));
      }
    }
  }
  return drop;
}

console.log(`Generating ${TOTAL_FRAMES} frames for vinicunca_speaking.mp4...`);

const ffmpegProc = spawn('ffmpeg', [
  '-y',
  '-f', 'rawvideo',
  '-pix_fmt', 'rgb24',
  '-s', `${W}x${H}`,
  '-r', `${FPS}`,
  '-i', '-',
  '-c:v', 'libx264',
  '-preset', 'veryfast',
  '-crf', '18',
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  'public/video/vinicunca_speaking.mp4'
]);

ffmpegProc.stderr.on('data', (d) => {
  // console.log(d.toString());
});

let currentFrame = 0;
function writeNext() {
  while (currentFrame < TOTAL_FRAMES) {
    const drop = getJawDropAtFrame(currentFrame);
    const frameBuffer = createMouthFrame(drop);
    currentFrame++;
    const ok = ffmpegProc.stdin.write(frameBuffer);
    if (!ok) {
      ffmpegProc.stdin.once('drain', writeNext);
      return;
    }
  }
  ffmpegProc.stdin.end();
}

writeNext();

ffmpegProc.on('close', (code) => {
  console.log(`Finished encoding speaking video. Exit code: ${code}`);
  const stat = fs.statSync('public/video/vinicunca_speaking.mp4');
  console.log(`Video size: ${(stat.size / 1024 / 1024).toFixed(2)} MB`);
});
