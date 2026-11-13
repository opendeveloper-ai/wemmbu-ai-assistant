/**
 * Apply independent, exponentially damped Euler targets for the Minecraft-style head pivot.
 * Keeping all three axes explicit prevents pitch-only gestures (nod/think/facepalm) and
 * roll gestures (shrug) from being silently ignored by the render loop.
 */
export function dampHeadRotation(rotation, target, deltaSeconds) {
  const dt = Math.max(0, Math.min(Number(deltaSeconds) || 0, 0.1));
  const damp = (current, goal, lambda) => goal + (current - goal) * Math.exp(-lambda * dt);
  rotation.x = damp(rotation.x, target.x, 7);
  rotation.y = damp(rotation.y, target.y, 5);
  rotation.z = damp(rotation.z, target.z, 6);
  return rotation;
}
