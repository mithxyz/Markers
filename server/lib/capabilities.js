/**
 * Capability vocabulary for per-project custom roles. Single source of truth,
 * imported by the migration seed, the membership middleware, the roles routes,
 * and the socket layer. Pure constants — safe to import from a Knex migration.
 */
export const CAPABILITIES = [
  'manage_project', // edit name / description / settings / share link
  'delete_project',
  'manage_members', // invite / assign role / remove members
  'manage_roles', // create / edit / delete project roles
  'manage_departments', // create / edit / delete departments + lanes (Phase 2b)
  'manage_tracks', // create / rename / delete tracks + track settings
  'upload_media', // upload track versions and video layers
  'manage_versions', // activate / rollback / reprocess versions
  'create_cues', // create cues, edit/delete your OWN cues
  'edit_others_cues', // edit non-private cues owned by others
  'delete_others_cues', // delete non-private cues owned by others
  'view_private_cues', // see other people's private cues (off by default)
  'create_invites', // mint invite links
];

export const ALL_CAPABILITIES = [...CAPABILITIES];

const EDITOR_CAPS = [
  'manage_project',
  'manage_departments',
  'manage_tracks',
  'upload_media',
  'manage_versions',
  'create_cues',
  'edit_others_cues',
  'delete_others_cues',
  'create_invites',
];

/**
 * The three system roles seeded into every project. These reproduce the legacy
 * owner/editor/viewer enum behavior exactly, so existing projects are unchanged.
 * Returns fresh arrays each call (safe to mutate / stringify).
 */
export function systemRoleSeeds() {
  return [
    { name: 'owner', capabilities: [...ALL_CAPABILITIES], is_default: false, is_system: true, sort_order: 0 },
    { name: 'editor', capabilities: [...EDITOR_CAPS], is_default: true, is_system: true, sort_order: 1 },
    { name: 'viewer', capabilities: [], is_default: false, is_system: true, sort_order: 2 },
  ];
}

/** Normalize a jsonb capabilities value (array or JSON string) to a string[]. */
export function toCapabilityArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export default { CAPABILITIES, ALL_CAPABILITIES, systemRoleSeeds, toCapabilityArray };
