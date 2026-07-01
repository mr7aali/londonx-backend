# Login Credentials

This project has two real account roles:

- `admin` - used for the admin dashboard.
- `user` - used for the learner dashboard.

The values below come from `src/scripts/seedDatabase.js`. They work only after the database has been seeded with that script.

## Admin Dashboard

| Field | Value |
| --- | --- |
| Email | `jenny.wilson@example.com` |
| Password | `AdminPass123` |
| Role | `admin` |

## Learner Dashboard

| Field | Value |
| --- | --- |
| Email | `michael.johnson@example.com` |
| Password | `UserPass123` |
| Role | `user` |

Other seeded learner accounts use the same password, `UserPass123`:

- `rebecca.stone@example.com`
- `daniel.clarke@example.com`
- `sara.ali@example.com`
- `olivia.bennett@example.com`
- `ahmed.rahman@example.com`

## Notes

- Backend user roles are defined in `src/models/User.js` as `user` and `admin`.
- Admin routes are protected with `requireRole("admin")`.
- `system` appears in support ticket replies as an `authorType`, but it is not a login/account role.
