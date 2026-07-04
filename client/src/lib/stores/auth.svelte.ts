import { api, type User } from '$lib/api';

// Rune-based global auth state (Svelte 5).
class AuthStore {
  user = $state<User | null>(null);
  loaded = $state(false);

  async load() {
    try {
      const { user } = await api.get<{ user: User }>('/auth/me');
      this.user = user;
    } catch {
      this.user = null;
    } finally {
      this.loaded = true;
    }
  }

  async logout() {
    await api.post('/auth/logout');
    this.user = null;
  }
}

export const auth = new AuthStore();
