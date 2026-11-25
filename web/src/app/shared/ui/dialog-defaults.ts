/**
 * Options every dialog of the app opens with. Focus moves into a dialog as soon as it appears, not
 * after its opening animation: otherwise text typed straight away can land in one field and then
 * jump to another (seen on slower machines). A plain object on purpose: providing Material's
 * MAT_DIALOG_DEFAULT_OPTIONS at the root would pull the whole dialog module into the first download.
 */
export const DIALOG_DEFAULTS = { delayFocusTrap: false } as const;
