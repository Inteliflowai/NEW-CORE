// AssignmentPlayer — client player (two-phase state machine + behavioral capture
// + autosave + submit). FULL IMPLEMENTATION LANDS IN TASK 8 of this plan.
//
// This minimal placeholder exists so the Task 7 server page (page.tsx) can statically
// import it and resolve. Task 8 replaces this file with the real player; Task 7's page
// test mocks this module, so the placeholder body is not exercised there.
'use client';

import type { AssignmentContent, ResponsesShape } from '@/lib/assignments/loadAssignmentForPlay';

export interface AssignmentPlayerProps {
  assignmentId: string;
  attemptId: string;
  content: AssignmentContent;
  initialResponses: ResponsesShape;
}

export function AssignmentPlayer(_props: AssignmentPlayerProps) {
  return null;
}

export default AssignmentPlayer;
