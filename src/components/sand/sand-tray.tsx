import { GLView, type ExpoWebGLRenderingContext } from 'expo-gl';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { AppState, PanResponder, StyleSheet, Text, View } from 'react-native';

import { createRenderer, turnRake, type SandState } from './renderer';

type Props = {
  size: number;
  simulation: RefObject<SandState>;
  onGrab: () => void;
};

export function SandTray({ size, simulation, onGrab }: Props) {
  const renderer = useRef<ReturnType<typeof createRenderer> | null>(null);
  const frame = useRef(0);
  const active = useRef(AppState.currentState === 'active');
  const [error, setError] = useState(false);
  const lastTouch = useRef(0);
  const height = size * 0.88;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (value) => {
      active.current = value === 'active';
    });
    return () => {
      subscription.remove();
      cancelAnimationFrame(frame.current);
      renderer.current?.dispose();
    };
  }, []);

  const onContextCreate = useCallback((gl: ExpoWebGLRenderingContext) => {
    try {
      renderer.current = createRenderer(gl, simulation.current);
      let previous = 0;
      let signature = '';
      const tick = (time: number) => {
        frame.current = requestAnimationFrame(tick);
        if (time - previous < 1000 / 30) return;
        const dt = previous ? Math.min((time - previous) / 1000, 0.08) : 0;
        previous = time;
        if (!active.current) return;
        const state = simulation.current;
        if (state.playing) turnRake(state, dt * 0.16 * state.speed);
        const nextSignature = `${state.angle}:${gl.drawingBufferWidth}:${gl.drawingBufferHeight}`;
        const settling = renderer.current?.advance(dt);
        if (signature !== nextSignature || settling) {
          renderer.current?.draw();
          signature = nextSignature;
        }
      };
      frame.current = requestAnimationFrame(tick);
    } catch (cause) {
      console.error('Sand renderer:', cause);
      setError(true);
    }
  }, [simulation]);

  // PanResponder stores these callbacks; it does not read the refs during render.
  // eslint-disable-next-line react-hooks/refs
  const gesture = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: ({ nativeEvent: { locationX, locationY } }) => {
      onGrab();
      lastTouch.current = Math.atan2((locationY - height / 2) / 0.8, locationX - size / 2);
    },
    onPanResponderMove: ({ nativeEvent: { locationX, locationY } }) => {
      const x = locationX - size / 2;
      const y = (locationY - height / 2) / 0.8;
      if (Math.hypot(x, y) < 24) return;
      const next = Math.atan2(y, x);
      const delta = Math.atan2(Math.sin(next - lastTouch.current), Math.cos(next - lastTouch.current));
      turnRake(simulation.current, delta);
      lastTouch.current = next;
    },
  }), [height, size, simulation, onGrab]);

  return (
    <View style={{ width: size, height }} {...gesture.panHandlers}>
      {error ? (
        <View style={styles.error}>
          <Text style={styles.errorText}>The garden needs a graphics-enabled device to open.</Text>
        </View>
      ) : (
        <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} msaaSamples={0} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  error: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  errorText: { color: '#6f6b60', textAlign: 'center', lineHeight: 24 },
});
