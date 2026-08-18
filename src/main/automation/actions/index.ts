import type { OperationId } from '@shared/types.js'
import type { ActionModule } from '../context.js'
import { makeDeleteModule, makeFollowModule } from './common.js'

/** Registry of the four operations, keyed by id. */
export const ACTIONS: Record<OperationId, ActionModule> = {
  deletePosts: makeDeleteModule('deletePosts', 'posts'),
  deleteReplies: makeDeleteModule('deleteReplies', 'replies'),
  unfollowAll: makeFollowModule('unfollowAll', 'unfollow'),
  removeFollowers: makeFollowModule('removeFollowers', 'remove')
}
