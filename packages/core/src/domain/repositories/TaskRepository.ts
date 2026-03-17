/**
 * TaskRepository - Task entity persistence layer
 *
 * Implements ITaskRepository, accepting only complete Task entities
 * and converting between Task entity and TaskMetadata DTO.
 */

import type { ITask, TaskFilter as ITaskFilter } from "@talos/types";
import { Task } from "../entities/Task";
import type { TaskProperties } from "../entities/Task";
import { Worktree } from "../entities/Worktree";
import { PRD } from "../entities/PRD";
import { PRDRepository } from "@/repositories/prd-repository";
import type { TaskMetadata, ProjectTasksConfig } from "@/storage/task-dto";
import { LocalStorageEngine } from "@/storage/storage";
import { ToolType } from "@talos/types";
import { PROJECT_CONFIG_FILE } from "@/infrastructure/constant";

/**
 * TaskStatus from domain model (ITask)
 */
type DomainTaskStatus = "pending" | "running" | "completed" | "failed" | "stopped";

/**
 * TaskStatus from storage layer (LocalTaskConfig)
 */
type StorageTaskStatus = "pending" | "running" | "stopped" | "failed" | "completed";

/**
 * Map domain TaskStatus to storage TaskStatus
 */
function mapDomainToStorageStatus(status: DomainTaskStatus): StorageTaskStatus {
  switch (status) {
    case "pending":
      return "pending";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    case "stopped":
      return "stopped";
  }
}

/**
 * Map storage TaskStatus to domain TaskStatus
 */
function mapStorageToDomainStatus(status: StorageTaskStatus): DomainTaskStatus {
  switch (status) {
    case "pending":
      return "pending";
    case "running":
      return "running";
    case "stopped":
      return "stopped";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
  }
}

/**
 * Convert Task entity to TaskMetadata DTO
 *
 * PRD entity is serialized as prdId (string) in metadata.
 */
function taskToMetadata(task: Task): TaskMetadata {
  // Require worktree to be set - no fallback
  if (!task.worktree) {
    throw new Error(`Task ${task.id} has no worktree set`);
  }

  return {
    id: task.id,
    command: task.command,
    status: mapDomainToStorageStatus(task.status),
    tool: task.tool as ToolType | undefined,
    workspace: task.workspace,
    prd: task.prd.id,
    branch: task.branch,
    // Extract worktree name from worktree.path for storage (backward compatibility)
    worktree: extractWorktreeName(task.worktree.path),
    workingDir: task.worktree.path,
    pid: task.pid,
    createdAt: task.timestamp,
    startedAt: task.startedAt,
    exitCode: task.completedAt !== undefined ? 0 : undefined,
    progress: task.progress,
    metadata: {
      title: task.title,
      description: task.description,
      prdId: task.prd.id,
      storyId: task.storyId,
      role: task.role,
      error: task.error,
      conversation: task.conversation,
    },
  };
}

/**
 * Extract worktree name from path
 * 从路径中提取 worktree 名称
 *
 * @param worktreePath - Worktree path (e.g., "/path/to/repo/worktrees/feature-branch")
 * @returns Worktree name (e.g., "feature-branch")
 */
function extractWorktreeName(worktreePath: string): string {
  const match = worktreePath.match(/\/worktrees\/([^/]+)$/);
  if (!match) {
    throw new Error(`Invalid worktree path: ${worktreePath}. Expected path ending with /worktrees/<name>`);
  }
  return match[1];
}

/**
 * Convert TaskMetadata DTO to Task entity
 *
 * Note: This does NOT load the PRD entity.
 * PRD entity MUST be loaded separately via TaskLifecycleManager.
 *
 * @param metadata - Task metadata from storage
 * @param repoRoot - Repository root directory
 * @returns Task entity with loaded PRD
 */
async function metadataToTask(metadata: TaskMetadata, repoRoot: string): Promise<Task> {
  // Worktree path is stored in workingDir (new format)
  const worktreePath = metadata.workingDir || `${repoRoot}/worktrees/${metadata.id}`;

  // Create Worktree object
  const worktree = Worktree.fromProperties({
    path: worktreePath,
    branch: metadata.branch,
  });

  // Get PRD ID from metadata
  const prdId = metadata.metadata?.prdId as string || metadata.prd;

  if (!prdId) {
    throw new Error(`Task ${metadata.id} has no PRD ID in metadata`);
  }

  // Load PRD entity from repository
  const prdRepository = new PRDRepository(repoRoot);
  const prdData = await prdRepository.findById(prdId);

  if (!prdData) {
    throw new Error(`PRD '${prdId}' not found in repository at ${repoRoot}`);
  }

  // Convert to PRD entity
  const prd = PRD.fromDTO({
    id: prdData.id,
    project: prdData.project,
    description: prdData.description,
    branchName: prdData.branchName,
    userStories: prdData.userStories || [],
    status: prdData.status || "draft",
    createdAt: prdData.createdAt || Date.now(),
    updatedAt: prdData.updatedAt,
  });

  // Create TaskProperties from TaskMetadata
  const taskProperties: TaskProperties = {
    id: metadata.id,
    title: metadata.metadata?.title as string || metadata.id,
    description:
      metadata.metadata?.description as string || metadata.command,
    command: metadata.command,
    tool: metadata.tool,
    workspace: metadata.workspace,
    prd,  // PRD entity loaded from repository
    branch: metadata.branch,
    worktree,
    repoRoot,  // Set repoRoot for proper task context
    pid: metadata.pid,
    progress: metadata.progress,
    timestamp: metadata.createdAt,
    startedAt: metadata.startedAt,
    completedAt: metadata.exitCode !== undefined ? metadata.createdAt : undefined,
    storyId: metadata.metadata?.storyId as string | undefined,
    role: metadata.metadata?.role as string | undefined,
    error: metadata.status === "failed" ? metadata.metadata?.error as string : undefined,
    conversation: (metadata.metadata?.conversation as any[]) || [],
    status: mapStorageToDomainStatus(metadata.status),
  };

  return Task.create(taskProperties);
}

export class TaskRepository {
  private storage: LocalStorageEngine;
  private configPath: string;
  private readonly repoRoot: string;

  /**
   * Create a new TaskRepository
   *
   * @param repoRoot - Repository root directory
   */
  constructor(repoRoot: string) {
    this.storage = new LocalStorageEngine(repoRoot);
    this.configPath = PROJECT_CONFIG_FILE;
    this.repoRoot = repoRoot;
  }

  /**
   * Read the entire local configuration
   * @private
   */
  private async getConfig(): Promise<ProjectTasksConfig> {
    const config = await this.storage.readJSON<ProjectTasksConfig>(this.configPath);

    if (!config) {
      // Return default empty config
      return {
        version: 1,
        tasks: [],
      };
    }

    // Validate version - accept both number 1 and string "1.0"
    const version = config.version;
    const isValidVersion = version === 1 || version === "1.0";
    if (!isValidVersion) {
      console.warn(`Unsupported local config version: ${version}`);
      return {
        version: 1,
        tasks: [],
      };
    }

    // No migration - we don't support old formats
    return config;
  }

  /**
   * Save the entire local configuration
   * @private
   */
  private async saveConfig(config: ProjectTasksConfig): Promise<void> {
    await this.storage.writeJSON(this.configPath, config);
  }

  /**
   * Save a complete task entity
   * Creates new or updates existing task
   *
   * @param task - Complete task entity to save
   * @throws Error if task is invalid or save fails
   */
  async save(task: Task): Promise<void> {
    const config = await this.getConfig();
    const metadata = taskToMetadata(task);

    // Find existing task
    const existingIndex = config.tasks.findIndex(t => t.id === task.id);

    if (existingIndex >= 0) {
      // Update existing task (preserve createdAt from storage)
      metadata.createdAt = config.tasks[existingIndex].createdAt;
      config.tasks[existingIndex] = metadata;
    } else {
      // Create new task - ensure createdAt is set
      if (!metadata.createdAt) {
        metadata.createdAt = Date.now();
      }
      config.tasks.push(metadata);
    }

    await this.saveConfig(config);
  }

  /**
   * Find task by ID
   *
   * @param taskId - Task identifier
   * @returns Task entity or null if not found
   */
  async findById(taskId: string): Promise<Task | null> {
    const config = await this.getConfig();
    const metadata = config.tasks.find(t => t.id === taskId);

    if (!metadata) {
      return null;
    }

    return await metadataToTask(metadata, this.repoRoot);
  }

  /**
   * Find all tasks
   * Optionally filter by status or PRD ID
   *
   * Note: Returned tasks will have PRD entity loaded.
   * Tasks with missing PRDs are skipped with a warning logged.
   *
   * @param filter - Optional filter criteria
   * @returns Array of task entities
   */
  async findAll(filter?: ITaskFilter): Promise<Task[]> {
    const config = await this.getConfig();
    let metadataList = config.tasks;

    // Apply status filter
    if (filter?.status) {
      const storageStatus = mapDomainToStorageStatus(
        filter.status as DomainTaskStatus
      );
      metadataList = metadataList.filter(t => t.status === storageStatus);
    }

    // Apply prd filter
    if (filter?.prdId) {
      metadataList = metadataList.filter(t => t.prd === filter.prdId);
    }

    // Convert metadata to entities (load PRD for each)
    // Skip tasks with missing PRDs to avoid failing entire list
    const tasks: Task[] = [];
    for (const metadata of metadataList) {
      try {
        tasks.push(await metadataToTask(metadata, this.repoRoot));
      } catch (error) {
        // Log warning and skip tasks with missing PRDs
        const prdId = metadata.metadata?.prdId as string || metadata.prd;
        console.warn(`Skipping task ${metadata.id}: PRD '${prdId}' not found - ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Apply remaining filters that operate on domain model
    let result = tasks;
    if (filter?.storyId) {
      result = result.filter((task) => task.storyId === filter.storyId);
    }
    if (filter?.role) {
      result = result.filter((task) => task.role === filter.role);
    }

    return result;
  }

  /**
   * Delete a task by ID
   *
   * @param taskId - Task identifier
   * @throws Error if task not found or delete fails
   */
  async delete(taskId: string): Promise<void> {
    const config = await this.getConfig();
    const initialLength = config.tasks.length;

    config.tasks = config.tasks.filter(t => t.id !== taskId);

    if (config.tasks.length === initialLength) {
      throw new Error(`Task with id '${taskId}' not found`);
    }

    await this.saveConfig(config);
  }

  /**
   * Check if task exists
   *
   * @param taskId - Task identifier
   * @returns true if task exists, false otherwise
   */
  async exists(taskId: string): Promise<boolean> {
    const config = await this.getConfig();
    return config.tasks.some(t => t.id === taskId);
  }

  /**
   * Count tasks matching filter
   *
   * @param filter - Optional filter criteria
   * @returns Number of matching tasks
   */
  async count(filter?: ITaskFilter): Promise<number> {
    const tasks = await this.findAll(filter);
    return tasks.length;
  }
}
