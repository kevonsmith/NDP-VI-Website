# NDP Real Multi-Page Membership Site — Virtual Pay Edition

A production-style Node/Express starter with:

- Real multi-page routing
- Server-side register/login/logout
- Protected member portal
- Admin dashboard
- News publishing
- Manifesto upload and public viewer
- Virtual Pay-ready hosted checkout flow for $20/month membership payments
- Generic Virtual Pay webhook endpoint for payment confirmation
- Admin manual payment confirmation fallback
- Party Leaders and Political Candidates sections
- Modern campaign homepage and social icon links
- SQLite database

## Setup

```bash
npm install
cp .env.example .env
npm run seed
npm start
```

Open: http://localhost:3000

Seeded admin:

```txt
admin@example.com / admin123
```

## Virtual Pay setup

Virtual Pay supports BVI payment gateway services and advertises recurring payments for subscriptions/membership-style programs. Ask Virtual Pay onboarding/support for your exact hosted checkout URL, merchant ID, API key, return/cancel URL field names, and webhook/signature format.

Update `.env`:

```env
MEMBERSHIP_AMOUNT_CENTS=2000
MEMBERSHIP_CURRENCY=USD
VIRTUAL_PAY_CHECKOUT_URL=https://your-secure-virtualpay-checkout-url
VIRTUAL_PAY_MERCHANT_ID=your-merchant-id
VIRTUAL_PAY_API_KEY=your-api-key-if-issued
VIRTUAL_PAY_WEBHOOK_SECRET=your-webhook-secret-if-issued
BASE_URL=https://your-live-domain.com
```

The app creates a pending payment record, then redirects the member to the hosted Virtual Pay checkout URL with common query parameters:

- `merchant_id`
- `reference`
- `amount`
- `currency`
- `customer_email`
- `customer_name`
- `description`
- `success_url`
- `cancel_url`

If Virtual Pay provides different parameter names, update `/create-virtualpay-payment` in `server.js`.

## Webhook endpoint

Generic webhook URL:

```txt
POST /virtualpay/webhook
```

Expected fields currently supported:

```json
{
  "reference": "NDP-1-123456789",
  "status": "paid",
  "transaction_id": "VP123"
}
```

The handler also accepts `gateway_reference` or `order_id` for the reference, and common paid statuses such as `success`, `successful`, `approved`, and `completed`.

If Virtual Pay uses a custom signature format, update the verification block in `/virtualpay/webhook`.

## Manual payment confirmation fallback

Admins can confirm pending Virtual Pay payments from `/admin` after verifying the transaction in the Virtual Pay portal. This marks the payment as paid and activates the member.

## Deployment notes

Before going live:

- Replace demo social links with official URLs.
- Put the app behind HTTPS.
- Use a managed database such as PostgreSQL.
- Add email verification and password reset.
- Harden admin permissions and audit logging.
- Store uploaded files in object storage such as S3/R2.
- Confirm Virtual Pay recurring-payment/webhook requirements with their onboarding team.

## Party Leaders and Candidates

Public pages:

- `/leaders`
- `/candidates`

Admins can add/delete leader and candidate profiles from `/admin`, including optional photo uploads.
