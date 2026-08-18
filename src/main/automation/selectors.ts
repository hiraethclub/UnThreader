// ─────────────────────────────────────────────────────────────────────────────
// FRAGILITY FIREWALL
//
// Every piece of knowledge about the Threads web DOM lives here. Threads ships
// obfuscated class names, so we anchor on stable-ish things: ARIA labels, element
// roles, and human-visible button text (case-insensitive substring match).
//
// If the app stops finding buttons after a Threads redesign, THIS is the file to
// update — nothing else should need to change.
// ─────────────────────────────────────────────────────────────────────────────

export interface SelectorConfig {
  /** Accessible names for a post/reply's "..." (more options) button. */
  postMenuButtonLabels: string[]
  /** Menu-item text that begins a delete. */
  deleteMenuItemText: string[]
  /** Confirmation-dialog button text that finalises a delete. */
  confirmDeleteText: string[]
  /** Exact accessible name(s) of the left-rail Profile navigation control. */
  profileNavLabels: string[]
  /** Accessible name(s) of the compose/create control (a logged-in-only signal). */
  composeLabels: string[]
  /** Text of the "Edit profile" control — only present on your OWN profile. */
  editProfileText: string[]
  /** Profile tab accessible names. */
  tabs: { posts: string[]; replies: string[] }
  /** Candidate container selectors that wrap a single post/reply. */
  postContainers: string[]
  /** Phrases that indicate Threads has rate-limited or blocked the account. */
  rateWallText: string[]
  /** Base Threads URL. */
  baseUrl: string
}

export const SELECTORS: SelectorConfig = {
  profileNavLabels: ['Profile'],
  composeLabels: ['Create', 'New thread', 'Post'],
  editProfileText: ['Edit profile'],
  postMenuButtonLabels: ['More', 'More options', 'Options', 'Post options'],
  deleteMenuItemText: ['Delete'],
  confirmDeleteText: ['Delete'],
  tabs: {
    posts: ['Threads'],
    replies: ['Replies']
  },
  postContainers: ['div[data-pressable-container="true"]', 'div[role="article"]', 'article'],
  rateWallText: [
    'try again later',
    'temporarily blocked',
    'please wait a few minutes',
    'action blocked',
    'we limit how often',
    'suspicious activity',
    'too many requests'
  ],
  baseUrl: 'https://www.threads.net'
}
