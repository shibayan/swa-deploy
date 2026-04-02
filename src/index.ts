/**
 * The entrypoint for the action. This file simply imports and runs the action's
 * main logic.
 */
import * as core from '@actions/core'
import { CacheState } from './cache.js'
import { run } from './main.js'
import { runPost } from './post.js'

/* istanbul ignore next */
if (core.getState(CacheState.PostRun) === 'true') {
  runPost()
} else {
  run()
}
