# frontend — src

Frontend source root for both the Employee portal (ESS) and the HR/Admin
portal, sharing one shell (`App.tsx` → `routes/router.tsx`). See
`layouts/`, `routes/`, `pages/`, `components/`, `hooks/`, `api/`,
`sockets/` and `theme/` below.

`routes/employeeMenu.config.tsx` and `routes/adminMenu.config.tsx` are the
single source of truth for both portals' navigation — `router.tsx`
generates every route from them, rendering each leaf's `element` if one
is registered or `components/common/PlaceholderPage` (with its `phase`)
otherwise.
