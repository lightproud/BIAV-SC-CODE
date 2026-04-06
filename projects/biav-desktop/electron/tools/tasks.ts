/**
 * Task Manager — enables background and parallel task execution.
 *
 * Each conversation gets its own task context (abort controller, status).
 * Multiple conversations can run simultaneously.
 * Tasks notify the renderer via IPC events when they complete.
 */

export interface Task {
  conversationId: string
  abortController: AbortController
  status: 'running' | 'completed' | 'failed' | 'aborted'
  startedAt: number
  label?: string
}

class TaskManager {
  private tasks = new Map<string, Task>()

  /**
   * Start a new task for a conversation.
   * If one is already running for this conversation, abort it first.
   */
  start(conversationId: string, label?: string): AbortController {
    // Abort existing task for this conversation if any
    const existing = this.tasks.get(conversationId)
    if (existing && existing.status === 'running') {
      existing.abortController.abort()
      existing.status = 'aborted'
    }

    const controller = new AbortController()
    this.tasks.set(conversationId, {
      conversationId,
      abortController: controller,
      status: 'running',
      startedAt: Date.now(),
      label,
    })

    return controller
  }

  /**
   * Mark a task as completed (only if still running).
   */
  complete(conversationId: string): void {
    const task = this.tasks.get(conversationId)
    if (task && task.status === 'running') {
      task.status = 'completed'
    }
  }

  /**
   * Mark a task as failed.
   */
  fail(conversationId: string): void {
    const task = this.tasks.get(conversationId)
    if (task && task.status === 'running') {
      task.status = 'failed'
    }
  }

  /**
   * Abort a specific conversation's task.
   */
  abort(conversationId: string): boolean {
    const task = this.tasks.get(conversationId)
    if (task && task.status === 'running') {
      task.abortController.abort()
      task.status = 'aborted'
      return true
    }
    return false
  }

  /**
   * Abort all running tasks.
   */
  abortAll(): void {
    for (const task of this.tasks.values()) {
      if (task.status === 'running') {
        task.abortController.abort()
        task.status = 'aborted'
      }
    }
  }

  /**
   * Get task for a conversation.
   */
  get(conversationId: string): Task | undefined {
    return this.tasks.get(conversationId)
  }

  /**
   * Check if a conversation has a running task.
   */
  isRunning(conversationId: string): boolean {
    const task = this.tasks.get(conversationId)
    return task?.status === 'running' || false
  }

  /**
   * Get all currently running tasks.
   */
  getRunning(): Task[] {
    return Array.from(this.tasks.values()).filter(t => t.status === 'running')
  }

  /**
   * Get status summary for all active tasks.
   */
  getStatus(): { conversationId: string; status: string; duration: number; label?: string }[] {
    return Array.from(this.tasks.values())
      .filter(t => t.status === 'running')
      .map(t => ({
        conversationId: t.conversationId,
        status: t.status,
        duration: Date.now() - t.startedAt,
        label: t.label,
      }))
  }

  /**
   * Clean up completed/failed tasks older than given age.
   */
  cleanup(maxAgeMs: number = 60000): void {
    const now = Date.now()
    for (const [id, task] of this.tasks) {
      if (task.status !== 'running' && now - task.startedAt > maxAgeMs) {
        this.tasks.delete(id)
      }
    }
  }
}

export const taskManager = new TaskManager()
