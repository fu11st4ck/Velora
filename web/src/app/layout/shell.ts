import { TitleCasePipe } from '@angular/common';
import { BreakpointObserver } from '@angular/cdk/layout';
import { ChangeDetectionStrategy, Component, computed, inject, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatIconButton } from '@angular/material/button';
import { MatDivider } from '@angular/material/divider';
import { MatIcon } from '@angular/material/icon';
import { MatMenu, MatMenuItem, MatMenuTrigger } from '@angular/material/menu';
import { MatSidenav, MatSidenavContainer, MatSidenavContent } from '@angular/material/sidenav';
import { MatTooltip } from '@angular/material/tooltip';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { SessionStore } from '../core/auth/session.store';
import { PreferencesStore, type ThemePreference } from '../core/state/preferences.store';
import { activeNavPath, visibleNavigation } from './navigation';

type Layout = 'wide' | 'rail' | 'compact';

function currentLayout(): Layout {
  if (typeof matchMedia === 'undefined') return 'wide';
  return matchMedia('(min-width: 1280px)').matches ? 'wide' : matchMedia('(min-width: 840px)').matches ? 'rail' : 'compact';
}

/** The signed-in frame: sidebar (≥ 1280 px), icon rail (840–1279 px) or drawer (< 840 px). */
@Component({
  selector: 'app-shell',
  imports: [TitleCasePipe, RouterOutlet, RouterLink, MatSidenavContainer, MatSidenav, MatSidenavContent, MatIcon, MatIconButton, MatMenu, MatMenuItem, MatMenuTrigger, MatDivider, MatTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
})
export class Shell {
  protected readonly session = inject(SessionStore);
  protected readonly preferences = inject(PreferencesStore);
  private readonly router = inject(Router);
  private readonly sidenav = viewChild.required(MatSidenav);

  private readonly breakpoints = toSignal(
    inject(BreakpointObserver)
      .observe(['(min-width: 1280px)', '(min-width: 840px)'])
      .pipe(map((s) => (s.breakpoints['(min-width: 1280px)'] ? 'wide' : s.breakpoints['(min-width: 840px)'] ? 'rail' : 'compact') as Layout)),
    // The right layout from the first render, so a phone never starts with the drawer open.
    { initialValue: currentLayout() },
  );
  protected readonly layout = computed<Layout>(() => (this.breakpoints() === 'wide' && this.preferences.sidebarCollapsed() ? 'rail' : this.breakpoints()));
  protected readonly navigation = computed(() => visibleNavigation((p) => this.session.can(p)));
  private readonly url = toSignal(this.router.events.pipe(filter((e) => e instanceof NavigationEnd), map(() => this.router.url)), { initialValue: this.router.url });
  /** The most specific entry containing the current page: /inventory/42 → Products, /inventory/history → Stock history. */
  protected readonly activePath = computed(() => activeNavPath(this.url(), this.navigation()));
  protected readonly initials = computed(() =>
    (this.session.me()?.user.fullName ?? '?')
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join(''),
  );
  protected readonly themes: { value: ThemePreference; label: string }[] = [
    { value: 'system', label: 'Same as device' },
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ];

  /** On a phone the drawer closes once a destination is chosen — including the page already open. */
  protected closeDrawer(): void {
    if (this.layout() === 'compact') void this.sidenav().close();
  }

  protected toggleNavigation(): void {
    if (this.breakpoints() === 'compact') void this.sidenav().toggle();
    else if (this.breakpoints() === 'wide') this.preferences.toggleSidebar();
  }

  protected skipToContent(event: Event): void {
    event.preventDefault();
    const target = document.getElementById('page-title') ?? document.getElementById('main');
    target?.focus();
  }

  protected async signOut(): Promise<void> {
    await this.session.signOut();
    await this.router.navigateByUrl('/sign-in');
  }
}
