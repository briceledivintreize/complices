// Sons synthétisés (aucun fichier) : craie, éponge, tic-tac, cloche. Vibrations quand le téléphone le permet.

let ac = null;
let muted = false;
try { muted = localStorage.getItem('complices:muted') === '1'; } catch { /* stockage indisponible */ }

export const isMuted = () => muted;
export function setMuted(v) {
  muted = v;
  try { localStorage.setItem('complices:muted', v ? '1' : '0'); } catch { /* ignore */ }
}

function ctx() {
  if (muted) return null;
  if (!ac) {
    try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { ac = null; }
  }
  if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
}

/** À appeler sur le premier geste de l'utilisateur pour débloquer l'audio sur mobile. */
export function unlock() { ctx(); }

function tone(freq, dur, type = 'sine', vol = 0.2, delay = 0) {
  const a = ctx(); if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + dur + 0.05);
}

function noise(dur, freq = 2500, vol = 0.08) {
  const a = ctx(); if (!a) return;
  const n = Math.floor(a.sampleRate * dur);
  const b = a.createBuffer(1, n, a.sampleRate);
  const ch = b.getChannelData(0);
  for (let i = 0; i < n; i++) ch[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = a.createBufferSource(); s.buffer = b;
  const f = a.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = freq;
  const g = a.createGain(); g.gain.value = vol;
  s.connect(f).connect(g).connect(a.destination);
  s.start();
}

let lastChalk = 0;
export function chalk() { const now = performance.now(); if (now - lastChalk < 70) return; lastChalk = now; noise(0.05, 3200, 0.05); }
export const circle = () => noise(0.14, 2600, 0.05);
export const sponge = () => noise(0.3, 1100, 0.06);
export const pose = () => noise(0.08, 1800, 0.06);
export const peerReady = () => tone(520, 0.12, 'triangle', 0.12);
export const tick = () => tone(740, 0.09, 'triangle', 0.18);
export function bell() { tone(1046, 1.4, 'sine', 0.22); tone(1568, 1.0, 'sine', 0.1); tone(2093, 0.6, 'sine', 0.05); }
export const lift = () => noise(0.3, 900, 0.05);
export const pop = () => tone(880, 0.12, 'sine', 0.1);
export function joined() { tone(660, 0.15, 'sine', 0.12); tone(990, 0.2, 'sine', 0.1, 0.12); }

export function buzz(pattern) {
  try { if (navigator.vibrate) navigator.vibrate(pattern); } catch { /* ignore */ }
}
