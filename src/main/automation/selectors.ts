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
  /** Profile tab accessible names. */
  tabs: { posts: string[]; replies: string[] }
  /** Text contained in the link that opens the "following" list. */
  followingLinkText: string[]
  /** Text contained in the link that opens the "followers" list. */
  followersLinkText: string[]
  /** Button text on a following-row (click to unfollow). */
  followingButtonText: string[]
  /** Confirmation button text for an unfollow. */
  confirmUnfollowText: string[]
  /** Button text on a follower-row (click to remove). */
  removeButtonText: string[]
  /** Confirmation button text for removing a follower. */
  confirmRemoveText: string[]
  /** Candidate container selectors that wrap a single post/reply. */
  postContainers: string[]
  /** Phrases that indicate Threads has rate-limited or blocked the account. */
  rateWallText: string[]
  /** Base Threads URL. */
  baseUrl: string
}

export const SELECTORS: SelectorConfig = {
  postMenuButtonLabels: ['More', 'More options', 'Options', 'Post options'],
  deleteMenuItemText: ['Delete'],
  confirmDeleteText: ['Delete'],
  tabs: {
    posts: ['Threads'],
    replies: ['Replies']
  },
  followingLinkText: ['following'],
  followersLinkText: ['followers'],
  followingButtonText: ['Following'],
  confirmUnfollowText: ['Unfollow'],
  removeButtonText: ['Remove'],
  confirmRemoveText: ['Remove'],
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
