import { HttpContextToken } from '@angular/common/http';

/** The request authenticates itself (sign-in, refresh, public endpoints): no bearer token, no refresh on 401. */
export const SKIP_AUTH = new HttpContextToken<boolean>(() => false);

/** Milliseconds before the request is abandoned. PDFs and CSV exports get longer. */
export const TIMEOUT_MS = new HttpContextToken<number>(() => 20_000);
