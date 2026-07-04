<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { api, type Project } from '$lib/api';
  import { ui } from '$lib/stores/ui.svelte';
  import { ProjectStore, PROJECT_CTX } from '$lib/stores/project.svelte';
  import ProjectImage from '$lib/components/ProjectImage.svelte';
  import MembersPanel from '$lib/components/MembersPanel.svelte';
  import RolesPanel from '$lib/components/RolesPanel.svelte';
  import DepartmentsPanel from '$lib/components/DepartmentsPanel.svelte';
  import CrewPanel from '$lib/components/CrewPanel.svelte';
  import DancersPanel from '$lib/components/DancersPanel.svelte';

  const store = getContext<ProjectStore>(PROJECT_CTX);
  const reload = () => store.loadProject();

  let name = $state(store.project?.name ?? '');
  let description = $state(store.project?.description ?? '');

  async function saveDetails() {
    try {
      const { project } = await api.patch<{ project: Project }>(`/projects/${store.id}`, { name: name.trim(), description: description.trim() });
      store.project = project;
      ui.toast('Saved', 'success');
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }
  async function deleteProject() {
    if (!confirm(`Delete project "${store.project?.name}"? This cannot be undone.`)) return;
    try {
      await api.del(`/projects/${store.id}`);
      goto('/projects', { replaceState: true });
    } catch (e) {
      ui.toast((e as Error).message, 'error');
    }
  }
</script>

{#if store.project}
  <div class="mx-auto w-full max-w-3xl px-6 py-8">
    <header class="flex items-center gap-3 border-b border-neutral-800 pb-4">
      <a href="/projects/{store.id}" class="text-sm text-neutral-500 hover:text-white">← {store.project.name}</a>
      <h1 class="text-xl font-semibold text-white">Project settings</h1>
    </header>

    {#if store.can('manage_project')}
      <section class="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-[2fr_3fr]">
        <ProjectImage editable />
        <div class="flex flex-col gap-2">
          <label class="flex flex-col gap-1 text-xs text-neutral-400">Name
            <input bind:value={name} class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500" />
          </label>
          <label class="flex flex-col gap-1 text-xs text-neutral-400">Description
            <textarea bind:value={description} rows="3" class="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-white outline-none focus:border-indigo-500"></textarea>
          </label>
          <button onclick={saveDetails} class="self-start rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500">Save details</button>
        </div>
      </section>
    {/if}

    <MembersPanel projectId={store.id} members={store.members} roles={store.roles} ownerId={store.project.owner_id} canManage={store.can('manage_members')} onChanged={reload} />

    {#if store.departments.length || store.can('manage_departments')}
      <DepartmentsPanel projectId={store.id} departments={store.departments} canManage={store.can('manage_departments')} onChanged={reload} />
    {/if}

    {#if store.departments.length > 1 && (store.can('manage_members') || store.myDepartmentIds.length)}
      <CrewPanel projectId={store.id} members={store.members} departments={store.departments} assignments={store.assignments} canManage={store.can('manage_members')} onChanged={reload} />
    {/if}

    {#if store.project.type === 'dance' && (store.dancers.length || store.can('manage_tracks'))}
      <DancersPanel projectId={store.id} dancers={store.dancers} stage={store.stage} canManage={store.can('manage_tracks')} onChanged={reload} />
    {/if}

    {#if store.can('manage_roles')}
      <RolesPanel projectId={store.id} departments={store.departments} onChanged={reload} />
    {/if}

    {#if store.can('delete_project')}
      <section class="mt-10 rounded-xl border border-red-900/40 bg-red-950/20 p-4">
        <h2 class="text-xs font-semibold uppercase tracking-wide text-red-400">Danger zone</h2>
        <div class="mt-2 flex items-center justify-between">
          <p class="text-sm text-neutral-400">Permanently delete this project and all its tracks, cues, and formations.</p>
          <button onclick={deleteProject} class="rounded-lg border border-red-800 px-3 py-1.5 text-sm text-red-300 hover:bg-red-900/40">Delete project</button>
        </div>
      </section>
    {/if}
  </div>
{/if}
