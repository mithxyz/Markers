// Web MIDI engine (Phase 3a). Browser-native output for live cue triggering — no
// server, no bridge. Web MIDI is Chromium/Edge (and Opera); Safari/Firefox lack
// it by default, hence the `supported` guard. Requires a secure context (HTTPS).

interface MIDIOutputLike {
  id: string;
  name?: string;
  send: (data: number[]) => void;
}

class MidiEngine {
  supported = $state(typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator);
  enabled = $state(false);
  outputs = $state<{ id: string; name: string }[]>([]);
  error = $state<string | null>(null);

  #access: any = null;
  #outMap = new Map<string, MIDIOutputLike>();

  /** Prompt for MIDI access + populate outputs. Call from a user gesture. */
  async enable(): Promise<boolean> {
    if (!this.supported) {
      this.error = 'Web MIDI is not available in this browser (try Chrome or Edge).';
      return false;
    }
    try {
      this.#access = await (navigator as any).requestMIDIAccess({ sysex: false });
      this.#refresh();
      this.#access.onstatechange = () => this.#refresh();
      this.enabled = true;
      this.error = null;
      return true;
    } catch (e) {
      this.error = (e as Error)?.message || 'MIDI access was denied.';
      return false;
    }
  }

  #refresh() {
    this.#outMap.clear();
    const list: { id: string; name: string }[] = [];
    this.#access?.outputs?.forEach((o: MIDIOutputLike) => {
      this.#outMap.set(o.id, o);
      list.push({ id: o.id, name: o.name || o.id });
    });
    this.outputs = list;
  }

  noteOn(outId: string, channel: number, note: number, velocity: number) {
    this.#outMap.get(outId)?.send([0x90 | ((channel - 1) & 0x0f), note & 0x7f, velocity & 0x7f]);
  }

  noteOff(outId: string, channel: number, note: number) {
    this.#outMap.get(outId)?.send([0x80 | ((channel - 1) & 0x0f), note & 0x7f, 0]);
  }

  /** Note On then Note Off after `ms` — a momentary trigger pulse. */
  pulse(outId: string, channel: number, note: number, velocity: number, ms = 120) {
    this.noteOn(outId, channel, note, velocity);
    setTimeout(() => this.noteOff(outId, channel, note), ms);
  }
}

export const midi = new MidiEngine();
