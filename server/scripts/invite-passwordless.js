/**
 * One-time backfill: email a "set your password" link to every existing user
 * who has no password yet (legacy magic-link accounts).
 *
 *   node server/scripts/invite-passwordless.js          # send for real
 *   node server/scripts/invite-passwordless.js --dry    # list who would be emailed
 *
 * Safe to re-run: a fresh set_password token is issued each time (72h TTL).
 */
import { knex } from '../db/knex.js';
import { issueAuthToken } from '../routes/auth.js';
import { sendSetPassword } from '../services/mail.js';

const dry = process.argv.includes('--dry');

async function main() {
  const users = await knex('users').whereNull('password_hash').select('id', 'email', 'display_name');
  console.log(`${users.length} passwordless user(s) found.${dry ? ' (dry run)' : ''}`);

  for (const u of users) {
    if (dry) {
      console.log(`  would email: ${u.email}`);
      continue;
    }
    try {
      const url = await issueAuthToken({ email: u.email, purpose: 'set_password', ttlMs: 72 * 60 * 60 * 1000 });
      await sendSetPassword(u.email, url);
      console.log(`  emailed: ${u.email}`);
    } catch (err) {
      console.error(`  FAILED ${u.email}: ${err.message}`);
    }
  }

  await knex.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
