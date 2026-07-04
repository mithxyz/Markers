import nodemailer from 'nodemailer';
import { config } from '../config.js';
import { logActivity } from '../lib/activity.js';

// The VPS runs Postfix + OpenDKIM with mith.studio fully configured
// (SPF + DKIM valid), so we send straight through the local mail server —
// no external provider needed.
const transport = nodemailer.createTransport({
  host: config.smtp.host,
  port: config.smtp.port,
  secure: false,
  // Local relay (mynetworks 127.0.0.0/8) needs no auth; STARTTLS not required on loopback.
  tls: { rejectUnauthorized: false },
});

/** Shared sender with a dev console-log fallback (config.ses.logLinks). */
async function send({ tag, email, url, subject, heading, intro, cta, ttlNote }) {
  if (config.ses.logLinks) {
    console.log(`\n[${tag}] ${email} -> ${url}\n`);
  }

  try {
    await transport.sendMail({
      from: `cue <${config.smtp.from}>`,
      to: email,
      subject,
      text: `${heading}\n\n${intro}\n\n${url}\n\n${ttlNote}`,
      html: `<div style="font-family:Inter,Arial,sans-serif;max-width:480px">
        <h2 style="color:#111">${heading}</h2>
        <p>${intro}</p>
        <p><a href="${url}" style="display:inline-block;padding:12px 20px;background:#6366f1;color:#fff;border-radius:8px;text-decoration:none">${cta}</a></p>
        <p style="color:#666;font-size:13px">Or paste this URL:<br>${url}</p>
        <p style="color:#999;font-size:12px">${ttlNote}</p>
      </div>`,
    });
  } catch (err) {
    if (config.ses.logLinks) {
      console.warn(`[${tag}] SMTP send failed (link logged above):`, err.message);
      return;
    }
    // Log to the journal so prod failures are immediately visible via
    // `journalctl -u markers`. The activity_log table is project-scoped and
    // cannot store mail failures (no project_id) — do not use logActivity here.
    console.error('[mail] send_failed', { tag, email, error: err.message });
    throw err;
  }
}

/** Invite / first-time "set your password" email. */
export async function sendSetPassword(email, url) {
  await send({
    tag: 'set-password',
    email,
    url,
    subject: 'Set up your cue password',
    heading: 'Welcome to cue',
    intro: 'Click the button below to set your password and sign in. This link can be used once.',
    cta: 'Set password',
    ttlNote: 'This link expires in 72 hours.',
  });
}

/** Forgot-password reset email. */
export async function sendResetPassword(email, url) {
  await send({
    tag: 'reset-password',
    email,
    url,
    subject: 'Reset your cue password',
    heading: 'Reset your password',
    intro: 'We received a request to reset your cue password. Click below to choose a new one. If this wasn’t you, you can ignore this email.',
    cta: 'Reset password',
    ttlNote: 'This link expires in 1 hour and can be used once.',
  });
}

export default { sendSetPassword, sendResetPassword };
