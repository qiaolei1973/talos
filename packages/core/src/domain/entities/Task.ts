/**
 * Task - Rich Domain Model for Task Execution Units
 *
 * Implements the Entity pattern from Domain-Driven Design.
 * Encapsulates task state transition logic with validation.
 *
 * STATE TRANSITIONS:
 * pending → running → completed
 *                    ↘ failed
 *
 * Any state → stopped (via stop())
 *
 * @example
 * ```typescript
 * const task = Task.create({
 *   id: 'task-123',
 *   title: 'Implement feature',
 *   description: 'Add new feature',
 *   command: 'npm run build',
 *   workspace: '/path/to/workspace',
 *   prd,  // PRD entity instance (required for execution)
 *   branch: 'main'
 * });
 *
 * task.start(); // pending → running
 * task.complete(); // running → completed
 * ```
 */

import type {
  ToolType,
  ITask,
  TaskMessage,
  TaskProgress as TaskProgressType,
  TaskStatus,
} from "@talos/types";
import type { WorktreeDTO } from "./Worktree";
import type { PRD } from "./PRD";
import type { PRDDTO } from "./PRD";
import { Worktree } from "./Worktree";

/**
 * Task entity properties
 * 任务实体属性
 */
export interface TaskProperties {
  id: string;
  title: string;
  description: string;
  command: string;
  tool?: ToolType;
  workspace: string;
  prd: PRD;  // PRD entity instance (required)
  branch: string;
  worktree?: Worktree;
  repoRoot?: string;  // 仓库根目录
  pid?: number;
  processId?: string;  // Process identifier (same as id in most cases)
  progress?: TaskProgressType;
  timestamp: number;
  startedAt?: number;
  completedAt?: number;
  storyId?: string;
  role?: string;
  error?: string;
  conversation?: TaskMessage[];
  status?: TaskStatus;
}

/**
 * Task DTO for serialization
 * 任务 DTO 用于序列化
 */
export interface TaskDTO extends Omit<TaskProperties, "worktree" | "prd"> {
  worktree?: WorktreeDTO;  // Override worktree type for serialization
  prd: string;  // PRD identifier (serialized form)
  // Additional runtime properties not in TaskProperties
  repoRoot?: string;
  status: TaskStatus;
  conversation: TaskMessage[];
}

/**
 * Task Entity - Rich domain model with state transition logic
 * 任务实体 - 带有状态转换逻辑的富领域模型
 */
export class Task implements ITask {
  readonly id: string;
  status: TaskStatus;
  title: string;
  description: string;
  conversation: TaskMessage[];
  timestamp: number;
  startedAt?: number;
  completedAt?: number;
  storyId?: string;
  role?: string;
  error?: string;

  // Additional properties for execution context
  readonly command: string;
  readonly tool?: ToolType;
  readonly workspace: string;
  readonly prd: PRD;  // PRD entity instance (required)
  readonly branch: string;
  readonly worktree?: Worktree;
  readonly repoRoot?: string;  // 仓库根目录
  pid?: number;
  processId?: string;  // Process identifier (same as id in most cases, can be updated)
  progress?: TaskProgressType;

  /**
   * Create a new Task instance
   * 创建新的 Task 实例
   *
   * @param props - Task properties (任务属性)
   * @returns Task entity (任务实体)
   */
  static create(props: TaskProperties): Task {
    return new Task(props);
  }

  /**
   * Create Task from DTO
   * 从 DTO 创建任务
   *
   * Note: This does NOT load the full PRD entity.
   * PRD entity must be loaded separately via TaskLifecycleManager.
   *
   * @param dto - Task DTO (任务 DTO)
   * @returns Task entity (任务实体)
   */
  static fromDTO(dto: TaskDTO): Task {
    // Convert WorktreeDTO to Worktree if present
    const worktree = dto.worktree ? Worktree.fromDTO(dto.worktree) : undefined;

    const props: TaskProperties = {
      id: dto.id,
      title: dto.title,
      description: dto.description,
      command: dto.command,
      tool: dto.tool,
      workspace: dto.workspace,
      prd: (() => {
      throw new Error(`Task ${dto.id} cannot be created from DTO without PRD entity. Use TaskLifecycleManager to load tasks with PRD.`);
    })() as any,  // Will throw at runtime
      branch: dto.branch,
      worktree,
      repoRoot: dto.repoRoot,
      pid: dto.pid,
      processId: dto.processId,
      progress: dto.progress,
      timestamp: dto.timestamp,
      startedAt: dto.startedAt,
      completedAt: dto.completedAt,
      storyId: dto.storyId,
      role: dto.role,
      error: dto.error,
      conversation: dto.conversation,
      status: dto.status,
    };
    return new Task(props);
  }

  private constructor(props: TaskProperties) {
    this.id = props.id;
    this.title = props.title;
    this.description = props.description;
    this.command = props.command;
    this.tool = props.tool;
    this.workspace = props.workspace;
    this.prd = props.prd;
    this.branch = props.branch;
    this.worktree = props.worktree;
    this.repoRoot = props.repoRoot;
    this.pid = props.pid;
    this.processId = props.processId;
    this.progress = props.progress;
    this.timestamp = props.timestamp;
    this.startedAt = props.startedAt;
    this.completedAt = props.completedAt;
    this.storyId = props.storyId;
    this.role = props.role;
    this.error = props.error;
    this.conversation = props.conversation || [];
    this.status = props.status || "pending";
  }

  // ============================================
  // State Transition Methods (Domain Logic)
  // 状态转换方法（领域逻辑）
  // ============================================

  /**
   * Start the task (pending → running, stopped → running, failed → running)
   * 启动任务 (pending → running，stopped → running，failed → running)
   */
  start(): void {
    // Clear error and completedAt when restarting from failed state
    if (this.status === "failed") {
      this.error = undefined;
      this.completedAt = undefined;
    }
    this.status = "running";
  }

  /**
   * Complete the task (running → completed)
   * 完成任务 (running → completed)
   *
   * @throws Error if task is not in progress
   */
  complete(): void {
    if (this.status !== "running") {
      throw new Error(
        `Cannot complete task from status '${this.status}'. Task must be in 'running' state.`
      );
    }
    this.transitionTo("completed");
    this.completedAt = Date.now();
  }

  /**
   * Fail the task (any state → failed)
   * 任务失败 (any state → failed)
   *
   * Unlike other state transitions, fail() can be called from any state.
   * This allows tasks to be marked as failed regardless of their current status.
   *
   * @param error - Error message describing the failure
   */
  fail(error: string): void {
    this.error = error;
    this.completedAt = Date.now();
    // Direct assignment instead of transitionTo() to bypass validation
    // fail() is special: it can transition from any state
    this.status = "failed";
  }

  /**
   * Stop the task (any state → stopped)
   * 停止任务 (any state → stopped)
   *
   * Used for manual cancellation
   * 用于手动取消
   */
  stop(): void {
    this.transitionTo("stopped");
    this.completedAt = Date.now();
  }

  /**
   * General state transition method with validation
   * 通用状态转换方法，带验证
   *
   * @param newStatus - Target status (目标状态)
   * @throws Error if transition is invalid
   */
  transitionTo(newStatus: TaskStatus): void {
    if (!this.canTransitionTo(newStatus)) {
      const validTransitions = this.getValidTransitions(this.status);
      const transitionsStr = validTransitions.length > 0
        ? validTransitions.join(", ")
        : "(none)";
      throw new Error(
        `Invalid state transition from '${this.status}' to '${newStatus}'. ` +
        `Valid transitions from '${this.status}' are: ${transitionsStr}`
      );
    }
    this.status = newStatus;
  }

  /**
   * Check if task can transition to target status
   * 检查任务是否可以转换到目标状态
   *
   * @param newStatus - Target status to check (要检查的目标状态)
   * @returns true if transition is valid (如果转换有效则返回 true)
   */
  canTransitionTo(newStatus: TaskStatus): boolean {
    const validTransitions = this.getValidTransitions(this.status);
    return validTransitions.includes(newStatus);
  }

  /**
   * Get valid transitions for a given status
   * 获取给定状态的有效转换
   *
   * @param status - Current status (当前状态)
   * @returns Array of valid next states (有效下一个状态的数组)
   */
  private getValidTransitions(status: TaskStatus): TaskStatus[] {
    const transitions: Record<TaskStatus, TaskStatus[]> = {
      pending: ["running", "stopped"],
      running: ["completed", "failed", "stopped"],
      completed: [],
      failed: ["running"],
      stopped: ["running"]
    };
    return transitions[status];
  }

  /**
   * Get task duration in seconds
   * 获取任务持续时间（秒）
   *
   * @returns Duration in seconds, or undefined if task hasn't completed
   */
  getDuration(): number | undefined {
    if (!this.completedAt) {
      return undefined;
    }
    const startTime = this.startedAt || this.timestamp;
    return Math.floor((this.completedAt - startTime) / 1000);
  }

  /**
   * Add message to conversation
   * 向对话中添加消息
   *
   * @param message - Message to add (要添加的消息)
   */
  addMessage(message: TaskMessage): void {
    this.conversation.push(message);
  }

  // ============================================
  // Business Methods
  // 业务方法
  // ============================================

  /**
   * Update task progress
   * 更新任务进度
   *
   * @param progress - Progress information (进度信息)
   */
  updateProgress(progress: TaskProgressType): void {
    this.progress = progress;
  }

  /**
   * Check if task is alive (process is running)
   * 检查任务是否存活（进程正在运行）
   *
   * @returns true if task is running and has a valid PID
   */
  isAlive(): boolean {
    return this.status === "running" && (this.pid !== undefined && this.pid > 0);
  }

  /**
   * Update execution information (统一入口)
   *
   * 替代直接属性修改：(task as any).pid = xxx
   *
   * 此方法提供统一的执行信息更新入口，避免直接修改 Task 实体属性。
   * 使用场景：在 TaskLifecycleManager 中启动进程后更新 PID、processId 等信息。
   *
   * @param info - 执行信息（可选字段）
   *
   * @example
   * ```typescript
   * // ❌ 旧方式：直接修改（不推荐）
   * (task as any).pid = 12345;
   * (task as any).processId = 'task-id';
   *
   * // ✅ 新方式：使用方法（推荐）
   * task.updateExecutionInfo({
   *   pid: 12345,
   *   processId: 'task-id',
   * });
   * ```
   */
  updateExecutionInfo(info: {
    pid?: number;
    processId?: string;
    socketPath?: string;
  }): void {
    // pid 和 processId 是正式属性，socketPath 是扩展属性

    if (info.pid !== undefined) {
      this.pid = info.pid;
    }
    if (info.processId !== undefined) {
      this.processId = info.processId;
    }
    if (info.socketPath !== undefined) {
      (this as any).socketPath = info.socketPath;
    }
  }

  /**
   * Get execution information
   * 获取执行信息
   *
   * @returns 执行信息对象
   */
  getExecutionInfo(): {
    pid?: number;
    processId?: string;
    socketPath?: string;
  } {

    return {
      pid: this.pid,
      processId: this.processId,
      socketPath: (this as any).socketPath,
    };
  }

  // ============================================
  // PRD-related Methods (充血模型 - Rich Domain Model)
  // ============================================


  /**
   * Get PRD ID
   * 获取 PRD 标识符
   *
   * @returns PRD ID
   * @throws Error if PRD ID is not available
   */
  getPrdId(): string {
    return this.prd.id;
  }





  /**
   * Get PRD directory path
   * 获取 PRD 目录路径
   *
   * PRD 存储在 worktree 的 ralph 目录下
   *
   * @returns PRD 目录绝对路径
   * @throws Error if worktree or PRD ID is not available
   */
  getPrdDir(): string {
    if (!this.worktree) {
      throw new Error(`Task ${this.id} has no worktree set`);
    }
    const prdId = this.getPrdId();
    return `${this.worktree.path}/ralph/${prdId}`;
  }

  /**
   * Get PRD file path
   * 获取 PRD 文件路径
   *
   * @returns PRD JSON 文件绝对路径
   */
  getPrdFilePath(): string {
    return `${this.getPrdDir()}/prd.json`;
  }

  /**
   * Get PRD completion percentage
   * 获取 PRD 完成进度
   *
   * @returns Completion percentage (0-100)
   * @throws Error if PRD entity is not loaded
   */
  getPrdProgress(): number {
    return this.prd.getCompletionPercentage();
  }

  // ============================================
  // Path-related Methods
  // ============================================

  /**
   * Get working directory path
   * 获取工作目录路径
   *
   * @returns 工作目录绝对路径
   * @throws Error if worktree is not set
   */
  getWorkingDir(): string {
    if (!this.worktree) {
      throw new Error(`Task ${this.id} has no worktree set`);
    }
    return this.worktree.path;
  }

  /**
   * Get log file path
   * 获取日志文件路径
   *
   * 日志存储在主 repo 的 .talos/logs 目录下
   *
   * @returns 日志文件绝对路径
   * @throws Error if repoRoot is not set
   */
  getLogPath(): string {
    if (!this.repoRoot) {
      throw new Error(`Task ${this.id} has no repoRoot set`);
    }
    return `${this.repoRoot}/.talos/logs/${this.id}.log`;
  }

  /**
   * Get repo root (workspace path)
   * 获取仓库根目录
   *
   * @returns 仓库根目录路径
   * @throws Error if repoRoot is not set
   */
  getRepoRoot(): string {
    if (!this.repoRoot) {
      throw new Error(`Task ${this.id} has no repoRoot set`);
    }
    return this.repoRoot;
  }

  /**
   * Convert task to DTO for serialization
   * 将任务转换为 DTO 用于序列化
   *
   * Note: PRD entity is serialized as prd.id (string) for storage.
   *
   * @returns Task DTO (任务 DTO)
   */
  toDTO(): TaskDTO {
    return {
      id: this.id,
      title: this.title,
      description: this.description,
      command: this.command,
      tool: this.tool,
      workspace: this.workspace,
      prd: this.getPrdId(),  // Serialize PRD ID only (throws if no PRD)
      branch: this.branch,
      worktree: this.worktree?.toDTO(),  // Serialize Worktree to WorktreeDTO
      repoRoot: this.repoRoot,
      pid: this.pid,
      processId: this.processId,
      progress: this.progress,
      timestamp: this.timestamp,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      storyId: this.storyId,
      role: this.role,
      error: this.error,
      conversation: [...this.conversation], // Clone array to prevent mutation
      status: this.status
    };
  }

  /**
   * Get task summary for logging/display
   * 获取任务摘要用于日志/显示
   *
   * @returns Task summary string (任务摘要字符串)
   */
  getSummary(): string {
    const duration = this.getDuration();
    const durationStr = duration !== undefined ? `${duration}s` : "ongoing";
    return `Task ${this.id} [${this.status}] - ${this.title} (${durationStr})`;
  }
}
