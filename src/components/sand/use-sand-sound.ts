import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { AppState } from 'react-native';

import type { SandState } from './renderer';

export function useSandSound(simulation: RefObject<SandState>) {
  const control = useRef<{ player: AudioPlayer | null; enabled: boolean }>({ player: null, enabled: false });
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    // Browser audio only exists after mounting; keep server rendering silent.
    const soundControl = control.current;
    const player = createAudioPlayer(require('../../../assets/audio/sand-scrape.wav'));
    soundControl.player = player;
    player.loop = true;
    player.volume = 0;
    player.shouldCorrectPitch = false;
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
    }).catch((cause) => console.warn('Sand audio session:', cause));
    let previousAngle = simulation.current.angle;
    let previousTime = Date.now();
    let active = AppState.currentState === 'active';
    let level = 0;
    let speed = 0;
    let rate = 1;
    const subscription = AppState.addEventListener('change', (state) => {
      active = state === 'active';
      previousAngle = simulation.current.angle;
      previousTime = Date.now();
      if (!active) {
        player.volume = 0;
        player.pause();
        level = speed = 0;
      }
    });
    const timer = setInterval(() => {
      const now = Date.now();
      const dt = (now - previousTime) / 1000;
      const angle = simulation.current.angle;
      const motion = Math.abs(angle - previousAngle) / Math.max(dt, 0.001);
      previousAngle = angle;
      previousTime = now;
      if (!active || !soundControl.enabled) {
        level = speed = 0;
        return;
      }
      // Measure actual movement, so automatic rotation and manual drags share
      // the same sound and a stationary rod is silent even when sound is enabled.
      speed += (motion - speed) * (1 - Math.exp(-dt / 0.10));
      const target = motion > 0 ? Math.min(0.55, 0.32 * Math.sqrt(speed / 0.16)) : 0;
      level += (target - level) * (1 - Math.exp(-dt / 0.10));
      if (level < 0.002 && target === 0) {
        player.volume = 0;
        if (player.playing) player.pause();
        return;
      }
      if (!player.playing) player.play();
      player.volume = level;
      const nextRate = 0.80 + 0.25 * Math.min(speed / 0.16, 2);
      if (Math.abs(nextRate - rate) > 0.02) {
        player.setPlaybackRate(nextRate);
        rate = nextRate;
      }
    }, 50);
    return () => {
      clearInterval(timer);
      subscription.remove();
      player.remove();
      soundControl.player = null;
    };
  }, [simulation]);

  function toggle() {
    const player = control.current.player;
    if (!player) return;
    const next = !control.current.enabled;
    control.current.enabled = next;
    if (!next) {
      player.volume = 0;
      player.pause();
    } else {
      // Keep play inside the gesture so browsers can authorize audio playback.
      player.volume = 0;
      player.play();
    }
    setEnabled(next);
  }

  return { enabled, toggle };
}
