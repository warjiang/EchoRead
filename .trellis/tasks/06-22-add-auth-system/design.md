# Add Auth System Design

## Architecture

- Use the existing Drizzle/SQLite stack. Add `User` and `AuthSession`; add nullable `userId` ownership to `Vocabulary` and `ReadingHistory`.
- Add `src/lib/auth/*` as the shared auth owner for password hashing, session cookies, current-user loading, admin permission checks, and safe redirects.
- Keep article browsing and shadow reading public. Gate personal pages/API with authenticated users and gate admin pages/API with `canAdmin`.

## Data Flow

1. Register normalizes email, hashes password with `crypto.scrypt`, inserts a user, creates an auth session, and redirects to a safe `next` path.
2. Login verifies password, creates a new session token, stores its hash, writes the auth cookie, and redirects safely.
3. Request-time auth reads the cookie, hashes the token, looks up a non-expired session joined to user, and derives `canAdmin` from `ADMIN_EMAILS`.
4. Vocabulary/history queries filter by the current user's `id`; guests cannot mutate or view personal rows.
5. Admin UI/actions/APIs call shared admin guards instead of the old `ADMIN_SECRET` session cookie.

## Compatibility

- Keep `/admin/login` as a redirect to `/login?next=/admin`.
- Existing unowned `Vocabulary` and `ReadingHistory` rows remain in the database but are not shown as personal user data.
- Existing article, scraper, material, original-audio, and worker APIs remain unchanged unless they are admin-only.
