import {LocalFilesystem, Workspace} from '@mastra/core/workspace';
import {resolve} from 'node:path';
import {config} from '../config.js';

let _workspace: Workspace;

/**
 * Get or create the Workspace singleton shared by all agents.
 *
 * The workspace provides filesystem capabilities (file read/write, code execution)
 * via Mastra's built-in workspace tools. Configured from the project's workspace
 * config section, which controls basePath, containment, and isolation.
 */
export function getWorkspace(): Workspace {
  if (!_workspace) {
    const basePath = resolve(config.workspace.base_path);
    _workspace = new Workspace({

      filesystem: new LocalFilesystem({
        basePath,
        contained: config.workspace.contained,
        allowedPaths: config.workspace.allowed_paths,
      }),
    });
  }
  return _workspace;
}
