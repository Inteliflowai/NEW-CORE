// US state → standards framework, for the AI lesson generator's PROPOSE step.
// NOT a curated standards database (separate epic) — a lightweight label + prompt guidance.
// The model proposes codes; the teacher confirms. Pure (no next/Supabase imports).

export interface StateOption {
  code: string;
  name: string;
}

export const US_STATES: StateOption[] = [
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' }, { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' }, { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' }, { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' }, { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' }, { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' }, { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' }, { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' }, { code: 'ND', name: 'North Dakota' }, { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' }, { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' }, { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' }, { code: 'WI', name: 'Wisconsin' }, { code: 'WY', name: 'Wyoming' },
];

const STATE_CODES = new Set(US_STATES.map((s) => s.code));

export function isUsStateCode(v: string | null | undefined): v is string {
  return typeof v === 'string' && STATE_CODES.has(v.toUpperCase());
}

// States that primarily use their own named standards rather than Common Core / NGSS.
const NAMED_STATE_FRAMEWORKS: Record<string, string> = {
  TX: 'the Texas Essential Knowledge and Skills (TEKS)',
  FL: 'the Florida B.E.S.T. Standards',
  VA: 'the Virginia Standards of Learning (SOL)',
};

const DEFAULT_FRAMEWORK =
  'the Common Core State Standards (ELA & Math) and the Next Generation Science Standards (NGSS)';

/** Framework label for a state. Unknown/null → the national reference set. */
export function frameworkLabelForState(state: string | null | undefined): string {
  if (isUsStateCode(state)) return NAMED_STATE_FRAMEWORKS[state.toUpperCase()] ?? DEFAULT_FRAMEWORK;
  return DEFAULT_FRAMEWORK;
}

/** A prompt directive telling the model which standards to align to and to propose codes from. */
export function standardsGuidance(state: string | null | undefined): string {
  const label = frameworkLabelForState(state);
  const where = isUsStateCode(state)
    ? `the US state of ${state.toUpperCase()}`
    : 'US K-12 schools generally';
  return (
    `Align this lesson to ${label}, used in ${where}. ` +
    'Propose 1-4 specific standard codes this lesson addresses, each with a short plain-language ' +
    'description, in a "proposed_standards" array. If you are not confident a specific code applies, ' +
    'propose fewer codes rather than inventing any.'
  );
}
