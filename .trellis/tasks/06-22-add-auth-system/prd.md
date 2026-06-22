# Add auth system

## Goal

Introduce a local email/password authentication system where every admin is also a normal user with extra permissions, login/logout are global application features, and guests can still use public article and shadow-reading flows.

## Requirements

- Add local user registration and login with persistent httpOnly sessions.
- Treat admin as a capability of a normal authenticated user, controlled by an `ADMIN_EMAILS` allowlist.
- Move login/logout to global app chrome instead of admin-only pages.
- Allow guests to browse articles, read article details, and use shadow-reading pages.
- Require authentication for personal vocabulary and learning history.
- Require admin permission for admin UI, admin actions, and `/api/admin/*`.
- Preserve existing unowned vocabulary/history rows without showing them as a logged-in user's personal data.

## Acceptance Criteria

- [x] `User` and `AuthSession` tables exist; `Vocabulary` and `ReadingHistory` can belong to a user.
- [x] Users can register, log in, and log out from global routes/actions.
- [x] Session cookies store only opaque tokens; DB stores token hashes.
- [x] `/admin` and admin APIs authorize through the current user session and `ADMIN_EMAILS`.
- [x] Guests can still access public article and shadow-reading routes.
- [x] Unauthenticated `/vocabulary`, `/history`, and vocabulary mutations require login.
- [x] Tests cover auth helpers, admin authorization, and vocabulary ownership.

## Notes

- Initial version excludes email verification, password reset, OAuth, invitations, and guest data merge.
