import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SandTray } from '@/components/sand/sand-tray';
import type { SandState } from '@/components/sand/renderer';
import { useSandSound } from '@/components/sand/use-sand-sound';

const speeds = [0.5, 1, 2];

export default function HomeScreen() {
  const [{ width, height }, setViewport] = useState({ width: 390, height: 844 });
  const size = Math.min(width, 720, Math.max(320, (height - 440) / 0.88));
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [fresh, setFresh] = useState(false);
  const simulation = useRef<SandState>({
    tool: 'blade', angle: 0.65, direction: 1, resetId: 0, playing: true, speed: 1,
  });
  const userInteracted = useRef(false);
  const sound = useSandSound(simulation);

  useEffect(() => {
    const reduceMotion = (enabled: boolean) => {
      if (enabled && !userInteracted.current) {
        simulation.current.playing = false;
        setPlaying(false);
      }
    };
    AccessibilityInfo.isReduceMotionEnabled().then(reduceMotion);
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', reduceMotion);
    return () => subscription.remove();
  }, []);

  const pauseForTouch = useCallback(() => {
    userInteracted.current = true;
    simulation.current.playing = false;
    setPlaying(false);
    setFresh(false);
  }, []);

  function togglePlaying() {
    userInteracted.current = true;
    simulation.current.playing = !simulation.current.playing;
    setPlaying(simulation.current.playing);
    setFresh(false);
  }

  function resetSand() {
    simulation.current.resetId += 1;
    setFresh(true);
  }

  return (
    <SafeAreaView style={styles.page} onLayout={({ nativeEvent }) => setViewport(nativeEvent.layout)}>
      <ScrollView contentContainerStyle={[styles.content, { minHeight: height - 40 }]} bounces={false}>
        <View style={[styles.header, width < 600 && styles.mobileHeader]}>
          <View style={styles.wordmarkRow}>
            <View style={styles.brandMark}>
              <View style={styles.brandInner} />
              <View style={styles.brandLine} />
            </View>
            <Text style={styles.wordmark}>kare</Text>
          </View>
          <Text style={styles.headerNote}>A space to slow down.</Text>
        </View>

        <View style={styles.garden}>
          <View style={styles.intro}>
            <Text style={styles.title}>A moment of stillness.</Text>
            <Text style={styles.subtitle}>Let it turn. Let your mind wander.</Text>
          </View>
          <SandTray size={size} simulation={simulation} onGrab={pauseForTouch} />
          <Text style={styles.touchHint}>Drag around the tray to guide the rake</Text>

          <View style={styles.controls}>
            <Pressable onPress={() => resetSand()} accessibilityRole="button" accessibilityLabel="Reset to fresh sand"
              style={({ pressed }) => [styles.sideControl, pressed && styles.pressed]}>
              <Text style={styles.resetIcon}>↺</Text>
              <Text style={styles.controlText}>Fresh sand</Text>
            </Pressable>
            <Pressable onPress={togglePlaying} accessibilityRole="button" accessibilityLabel={playing ? 'Pause rake' : 'Play rake'}
              style={({ pressed }) => [styles.playButton, pressed && styles.playPressed]}>
              {playing ? <View style={styles.pauseIcon}><View style={styles.pauseBar} /><View style={styles.pauseBar} /></View>
                : <View style={styles.playIcon} />}
            </Pressable>
            <Pressable onPress={() => {
              const next = speeds[(speeds.indexOf(speed) + 1) % speeds.length];
              simulation.current.speed = next;
              setSpeed(next);
            }} accessibilityRole="button" accessibilityLabel={`Speed ${speed} times. Change speed`}
              style={({ pressed }) => [styles.sideControl, pressed && styles.pressed]}>
              <Text style={styles.speedValue}>{speed}×</Text>
              <Text style={styles.controlText}>Speed</Text>
            </Pressable>
            <Pressable onPress={sound.toggle} accessibilityRole="button"
              accessibilityLabel={sound.enabled ? 'Mute sand sound' : 'Enable sand sound'}
              style={({ pressed }) => [styles.sideControl, pressed && styles.pressed]}>
              <View style={[styles.soundIcon, !sound.enabled && styles.soundMuted]}>
                <View style={[styles.soundBar, { height: 10 }]} />
                <View style={[styles.soundBar, { height: 22 }]} />
                <View style={[styles.soundBar, { height: 15 }]} />
              </View>
              <Text style={styles.controlText}>{sound.enabled ? 'Sound on' : 'Sound off'}</Text>
            </Pressable>
          </View>
          <Text style={styles.status} accessibilityLiveRegion="polite">
            {fresh ? 'A fresh beginning.' : playing ? 'Nothing to do. Nowhere to be.' : 'Take your time.'}
          </Text>
        </View>
        <View style={styles.footer}>
          <View style={styles.materialDot} />
          <Text style={styles.footerText}>Walnut, brass & a little peace.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const serif = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia' });
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f2efe8' },
  content: { alignItems: 'center', paddingBottom: 22 },
  header: { width: '100%', maxWidth: 1160, paddingHorizontal: 48, paddingTop: 25, paddingBottom: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mobileHeader: { paddingHorizontal: 25, paddingTop: 14, paddingBottom: 20 },
  wordmarkRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  wordmark: { fontFamily: serif, fontSize: 34, letterSpacing: -1.5, color: '#383d31' },
  brandMark: { width: 26, height: 26, borderWidth: 1, borderColor: '#747b66', borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  brandInner: { width: 16, height: 16, borderWidth: 1, borderColor: '#747b66', borderRadius: 12 },
  brandLine: { width: 1, height: 30, backgroundColor: '#747b66', position: 'absolute', transform: [{ rotate: '-40deg' }] },
  headerNote: { fontSize: 12, color: '#79796d' },
  garden: { alignItems: 'center', flex: 1, justifyContent: 'center', paddingTop: 10 },
  intro: { alignItems: 'center', gap: 10, paddingHorizontal: 20, zIndex: 1 },
  title: { fontFamily: serif, fontSize: 30, letterSpacing: -0.7, color: '#424638', textAlign: 'center' },
  subtitle: { fontSize: 13, color: '#817e72', lineHeight: 20 },
  touchHint: { fontSize: 11, color: '#8a877b', marginTop: -18, marginBottom: 26 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 20, marginTop: 26 },
  sideControl: { width: 64, height: 60, alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 12 },
  soundIcon: { height: 29, flexDirection: 'row', alignItems: 'center', gap: 4 },
  soundBar: { width: 3, borderRadius: 2, backgroundColor: '#545b49' },
  soundMuted: { opacity: 0.4 },
  controlText: { fontSize: 11, color: '#777769' },
  resetIcon: { fontSize: 28, color: '#545b49', lineHeight: 29 },
  speedValue: { fontSize: 20, fontFamily: serif, color: '#545b49', lineHeight: 29 },
  playButton: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#4d5946', alignItems: 'center', justifyContent: 'center', boxShadow: '0px 5px 14px rgba(55, 66, 43, 0.14)' },
  playPressed: { backgroundColor: '#394432', transform: [{ scale: 0.97 }] },
  pauseIcon: { flexDirection: 'row', gap: 5 },
  pauseBar: { width: 3, height: 17, borderRadius: 1, backgroundColor: '#f4f0e5' },
  playIcon: { marginLeft: 4, width: 0, height: 0, borderTopWidth: 9, borderBottomWidth: 9, borderLeftWidth: 14, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: '#f4f0e5' },
  pressed: { opacity: 0.6 },
  status: { fontFamily: serif, fontStyle: 'italic', fontSize: 13, color: '#8a877a', marginTop: 20, marginBottom: 32 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 12 },
  footerText: { fontSize: 10, color: '#939083' },
  materialDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#9c8661' },
});
