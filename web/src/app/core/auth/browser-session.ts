import { Injectable } from '@angular/core';

/** Messages between tabs of the same browser, so signing out in one tab signs out all of them. */
export type SessionMessage = { type: 'signed-out' } | { type: 'signed-in' };

/**
 * Browser facilities the session needs, behind one small class so tests can replace them:
 * Web Locks (one tab refreshes at a time — the server treats a reused refresh token as theft and
 * would end the session) and BroadcastChannel (tell the other tabs).
 */
@Injectable({ providedIn: 'root' })
export class BrowserSession {
  private readonly channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('velora-session');

  /** Runs `task` while no other tab of this site runs a task under the same lock. */
  exclusive<T>(task: () => Promise<T>): Promise<T> {
    const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
    return locks ? locks.request('velora-refresh', task) : task();
  }

  post(message: SessionMessage): void {
    this.channel?.postMessage(message);
  }

  listen(handler: (message: SessionMessage) => void): void {
    if (this.channel) this.channel.onmessage = (event: MessageEvent<SessionMessage>) => handler(event.data);
  }

  /** A short, readable name for the signed-in devices list, e.g. "Chrome on macOS". */
  deviceName(): string {
    const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'web';
    return `${browser} on ${os}`;
  }
}
