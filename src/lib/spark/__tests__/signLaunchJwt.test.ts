import { describe, it, expect, beforeEach } from 'vitest';
import { createHmac } from 'crypto';
beforeEach(() => { process.env.CORE_SPARK_API_SECRET = 'sek'; });
describe('signLaunchJwt', () => {
  it('produces a SPARK-verifiable HS256 JWT with the right claims', async () => {
    const { signLaunchJwt } = await import('../signLaunchJwt');
    const tok = signLaunchJwt({ core_user_id: 'u1', core_school_id: 's1', spark_attempt_id: 'a1', return_url: 'https://newcore.inteliflowai.com/student/assignments/x' });
    const [h, p, sig] = tok.split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(createHmac('sha256', 'sek').update(`${h}.${p}`).digest('base64url')).toBe(sig);
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    expect(payload).toMatchObject({ core_user_id: 'u1', core_school_id: 's1', spark_attempt_id: 'a1', iss: 'inteliflow-core' });
    expect(typeof payload.exp).toBe('number');
    expect(payload.exp - payload.iat).toBe(900);
  });
});
