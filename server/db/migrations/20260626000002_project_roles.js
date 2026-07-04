import { systemRoleSeeds } from '../../lib/capabilities.js';

/**
 * Replace the fixed native-enum roles (member_role / invite_role) with
 * per-project custom roles.
 *
 * Strategy (order matters — Postgres can't ALTER a useNative enum in place, and
 * refuses to DROP TYPE while a column still references it):
 *   1. create project_roles
 *   2. seed the 3 system roles into every existing project
 *   3. add nullable role_id columns on project_members + invite_tokens
 *   4. backfill role_id from the old enum value (matched per project)
 *   5. set project_members.role_id NOT NULL
 *   6. drop the old enum columns
 *   7. DROP the now-unreferenced native enum types
 */
export async function up(knex) {
  // 1. project_roles
  await knex.schema.createTable('project_roles', (t) => {
    t.uuid('id').primary().defaultTo(knex.fn.uuid());
    t.uuid('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.string('name', 64).notNullable();
    t.jsonb('capabilities').notNullable().defaultTo('[]');
    t.boolean('is_default').notNullable().defaultTo(false); // auto-assigned to new members/invitees
    t.boolean('is_system').notNullable().defaultTo(false); // seeded owner/editor/viewer (rename/delete protected)
    t.integer('sort_order').notNullable().defaultTo(0);
    t.timestamps(true, true);
    t.unique(['project_id', 'name']);
  });

  // 2. seed system roles per project, remembering ids for the backfill
  const seeds = systemRoleSeeds();
  const projects = await knex('projects').select('id');
  const roleId = {}; // `${projectId}:${name}` -> role uuid
  for (const p of projects) {
    for (const s of seeds) {
      const [row] = await knex('project_roles')
        .insert({
          project_id: p.id,
          name: s.name,
          capabilities: JSON.stringify(s.capabilities),
          is_default: s.is_default,
          is_system: s.is_system,
          sort_order: s.sort_order,
        })
        .returning('id');
      roleId[`${p.id}:${s.name}`] = row.id;
    }
  }

  // 3. nullable role_id columns
  await knex.schema.alterTable('project_members', (t) => {
    t.uuid('role_id').nullable().references('id').inTable('project_roles').onDelete('RESTRICT');
  });
  await knex.schema.alterTable('invite_tokens', (t) => {
    t.uuid('role_id').nullable().references('id').inTable('project_roles').onDelete('SET NULL');
  });

  // 4. backfill from the old enum value
  for (const m of await knex('project_members').select('id', 'project_id', 'role')) {
    const rid = roleId[`${m.project_id}:${m.role}`];
    if (rid) await knex('project_members').where({ id: m.id }).update({ role_id: rid });
  }
  for (const inv of await knex('invite_tokens').select('id', 'project_id', 'role')) {
    const rid = roleId[`${inv.project_id}:${inv.role}`];
    if (rid) await knex('invite_tokens').where({ id: inv.id }).update({ role_id: rid });
  }

  // 5. require role_id on members (every member should have matched a seeded role)
  const orphans = await knex('project_members').whereNull('role_id').count('id as c').first();
  if (Number(orphans.c) > 0) {
    throw new Error(`Cannot enforce role_id NOT NULL: ${orphans.c} member(s) had no matching role`);
  }
  await knex.schema.alterTable('project_members', (t) => {
    t.uuid('role_id').notNullable().alter();
  });

  // 6. drop the enum columns
  await knex.schema.alterTable('project_members', (t) => t.dropColumn('role'));
  await knex.schema.alterTable('invite_tokens', (t) => t.dropColumn('role'));

  // 7. drop the now-unreferenced native enum types
  await knex.raw('DROP TYPE IF EXISTS member_role');
  await knex.raw('DROP TYPE IF EXISTS invite_role');
}

export async function down(knex) {
  // Recreate the native enums + columns. NOTE: custom (non-system) roles cannot
  // round-trip — members/invites on a custom role fall back to 'viewer'.
  await knex.raw("CREATE TYPE member_role AS ENUM ('owner','editor','viewer')");
  await knex.raw("CREATE TYPE invite_role AS ENUM ('editor','viewer')");

  await knex.schema.alterTable('project_members', (t) => {
    t.specificType('role', 'member_role').notNullable().defaultTo('viewer');
  });
  await knex.schema.alterTable('invite_tokens', (t) => {
    t.specificType('role', 'invite_role').notNullable().defaultTo('viewer');
  });

  for (const m of await knex('project_members as m')
    .leftJoin('project_roles as r', 'r.id', 'm.role_id')
    .select('m.id', 'r.name')) {
    const role = ['owner', 'editor', 'viewer'].includes(m.name) ? m.name : 'viewer';
    await knex('project_members').where({ id: m.id }).update({ role });
  }
  for (const inv of await knex('invite_tokens as i')
    .leftJoin('project_roles as r', 'r.id', 'i.role_id')
    .select('i.id', 'r.name')) {
    const role = ['editor', 'viewer'].includes(inv.name) ? inv.name : 'viewer';
    await knex('invite_tokens').where({ id: inv.id }).update({ role });
  }

  await knex.schema.alterTable('project_members', (t) => t.dropColumn('role_id'));
  await knex.schema.alterTable('invite_tokens', (t) => t.dropColumn('role_id'));
  await knex.schema.dropTableIfExists('project_roles');
}
