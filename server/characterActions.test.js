import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTER_ACTIONS, CHARACTER_GESTURE_ACTIONS, NEW_GESTURE_ACTIONS, detectNewGestureCommand } from '../shared/characterActions.js';
import { dampHeadRotation } from '../shared/characterAnimation.js';

test('character gesture registry contains wave, explain and ten unique new postures', () => {
  assert.equal(CHARACTER_GESTURE_ACTIONS.length, 12);
  assert.equal(NEW_GESTURE_ACTIONS.length, 10);
  assert.equal(new Set(CHARACTER_ACTIONS).size, CHARACTER_ACTIONS.length);
  for (const action of ['wave', 'explain', 'nod', 'shake_head', 'think', 'point', 'present', 'shrug', 'cheer', 'salute', 'facepalm', 'stop', 'idle']) assert.ok(CHARACTER_ACTIONS.includes(action), `${action} should be registered`);
});

test('direct gesture commands map to expected actions', () => {
  const cases = [
    ['please nod your head', 'nod'], ['disagree', 'shake_head'], ['think for a moment', 'think'],
    ['point forward', 'point'], ['showcase', 'present'], ['show uncertainty', 'shrug'],
    ['celebrate!', 'cheer'], ['salute', 'salute'], ['do a facepalm', 'facepalm'], ['hold on', 'stop'],
  ];
  for (const [input, expected] of cases) assert.equal(detectNewGestureCommand(input), expected, input);
});

test('gesture parser does not trigger from casual mentions or empty input', () => {
  assert.equal(detectNewGestureCommand('I am thinking about the answer'), null);
  assert.equal(detectNewGestureCommand('the celebration was fun'), null);
  assert.equal(detectNewGestureCommand(''), null);
  assert.equal(detectNewGestureCommand('x'.repeat(161)), null);
});

test('head animation applies pitch, yaw and roll so Nod/Agree and other head gestures visibly move', () => {
  const rotation = { x: 0, y: 0, z: 0 };
  const result = dampHeadRotation(rotation, { x: 0.3, y: -0.4, z: 0.2 }, 1 / 30);
  assert.ok(result.x > 0, 'pitch/X must be applied for nodding');
  assert.ok(result.y < 0, 'yaw/Y must be applied for shaking the head');
  assert.ok(result.z > 0, 'roll/Z must be applied for shrugging');
  assert.ok(result.x < 0.3 && result.y > -0.4 && result.z < 0.2, 'rotation should interpolate instead of snapping');
});
