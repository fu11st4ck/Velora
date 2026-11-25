/**
 * The link emailed for choosing a password (reset or invitation). It opens the web app's reset
 * page in any browser; the phone app can later claim the same https address (Android App Links,
 * iOS Universal Links), which a custom `velora://` scheme cannot offer on a computer.
 */
export function resetLink(appBaseUrl: string, token: string): string {
  // Relative to the base, so an app served under a path (https://shop.example/velora/) keeps it.
  const url = new URL('reset-password', appBaseUrl.endsWith('/') ? appBaseUrl : `${appBaseUrl}/`);
  url.searchParams.set('token', token);
  return url.toString();
}
