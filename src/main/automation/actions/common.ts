import { Ctx, sleep } from '../context.js'

const rand = (base: number, spread: number) => base + Math.random() * spread

/**
 * Scrolls the feed to load more items and decides whether the list is exhausted.
 * Uses a "stall counter": after several scrolls with no growth in the scroll
 * height + loaded-post count, we conclude there is nothing more to load.
 */
export async function loadMoreOrDone(ctx: Ctx): Promise<{ done: boolean }> {
  const before = await ctx.rt<{ height: number }>('scrollFeed').then((r) => r?.height ?? 0)
  await sleep(rand(1300, 900))
  const after = await ctx.rt<number>('measure', 'feed')
  const grew = (after ?? 0) > before

  if (grew) {
    ctx.state.stall = 0
    return { done: false }
  }
  ctx.state.stall = (ctx.state.stall ?? 0) + 1
  // Several stalled scrolls in a row → treat as the end of the list.
  return { done: (ctx.state.stall ?? 0) >= 4 }
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
      await ctx.rt('resetMarks')
      await ctx.rt('activateTab', tab)
      await sleep(rand(1200, 800))
      ctx.state.stall = 0
    },
    async step(ctx: Ctx) {
      if (ctx.dryRun) {
        const m = await ctx.rt('markFirstItem')
        if (!m.ok) return await endOrScroll(ctx)
        ctx.log('action', `Would delete ${noun}`, m.id)
        return { acted: true, skipped: true, target: m.id }
      }

      const menu = await ctx.rt('firstItemMenuRect')
      if (!menu.ok || !menu.rect) return await endOrScroll(ctx)

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

async function endOrScroll(ctx: Ctx) {
  const { done } = await loadMoreOrDone(ctx)
  return done ? { done: true } : {}
}
