# Auth Contracts

## Scenario: Local User Auth And Admin Capability

### 1. Scope / Trigger

- Trigger: auth crosses database schema, server actions, API routes, page guards, and global navigation.
- Admin is a capability of a normal signed-in user, never a separate secret-cookie identity.

### 2. Signatures

- DB: `User(id, email, passwordHash, createdAt, updatedAt)`.
- DB: `AuthSession(id, userId, tokenHash, expiresAt, createdAt, updatedAt)`.
- DB ownership: `Vocabulary.userId` and `ReadingHistory.userId` are nullable for legacy rows but required for new personal data.
- Auth helpers live under `src/lib/auth/*`; admin wrappers live in `src/lib/admin/auth.ts`.

### 3. Contracts

- Cookie: `AUTH_SESSION_COOKIE_NAME` defaults to `echoread_session`; cookie value is an opaque raw token only.
- Session storage: DB stores `sha256(token)` in `AuthSession.tokenHash`, not the raw cookie token.
- Password storage: `passwordHash` uses the `scrypt$salt$hash` format from `src/lib/auth/password.ts`.
- Admin env: `ADMIN_EMAILS` is a comma/whitespace-separated allowlist of normalized email addresses.
- Login/register `next` must pass through `safeRedirectPath`; only site-local paths are allowed.

### 4. Validation & Error Matrix

- Missing or invalid auth cookie -> personal APIs return `401`; personal pages redirect to `/login?next=...`.
- Signed-in non-admin hitting admin API -> `403`.
- Signed-in non-admin hitting admin page/action -> redirect to `/`.
- Duplicate email on register -> form error, no session created.
- Duplicate vocabulary word for same user -> update existing row; same word for a different user is allowed.

### 5. Good/Base/Bad Cases

- Good: `getCurrentUser()` derives `{ id, email, canAdmin }` once and callers use that projection.
- Base: guests may read articles and use `/articles/:id/shadow`.
- Bad: reading `ADMIN_SECRET`, parsing cookies directly in routes, or showing admin operation buttons to guests.

### 6. Tests Required

- Unit: email normalization, admin allowlist, password hash/verify, session token hashing, safe redirects.
- DB: `User`/`AuthSession` migrate cleanly; vocabulary permits the same word for different users.
- API/UI guard: admin endpoints distinguish `401` from `403`; personal vocabulary rejects guests.

### 7. Wrong vs Correct

#### Wrong

```typescript
if (request.cookies.get("echoread_admin")) {
  // admin operation
}
```

#### Correct

```typescript
const auth = await authorizeAdminRequest(request);
if (!auth.ok) return adminAuthErrorResponse(auth);
```

