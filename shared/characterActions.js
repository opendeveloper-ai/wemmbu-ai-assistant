/** Shared character gesture registry used by the local command parser, UI and API tools. */
export const CHARACTER_GESTURE_ACTIONS = Object.freeze([
  { action: 'wave', label: 'Wave', description: 'Greet the user with a wave of the left/offhand arm.' },
  { action: 'explain', label: 'Explain', description: 'Use a brief two-handed explanatory gesture.' },
  { action: 'nod', label: 'Nod / Agree', description: 'Nod briefly to show agreement or acknowledgment.' },
  { action: 'shake_head', label: 'Shake Head', description: 'Shake the head to show disagreement or correction.' },
  { action: 'think', label: 'Think', description: 'Bring the right hand toward the face in a considering pose.' },
  { action: 'point', label: 'Point', description: 'Extend the right arm forward to direct attention.' },
  { action: 'present', label: 'Present', description: 'Open the left arm outward as if presenting something.' },
  { action: 'shrug', label: 'Shrug', description: 'Raise both arms in a restrained uncertain shrug.' },
  { action: 'cheer', label: 'Cheer', description: 'Raise both arms in a short celebration.' },
  { action: 'salute', label: 'Salute', description: 'Raise the right hand toward the helmet in a respectful salute.' },
  { action: 'facepalm', label: 'Facepalm', description: 'Bring the right hand toward the front of the head in playful embarrassment.' },
  { action: 'stop', label: 'Stop / Wait', description: 'Raise the right arm forward in a halt or wait gesture.' },
]);

export const NEW_GESTURE_ACTIONS = Object.freeze(CHARACTER_GESTURE_ACTIONS.slice(2).map(({ action }) => action));
export const CHARACTER_ACTIONS = Object.freeze([...CHARACTER_GESTURE_ACTIONS.map(({ action }) => action), 'pose', 'idle', 'stop_rotation', 'resume_rotation', 'reset_view']);
const aliases = [
  { action: 'nod', patterns: [/^(?:please\s+)?(?:nod|nod your head|agree with a nod|give me a nod|acknowledge me)$/i, /^(?:please\s+)?(?:show|do|use) (?:the )?(?:nod|agree) pose$/i] },
  { action: 'shake_head', patterns: [/^(?:please\s+)?(?:shake your head|shake head|disagree|show disagreement|say no with your head)$/i, /^(?:please\s+)?(?:show|do|use) (?:the )?(?:shake[- ]head|disagree) pose$/i] },
  { action: 'think', patterns: [/^(?:(?:please|can you|could you)\s+)?(?:think|think for a moment|consider that|do a thinking pose|look thoughtful)$/i, /^(?:please\s+)?(?:show|do|use) (?:the )?thinking pose$/i] },
  { action: 'point', patterns: [/^(?:(?:please|can you|could you)\s+)?(?:point|point forward|point at it|direct attention|point it out)$/i, /^(?:please\s+)?(?:show|do|use) (?:the )?pointing pose$/i] },
  { action: 'present', patterns: [/^(?:(?:please|can you|could you)\s+)?(?:present|showcase|present it|show it off|introduce this)$/i, /^(?:please\s+)?(?:show|do|use) (?:the )?(?:present|showcase) pose$/i] },
  { action: 'shrug', patterns: [/^(?:(?:please|can you|could you)\s+)?(?:shrug|shrug your shoulders|show uncertainty|act unsure|i don't know shrug)$/i, /^(?:please\s+)?(?:show|do|use) (?:the )?shrug pose$/i] },
  { action: 'cheer', patterns: [/^(?:(?:please|can you|could you)\s+)?(?:cheer|celebrate|celebrate that|victory pose|do a celebration)$/i, /^(?:please\s+)?(?:show|do|use) (?:the )?(?:cheer|celebration|victory) pose$/i] },
  { action: 'salute', patterns: [/^(?:(?:please|can you|could you)\s+)?(?:salute|give a salute|show respect|respectfully salute)$/i, /^(?:please\s+)?(?:show|do|use) (?:the )?salute pose$/i] },
  { action: 'facepalm', patterns: [/^(?:(?:please|can you|could you)\s+)?(?:facepalm|do a facepalm|show embarrassment|embarrassed pose)$/i, /^(?:please\s+)?(?:show|do|use) (?:the )?facepalm pose$/i] },
  { action: 'stop', patterns: [/^(?:(?:please|can you|could you)\s+)?(?:stop gesture|stop pose|wait|hold on|halt|tell me to wait|raise your hand to stop)$/i, /^(?:please\s+)?(?:show|do|use) (?:the )?(?:stop|wait|halt) pose$/i] },
];

/** Only recognizes direct, explicit gesture commands; it avoids inferring poses from casual mentions. */
export function detectNewGestureCommand(text) {
  const normalized = String(text || '').trim().replace(/[.!?]+$/g, '').trim();
  if (!normalized || normalized.length > 160) return null;
  for (const entry of aliases) {
    if (entry.patterns.some((pattern) => pattern.test(normalized))) return entry.action;
  }
  return null;
}
