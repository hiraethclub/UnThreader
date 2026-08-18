import { Ctx, sleep } from '../context.js'

const rand = (base: number, spread: number) => base + Math.random() * spread

/** A compact list of clickable labels currently on the page, for the debug log. */
async function sample(ctx: Ctx): Promise<string> {
  const s = (await ctx.rt<string[]>('sampleButtons').catch(() => [])) as string[]
  return Array.isArray(s) && s.length ? s.join(' | ') : '(none)'
}

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
      if (!menu.ok || !menu.rect) {
        ctx.debug(`no ⋯ menu button found among posts; scrolling`)
        return await endOrScroll(ctx)
      }
      ctx.debug(`target ${noun} ${menu.id}; opening ⋯ menu at ${Math.round(menu.rect.x)},${Math.round(menu.rect.y)}`)

      await ctx.clickRect(menu.rect)
      await sleep(400)
      ctx.debug(`after ⋯ click, buttons on page: ${await sample(ctx)}`)

      const del = await ctx.pollRect('menuItemRect', undefined, 12, 250)
      if (!del) {
        ctx.debug(`"Delete" menu item NOT found after opening ⋯ menu`)
        await ctx.rt('closeOverlays')
        ctx.log('warn', `Could not find Delete in the menu`, menu.id)
        return { failed: true, target: menu.id }
      }
      ctx.debug(`clicking "Delete" menu item at ${Math.round(del.rect.x)},${Math.round(del.rect.y)}`)
      await ctx.clickRect(del.rect)
      await sleep(400)
      ctx.debug(`after Delete click, buttons on page: ${await sample(ctx)}`)

      const confirm = await ctx.pollRect('confirmRect', undefined, 8, 250)
      if (confirm) {
        ctx.debug(`clicking confirm "Delete" at ${Math.round(confirm.rect.x)},${Math.round(confirm.rect.y)}`)
        await ctx.clickRect(confirm.rect)
      } else {
        ctx.debug(`no confirmation dialog appeared (delete may have been immediate)`)
      }
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
