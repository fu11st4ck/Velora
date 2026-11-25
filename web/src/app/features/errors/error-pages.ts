import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { StateView } from '../../shared/ui/state-view';

@Component({
  selector: 'app-not-found-page',
  imports: [StateView, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-state-view kind="notFound" heading="Page not found" message="The address may be mistyped, or the page has moved."><a routerLink="/dashboard">Go to the dashboard</a></app-state-view>`,
})
export class NotFoundPage {}

@Component({
  selector: 'app-forbidden-page',
  imports: [StateView, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-state-view kind="forbidden" heading="You don't have access to this" message="Your role does not include this page. Ask the business owner if you need it."><a routerLink="/dashboard">Go to the dashboard</a></app-state-view>`,
})
export class ForbiddenPage {}
