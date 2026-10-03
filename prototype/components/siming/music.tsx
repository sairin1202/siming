'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const KEY = 'siming.music';
const VOLUME = 0.55;

// 五声 on D (宫 商 角 徵 羽), two octaves: the guqin's plain open-string colour.
const SCALE = [146.83, 164.81, 185.0, 220.0, 246.94, 293.66, 329.63, 369.99, 440.0, 493.88];

/** A plucked string (Karplus–Strong), soft at the attack like a finger on silk. */
function pluck(ctx: BaseAudioContext, freq: number, seconds = 7) {
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * seconds);
  const buffer = ctx.createBuffer(1, length, rate);
  const out = buffer.getChannelData(0);
  const period = Math.max(2, Math.round(rate / freq));
  const line = new Float32Array(period);
  let smooth = 0;
  for (let i = 0; i < period; i += 1) {
    smooth = smooth * 0.55 + (Math.random() * 2 - 1) * 0.45;
    line[i] = smooth;
  }
  let peak = 0;
  for (let i = 0; i < length; i += 1) {
    const j = i % period;
    const value = line[j];
    out[i] = value;
    peak = Math.max(peak, Math.abs(value));
    line[j] = (value + line[(j + 1) % period]) * 0.5 * 0.9993;
  }
  // Even out loudness across the range, and let the tail fall to silence.
  const fade = Math.floor(rate * 1.5);
  for (let i = 0; i < length; i += 1) {
    out[i] *= (0.5 / (peak || 1)) * (i > length - fade ? (length - i) / fade : 1);
  }
  return buffer;
}

/** A dark, long hall: stereo noise that dies away. */
function hall(ctx: BaseAudioContext, seconds = 4.5) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  }
  return buffer;
}

type Player = { ctx: AudioContext; master: GainNode; stop: () => void };

/** Start the endless, unhurried phrase. */
function startPlayer(): Player {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  const reverb = ctx.createConvolver();
  reverb.buffer = hall(ctx);
  const wet = ctx.createGain();
  wet.gain.value = 0.55;
  reverb.connect(wet).connect(master);
  const tone = ctx.createBiquadFilter();
  tone.type = 'lowpass';
  tone.frequency.value = 2600;
  tone.connect(master);
  tone.connect(reverb);

  // A faint low drone on 宫 and 徵, breathing slowly.
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.018;
  const breath = ctx.createOscillator();
  breath.frequency.value = 0.07;
  const breathDepth = ctx.createGain();
  breathDepth.gain.value = 0.01;
  breath.connect(breathDepth).connect(droneGain.gain);
  const drones = [73.42, 110].map((freq) => {
    const osc = ctx.createOscillator();
    osc.frequency.value = freq;
    osc.connect(droneGain);
    return osc;
  });
  droneGain.connect(tone);
  for (const node of [breath, ...drones]) node.start();

  const strings = SCALE.map((freq) => pluck(ctx, freq));
  let index = 3;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const play = (note: number, when: number, gain: number, rate = 1) => {
    const source = ctx.createBufferSource();
    source.buffer = strings[note];
    // Now and then the finger slides into the note (上), as on the guqin.
    if (rate === 1 && Math.random() < 0.25) {
      source.playbackRate.setValueAtTime(0.94, when);
      source.playbackRate.linearRampToValueAtTime(1, when + 0.28);
    } else {
      source.playbackRate.value = rate;
    }
    const level = ctx.createGain();
    level.gain.value = gain;
    const pan = ctx.createStereoPanner();
    pan.pan.value = (note / (SCALE.length - 1)) * 0.8 - 0.4;
    source.connect(level).connect(pan).connect(tone);
    source.start(when);
  };

  const next = () => {
    const when = ctx.currentTime + 0.05;
    // Wander by small steps, as a melody on seven strings would.
    index = Math.min(SCALE.length - 1, Math.max(0, index + Math.round(Math.random() * 4 - 2)));
    play(index, when, 0.5);
    if (Math.random() < 0.2) play(index, when + 0.02, 0.12, 2); // 泛音: the harmonic an octave up
    if (Math.random() < 0.15 && index >= 2) play(index - 2, when + 0.45, 0.35);
    const rest = Math.random() < 0.12 ? 6000 + Math.random() * 3000 : 1600 + Math.random() * 2600;
    timer = setTimeout(next, rest);
  };
  timer = setTimeout(next, 600);

  return {
    ctx,
    master,
    stop: () => {
      if (timer) clearTimeout(timer);
      void ctx.close();
    },
  };
}

/** The 乐 seal: background music, on by default, begun at the first touch since browsers forbid autoplay. */
export function MusicToggle() {
  const [on, setOn] = useState(true);
  const playerRef = useRef<Player | null>(null);
  const onRef = useRef(true);

  const fadeTo = useCallback((value: number, seconds: number) => {
    const player = playerRef.current;
    if (!player) return;
    const { ctx, master } = player;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
    master.gain.linearRampToValueAtTime(value, ctx.currentTime + seconds);
  }, []);

  const begin = useCallback(() => {
    if (!onRef.current) return;
    if (!playerRef.current) {
      try {
        playerRef.current = startPlayer();
      } catch {
        return; // No Web Audio: stay silent.
      }
    }
    void playerRef.current.ctx.resume();
    fadeTo(VOLUME, 3);
  }, [fadeTo]);

  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(KEY);
    } catch {
      // Storage may be blocked; keep the default.
    }
    const wanted = stored !== 'off';
    onRef.current = wanted;
    // oxlint-disable-next-line react/react-compiler
    setOn(wanted);

    const onFirstTouch = () => {
      window.removeEventListener('pointerdown', onFirstTouch);
      window.removeEventListener('keydown', onFirstTouch);
      begin();
    };
    window.addEventListener('pointerdown', onFirstTouch);
    window.addEventListener('keydown', onFirstTouch);

    // Fall quiet while the page is hidden.
    const onVisibility = () => {
      const player = playerRef.current;
      if (!player) return;
      if (document.hidden) void player.ctx.suspend();
      else if (onRef.current) void player.ctx.resume();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pointerdown', onFirstTouch);
      window.removeEventListener('keydown', onFirstTouch);
      document.removeEventListener('visibilitychange', onVisibility);
      playerRef.current?.stop();
      playerRef.current = null;
    };
  }, [begin]);

  const toggle = () => {
    const next = !on;
    onRef.current = next;
    setOn(next);
    try {
      localStorage.setItem(KEY, next ? 'on' : 'off');
    } catch {
      // Not remembered; it still toggles for this visit.
    }
    if (next) begin();
    else fadeTo(0, 1.2);
  };

  return (
    <button
      type="button"
      className={`icon-button music-toggle ${on ? '' : 'is-off'}`}
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? '关闭音乐' : '开启音乐'}
    >
      乐
    </button>
  );
}
