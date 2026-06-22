# Add Auth System Implementation Plan

## Steps

1. Update Drizzle schema and generate a migration for `User`, `AuthSession`, and user-owned vocabulary/history.
2. Add shared auth modules for password hashing, sessions, current user, admin allowlist, and redirect validation.
3. Add `/login` and `/register` pages/forms plus global logout action; update `AppNav` to render auth state and hide Admin for non-admins.
4. Replace `src/lib/admin/auth.ts` with compatibility wrappers backed by the new auth system; update admin pages/actions/API routes for `401` vs `403`.
5. Gate `/vocabulary` and `/history`, and update vocabulary API to enforce current-user ownership.
6. Add/update tests for auth helpers, admin authorization, and vocabulary ownership.

## Validation

- `pnpm test:admin`
- auth/vocabulary test commands added during implementation
- `pnpm test:db`
- `pnpm lint`
- `pnpm build`
