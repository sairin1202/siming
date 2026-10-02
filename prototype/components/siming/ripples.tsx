import { useEffect, useRef } from 'react';

/** Ask the water to take a drop at a viewport point (0–1 coordinates). */
export function dropOnWater(x: number, y: number, strength = 1) {
  window.dispatchEvent(new CustomEvent('siming:drop', { detail: { x, y, strength } }));
}

export type RippleSource = () => HTMLVideoElement | HTMLImageElement | null;

const MAX_DROPS = 8;

const VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

// Each drop is an expanding, decaying wave packet. The painting is sampled
// through the slope of that surface, so it bends where the waves pass; crests
// also catch a little paper-white light and troughs a faint ink shadow.
const FRAGMENT = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform float uScale;
uniform vec4 uDrops[${MAX_DROPS}];
uniform sampler2D uTex;
uniform vec2 uTexScale;
uniform vec2 uTexOffset;
uniform float uHasTex;

float height(vec2 p, vec4 d) {
  float t = uTime - d.z;
  if (t < 0.0 || t > 7.0) return 0.0;
  vec2 q = (p - d.xy * uRes) / uScale; // work in CSS pixels
  q.y *= 2.6;                          // lake perspective: rings flatten to ellipses
  float r = length(q);
  float front = 70.0 * t;
  float width = 26.0 + 22.0 * t;       // the packet spreads as it travels
  float envelope = exp(-pow((r - front) / width, 2.0));
  float wave = sin((r - front) * 0.16);
  float fade = exp(-0.55 * t) * smoothstep(0.0, 0.25, t);
  return d.w * envelope * wave * fade;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  float h = 0.0;
  float hx = 0.0;
  float hy = 0.0;
  for (int i = 0; i < ${MAX_DROPS}; i++) {
    vec4 d = uDrops[i];
    if (d.w <= 0.0) continue;
    h += height(p, d);
    hx += height(p + vec2(1.5 * uScale, 0.0), d);
    hy += height(p + vec2(0.0, 1.5 * uScale), d);
  }
  vec2 slope = vec2(h - hx, h - hy);
  vec3 n = normalize(vec3(slope, 0.35));
  float light = dot(n, normalize(vec3(-0.4, -0.7, 0.6))) - 0.6;

  if (uHasTex < 0.5) {
    float a = clamp(abs(light) * 1.6, 0.0, 0.55);
    vec3 col = light > 0.0 ? vec3(1.0, 0.99, 0.96) : vec3(0.11, 0.1, 0.09);
    gl_FragColor = vec4(col * a, a);
    return;
  }

  // Refraction: shift where we read the painting by the surface slope.
  vec2 uv = p / uRes + slope * 34.0 * uScale / uRes;
  vec3 paint = texture2D(uTex, uv * uTexScale + uTexOffset).rgb;
  float grey = dot(paint, vec3(0.299, 0.587, 0.114));
  vec3 col = vec3(grey) + light * 0.16;
  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

function compile(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  return shader;
}

function sourceSize(source: HTMLVideoElement | HTMLImageElement) {
  return source instanceof HTMLVideoElement
    ? { width: source.videoWidth, height: source.videoHeight, ready: source.readyState >= 2 }
    : { width: source.naturalWidth, height: source.naturalHeight, ready: source.complete && source.naturalWidth > 0 };
}

/** Start the water renderer on a canvas; returns a cleanup function. */
function startRipples(canvas: HTMLCanvasElement, getSource: RippleSource): (() => void) | undefined {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true });
  if (!gl) return undefined;

  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return undefined;
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const uRes = uniform('uRes');
  const uTime = uniform('uTime');
  const uDrops = uniform('uDrops');
  const uScale = uniform('uScale');
  const uTexScale = uniform('uTexScale');
  const uTexOffset = uniform('uTexOffset');
  const uHasTex = uniform('uHasTex');
  const drops = new Float32Array(MAX_DROPS * 4);
  let next = 0;
  const start = performance.now();
  const now = () => (performance.now() - start) / 1000;

  const addDrop = (x: number, y: number, strength: number) => {
    drops.set([x, y, now(), strength], next * 4);
    next = (next + 1) % MAX_DROPS;
  };
  const onDrop = (event: Event) => {
    const { x, y, strength } = (event as CustomEvent<{ x: number; y: number; strength: number }>).detail;
    addDrop(x, y, strength);
  };
  window.addEventListener('siming:drop', onDrop);

  const resize = () => {
    const scale = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(canvas.clientWidth * scale);
    canvas.height = Math.round(canvas.clientHeight * scale);
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  resize();
  window.addEventListener('resize', resize);

  // Ambient drops on the lake, every few seconds.
  let ambient: ReturnType<typeof setTimeout>;
  const scheduleAmbient = () => {
    ambient = setTimeout(() => {
      addDrop(0.15 + Math.random() * 0.7, 0.66 + Math.random() * 0.26, 0.6 + Math.random() * 0.4);
      scheduleAmbient();
    }, 2600 + Math.random() * 3200);
  };
  addDrop(0.5, 0.82, 0.9);
  scheduleAmbient();

  let uploaded: HTMLImageElement | null = null;
  let frame = 0;
  const render = () => {
    const source = getSource();
    const size = source ? sourceSize(source) : null;
    let hasTexture = false;
    if (source && size?.ready) {
      // Videos change every frame; a still only needs uploading once.
      if (source instanceof HTMLVideoElement || uploaded !== source) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
        uploaded = source instanceof HTMLImageElement ? source : null;
      }
      // object-fit: cover
      const canvasAspect = canvas.width / canvas.height;
      const sourceAspect = size.width / size.height;
      if (sourceAspect > canvasAspect) {
        const scale = canvasAspect / sourceAspect;
        gl.uniform2f(uTexScale, scale, 1);
        gl.uniform2f(uTexOffset, (1 - scale) / 2, 0);
      } else {
        const scale = sourceAspect / canvasAspect;
        gl.uniform2f(uTexScale, 1, scale);
        gl.uniform2f(uTexOffset, 0, (1 - scale) / 2);
      }
      hasTexture = true;
    }
    gl.uniform1f(uHasTex, hasTexture ? 1 : 0);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uScale, canvas.width / Math.max(canvas.clientWidth, 1));
    gl.uniform1f(uTime, now());
    gl.uniform4fv(uDrops, drops);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    frame = requestAnimationFrame(render);
  };
  frame = requestAnimationFrame(render);

  return () => {
    cancelAnimationFrame(frame);
    clearTimeout(ambient);
    window.removeEventListener('siming:drop', onDrop);
    window.removeEventListener('resize', resize);
  };
}

/**
 * The painting seen through water. With a source it redraws the video (or
 * still) refracted by the drops; without one it only shades the ripples.
 * Drops fall now and then on their own, and whenever `dropOnWater` is called.
 */
export function WaterRipples({ getSource = () => null }: { getSource?: RippleSource }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef(getSource);
  useEffect(() => {
    sourceRef.current = getSource;
  });

  useEffect(
    () => (canvasRef.current ? startRipples(canvasRef.current, () => sourceRef.current()) : undefined),
    [],
  );

  return <canvas ref={canvasRef} className="water-ripples" aria-hidden="true" />;
}
