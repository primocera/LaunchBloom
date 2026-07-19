// ---------------------------------------------------------------------------
// v7 LB-11: ONE customer-facing label per stored asset status. The database
// keeps its historical values (draft/edited/ready/published); every surface —
// studio status pills, Library filters and cards — renders these labels so
// "edited" never shows up next to "Needs review" for the same state.
// Published is always a user-declared status: LaunchBloom never publishes.
// ---------------------------------------------------------------------------

export const STATUS_VALUES = ['draft', 'edited', 'ready', 'published'];

export const STATUS_LABEL = {
  draft: 'Draft',
  edited: 'Needs review',
  ready: 'Ready to export',
  published: 'Published',
  blocked: 'Blocked by unresolved claim',
};

/** Customer-facing label for a stored status value (falls back to Draft). */
export function statusLabelFor(status) {
  return STATUS_LABEL[status] || status || 'Draft';
}
