import { api, type Project, type Member, type ProjectRole, type Department, type DepartmentAssignment } from '$lib/api';
import type { Track, Dancer, StageConfig, Formation, Playlist } from '$lib/types';
import { DEFAULT_STAGE } from '$lib/formations';
import { auth } from '$lib/stores/auth.svelte';
import { getSocket, joinProject, leaveProject, type OnlineUser } from '$lib/socket';

/**
 * Shared project state for the `projects/[id]` route group (Phase 4a). Loaded once
 * by the layout and consumed via context by the overview / track / settings pages,
 * so switching tracks (sibling routes) never refetches. Owns the socket room join,
 * presence, and track:* realtime reloads. A Svelte 5 `$state` class à la ui.svelte.ts.
 */
export const PROJECT_CTX = Symbol('project');

export class ProjectStore {
  id = $state('');
  project = $state<Project | null>(null);
  members = $state<Member[]>([]);
  roles = $state<ProjectRole[]>([]);
  departments = $state<Department[]>([]);
  assignments = $state<DepartmentAssignment[]>([]);
  dancers = $state<Dancer[]>([]);
  formations = $state<Formation[]>([]); // Phase 8b: project-scoped definition library
  playlists = $state<Playlist[]>([]); // 10-playlists
  stage = $state<StageConfig>(DEFAULT_STAGE);
  imageUrl = $state<string | null>(null);
  tracks = $state<Track[]>([]);
  online = $state<OnlineUser[]>([]);
  loading = $state(true);
  error = $state<string | null>(null);

  #pollTimer: ReturnType<typeof setInterval> | null = null;
  #joined = false;
  #handlers: Record<string, (payload: any) => void> = {};

  can(cap: string) {
    return (this.project?.capabilities || []).includes(cap);
  }
  get privileged() {
    return !!this.project && (this.project.owner_id === auth.user?.id || !!auth.user?.is_admin);
  }
  get myDepartmentIds() {
    return this.assignments.filter((a) => a.user_id === auth.user?.id).map((a) => a.department_id);
  }
  trackById(id: string) {
    return this.tracks.find((t) => t.id === id) ?? null;
  }

  /** (Re)load for a project id. No-op if already loaded for that id. */
  async init(id: string) {
    if (this.id === id && this.project) return;
    this.teardown();
    this.id = id;
    this.loading = true;
    this.error = null;
    try {
      await this.loadProject();
      await Promise.all([this.loadTracks(), this.loadPlaylists()]);
      this.setupSocket();
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.loading = false;
    }
  }

  async loadProject() {
    const data = await api.get<{
      project: Project; members: Member[]; roles: ProjectRole[]; departments: Department[];
      assignments: DepartmentAssignment[]; dancers: Dancer[]; formations: Formation[];
      settings: { stage?: StageConfig }; imageUrl?: string | null;
    }>(`/projects/${this.id}`);
    this.project = data.project;
    this.members = data.members;
    this.roles = data.roles;
    this.departments = data.departments ?? [];
    this.assignments = data.assignments ?? [];
    this.dancers = data.dancers ?? [];
    this.formations = data.formations ?? [];
    this.stage = data.settings?.stage ?? DEFAULT_STAGE;
    this.imageUrl = data.imageUrl ?? null;
  }

  async loadTracks() {
    const { tracks } = await api.get<{ tracks: Track[] }>(`/projects/${this.id}/tracks`);
    this.tracks = tracks;
    this.#managePolling();
  }

  // 10-playlists: load the project's playlists (named setlists)
  async loadPlaylists() {
    const { playlists } = await api.get<{ playlists: Playlist[] }>(`/projects/${this.id}/playlists`);
    this.playlists = playlists;
  }

  // Poll while any version is still processing.
  #managePolling() {
    const anyProcessing = this.tracks.some((t) =>
      t.versions.some((v) => v.status === 'uploaded' || v.status === 'processing' || v.status === 'pending_upload')
    );
    if (anyProcessing && !this.#pollTimer) this.#pollTimer = setInterval(() => this.loadTracks(), 2500);
    else if (!anyProcessing && this.#pollTimer) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = null;
    }
  }

  setupSocket() {
    const socket = getSocket();
    const reload = () => this.loadTracks();
    this.#handlers = {
      'presence:state': ({ online }: { online: OnlineUser[] }) => (this.online = online),
      'member:joined': ({ online }: { online: OnlineUser[] }) => (this.online = online),
      'member:left': ({ online }: { online: OnlineUser[] }) => (this.online = online),
      'track:created': reload,
      'track:deleted': reload,
      'track:version:uploaded': reload,
      'track:version:ready': reload,
      'track:version:activated': reload,
      // Phase 5a: departments/lanes/crew changed elsewhere → refresh the tree.
      'department:changed': () => this.loadProject(),
      // Phase 8b: formation definition library — keep in sync across collaborators.
      'formation:def:created': ({ formation }: any) => {
        if (!this.formations.find((f) => f.id === formation.id))
          this.formations = [...this.formations, formation];
      },
      'formation:def:updated': ({ formation }: any) => {
        this.formations = this.formations.map((f) => (f.id === formation.id ? formation : f));
      },
      'formation:def:deleted': ({ formationId }: any) => {
        this.formations = this.formations.filter((f) => f.id !== formationId);
      },
      // 10-meta / 10-views: track name/id_number/notes/sort_order changed by another client.
      'track:updated': () => this.loadTracks(),
      // 10-views: another client reordered tracks.
      'tracks:reordered': () => this.loadTracks(),
      // 10-playlists: setlist changes from another client.
      'playlist:created': () => this.loadPlaylists(),
      'playlist:updated': () => this.loadPlaylists(),
      'playlist:deleted': () => this.loadPlaylists(),
      'playlist:tracks:changed': () => this.loadPlaylists(),
      // A rekordbox import may have created the "Rekordbox" department/lane
      // (loadProject) as well as tracks/cues (loadTracks) — refresh both.
      'import:completed': () => {
        this.loadProject();
        this.loadTracks();
      },
    };
    for (const [ev, fn] of Object.entries(this.#handlers)) socket.on(ev, fn);
    const join = () => joinProject(this.id);
    socket.connected ? join() : socket.once('connect', join);
    this.#joined = true;
  }

  teardown() {
    if (this.#pollTimer) {
      clearInterval(this.#pollTimer);
      this.#pollTimer = null;
    }
    if (this.#joined) {
      const socket = getSocket();
      for (const [ev, fn] of Object.entries(this.#handlers)) socket.off(ev, fn);
      leaveProject();
      this.#joined = false;
    }
  }
}
