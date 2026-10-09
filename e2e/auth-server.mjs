import { createServer } from "node:http";
import { generateKeyPairSync, sign } from "node:crypto";
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const user = { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "test@example.com", email_confirmed_at: "2026-10-01T00:00:00Z", created_at: "2026-10-01T00:00:00Z", app_metadata: {}, user_metadata: {} };
const b64 = value => Buffer.from(JSON.stringify(value)).toString("base64url");
const payload = { sub: user.id, aud: "authenticated", role: "authenticated", email: user.email, iss: "http://127.0.0.1:54329/auth/v1", exp: Math.floor(Date.now() / 1000) + 3600 };
const input = `${b64({ alg: "RS256", kid: "test-key", typ: "JWT" })}.${b64(payload)}`;
const token = `${input}.${sign("RSA-SHA256", Buffer.from(input), privateKey).toString("base64url")}`;
const session = { access_token: token, refresh_token: "test-refresh-token", expires_in: 3600, expires_at: payload.exp, token_type: "bearer", user };
const server = createServer(async (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "http://localhost:3001");
  res.setHeader("Access-Control-Allow-Headers", "authorization,apikey,content-type,x-client-info,x-supabase-api-version");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.url === "/auth/v1/.well-known/jwks.json") res.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "test-key", alg: "RS256", use: "sig" }] }));
  else if (req.url === "/test/session") res.end(JSON.stringify(session));
  else if (req.url?.startsWith("/auth/v1/token?grant_type=pkce")) { res.writeHead(400); res.end(JSON.stringify({ error: "invalid_grant", error_code: "flow_state_not_found", error_description: "Test PKCE flow is unavailable" })); }
  else if (req.url?.startsWith("/auth/v1/token")) res.end(JSON.stringify(session));
  else if (req.url?.startsWith("/auth/v1/user")) res.end(JSON.stringify(user));
  else if (req.url?.startsWith("/auth/v1/signup")) res.end(JSON.stringify({ user, session: null }));
  else if (req.url?.startsWith("/auth/v1/logout")) { res.writeHead(204); res.end(); }
  else { res.writeHead(404); res.end("{}"); }
});
server.listen(54329, "127.0.0.1", () => console.log("Test auth server ready"));
process.on("SIGTERM", () => server.close());
process.on("SIGINT", () => server.close());
