/** Build-time settings. Never put secrets here: everything in this file ends up in the browser. */
export const environment = {
  /** Same origin as the web app: Caddy (production) or the dev-server proxy forwards it to the API. */
  apiBaseUrl: '/api/v1',
  /** Enables the design-system review page at /dev/ui. */
  devTools: false,
};
