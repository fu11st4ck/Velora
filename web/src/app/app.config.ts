import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { type ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { MAT_DIALOG_DEFAULT_OPTIONS, MatDialogConfig } from '@angular/material/dialog';
import { MAT_FORM_FIELD_DEFAULT_OPTIONS } from '@angular/material/form-field';
import { MatIconRegistry } from '@angular/material/icon';
import { provideRouter, withComponentInputBinding, withInMemoryScrolling } from '@angular/router';
import { routes } from './app.routes';
import { apiInterceptor } from './core/api/api.interceptor';
import { SessionStore } from './core/auth/session.store';
import { PreferencesStore } from './core/state/preferences.store';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes, withComponentInputBinding(), withInMemoryScrolling({ scrollPositionRestoration: 'enabled' })),
    provideHttpClient(withFetch(), withInterceptors([apiInterceptor])),
    // Move focus into a dialog as soon as it appears, not after its opening animation: otherwise text
    // typed straight away can land in one field and then jump to another (seen on slower machines).
    // Material uses these options instead of its own defaults, so start from them.
    { provide: MAT_DIALOG_DEFAULT_OPTIONS, useValue: { ...new MatDialogConfig(), delayFocusTrap: false } },
    { provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { appearance: 'outline', subscriptSizing: 'dynamic' } },
    provideAppInitializer(() => {
      // 'mat-ligature-font' lets <mat-icon fontIcon="…"> draw a glyph from CSS, with no text in the element.
      inject(MatIconRegistry).setDefaultFontSetClass('material-symbols-rounded', 'mat-ligature-font');
      inject(PreferencesStore); // applies the theme before the first paint
      // Not awaited: the guards wait for the session check, so public pages render at once.
      void inject(SessionStore).restore();
    }),
  ],
};
