import { Ctx, sleep } from '../context.js'

const rand = (base: number, spread: number) => base + Math.random() * spread

/**
 * Scrolls the feed or dialog to load more items and decides whether the list is
 * exhausted. Uses a "stall counter": after several scrolls with no growth in the
 * scroll height, we conclude there is nothing more to load.
 */
export async function loadMoreOrDone(ctx: Ctx, kind: 'feed' | 'dialog'): Promise<{ done: boolean }> {
  const method = kind === 'dialog' ? 'scrollDialog' : 'scrollFeed'
  const before = await ctx.rt<{ height: number }>(method).then((r) => r?.height ?? 0)
  await sleep(rand(1000, 800))
  const after = await ctx.rt<number>('measure', kind === 'dialog' ? 'dialog' : 'feed')
  const grew = (after ?? 0) > before + 40

  if (grew) {
    ctx.state.stall = 0
    return { done: false }
  }
  ctx.state.stall = (ctx.state.stall ?? 0) + 1
  // Three stalled scrolls in a row → treat as the end of the list.
  return { done: (ctx.state.stall ?? 0) >= 3 }
}

/**
 * Shared "open the ⋯ menu → Delete → confirm" flow for posts and replies.
 * `tab` selects the profile tab to operate on.
 */
export function makeDeleteModule(id: 'deletePosts' | 'deleteReplies', tab: 'posts' | 'replies') {
  const noun = tab === 'replies' ? 'reply' : 'post'
  return {
    id,
    async navigate(ctx: Ctx): Promise<void> {
      await ctx.rt('activateTab', tab)
      await sleep(rand(1200, 800))
      ctx.state.stall = 0
    },
    async step(ctx: Ctx) {
      if (ctx.dryRun) {
        const m = await ctx.rt('markFirstItem')
        if (!m.ok) return await endOrScroll(ctx, 'feed')
        ctx.log('action', `Would delete ${noun}`, m.id)
        return { acted: true, skipped: true, target: m.id }
      }

      const menu = await ctx.rt('firstItemMenuRect')
      if (!menu.ok || !menu.rect) return await endOrScroll(ctx, 'feed')

      await ctx.clickRect(menu.rect)
      const del = await ctx.pollRect('menuItemRect', 'delete', 12, 250)
      if (!del) {
        await ctx.rt('closeOverlays')
        ctx.log('warn', `Could not find Delete in the menu`, menu.id)
        return { failed: true, target: menu.id }
      }
      await ctx.clickRect(del.rect)
      const confirm = await ctx.pollRect('confirmRect', 'delete', 8, 250)
      if (confirm) await ctx.clickRect(confirm.rect)
      await sleep(rand(900, 700))
      ctx.log('success', `Deleted ${noun}`, menu.id)
      ctx.state.stall = 0
      return { acted: true, target: menu.id }
    }
  }
}

/**
 * Shared flow for the follow / followers dialogs: open the dialog, then for each
 * row click its action button (Following→Unfollow, or Remove) and confirm.
 */
export function makeFollowModule(id: 'unfollowAll' | 'removeFollowers', kind: 'unfollow' | 'remove') {
  const dialog = kind === 'remove' ? 'followers' : 'following'
  const verb = kind === 'remove' ? 'Removed follower' : 'Unfollowed'
  const wouldVerb = kind === 'remove' ? 'Would remove follower' : 'Would unfollow'
  return {
    id,
    async navigate(ctx: Ctx): Promise<void> {
      const opened = await ctx.rt<boolean>('openFollowDialog', dialog)
      if (!opened) ctx.log('warn', `Could not open the ${dialog} list`)
      await sleep(rand(1400, 900))
      ctx.state.stall = 0
    },
    async step(ctx: Ctx) {
      if (ctx.dryRun) {
        const m = await ctx.rt('markFirstRow', kind)
        if (!m.ok) return await endOrScroll(ctx, 'dialog')
        ctx.log('action', wouldVerb, m.id)
        return { acted: true, skipped: true, target: m.id }
      }

      const row = await ctx.rt('firstRowActionRect', kind)
      if (!row.ok || !row.rect) return await endOrScroll(ctx, 'dialog')

      await ctx.clickRect(row.rect)
      // A confirm sheet appears for unfollow/remove on the web UI.
      const confirm = await ctx.pollRect('confirmRect', kind, 8, 250)
      if (confirm) await ctx.clickRect(confirm.rect)
      await sleep(rand(900, 700))
      ctx.log('success', verb, row.id)
      ctx.state.stall = 0
      return { acted: true, target: row.id }
    }
  }
}

async function endOrScroll(ctx: Ctx, kind: 'feed' | 'dialog') {
  const { done } = await loadMoreOrDone(ctx, kind)
  return done ? { done: true } : {}
}
