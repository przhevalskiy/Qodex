# WordPress SSO → Qodex Implementation Plan

## Overview

Single sign-on between `openclimatecurriculum.org` (WordPress) and `qodex.openclimatecurriculum.org` (Qodex). Users log in once to WordPress and are automatically authenticated in Qodex — no second login.

---

## Architecture

```
WordPress (logged-in user clicks "Qodex")
  → PHP generates signed JWT (HMAC-SHA256, shared secret, 5-min TTL)
  → Redirect to qodex.openclimatecurriculum.org?token=xxx

Qodex Frontend (detects ?token= on load)
  → POST /auth/wordpress-sso { token }
  → Receives Supabase session (access_token, refresh_token)
  → Stores session, redirects to /

Qodex Backend (/auth/wordpress-sso)
  → Verifies HMAC signature
  → Checks token not expired
  → Looks up or creates user in Supabase (by email)
  → Returns Supabase session
```

---

## Shared Secret

A single secret string known to both WordPress and the Qodex backend. Generated once, stored securely in both environments. Never exposed to the frontend.

```bash
# Generate (run once)
openssl rand -hex 32
```

- **WordPress**: stored as a constant in `wp-config.php` → `QODEX_SSO_SECRET`
- **Qodex backend**: stored as env var → `WORDPRESS_SSO_SECRET`

---

## Token Format

A URL-safe JWT-like payload, HMAC-SHA256 signed:

```json
{
  "sub": "user@example.com",
  "name": "Jane Smith",
  "iat": 1711234567,
  "exp": 1711234867
}
```

- `sub` — WordPress user email (primary identifier)
- `name` — display name (used to populate Supabase profile)
- `iat` — issued at (Unix timestamp)
- `exp` — expiry (iat + 300 seconds / 5 minutes)

---

## Part 1 — WordPress

### Option A: Custom plugin (recommended, no dependencies)

Create `wp-content/plugins/qodex-sso/qodex-sso.php`:

```php
<?php
/**
 * Plugin Name: Qodex SSO
 * Description: Generates signed tokens for Qodex single sign-on
 */

define('QODEX_SSO_URL', 'https://qodex.openclimatecurriculum.org');

function qodex_generate_sso_token() {
    if (!is_user_logged_in()) {
        return null;
    }

    $user    = wp_get_current_user();
    $secret  = defined('QODEX_SSO_SECRET') ? QODEX_SSO_SECRET : '';
    $now     = time();

    $payload = json_encode([
        'sub'  => $user->user_email,
        'name' => $user->display_name,
        'iat'  => $now,
        'exp'  => $now + 300,
    ]);

    $b64_payload = rtrim(strtr(base64_encode($payload), '+/', '-_'), '=');
    $signature   = hash_hmac('sha256', $b64_payload, $secret);
    $token       = $b64_payload . '.' . $signature;

    return QODEX_SSO_URL . '?token=' . urlencode($token);
}

// Expose as shortcode: [qodex_link text="Open Qodex"]
function qodex_link_shortcode($atts) {
    $atts = shortcode_atts(['text' => 'Open Qodex'], $atts);
    $url  = qodex_generate_sso_token();

    if (!$url) {
        return '<a href="/login">Log in to access Qodex</a>';
    }

    return '<a href="' . esc_url($url) . '">' . esc_html($atts['text']) . '</a>';
}
add_shortcode('qodex_link', 'qodex_link_shortcode');
```

Add to `wp-config.php`:
```php
define('QODEX_SSO_SECRET', 'your-generated-secret-here');
```

Add to nav or page via shortcode:
```
[qodex_link text="Research Assistant"]
```

### Option B: Existing JWT plugin

Use **JWT Authentication for WP REST API** or **Simple JWT Login** plugins. Both support custom claims and redirect hooks. More configuration, less custom code.

---

## Part 2 — Qodex Backend

### New env var

```bash
# backend/.env
WORDPRESS_SSO_SECRET=your-generated-secret-here
```

### New route file

**`backend/app/api/routes/auth.py`**

```python
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import hmac, hashlib, json, base64, time

from app.core.config import get_settings
from app.database.supabase_client import get_supabase_client

router = APIRouter(prefix="/auth", tags=["auth"])


class SSORequest(BaseModel):
    token: str


class SSOResponse(BaseModel):
    access_token: str
    refresh_token: str
    user_id: str
    email: str


def _verify_token(token: str, secret: str) -> dict:
    """Verify HMAC signature and expiry. Returns payload dict or raises."""
    try:
        b64_payload, signature = token.rsplit(".", 1)
    except ValueError:
        raise HTTPException(status_code=401, detail="Malformed token")

    expected = hmac.new(secret.encode(), b64_payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=401, detail="Invalid token signature")

    # Decode payload
    padding = 4 - len(b64_payload) % 4
    payload = json.loads(base64.urlsafe_b64decode(b64_payload + "=" * padding))

    if time.time() > payload.get("exp", 0):
        raise HTTPException(status_code=401, detail="Token expired")

    return payload


@router.post("/wordpress-sso", response_model=SSOResponse)
async def wordpress_sso(body: SSORequest):
    settings = get_settings()
    secret = settings.wordpress_sso_secret

    if not secret:
        raise HTTPException(status_code=501, detail="SSO not configured")

    payload = _verify_token(body.token, secret)
    email = payload["sub"]
    name  = payload.get("name", "")

    supabase = get_supabase_client()

    # Look up or create user in Supabase Auth
    try:
        # Try to sign in with a magic link exchange (admin API)
        result = supabase.auth.admin.get_user_by_email(email)
        user_id = result.user.id
    except Exception:
        # User doesn't exist — create them
        result = supabase.auth.admin.create_user({
            "email": email,
            "email_confirm": True,
            "user_metadata": {"display_name": name},
        })
        user_id = result.user.id

    # Issue a session via admin API
    session = supabase.auth.admin.generate_link({
        "type": "magiclink",
        "email": email,
    })

    # Exchange link for session tokens
    # (Supabase admin.sign_in_as_user or generate_link approach)
    tokens = supabase.auth.admin.sign_in_as_user(user_id)

    return SSOResponse(
        access_token=tokens.session.access_token,
        refresh_token=tokens.session.refresh_token,
        user_id=user_id,
        email=email,
    )
```

### Register the route

**`backend/app/api/routes/__init__.py`** — add:
```python
from .auth import router as auth_router
```

**`backend/app/main.py`** — add:
```python
from app.api.routes import auth_router
app.include_router(auth_router)
```

### Config

**`backend/app/core/config.py`** — add field:
```python
wordpress_sso_secret: str = ""
```

---

## Part 3 — Qodex Frontend

### Token handler on app load

**`frontend/src/app/App.tsx`** — before auth gate renders, check for `?token=`:

```tsx
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (token) {
    // Remove token from URL immediately
    window.history.replaceState({}, '', window.location.pathname);
    handleWordPressSSOToken(token);
  }
}, []);
```

### SSO token handler

**`frontend/src/features/auth/wordpressSso.ts`**

```ts
import { supabase } from '@/shared/services/supabase';

export async function handleWordPressSSOToken(token: string): Promise<void> {
  const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/wordpress-sso`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });

  if (!res.ok) {
    console.error('SSO failed:', await res.text());
    return;
  }

  const { access_token, refresh_token } = await res.json();

  // Set session directly in Supabase client
  await supabase.auth.setSession({ access_token, refresh_token });
}
```

---

## Part 4 — Render Environment

Add to Render backend service env vars:

| Key | Value |
|---|---|
| `WORDPRESS_SSO_SECRET` | (shared secret, same as `QODEX_SSO_SECRET` in wp-config.php) |

---

## Security Notes

- Token TTL is 5 minutes — short enough to prevent replay attacks
- HMAC-SHA256 with a 32-byte random secret — unforgeable without the secret
- Token is consumed on first use (stateless — no DB check). For replay protection at scale, store used tokens in a short-lived Redis/Supabase cache keyed by `iat+sub`
- All communication over HTTPS — never send token over HTTP
- `hmac.compare_digest` used on backend to prevent timing attacks
- WordPress plugin only generates tokens for `is_user_logged_in()` — no unauthenticated token generation

---

## Testing Checklist

- [ ] WordPress user logs in, clicks nav link → lands on Qodex already authenticated
- [ ] Token older than 5 minutes is rejected with 401
- [ ] Tampered token signature is rejected with 401
- [ ] New WordPress user auto-creates Supabase account on first SSO
- [ ] Returning WordPress user reuses existing Supabase account
- [ ] Qodex discussion history is user-scoped (RLS working)
- [ ] Logged-out WordPress user clicking nav link is redirected to WP login, not Qodex

---

## Files to Create/Modify

| File | Action |
|---|---|
| `wp-content/plugins/qodex-sso/qodex-sso.php` | Create (WordPress side) |
| `wp-config.php` | Add `QODEX_SSO_SECRET` constant |
| `backend/app/api/routes/auth.py` | Create |
| `backend/app/api/routes/__init__.py` | Add `auth_router` export |
| `backend/app/main.py` | Register `auth_router` |
| `backend/app/core/config.py` | Add `wordpress_sso_secret` field |
| `backend/.env` | Add `WORDPRESS_SSO_SECRET` |
| `frontend/src/features/auth/wordpressSso.ts` | Create |
| `frontend/src/app/App.tsx` | Add SSO token detection on load |
| `render.yaml` | Add `WORDPRESS_SSO_SECRET` env var |
