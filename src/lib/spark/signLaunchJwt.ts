// src/lib/spark/signLaunchJwt.ts — hand-rolled HS256 JWT for the SPARK student launch handoff.
// Matches SPARK's verifier (verifyCoreJWT): header {alg:HS256,typ:JWT}, base64url parts, exp in
// epoch SECONDS, iss must be 'inteliflow-core'. No jsonwebtoken dependency (V2 choice).
import { createHmac } from 'crypto';
import { CORE_SPARK_API_SECRET } from './config';

export interface LaunchClaims {
  core_user_id: string;
  core_school_id: string;
  spark_attempt_id?: string;
  email?: string;
  full_name?: string;
  grade?: string;
  return_url?: string;
}

const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

export function signLaunchJwt(claims: LaunchClaims, ttlSeconds = 900): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ ...claims, iss: 'inteliflow-core', iat: now, exp: now + ttlSeconds }));
  const sig = createHmac('sha256', CORE_SPARK_API_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}
