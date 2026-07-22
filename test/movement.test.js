import { createHarness } from './tiny.js';
import { classifyJoystick } from '../client/src/input/movement.js';

export function run() {
  const { eq, report } = createHarness();

  eq(JSON.stringify(classifyJoystick(0.1, -0.8)),
    JSON.stringify({ move: 0, focus: true, brace: false, dodge: 0 }),
    'central 80% upward joystick movement Focuses');
  eq(JSON.stringify(classifyJoystick(-0.2, 0.9)),
    JSON.stringify({ move: 0, focus: false, brace: true, dodge: 0 }),
    'central 80% downward joystick movement Braces');
  eq(classifyJoystick(0.96, 0.2).dodge, 1, 'extreme right joystick movement Dodges right');
  eq(classifyJoystick(-0.96, -0.1).dodge, -1, 'extreme left joystick movement Dodges left');
  eq(classifyJoystick(0.95, 0).dodge, 0, 'Dodge requires more than 95% horizontal travel');
  eq(classifyJoystick(0.7, 0.7).focus, false, 'diagonal movement does not Focus');
  eq(classifyJoystick(0.7, 0.7).brace, false, 'diagonal movement does not Brace');

  return report('movement');
}
