import type { OperationId } from '@shared/types.js'
import type { ActionModule } from '../context.js'
import { makeDeleteModule } from './common.js'

/** Registry of the supported operations, keyed by id. */
export const ACTIONS: Record<OperationId, ActionModule> = {
  deletePosts: makeDeleteModule('deletePosts', 'posts'),
  deleteReplies: makeDeleteModule('deleteReplies', 'replies')
}
