/**
 * readErrorMessage — normalize the TWO server error shapes the Content Studio routes return into a
 * single display string, so a component never renders an object as a React child ([object Object]).
 *
 * Shape 1 (validation / url_fetch 400): `{ error: <string>, code?: string }`
 * Shape 2 (respondEngineError 503/500): `{ error: { code, message, retryable, userMessage } }`
 *
 * Returns the string error verbatim, else the envelope's userMessage, else the caller's fallback.
 */
export function readErrorMessage(body: unknown, fallback: string): string {
  if (body != null && typeof body === 'object' && 'error' in body) {
    const err = (body as { error: unknown }).error;
    if (typeof err === 'string') return err;
    if (err != null && typeof err === 'object' && 'userMessage' in err) {
      const userMessage = (err as { userMessage: unknown }).userMessage;
      if (typeof userMessage === 'string' && userMessage.length > 0) return userMessage;
    }
  }
  return fallback;
}
