// Generates the ink-wash artwork with nevatoken: images via gpt-image-2,
// ambient loops via happyhorse image-to-video.
//
//   node --env-file=.env scripts/generate-media.mjs            # everything missing
//   node --env-file=.env scripts/generate-media.mjs bg og      # only these
//   node --env-file=.env scripts/generate-media.mjs --force bg-video
//   node --env-file=.env scripts/generate-media.mjs --resume=<task id> bg-video
//
// Originals go to ../generated-art/ink/, web-ready files to public/.
// Needs ffmpeg and macOS `sips` for conversion.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGINALS = join(ROOT, '..', 'generated-art', 'ink');
const PUBLIC = join(ROOT, 'public');
const API = (process.env.NEVA_API_BASE_URL || 'https://nevatoken.com/v1').replace(/\/+$/, '');
const KEY = process.env.NEVA_API_KEY;
const IMAGE_MODEL = 'gpt-image-2';
const VIDEO_MODEL = 'happyhorse-1.1-i2v';
// Scenes with no still to start from are generated from text alone.
const TEXT_VIDEO_MODEL = 'happyhorse-1.1-t2v';
const POLL_MS = 15_000;
const VIDEO_TIMEOUT_MS = 15 * 60_000;

const STYLE =
  'Traditional Chinese ink-wash painting (shuimo), black ink on warm off-white xuan rice paper, expressive calligraphic brush strokes, ink gradations from deep black to the palest grey wash, wet-on-wet bleeding edges, dry-brush texture, generous empty space (liubai), subtle paper fibre texture.';
const PALETTE = 'Strictly monochrome: black and grey ink on off-white rice paper only. No colour at all, no red seals.';
const NO_TEXT = 'No text, calligraphy, Chinese characters, seals, stamps, signatures, logos, watermarks, frames or borders.';
const SCENE = `Misty mountain peaks rising out of drifting clouds above a still river, layered ridges fading from dense black ink to pale wash, a few gnarled pines clinging to cliffs, a pale moon left as an empty circle of paper, vast empty sky. Serene, sparse, poetic and otherworldly. No people, animals, boats, buildings, temples, pagodas or bridges.`;

// Shared by the quiet ritual scenes (stilling, casting, reveal, farewell).
const STILL_INK =
  'Traditional Chinese ink-wash aesthetic, strictly monochrome black and grey ink on warm off-white, soft and luminous, extremely slow and meditative motion, no text, no characters, no people, no camera movement.';

const LOOP_PROMPT =
  'Seamless subtle cinemagraph of an ink-wash painting. The camera is completely static. Pale ink mist drifts slowly between the peaks, the wash gently breathes and diffuses into the paper, faint ripples move on the river. Calm, slow motion only; the painting stays monochrome; no new objects, no characters, no camera movement.';

const ASSETS = {
  bg: {
    kind: 'image',
    size: '1536x1024',
    original: 'ink-mountains.png',
    output: 'backgrounds/ink-mountains.jpg',
    prompt: `Full-bleed 16:9 desktop website background. ${SCENE} Composition: the mountains and pines occupy the left third and the bottom edge; the right half is mostly empty paper and pale mist because a chat panel sits there. ${STYLE} ${PALETTE} ${NO_TEXT}`,
  },
  'bg-mobile': {
    kind: 'image',
    size: '1024x1536',
    original: 'ink-mountains-mobile.png',
    output: 'backgrounds/ink-mountains-mobile.jpg',
    prompt: `Full-bleed tall 9:16 mobile website background. ${SCENE} Composition: peaks, pines and moon all within the top 40%; the lower 60% is almost empty pale paper with only faint mist, suitable for chat bubbles. ${STYLE} ${PALETTE} ${NO_TEXT}`,
  },
  og: {
    kind: 'image',
    size: '1536x1024',
    original: 'og.png',
    output: 'og.jpg',
    crop: [1536, 806],
    prompt: `Social preview key art, pure atmosphere with no characters. ${SCENE} On the right third a large bagua diagram painted in bold black brush strokes floats in the mist inside an enso brush circle, with a taiji at its centre. Keep the left half mostly empty paper for a title overlaid later. ${STYLE} ${PALETTE} ${NO_TEXT}`,
  },
  cast: {
    kind: 'image',
    size: '1536x1024',
    original: 'casting.png',
    output: 'backgrounds/casting.jpg',
    prompt: `A large bagua diagram painted in black ink on rice paper, seen straight on and centred: the eight trigrams as bold, thick calligraphic brush strokes arranged in a circle, an expressive enso brush circle around them with dry-brush tails, ink splashes and wet ink bleeding softly into the paper, pale ink mist washing around the edges. The middle of the diagram is an empty pale circle of paper (no taiji) left for text overlaid later. ${STYLE} ${PALETTE} ${NO_TEXT}`,
  },
  'cast-video': {
    kind: 'video',
    from: 'cast',
    size: '1280x720',
    seconds: '8',
    loop: false,
    output: 'videos/casting.mp4',
    prompt:
      'The camera stays still. Black ink slowly blooms and spreads into the wet rice paper, the brush strokes of the bagua darken and settle, pale ink mist drifts and swirls around the enso circle, tiny ink droplets diffuse. Elegant, slow, meditative motion; strictly monochrome ink on paper; no text, no characters, no camera movement.',
  },
  'still-video': {
    kind: 'video',
    size: '1280x720',
    seconds: '8',
    loop: false,
    output: 'videos/still.mp4',
    prompt: `Seen from directly above: a perfectly still pool of clear water over pale paper. A single drop of black ink falls into the centre, and the ink blooms very slowly into soft, feathery clouds that unfurl and thin out into pale grey wisps. ${STILL_INK}`,
  },
  'cast-pool-video': {
    kind: 'video',
    size: '1280x720',
    seconds: '8',
    output: 'videos/cast-pool.mp4',
    prompt: `Seen from directly above: a calm circular pool of water on pale paper. Faint grey ink mist drifts in a slow circle around the edges while the centre stays clear and quiet; now and then a tiny ripple crosses the surface. ${STILL_INK}`,
  },
  'reveal-video': {
    kind: 'video',
    size: '1280x720',
    seconds: '8',
    loop: false,
    output: 'videos/reveal.mp4',
    prompt: `Seen from directly above: concentric ripples spread slowly outward across still water from the centre, carrying a dark ring of ink that softens and fades into pale paper, leaving the centre calm and bright. ${STILL_INK}`,
  },
  'farewell-video': {
    kind: 'video',
    size: '1280x720',
    seconds: '8',
    loop: false,
    output: 'videos/farewell.mp4',
    prompt: `An ink-wash landscape of misty mountain peaks; pale mist slowly rises and drifts across the scene, veiling the peaks one by one until only soft blank paper and a faint outline remain. ${STILL_INK}`,
  },
  'bg-video': {
    kind: 'video',
    from: 'bg',
    size: '1280x720',
    seconds: '8',
    output: 'videos/ink-mountains.mp4',
    prompt: LOOP_PROMPT,
  },
  'bg-mobile-video': {
    kind: 'video',
    from: 'bg-mobile',
    size: '720x1280',
    seconds: '8',
    output: 'videos/ink-mountains-mobile.mp4',
    prompt: LOOP_PROMPT,
  },
};

function ensureDir(file) {
  mkdirSync(dirname(file), { recursive: true });
}

// curl instead of fetch: high-quality images can take over five minutes,
// past Node's built-in fetch response timeout.
function api(path, body) {
  const args = ['-sS', '--max-time', '900', `${API}${path}`, '-H', `Authorization: Bearer ${KEY}`];
  if (body) args.push('-H', 'Content-Type: application/json', '--data-binary', '@-');
  let text;
  try {
    text = execFileSync('curl', args, {
      input: body ? JSON.stringify(body) : undefined,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();
  } catch (error) {
    // The failed command line includes the Authorization header; never print it.
    const detail = String(error.stderr || error.message).split(KEY).join('***');
    throw new Error(`${path} request failed: ${detail.trim().slice(0, 300)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${path} returned non-JSON: ${text.slice(0, 300)}`);
  }
  if (parsed.error || (parsed.code && !parsed.id)) {
    throw new Error(`${path} failed: ${JSON.stringify(parsed).slice(0, 400)}`);
  }
  return parsed;
}

async function withRetry(label, task, attempts = 2) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      if (attempt >= attempts) throw error;
      console.warn(`${label} failed (${error.message}); retrying…`);
    }
  }
}

async function generateImage(name, asset, force) {
  const original = join(ORIGINALS, asset.original);
  if (!existsSync(original) || force) {
    console.log(`[${name}] generating image ${asset.size}…`);
    const body = await withRetry(`[${name}]`, () =>
      api('/images/generations', {
        model: IMAGE_MODEL,
        prompt: asset.prompt,
        size: asset.size,
        quality: 'high',
        n: 1,
        ...(asset.background ? { background: asset.background } : {}),
      }),
    );
    const data = body.data?.[0];
    const bytes = data?.b64_json
      ? Buffer.from(data.b64_json, 'base64')
      : Buffer.from(await (await fetch(data.url)).arrayBuffer());
    ensureDir(original);
    writeFileSync(original, bytes);
  }

  const output = join(PUBLIC, asset.output);
  ensureDir(output);
  if (asset.output.endsWith('.webp')) {
    // Lossy WebP keeps the alpha channel at a fraction of the PNG size.
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', original, '-vf', 'scale=-2:1024', '-c:v', 'libwebp', '-quality', '88', output]);
  } else {
    const filters = asset.crop ? ['-vf', `crop=${asset.crop[0]}:${asset.crop[1]}`] : [];
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', original, ...filters, '-q:v', '3', output]);
  }
  console.log(`[${name}] → public/${asset.output}`);
}

async function generateVideo(name, asset, force, resumeTask) {
  const output = join(PUBLIC, asset.output);
  if (existsSync(output) && !force && !resumeTask) return console.log(`[${name}] exists, skipping`);
  // Image-to-video starts from one of our stills; text-to-video needs none.
  let image;
  if (asset.from) {
    const source = ASSETS[asset.from];
    const sourcePath = join(ORIGINALS, source.original);
    if (!existsSync(sourcePath)) await generateImage(asset.from, source, false);
    const [width, height] = asset.size.split('x');
    const frame = join(ORIGINALS, `${name}-frame.jpg`);
    execFileSync('ffmpeg', [
      '-y', '-loglevel', 'error', '-i', sourcePath,
      '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height}`,
      '-q:v', '2', frame,
    ]);
    image = `data:image/jpeg;base64,${readFileSync(frame).toString('base64')}`;
  }

  let task;
  if (resumeTask) {
    task = { id: resumeTask, status: 'queued' };
    console.log(`[${name}] resuming task ${resumeTask}`);
  } else {
    console.log(`[${name}] submitting ${image ? VIDEO_MODEL : TEXT_VIDEO_MODEL} ${asset.size} ${asset.seconds}s…`);
    task = api('/videos', {
      model: image ? VIDEO_MODEL : TEXT_VIDEO_MODEL,
      prompt: asset.prompt,
      seconds: asset.seconds,
      size: asset.size,
      ...(image ? { image } : {}),
    });
    console.log(`[${name}] task ${task.id} (resume with --resume=${task.id} ${name})`);
  }

  const started = Date.now();
  let status = task;
  let networkErrors = 0;
  while (status.status !== 'completed') {
    if (status.status === 'failed') throw new Error(`[${name}] video failed: ${JSON.stringify(status).slice(0, 300)}`);
    if (Date.now() - started > VIDEO_TIMEOUT_MS) throw new Error(`[${name}] timed out (task ${task.id})`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    try {
      status = api(`/videos/${task.id}`);
      networkErrors = 0;
    } catch (error) {
      // Polling is idempotent, so ride out short network blips.
      if (++networkErrors > 5) throw error;
      console.warn(`[${name}] poll failed, retrying: ${error.message}`);
      continue;
    }
    console.log(`[${name}] ${status.status} ${status.progress ?? ''}`);
  }

  const raw = join(ORIGINALS, `${name}-raw.mp4`);
  const url = status.metadata?.url ?? status.url;
  writeFileSync(raw, Buffer.from(await (await fetch(url)).arrayBuffer()));

  // Ping-pong ambient clips into a seamless loop; one-shot clips play forward.
  // Either way drop the audio and keep the file web-light.
  ensureDir(output);
  const filter =
    asset.loop === false
      ? '[0:v]null[v]'
      : '[0:v]split[a][b];[b]reverse[r];[a][r]concat=n=2:v=1[v]';
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-i', raw,
    '-filter_complex', filter,
    '-map', '[v]', '-an', '-c:v', 'libx264', '-crf', '27', '-preset', 'slow',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', output,
  ]);
  console.log(`[${name}] → public/${asset.output}`);
}

async function main() {
  if (!KEY) throw new Error('NEVA_API_KEY is missing; run with --env-file=.env');
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const resumeTask = args.find((arg) => arg.startsWith('--resume='))?.slice('--resume='.length);
  const names = args.filter((arg) => !arg.startsWith('--'));
  const selected = names.length ? names : Object.keys(ASSETS);
  for (const name of selected) {
    if (!ASSETS[name]) throw new Error(`Unknown asset "${name}". Known: ${Object.keys(ASSETS).join(', ')}`);
  }

  // Images first (videos depend on them), each group in parallel.
  const images = selected.filter((name) => ASSETS[name].kind === 'image');
  const videos = selected.filter((name) => ASSETS[name].kind === 'video');
  const run = (name) =>
    (ASSETS[name].kind === 'image' ? generateImage : generateVideo)(name, ASSETS[name], force, resumeTask).catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
  await Promise.all(images.map(run));
  await Promise.all(videos.map(run));
}

await main();
