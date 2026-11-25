import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { SessionStore } from './core/auth/session.store';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<router-outlet />',
  styles: ':host { display: block; height: 100%; }',
})
export class App {
  constructor() {
    const session = inject(SessionStore);
    const router = inject(Router);
    // The session ended while in use (expired, revoked, signed out in another tab): go to sign-in
    // and come back to the same page afterwards. The page's unsaved work stays where it was kept.
    effect(() => {
      if (session.status() === 'signedOut' && session.endReason() !== null && !router.url.startsWith('/sign-in')) {
        const returnUrl = router.url;
        void router.navigate(['/sign-in'], { queryParams: returnUrl && returnUrl !== '/' ? { returnUrl } : {} });
      }
    });
  }
}
