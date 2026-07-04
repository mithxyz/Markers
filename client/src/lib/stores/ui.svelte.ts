// Lightweight toast store (Svelte 5 runes).
interface Toast {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
}

let nextId = 1;

class UiStore {
  toasts = $state<Toast[]>([]);

  toast(message: string, kind: Toast['kind'] = 'info') {
    const id = nextId++;
    this.toasts = [...this.toasts, { id, message, kind }];
    setTimeout(() => this.dismiss(id), 4000);
  }

  dismiss(id: number) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
  }
}

export const ui = new UiStore();
