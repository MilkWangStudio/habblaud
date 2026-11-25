import { setTimeout as delay } from 'node:timers/promises';
import { MulticaError, readCredentials, readWorkspace, type Credentials, type WorkspaceFacts } from './client';

export type Frame =
  | { state: 'live'; facts: WorkspaceFacts }
  | { state: 'connecting' | 'stale' | 'unavailable'; reason?: string };

type Listener = (frame: Frame) => void;
const sameLogin = (a: Credentials, b: Credentials) => a.origin === b.origin && a.token === b.token;

export class WorkspaceStream {
  private readonly stop = new AbortController();
  private readonly listeners = new Set<Listener>();
  private frame: Frame = { state: 'connecting' };

  constructor(private readonly workspace: string) {}
  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.frame);
    return () => this.listeners.delete(listener);
  }
  get empty() { return this.listeners.size === 0; }
  close() { this.stop.abort(); }
  private publish(frame: Frame) {
    if (this.stop.signal.aborted) return;
    this.frame = frame;
    for (const fn of this.listeners) fn(frame);
  }

  async run() {
    let retry = 1000;
    while (!this.stop.signal.aborted) {
      try {
        const auth = await readCredentials();
        if (this.stop.signal.aborted) return;
        await this.connect(auth, () => { retry = 1000; });
      } catch (err) {
        const reason = err instanceof MulticaError ? err.code : 'upstream';
        this.publish({ state: reason === 'access' || reason === 'credentials' ? 'unavailable' : 'stale', reason });
      }
      await delay(retry, undefined, { signal: this.stop.signal }).catch(() => {});
      retry = Math.min(30_000, retry * 2);
    }
  }

  private async connect(auth: Credentials, online: () => void) {
    const url = new URL('/ws', auth.origin);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('workspace_id', this.workspace);
    const socket = new WebSocket(url);
    const controller = new AbortController();
    const signal = controller.signal;
    let authenticated = false;
    let lastSeen = Date.now();
    let dirty = false;
    let reading = false;
    let checkingLogin = false;
    let batch: NodeJS.Timeout | undefined;
    let finish!: (error?: MulticaError) => void;
    const ended = new Promise<void>((resolve, reject) => {
      finish = error => {
        controller.abort();
        if (error) reject(error); else resolve();
      };
    });
    const stop = () => finish();
    this.stop.signal.addEventListener('abort', stop, { once: true });
    async function verifyLogin() {
      if (!sameLogin(auth, await readCredentials())) throw new MulticaError('credentials');
    }
    const refresh = async () => {
      if (reading || signal.aborted) return;
      reading = true;
      try {
        do {
          dirty = false;
          const facts = await readWorkspace(auth, this.workspace, signal);
          await verifyLogin();
          if (signal.aborted) return;
          this.publish({ state: 'live', facts });
          online();
        } while (dirty && !signal.aborted);
      } catch (err) {
        if (!signal.aborted) finish(err instanceof MulticaError ? err : new MulticaError('upstream'));
      } finally { reading = false; }
    };
    const schedule = () => {
      if (!authenticated || signal.aborted) return;
      dirty = true;
      if (!reading && !batch) batch = setTimeout(() => { batch = undefined; void refresh(); }, 200);
    };
    const deadline = setTimeout(() => finish(new MulticaError('upstream')), 20_000);
    const calibration = setInterval(schedule, 300_000);
    const credentialCheck = setInterval(async () => {
      if (checkingLogin) return;
      checkingLogin = true;
      try { await verifyLogin(); } catch { finish(new MulticaError('credentials')); }
      finally { checkingLogin = false; }
    }, 5000);
    const ping = setInterval(() => {
      if (Date.now() - lastSeen > 75_000) finish(new MulticaError('upstream'));
      else if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' }));
    }, 25_000);
    socket.onopen = () => {
      if (!signal.aborted) socket.send(JSON.stringify({ type: 'auth', payload: { token: auth.token } }));
    };
    socket.onmessage = event => {
      if (signal.aborted) return;
      lastSeen = Date.now();
      try {
        const msg = JSON.parse(String(event.data));
        if (msg?.error || msg?.type === 'error') return finish(new MulticaError('access'));
        if (typeof msg?.type !== 'string') throw new Error();
        if (msg.type === 'auth_ack' && !authenticated) {
          clearTimeout(deadline);
          authenticated = true;
          void refresh(); // Subscribe before the first read on every connection.
        } else if (msg.type !== 'pong' && msg.type !== 'task:message') {
          const scope = msg.workspace_id || msg.payload?.workspace_id;
          if (!scope || scope === this.workspace) schedule();
        }
      } catch { finish(new MulticaError('protocol')); }
    };
    socket.onerror = () => finish(new MulticaError('upstream'));
    socket.onclose = e => finish(new MulticaError([1008, 4001, 4003].includes(e.code) ? 'access' : 'upstream'));
    try { await ended; }
    finally {
      this.stop.signal.removeEventListener('abort', stop);
      clearTimeout(deadline); clearTimeout(batch);
      clearInterval(credentialCheck); clearInterval(calibration); clearInterval(ping);
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
    }
  }
}
