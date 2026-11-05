const { execSync, spawn } = require('child_process');
const fs = require('fs');

const rawBuffer = execSync('ffmpeg -i public/test_frames/forward_frame.jpg -f rawvideo -pix_fmt rgb24 -', { maxBuffer: 50 * 1024 * 1024 });

const W = 1920;
const H = 1080;

function createMouthFrame(jawDrop) {
  const out = Buffer.from(rawBuffer);

  const cx = 1378;
  const cy = 445;
  const rx = 36; // natural lip width
  const chinY = 525;

  if (jawDrop <= 0.05) return out;

  // 1. First deform the lower jaw and lip downwards
  for (let x = cx - 60; x <= cx + 60; x++) {
    const dx = (x - cx) / 60;
    if (Math.abs(dx) >= 1) continue;
    
    // Smooth horizontal bell curve
    const hFactor = 0.5 * (1 + Math.cos(dx * Math.PI));

    for (let y = chinY; y >= cy + 1; y--) {
      const vProgress = (y - cy) / (chinY - cy); // 0 at mouth, 1 at chin
      // Natural jaw biomechanics: lower lip drops most, chin drops along with it
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

  // 2. Now render the inner oral cavity smoothly between upper and lower lip
  for (let y = cy - 1; y <= cy + Math.ceil(jawDrop) + 3; y++) {
    for (let x = cx - rx - 2; x <= cx + rx + 2; x++) {
      const normX = (x - cx) / rx;
      if (Math.abs(normX) > 1.0) continue;

      // Natural anatomical lip aperture (tapering at corners)
      const openHeight = jawDrop * Math.pow(1 - normX * normX, 0.85);
      const upperLipY = cy - 0.5 * Math.sin(Math.abs(normX) * Math.PI) * (jawDrop * 0.15);
      const lowerLipY = upperLipY + openHeight;

      if (y >= upperLipY && y <= lowerLipY) {
        const innerProgress = (y - upperLipY) / Math.max(1, lowerLipY - upperLipY);
        // Distance from edge for soft anti-aliased blending
        const edgeDist = Math.min(
          Math.min(y - upperLipY, lowerLipY - y),
          (1 - Math.abs(normX)) * rx * 0.3
        );
        const alpha = Math.min(1.0, Math.max(0.0, edgeDist / 1.5));

        const idx = (y * W + x) * 3;
        
        // Dark interior mouth depth: deep obsidian shadow with subtle soft tongue/warmth
        let targetR = 12;
        let targetG = 10;
        let targetB = 16;
        
        // Subtle lower oral warmth / soft tongue reflection
        if (innerProgress > 0.55) {
          const tFactor = (innerProgress - 0.55) / 0.45;
          targetR += Math.round(tFactor * 14);
          targetG += Math.round(tFactor * 6);
          targetB += Math.round(tFactor * 10);
        }

        out[idx] = Math.round(out[idx] * (1 - alpha) + targetR * alpha);
        out[idx + 1] = Math.round(out[idx + 1] * (1 - alpha) + targetG * alpha);
        out[idx + 2] = Math.round(out[idx + 2] * (1 - alpha) + targetB * alpha);
      }
    }
  }

  return out;
}

// Generate test frame
const testMid = createMouthFrame(5.5);
const testFfmpeg = spawn('ffmpeg', [
  '-y',
  '-f', 'rawvideo',
  '-pix_fmt', 'rgb24',
  '-s', `${W}x${H}`,
  '-i', '-',
  '-vf', 'crop=240:240:1260:360',
  'public/test_frames/test_mouth_mid.jpg'
]);

testFfmpeg.stdin.write(testMid);
testFfmpeg.stdin.end();
testFfmpeg.on('close', () => {
  console.log('Saved test_mouth_mid.jpg');
});
