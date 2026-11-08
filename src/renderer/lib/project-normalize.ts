/**
 * 项目/资源集合的规范化：项目分组、模块选择、项目ID选择、项目资源映射。
 * 自 bundle 反混淆迁出，行为保持一致。
 */
import { mergeTransitResourceEntries } from "./app-root-helpers";

export const normalizeProjectGroups = (rawGroups) =>
        Array.isArray(rawGroups) ?
        rawGroups
        .filter((group) => group && typeof group == `object`)
        .map((group, index) => ({
          id: String(group.id || `group-${Date.now()}-${index}`),
          name: String(group.name || `未命名分组`).trim() || `未命名分组`,
          collapsed: !!group.collapsed,
          order: Number.isFinite(Number(group.order)) ? Number(group.order) : index,
        }))
        .sort((firstGroup, secondGroup) => (firstGroup.order || 0) - (secondGroup.order || 0)) :
        [];

export const normalizeModuleSelection = (list, allowedValues) => {
      let filtered = Array.isArray(list) ?
        list.filter((item) => allowedValues.includes(item)) :
        [];
      return filtered.length ? [...new Set(filtered)] : [...allowedValues];
    };

export const normalizeProjectIdSelection = (candidates, allowedValues) => {
      let matches = Array.isArray(candidates) ? candidates.filter((value) => allowedValues.includes(value)) : [];
      return matches.length ? [...new Set(matches)] : [...allowedValues];
    };

const RESERVED_PROJECT_IDS = new Set([`_blobs`, `_projects`, `_trash`, `_migrations`]);

export const isSafeBackupProjectId = (value) => {
      const id = String(value || ``).trim();
      if (!id || id.length > 128 || id.startsWith(`_`) || RESERVED_PROJECT_IDS.has(id.toLowerCase())) return false;
      return id === `default` || /^(?:proj|project|recovered)-[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id);
    };

export const assertSafeBackupProjects = (projects) => {
      const ids = new Set();
      for (const project of Array.isArray(projects) ? projects : []) {
        const id = String(project?.id || ``).trim();
        if (!isSafeBackupProjectId(id)) throw new Error(`BACKUP_PROJECT_ID_INVALID`);
        if (ids.has(id)) throw new Error(`BACKUP_PROJECT_ID_DUPLICATE`);
        ids.add(id);
      }
      return true;
    };

export const normalizeProjectResourceMap = (input) => {
              let source = input && typeof input == `object` ? input : {},
                result = {};
              for (let [key, value] of Object.entries(source))
                key &&
                Array.isArray(value) &&
                value.length > 0 &&
                (result[key] = mergeTransitResourceEntries(value));
              return result;
            };
