/**
 * Ralph Executor - Node.js implementation of ralph.sh
 *
 * A simplified Node.js version that replaces the bash script.
 * Runs Claude Code or Cursor Agent iteratively until all PRD stories are completed.
 *
 * Moved from @talos/core to @talos/executor as part of the architectural refactoring.
 * This implementation uses dependency injection for logging and validation callbacks
 * to avoid tight coupling with @talos/core and @talos/git packages.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import type { PRD, UserStory, IToolExecutorFactory, ToolExecutionRequest } from "@talos/types";
import { ToolExecutorFactory } from "./ToolExecutorFactory";
import { StreamJSONParser } from "./StreamJSONParser";

// ESM __dirname polyfill
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Simple logger interface for RalphExecutor
 * Avoids dependency on @talos/core's Logger class
 */
export interface RalphLogger {
  info(message: string): Promise<void> | void;
  warn(message: string): Promise<void> | void;
  error(message: string): Promise<void> | void;
}

/**
 * Ralph executor options
 */
export interface RalphExecutorOptions {
  /** PRD name (e.g., "my-feature") */
  prdName: string;
  /** Working directory (usually worktree path) */
  workingDir: string;
  /** Maximum iterations (default: 20) */
  maxIterations?: number;
  /** Tool to use: "claude", "cursor", or custom registered tool */
  tool: string;
  /** Tool executor factory (optional - defaults to ToolExecutorFactory with built-in tools) */
  toolExecutorFactory?: IToolExecutorFactory;
  /** Log file path (optional) */
  logFile?: string;
  /** Logger instance (optional) - uses console if not provided */
  logger?: RalphLogger;
  /** Callback on each iteration */
  onIteration?: (iteration: number, output: string) => void;
  /** Callback on completion */
  onComplete?: () => void;
  /** Callback on error */
  onError?: (error: Error) => void;
  /** Mock mode - use simple commands instead of real claude (for testing) */
  mock?: boolean;
  /** Mock mode - which iteration should "complete" (default: 3) */
  mockIterations?: number;
  /** Debug mode - capture full output including thinking and tool calls */
  debug?: boolean;
  /** Model to use (e.g., "claude-3-5-sonnet-20241022", "composer-1.5") */
  model?: string;
  /** Callback to validate completion - replaces direct git dependency */
  validateCompletionCallback?: () => Promise<{ isValid: boolean; reason?: string }>;
}

/**
 * Ralph execution result
 */
export interface RalphResult {
  success: boolean;
  iterations: number;
  completed: boolean;
  error?: string;
}

/**
 * Ralph Executor class
 *
 * Manages the iterative execution of Claude Code on a PRD.
 * Uses dependency injection for logging and validation to maintain
 * separation of concerns and avoid tight coupling with core packages.
 */
export class RalphExecutor extends EventEmitter {
  private options: Omit<Required<RalphExecutorOptions>, "logger" | "validateCompletionCallback" | "toolExecutorFactory" | "model"> & Pick<RalphExecutorOptions, "logger" | "validateCompletionCallback" | "toolExecutorFactory" | "model">;
  private toolExecutorFactory: IToolExecutorFactory;
  private currentExecutor: any = null;
  private currentProcess: ChildProcess | null = null;
  private isStopped = false;
  private currentIteration = 0;
  private streamJSONParser: StreamJSONParser;
  private completionDetected = false;  // Flag to track if cursor-agent completion signal was received
  private readonly MAX_PROMPT_LENGTH = 100000; // 100KB threshold for cursor-agent

  constructor(options: RalphExecutorOptions) {
    super();
    // Create tool executor factory if not provided
    this.toolExecutorFactory = options.toolExecutorFactory ?? new ToolExecutorFactory();
    
    this.options = {
      prdName: options.prdName,
      workingDir: options.workingDir,
      maxIterations: options.maxIterations ?? 20,
      tool: options.tool,
      toolExecutorFactory: options.toolExecutorFactory,
      logFile: options.logFile ?? join(options.workingDir, ".talos", "logs", `${options.prdName}.log`),
      logger: options.logger,
      onIteration: options.onIteration ?? (() => {}),
      onComplete: options.onComplete ?? (() => {}),
      onError: options.onError ?? (() => {}),
      mock: options.mock ?? false,
      mockIterations: options.mockIterations ?? 3,
      debug: options.debug ?? false,
      model: options.model,
      validateCompletionCallback: options.validateCompletionCallback,
    };

    // Log initialization asynchronously (don't await)
    this.logInfo(`RalphExecutor initialized at ${new Date().toISOString()}`);
    this.logInfo(`Working directory: ${this.options.workingDir}`);
    this.logInfo(`PRD name: ${this.options.prdName}`);
    this.logInfo(`Log file: ${this.options.logFile}`);
    this.logInfo(`Tool: ${this.options.tool}`);
    this.logInfo(`Mock mode: ${this.options.mock}`);
    if (this.options.mock) {
      this.logInfo(`Mock iterations: will complete at iteration ${this.options.mockIterations}`);
    }

    // Initialize StreamJSONParser for debug mode
    // Disable timestamps in parser because Logger already adds them
    this.streamJSONParser = new StreamJSONParser({
      includeTimestamps: false,
      useEmoji: true,
    });
    this.logInfo(`Debug mode: ${this.options.debug}`);
  }

  /**
   * Helper method to log info messages
   */
  private async logInfo(message: string): Promise<void> {
    if (this.options.logger) {
      await this.options.logger.info(message);
    } else {
      console.log(`[INFO] ${message}`);
    }
  }

  /**
   * Helper method to log error messages
   */
  private async logError(message: string): Promise<void> {
    if (this.options.logger) {
      await this.options.logger.error(message);
    } else {
      console.error(`[ERROR] ${message}`);
    }
  }

  /**
   * Helper method to log warning messages
   */
  private async logWarn(message: string): Promise<void> {
    if (this.options.logger) {
      await this.options.logger.warn(message);
    } else {
      console.warn(`[WARN] ${message}`);
    }
  }

  /**
   * Get current git branch name
   * Uses exec instead of @talos/git dependency
   */
  private async getCurrentBranch(): Promise<string> {
    const { exec } = await import("node:child_process");
    return new Promise((resolve, reject) => {
      exec(
        "git rev-parse --abbrev-ref HEAD",
        { cwd: this.options.workingDir },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(`Failed to get current branch: ${stderr || error.message}`));
          } else {
            resolve(stdout.trim());
          }
        }
      );
    });
  }

  /**
   * Validate that current branch matches PRD branchName
   */
  private async validateBranch(prdBranchName: string): Promise<void> {
    const currentBranch = await this.getCurrentBranch();

    await this.logInfo(`Current branch: ${currentBranch}`);
    await this.logInfo(`Expected branch (from PRD): ${prdBranchName}`);

    if (currentBranch !== prdBranchName) {
      const errorMsg = `Branch mismatch! Current branch is '${currentBranch}', but PRD specifies '${prdBranchName}'. Please switch to the correct branch before running the task.`;
      await this.logError(errorMsg);
      throw new Error(errorMsg);
    }

    await this.logInfo("Branch validation passed");
  }

  /**
   * Start the Ralph execution loop
   */
  async start(): Promise<RalphResult> {
    this.isStopped = false;
    this.setupSignalHandlers();

    // Enhanced logging for debugging
    await this.logInfo(`[${this.options.prdName}] RalphExecutor.start() called`);
    await this.logInfo(`[${this.options.prdName}] Working directory: ${this.options.workingDir}`);
    await this.logInfo(`[${this.options.prdName}] PRD name: ${this.options.prdName}`);
    await this.logInfo(`[${this.options.prdName}] Max iterations: ${this.options.maxIterations}`);
    await this.logInfo(`[${this.options.prdName}] Tool: ${this.options.tool}`);
    await this.logInfo(`[${this.options.prdName}] Log file: ${this.options.logFile}`);

    // Check tool availability
    await this.logInfo(`[${this.options.prdName}] Checking tool availability: ${this.options.tool}`);
    const executor = this.toolExecutorFactory.create(this.options.tool);
    const isAvailable = await executor.isAvailable();
    if (!isAvailable) {
      const errorMsg = `Tool '${this.options.tool}' is not available. Please install it or check your PATH.`;
      await this.logError(errorMsg);
      throw new Error(errorMsg);
    }
    await this.logInfo(`✓ Tool '${this.options.tool}' is available`);

    // Check if PRD file exists
    const prdPath = join(this.options.workingDir, "ralph", this.options.prdName, "prd.json");
    await this.logInfo(`[${this.options.prdName}] PRD path: ${prdPath}`);
    try {
      await readFile(prdPath);
      await this.logInfo(`[${this.options.prdName}] PRD file exists`);
    } catch {
      await this.logError(`[${this.options.prdName}] PRD file NOT found at ${prdPath}`);
    }

    // Validate branch if PRD specifies branchName
    try {
      const prdContent = await readFile(prdPath, "utf-8");
      const prd = JSON.parse(prdContent) as PRD;

      if (prd.branchName) {
        await this.logInfo(`[${this.options.prdName}] Validating branch: expected '${prd.branchName}'`);
        await this.validateBranch(prd.branchName);
      } else {
        await this.logWarn(`[${this.options.prdName}] PRD does not specify branchName, skipping branch validation`);
      }
    } catch (error) {
      await this.logError(`[${this.options.prdName}] Branch validation failed: ${(error as Error).message}`);
      throw error;
    }

    try {
      await this.logInfo(`[${this.options.prdName}] Starting execution loop...`);
      await this.executeIterations();

      if (!this.isStopped) {
        await this.logInfo("Task completed successfully, setting completed=true");
        this.options.onComplete();
        return {
          success: true,
          iterations: this.currentIteration,
          completed: true,
        };
      }

      await this.logInfo("Task stopped by signal");
      return {
        success: false,
        iterations: this.currentIteration,
        completed: false,
        error: "Stopped by signal",
      };
    } catch (error) {
      if (!this.isStopped) {
        await this.logError(`Task failed with error: ${(error as Error).message}`);
        await this.logError(`Error stack: ${(error as Error).stack}`);
        this.options.onError(error as Error);
        return {
          success: false,
          iterations: this.currentIteration,
          completed: false,
          error: (error as Error).message,
        };
      }
      await this.logInfo("Task stopped by signal (in catch block)");
      return {
        success: false,
        iterations: this.currentIteration,
        completed: false,
        error: "Stopped by signal",
      };
    }
  }

  /**
   * Stop the Ralph execution
   *
   * Sets the stop flag and kills any running child process.
   * Waits up to 5 seconds for the child process to exit.
   */
  async stop(): Promise<void> {
    this.isStopped = true;

    // Stop current executor if running
    if (this.currentExecutor) {
      await this.logInfo(`Stopping current executor: ${this.options.tool}`);
      await this.currentExecutor.stop();
      this.currentExecutor = null;
    }

    if (this.currentProcess) {
      await this.logInfo(`Stopping current process (PID: ${this.currentProcess.pid})`);

      // Send SIGTERM to the child process
      this.currentProcess.kill("SIGTERM");

      // Wait for the process to exit, with a timeout
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          this.logWarn(`Process ${this.currentProcess?.pid} did not exit gracefully, forcing kill`);
          if (this.currentProcess) {
            this.currentProcess.kill("SIGKILL");
          }
          resolve();
        }, 5000); // 5 second timeout

        this.currentProcess?.once("exit", () => {
          clearTimeout(timeout);
          this.logInfo("Process exited gracefully");
          resolve();
        });
      });

      this.currentProcess = null;
    }

    await this.logInfo("Ralph executor stopped");
  }

  /**
   * Execute iterations until complete or max iterations reached
   */
  private async executeIterations(): Promise<void> {
    await this.logInfo(`Starting execution loop, maxIterations=${this.options.maxIterations}`);

    while (!this.isStopped && this.currentIteration < this.options.maxIterations) {
      this.currentIteration++;
      await this.logInfo(`Starting iteration ${this.currentIteration}`);

      const output = await this.runIteration();

      this.options.onIteration(this.currentIteration, output);

      // Validate completion based on actual file system state
      await this.logInfo(`Iteration ${this.currentIteration} completed, validating completion...`);
      const validation = await this.validateCompletion();

      if (validation.isValid) {
        await this.logInfo(`Task validated as complete at iteration ${this.currentIteration}`);
        await this.logInfo(`All stories passed and working directory is clean`);
        return;
      } else {
        await this.logInfo(`Task not yet complete: ${validation.reason}`);
        await this.logInfo(`Continuing to next iteration...`);
      }
    }

    if (this.currentIteration >= this.options.maxIterations) {
      await this.logError("Max iterations reached without completion");
      throw new Error(`Max iterations (${this.options.maxIterations}) reached`);
    }
  }

  /**
   * Run a single iteration
   */
  private async runIteration(): Promise<string> {
    const prompt = await this.buildPrompt();
    
    // MOCK MODE: Skip actual claude execution for testing
    if (this.options.mock) {
      await this.logInfo(`[MOCK] Skipping ${this.options.tool} execution, returning mock response`);
      return `<promise>COMPLETE</promise>`;
    }
    
    // Get executor from factory
    const executor = this.toolExecutorFactory.create(this.options.tool);
    this.currentExecutor = executor;
    
    // Build execution request
    const request: ToolExecutionRequest = {
      workingDir: this.options.workingDir,
      prompt,
      debug: this.options.debug,
      model: this.options.model,
    };
    
    await this.logInfo(`[DEBUG] Executing ${this.options.tool} command...`);
    
    // Execute using the executor
    const result = await executor.execute(request);
    
    await this.logInfo(`[DEBUG] Execution result: success=${result.success}, exitCode=${result.exitCode}`);
    await this.logInfo(`[DEBUG] Output length: ${result.output?.length || 0}, Error length: ${result.error?.length || 0}`);
    if (result.output) {
      await this.logInfo(`[DEBUG] Output (first 500 chars): ${result.output.substring(0, Math.min(500, result.output.length))}`);
    }
    if (result.error) {
      await this.logError(`[DEBUG] Error output: ${result.error.substring(0, 500)}`);
    }
    
    return result.output || result.error || '';
  }

  /**
   * Build the Claude prompt from skill.md template
   */
  private async buildPrompt(): Promise<string> {
    // Only look in the standard bundled path
    // This ensures local testing matches production behavior
    const skillMdPath = join(__dirname, "assets", "skill.md");

    await this.logInfo(`RalphExecutor.buildPrompt():`);
    await this.logInfo(`  __dirname: ${__dirname}`);
    await this.logInfo(`  skill.md path: ${skillMdPath}`);

    // Check if skill.md exists
    try {
      await readFile(skillMdPath);
    } catch {
      const errorMsg = `skill.md not found at: ${skillMdPath}\nMake sure you have built the CLI with 'pnpm build'`;
      await this.logError(errorMsg);
      throw new Error(errorMsg);
    }

    await this.logInfo(`Reading skill.md from: ${skillMdPath}`);
    let template = await readFile(skillMdPath, "utf-8");

    // Get file paths
    const prdPath = join(this.options.workingDir, "ralph", this.options.prdName, "prd.json");
    const progressPath = join(this.options.workingDir, "ralph", this.options.prdName, "progress.txt");

    // Replace environment variables
    template = template.replace(/\$PRD_FILE/g, prdPath);
    template = template.replace(/\$PROGRESS_FILE/g, progressPath);

    return template;
  }

  /**
   * Check if a command is available in the system
   */
  private async checkCommandExists(command: string): Promise<boolean> {
    const { exec } = await import("node:child_process");
    return new Promise((resolve) => {
      exec(
        `command -v ${command}`,
        (error) => {
          resolve(!error);
        }
      );
    });
  }

  /**
   * Execute Claude Code or cursor-agent with the prompt
   */

  /**
   * Validate that the task is actually complete
   * 验证任务是否真的完成（基于实际文件系统状态）
   *
   * Uses dependency injection callback for validation instead of direct git dependency.
   * If no callback is provided, falls back to basic PRD validation only.
   *
   * Checks:
   * 1. All user stories in PRD have passes: true
   * 2. Git working directory is clean (via callback)
   */
  private async validateCompletion(): Promise<{
    isValid: boolean;
    reason?: string;
  }> {
    try {
      // Check 1: Verify PRD file - all stories should have passes: true
      const prdPath = join(this.options.workingDir, "ralph", this.options.prdName, "prd.json");
      const prdContent = await readFile(prdPath, "utf-8");
      const prd = JSON.parse(prdContent) as PRD;

      if (!prd.userStories || !Array.isArray(prd.userStories)) {
        return {
          isValid: false,
          reason: "PRD file does not contain valid userStories array"
        };
      }

      const allStoriesPassed = prd.userStories.every(story => story.passes === true);
      if (!allStoriesPassed) {
        const incompleteStories = prd.userStories
          .filter((story: UserStory) => story.passes !== true)
          .map((story: UserStory) => story.id);
        return {
          isValid: false,
          reason: `Not all user stories are marked as passed. Incomplete: ${incompleteStories.join(", ")}`
        };
      }

      // Check 2: Verify git working directory is clean (via callback)
      if (this.options.validateCompletionCallback) {
        const gitValidation = await this.options.validateCompletionCallback();
        if (!gitValidation.isValid) {
          return gitValidation;
        }
      } else {
        await this.logWarn("No validateCompletionCallback provided - skipping git status check");
      }

      // All checks passed
      return { isValid: true };
    } catch (error) {
      return {
        isValid: false,
        reason: `Validation error: ${(error as Error).message}`
      };
    }
  }

  /**
   * Process stream-json format output line
   * Parses and formats stream-json messages for debug logging
   *
   * @param line - Raw output line from Claude Code
   */
  private async processStreamJSONLine(line: string): Promise<void> {
    try {
      // Parse the line for stream-json messages
      const messages = this.streamJSONParser.parse(line);

      for (const message of messages) {
        // Detect completion signal in debug mode
        if (message.type === "result" && message.result?.type === "success") {
          this.completionDetected = true;
          await this.logInfo("✅ cursor-agent completion signal detected");
        }

        // Format each message and log it (skip empty content)
        const formatted = this.streamJSONParser.formatMessage(message);
        if (formatted) {
          await this.logInfo(formatted);
        }
      }
    } catch (error) {
      // If parsing fails, log the raw line (skip if empty or whitespace only)
      const trimmed = line.trim();
      if (trimmed) {
        await this.logInfo(`[raw] ${trimmed}`);
      }
    }
  }

  /**
   * Setup signal handlers for graceful shutdown
   */
  private setupSignalHandlers(): void {
    const handler = () => {
      this.stop().catch(console.error);
    };

    process.once("SIGTERM", handler);
    process.once("SIGINT", handler);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Execute cursor-agent using shell pipe
   * cursor-agent requires: --print (non-interactive) --trust (trust workspace)
   */
}

/**
 * Convenience function to run Ralph
 */
export async function runRalph(options: RalphExecutorOptions): Promise<RalphResult> {
  const executor = new RalphExecutor(options);
  return await executor.start();
}
