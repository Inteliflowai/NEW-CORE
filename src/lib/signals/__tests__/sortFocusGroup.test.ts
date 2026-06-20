import { describe, it, expect } from 'vitest';
import { sortFocusGroup } from '../sortFocusGroup';

const mk = (name: string, severity: 1|2|3, action: string) =>
  ({ student_id: name, full_name: name, diagnosis: { severity, suggestedAction: action, diagnosis: 'x' } } as never);

describe('sortFocusGroup', () => {
  it('orders by severity DESC, then action priority, then name; pure', () => {
    const input = [mk('Bob',1,'monitor'), mk('Ann',3,'reteach'), mk('Cy',3,'profile'), mk('Dan',3,'reteach')];
    const out = sortFocusGroup(input);
    expect(out.map((x) => x.full_name)).toEqual(['Ann','Dan','Cy','Bob']); // sev3 reteach(Ann,Dan by name) > sev3 profile(Cy) > sev1(Bob)
    expect(input.map((x) => x.full_name)).toEqual(['Bob','Ann','Cy','Dan']); // input unmutated
  });
});
