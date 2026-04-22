/**
 * Merged variable resolution across all scopes.
 *
 * Precedence (lowest → highest, later entries win):
 *   Global → Collection → Environment → Folder chain (root → leaf)
 *
 * "Request" scope is intentionally omitted here: request-level variable
 * overrides come from the pre-request script sandbox (#20 / T030) which
 * does not exist yet. The slot is reserved in the hierarchy; nothing
 * currently writes to it.
 *
 * Auth inheritance walk:
 *   resolveAuth(requestRelPath) walks the folder chain from leaf to root.
 *   The first folder (or collection) that has an `auth` block wins.
 *   Returns undefined when no inherited auth exists.
 */
import type { AuthConfig } from '@scrapeman/shared-types';
import { GlobalsFs } from './globals.js';
import { CollectionFs } from './collection.js';
import { EnvironmentsFs } from './environments.js';
import { FolderSettingsFs } from './folder-settings.js';

function folderSegments(requestRelPath: string): string[] {
  // Split the request path into its ancestor folder segments.
  // e.g. "api/users/get-user.sman" → ["api/users", "api", ""]
  // "" represents the workspace root.
  const parts = requestRelPath.split('/');
  // Remove the last segment (the file name itself).
  parts.pop();
  const segments: string[] = [];
  // Walk from the deepest folder up to the root.
  for (let i = parts.length; i >= 0; i--) {
    segments.push(parts.slice(0, i).join('/'));
  }
  return segments;
}

export interface ResolvedScope {
  /** Merged variables: global < collection < environment < folder chain. */
  variables: Record<string, string>;
  /** All secret keys across all scopes. */
  secretKeys: Set<string>;
  /**
   * The auth inherited from the nearest ancestor that defines one.
   * Undefined when no ancestor defines auth.
   */
  inheritedAuth?: AuthConfig;
  /**
   * The relPath of the folder that provided `inheritedAuth`, for display in
   * the UI (e.g. "Inherited from /api/users").
   */
  inheritedAuthSource?: string;
}

export class ScopedVariableResolver {
  private readonly globals: GlobalsFs;
  private readonly collection: CollectionFs;
  private readonly envs: EnvironmentsFs;
  private readonly folders: FolderSettingsFs;

  constructor(workspaceRoot: string) {
    this.globals = new GlobalsFs(workspaceRoot);
    this.collection = new CollectionFs(workspaceRoot);
    this.envs = new EnvironmentsFs(workspaceRoot);
    this.folders = new FolderSettingsFs(workspaceRoot);
  }

  /**
   * Resolve all variables for a given request path and active environment.
   * Returns merged variables, secret keys, and (optionally) inherited auth.
   */
  async resolve(
    requestRelPath: string,
    activeEnv: string | null,
  ): Promise<ResolvedScope> {
    const [globalVars, collectionVars, envVars] = await Promise.all([
      this.globals.resolveVariables(),
      this.collection.resolveVariables(),
      this.envs.resolveVariables(activeEnv),
    ]);

    const [globalSecrets, collectionSecrets, envSecrets] = await Promise.all([
      this.globals.resolveSecretKeys(),
      this.collection.resolveSecretKeys(),
      this.envs.resolveSecretKeys(activeEnv),
    ]);

    // Build folder chain from root → leaf so that deeper folders override
    // shallower ones when merging variables.
    const segments = folderSegments(requestRelPath);
    // segments is leaf→root; reverse for merge order (root first → leaf wins).
    const segmentsInOrder = [...segments].reverse();

    let folderVars: Record<string, string> = {};
    const folderSecrets = new Set<string>();

    for (const seg of segmentsInOrder) {
      const sv = await this.folders.resolveVariables(seg);
      folderVars = { ...folderVars, ...sv };
      // Gather secret keys from this folder level too.
      const fs = await this.folders.read(seg);
      for (const v of fs.variables) {
        if (v.enabled && v.secret) folderSecrets.add(v.key);
      }
    }

    const variables: Record<string, string> = {
      ...globalVars,
      ...collectionVars,
      ...envVars,
      ...folderVars,
    };

    const secretKeys = new Set<string>([
      ...globalSecrets,
      ...collectionSecrets,
      ...envSecrets,
      ...folderSecrets,
    ]);

    // Auth inheritance: walk leaf → root, first hit wins.
    let inheritedAuth: AuthConfig | undefined;
    let inheritedAuthSource: string | undefined;

    for (const seg of segments) {
      const fs = await this.folders.read(seg);
      if (fs.auth && fs.auth.type !== 'none') {
        inheritedAuth = fs.auth;
        inheritedAuthSource = seg;
        break;
      }
    }

    // Fall back to collection-level auth if no folder auth found.
    if (!inheritedAuth) {
      const cs = await this.collection.read();
      if (cs.auth && cs.auth.type !== 'none') {
        inheritedAuth = cs.auth;
        inheritedAuthSource = '.scrapeman/collection.yaml';
      }
    }

    return {
      variables,
      secretKeys,
      ...(inheritedAuth !== undefined ? { inheritedAuth } : {}),
      ...(inheritedAuthSource !== undefined
        ? { inheritedAuthSource }
        : {}),
    };
  }
}
