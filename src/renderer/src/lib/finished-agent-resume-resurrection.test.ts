/**
 * A LOCAL workspace agent that FINISHED its turn is recorded as unfinished work,
 * so the next worktree activation respawns it in a fresh tab running `--resume`.
 *
 * `retainsResumableRecoveryIdentity` (store/slices/agent-status.ts) deliberately
 * rewrites a `done` turn to `state: 'working'` with `origin: 'live'` so a cold
 * restore after an abrupt app death re-enters the agent instead of a bare shell
 * (#9454). The cost: nothing downstream can still tell "finished" from
 * "interrupted" — `isPassiveCompletedHibernationEvidence` keys off exactly those
 * two fields — so every completed agent stays queued for resurrection until its
 * pane is proven alive. Killing the PTY (`orca terminal stop`, app death) clears
 * the pane but never the record.
 *
 * No paired runtime here: the host-mirror park added in #15644 gates on a web
 * surface tab id, so this path never reaches it.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { makePaneKey } from '../../../shared/stable-pane-id'
import { useAppStore } from '@/store'
import { isPassiveCompletedHibernationEvidence } from './sleeping-agent-pane-ownership'
import { resumeSleepingAgentSessionsForWorktree } from './resume-sleeping-agent-session'

const initialAppStoreState = useAppStore.getState()
const LEAF_ID = '11111111-1111-4111-8111-111111111111'
const WORKTREE_ID = 'wt-local'
const TAB_ID = 'tab-reviewer'
const PANE_KEY = makePaneKey(TAB_ID, LEAF_ID)
const SESSION_ID = 'ses_fdc9b294effeBRR2JwiALSLpwy'

afterEach(() => {
  useAppStore.setState(initialAppStoreState, true)
})

/** A local codex pane with a live PTY, mid-turn. */
function seedLiveLocalCodexPane(): void {
  useAppStore.setState({
    activeWorktreeId: WORKTREE_ID,
    tabsByWorktree: {
      [WORKTREE_ID]: [
        {
          id: TAB_ID,
          ptyId: 'pty-1',
          worktreeId: WORKTREE_ID,
          title: 'Codex',
          customTitle: null,
          color: null,
          sortOrder: 0,
          createdAt: 1,
          launchAgent: 'codex'
        }
      ]
    },
    activeTabIdByWorktree: { [WORKTREE_ID]: TAB_ID },
    ptyIdsByTabId: { [TAB_ID]: ['pty-1'] },
    terminalLayoutsByTabId: {
      [TAB_ID]: {
        root: { type: 'leaf', leafId: LEAF_ID },
        activeLeafId: LEAF_ID,
        expandedLeafId: null,
        ptyIdsByLeafId: { [LEAF_ID]: 'pty-1' }
      }
    }
  } as never)
}

function reportTurnFinished(): void {
  useAppStore
    .getState()
    .setAgentStatus(
      PANE_KEY,
      { state: 'done', agentType: 'codex', prompt: 'review the diff' } as never,
      'Codex',
      { updatedAt: 1000, stateStartedAt: 1000 },
      { tabId: TAB_ID, worktreeId: WORKTREE_ID, terminalHandle: 'pty-1' } as never,
      { providerSession: { key: 'session_id', id: SESSION_ID } } as never
    )
}

describe('a finished local agent', () => {
  it('is persisted as unfinished work, not as completed history', () => {
    seedLiveLocalCodexPane()

    reportTurnFinished()

    const record = useAppStore.getState().sleepingAgentSessionsByPaneKey[PANE_KEY]
    expect(record, 'a finished codex turn leaves a resume record').toBeDefined()
    expect(record?.state, 'the done turn is stored as working').toBe('working')
    expect(record?.origin).toBe('live')
    expect(
      isPassiveCompletedHibernationEvidence(record!),
      'a finished agent must be classifiable as history, or activation will restart it'
    ).toBe(false)
  })

  it('is respawned into a new tab once its pane is killed', () => {
    seedLiveLocalCodexPane()
    reportTurnFinished()

    // `orca terminal stop` / app death: the PTY and pane go, the record stays.
    useAppStore.setState({
      tabsByWorktree: { [WORKTREE_ID]: [] },
      ptyIdsByTabId: {},
      terminalLayoutsByTabId: {}
    } as never)

    const launched = resumeSleepingAgentSessionsForWorktree(WORKTREE_ID)

    expect(launched, 'the finished agent was resurrected').toBe(1)
    const state = useAppStore.getState()
    const respawned = (state.tabsByWorktree[WORKTREE_ID] ?? [])[0]
    expect(respawned?.launchAgent).toBe('codex')
    const startup = state.pendingStartupByTabId[respawned!.id]
    expect(startup?.command).toContain(`'resume' '${SESSION_ID}'`)
    expect(startup?.showSessionRestoredBanner).toBe(true)
  })
})
