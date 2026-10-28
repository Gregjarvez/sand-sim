import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CELL, INNER_TOOTH, TEETH, TOOTH_RADIUS, TOOTH_SPACING, planPasses, rakeOffset, sharedGlsl,
} from '../src/components/sand/geometry.ts';

const outer = INNER_TOOTH + (TEETH - 1) * TOOTH_SPACING + TOOTH_RADIUS;

test('relaxation runs at the same rate at 30 and 60 Hz', () => {
  assert.equal(planPasses(1, 1, 1 / 30) * 30, planPasses(1, 1, 1 / 60) * 60);
  assert.equal(planPasses(1, 1, 0), 1);
});

test('teeth advance less than a cell per pass, up to the pass budget', () => {
  for (const speed of [0.08, 0.16, 0.32, 1, 3]) {
    const dt = 1 / 30;
    const passes = planPasses(0, speed * dt, dt);
    assert.ok(speed * dt * outer / passes <= 0.8 * CELL, `speed ${speed}`);
  }
  assert.equal(planPasses(0, 1, 1 / 30), 40);
  assert.equal(planPasses(1, 0, 1 / 30), planPasses(0, 1, 1 / 30));
});

test('hub play keeps both arms on nearly the same path', () => {
  for (let angle = 0; angle < 2 * Math.PI; angle += 0.01) {
    // The far arm passes the same world angle half a turn later, offset the other way.
    const separation = Math.abs(rakeOffset(angle) + rakeOffset(angle - Math.PI));
    assert.ok(separation <= 0.0004 + 1e-12);
    assert.ok(Math.abs(rakeOffset(angle)) < 0.002);
  }
});

test('shared GLSL constants are float literals', () => {
  for (const [, value] of sharedGlsl.matchAll(/const float \w+=([^;]+);/g)) {
    assert.match(value, /^-?\d+\.\d*(e-?\d+)?$|^-?\d+(\.\d*)?e-?\d+$/);
  }
});
