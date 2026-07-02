# Kenny Vapi Browser MVP — Vapi Structured Outputs

Plain HTML, CSS, JavaScript, Node.js, MongoDB and email. No Vite, React, Claude API, n8n or Make.com.

## Workflow

1. Website opens and requests microphone permission immediately.
2. Visitor submits name, phone and optional email.
3. Visitor starts a browser call with Kenny.
4. Browser saves the transcript as a backup.
5. Vapi analyzes the completed call using the attached **Kenny Lead Analysis** structured output.
6. Vapi sends the result to `/vapi/webhook`.
7. Node.js stores the result in MongoDB, emails the team and updates the dashboard.

## Required Vapi structured-output name

Use this exact name:

```text
Kenny Lead Analysis
```

Fields:

```text
whatsapp_number
intent
purpose
property_type
preferred_area
budget
timeline
payment_method
lead_quality
caller_sentiment
summary
next_step
best_follow_up_time
```

Attach it to the Kenny assistant and publish the assistant.

## Vapi webhook

Set the assistant Server URL to:

```text
https://YOUR-RENDER-SERVICE.onrender.com/vapi/webhook
```

Enable `end-of-call-report`. The backend also accepts Vapi's `call.ended` structured-output payload format.

## Local setup

```bash
cp .env.example .env
npm install
npm start
```

Open:

- App: `http://localhost:3000`
- Dashboard: `http://localhost:3000/dashboard.html`
- Health: `http://localhost:3000/health`

## Render

Build command:

```bash
npm install
```

Start command:

```bash
npm start
```

Environment variables:

```text
MONGO_URI
VAPI_PUBLIC_KEY
VAPI_ASSISTANT_ID
EMAIL_HOST
EMAIL_PORT
EMAIL_SECURE
EMAIL_USER
EMAIL_PASS
EMAIL_TO
```

Delete these old Render variables because they are no longer used:

```text
CLAUDE_API_KEY
CLAUDE_MODEL
```

## Microphone behavior

The site calls `navigator.mediaDevices.getUserMedia()` immediately on first page load. When permission is granted, the temporary stream is closed and Vapi reopens the microphone when the call starts.

Browsers do not allow a website to override a permission that a user previously blocked. In that case, the page shows a clear instruction and retry button.

## Security notes

- Add dashboard authentication before storing real customer data.
- Rotate any passwords or API keys that were exposed in screenshots or chat.
- Obtain appropriate recording and privacy consent.

## Version 3 fixes

- Adds browser-side `vapiInstance.stop()` fallback after Kenny's exact final closing.
- Uses Vapi's built-in End Call tool as the primary hang-up mechanism.
- Replaces Gmail SMTP with Brevo's HTTPS transactional email API because Render Free blocks outbound SMTP ports.
- Adds detailed email delivery logs and retries.

### Brevo setup

1. Create a Brevo account.
2. Verify a sender email/domain in Brevo.
3. Generate an API key.
4. Add `BREVO_API_KEY`, `EMAIL_FROM`, `EMAIL_FROM_NAME`, and `EMAIL_TO` in Render.
5. Delete the old SMTP variables (`EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SECURE`, `EMAIL_USER`, `EMAIL_PASS`).
