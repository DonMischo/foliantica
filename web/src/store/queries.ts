import { useCallback } from "react";
import { useQuery, useMutation, useQueryClient, useQueries } from "@tanstack/react-query";
import { projectsApi, actsApi, chaptersApi, scenesApi, codexApi, settingsApi, timeApi, fragmentsApi, imagesApi, sceneCommandsApi, promptsApi, versionsApi, mentionStatsApi, writingLogApi, synopsisApi, timelineTracksApi, timelineEventsApi, grammarApi, fontsApi, seriesApi, analyticsApi, researchApi, submissionsApi, exportProfilesApi, publishersApi, achievementsApi, statsApi, syncApi, type StatsTotals, type SyncStatus } from "@/lib/api";
import type { GrammarCheckResult, PovStats, QuerySubmissionCreate, ExportProfileCreate } from "@/lib/api";
import type { SceneCommandIn, ProjectItemLogEntry, ProjectCurrencyLogEntry, OpenRouterModel } from "@/lib/api";
import type { AIPrompt, ProjectSceneItem, SceneVersion, SceneVersionDetail, CorkboardAct, CorkboardData, SeriesData, ProjectAnalytics, ResearchItem, QuerySubmission, ExportProfile, PublisherProfile } from "@/types";

// ── Projects ──────────────────────────────────────────────────────────────────

export const useProjects = () =>
  useQuery({ queryKey: ["projects"], queryFn: projectsApi.list });

export const useProject = (id: number) =>
  useQuery({ queryKey: ["projects", id], queryFn: () => projectsApi.get(id), enabled: !!id });

export const useCreateProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: projectsApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
};

export const useUpdateProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof projectsApi.update>[1] }) =>
      projectsApi.update(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["projects", id] });
      qc.invalidateQueries({ queryKey: ["series"] });
    },
  });
};

export const useDeleteProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: projectsApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
};

export const useDetachCodexSharing = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => projectsApi.detachCodexSharing(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["projects", projectId] });
      qc.invalidateQueries({ queryKey: ["codex", projectId] });
    },
  });
};

export const usePovStats = (projectId: number) =>
  useQuery<PovStats>({
    queryKey: ["pov-stats", projectId],
    queryFn: () => projectsApi.getPovStats(projectId),
    enabled: projectId > 0,
  });

// ── Acts ──────────────────────────────────────────────────────────────────────

export const useActs = (projectId: number) =>
  useQuery({
    queryKey: ["acts", projectId],
    queryFn: () => actsApi.list(projectId),
    enabled: !!projectId,
    staleTime: 1000 * 30,
  });

export const useCreateAct = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: actsApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["acts", projectId] }),
  });
};

export const useUpdateAct = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof actsApi.update>[1] }) =>
      actsApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["acts", projectId] }),
  });
};

export const useDeleteAct = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: actsApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["acts", projectId] }),
  });
};

export const useReorderActs = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: actsApi.reorder,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["acts", projectId] }),
  });
};

export const useActRead = (actId: number) =>
  useQuery({
    queryKey: ["act-read", actId],
    queryFn: () => actsApi.read(actId),
    enabled: !!actId,
  });

// ── Chapters ──────────────────────────────────────────────────────────────────

export const useChapters = (actId: number) =>
  useQuery({
    queryKey: ["chapters", actId],
    queryFn: () => chaptersApi.list(actId),
    enabled: !!actId,
    staleTime: 1000 * 30,
  });

export const useCreateChapter = (actId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: chaptersApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chapters", actId] }),
  });
};

export const useUpdateChapter = (actId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof chaptersApi.update>[1] }) =>
      chaptersApi.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["chapters", actId] });
      qc.invalidateQueries({ queryKey: ["acts"] }); // update chapter title in act views
    },
  });
};

export const useDeleteChapter = (actId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: chaptersApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chapters", actId] }),
  });
};

export const useReorderChapters = (actId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: chaptersApi.reorder,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["chapters", actId] }),
  });
};

export const useChapterRead = (chapterId: number) =>
  useQuery({
    queryKey: ["chapter-read", chapterId],
    queryFn: () => chaptersApi.read(chapterId),
    enabled: !!chapterId,
  });

// ── Scenes ────────────────────────────────────────────────────────────────────

export const useScenes = (chapterId: number) =>
  useQuery({
    queryKey: ["scenes", chapterId],
    queryFn: () => scenesApi.list(chapterId),
    enabled: !!chapterId,
    staleTime: 1000 * 30,
  });

export const useScene = (sceneId: number) =>
  useQuery({
    queryKey: ["scene", sceneId],
    queryFn: () => scenesApi.get(sceneId),
    enabled: !!sceneId,
  });

export const useCreateScene = (chapterId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: scenesApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scenes", chapterId] }),
  });
};

export const useUpdateScene = (sceneId: number, chapterId?: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ data }: { data: Parameters<typeof scenesApi.update>[1] }) =>
      scenesApi.update(sceneId, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scene", sceneId] });
      // Narrow to the owning chapter when known; fall back to broad sweep otherwise
      if (chapterId) {
        qc.invalidateQueries({ queryKey: ["scenes", chapterId] });
      } else {
        qc.invalidateQueries({ queryKey: ["scenes"] });
      }
    },
  });
};

export const useDeleteScene = (chapterId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: scenesApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scenes", chapterId] }),
  });
};

export const useReorderScenes = (chapterId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: scenesApi.reorder,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scenes", chapterId] }),
  });
};

/** Load scenes for an arbitrary list of chapter IDs in a single hook call (uses useQueries). */
export const useAllScenesForChapters = (chapterIds: number[]) => {
  const results = useQueries({
    queries: chapterIds.map((chapterId) => ({
      queryKey: ["scenes", chapterId] as const,
      queryFn: () => scenesApi.list(chapterId),
      enabled: chapterId > 0,
    })),
  });
  return results.map((r) => r.data ?? []);
};

// ── Codex ─────────────────────────────────────────────────────────────────────

export const useCodexEntries = (projectId: number) =>
  useQuery({
    queryKey: ["codex", projectId],
    queryFn: () => codexApi.list(projectId),
    enabled: !!projectId,
  });

export const useCreateCodexEntry = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: codexApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["codex", projectId] }),
  });
};

export const useUpdateCodexEntry = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof codexApi.update>[1] }) =>
      codexApi.update(id, data),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ["codex", projectId] });
      qc.invalidateQueries({ queryKey: ["inventory-summary", id] });
    },
  });
};

export const useDeleteCodexEntry = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: codexApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["codex", projectId] }),
  });
};

export const useEntryRelations = (entryId: number) =>
  useQuery({
    queryKey: ["codex-relations", entryId],
    queryFn: () => codexApi.getRelations(entryId),
    enabled: !!entryId,
  });

export const useCreateRelation = (entryId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: codexApi.createRelation,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["codex-relations", entryId] }),
  });
};

export const useDeleteRelation = (entryId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: codexApi.deleteRelation,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["codex-relations", entryId] }),
  });
};

export const useEntryAccess = (entryId: number) =>
  useQuery({
    queryKey: ["codex-access", entryId],
    queryFn: () => codexApi.getEntryAccess(entryId),
    enabled: entryId > 0,
  });

export const useSetEntryAccess = (entryId: number, projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { project_ids: number[] }) =>
      entryId > 0 ? codexApi.setEntryAccess(entryId, data) : Promise.resolve({ project_ids: [] }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["codex-access", entryId] });
      qc.invalidateQueries({ queryKey: ["codex", projectId] });
    },
  });
};

export const useSeries = () =>
  useQuery<SeriesData>({
    queryKey: ["series"],
    queryFn: seriesApi.get,
  });

/** @deprecated Use {@link useUpdateProject} — identical behaviour since merge. */
export const useUpdateProjectMeta = useUpdateProject;

// ── Time Config ───────────────────────────────────────────────────────────────

export const useTimeConfig = (projectId: number) =>
  useQuery({
    queryKey: ["time-config", projectId],
    queryFn: () => timeApi.getConfig(projectId),
    enabled: !!projectId,
  });

export const useUpdateTimeConfig = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (config: Parameters<typeof timeApi.updateConfig>[1]) =>
      timeApi.updateConfig(projectId, config),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["time-config", projectId] }),
  });
};

export const useTimeline = (projectId: number) =>
  useQuery({
    queryKey: ["timeline", projectId],
    queryFn: () => timeApi.getTimeline(projectId),
    enabled: !!projectId,
  });

export function useTimelineV2(projectId: number) {
  return useQuery({
    queryKey: ["timeline-v2", projectId],
    queryFn: () => timeApi.getTimelineV2(projectId),
    enabled: !!projectId,
  });
}

export function useTimelineTracks(projectId: number) {
  return useQuery({
    queryKey: ["timeline-tracks", projectId],
    queryFn: () => timelineTracksApi.list(projectId),
    enabled: !!projectId,
  });
}

export function useTimelineEvents(projectId: number) {
  return useQuery({
    queryKey: ["timeline-events", projectId],
    queryFn: () => timelineEventsApi.list(projectId),
    enabled: !!projectId,
  });
}

export function useInvalidateTimeline(projectId: number) {
  const qc = useQueryClient();
  return useCallback(() => {
    qc.invalidateQueries({ queryKey: ["timeline-v2", projectId] });
    qc.invalidateQueries({ queryKey: ["timeline-tracks", projectId] });
    qc.invalidateQueries({ queryKey: ["timeline-events", projectId] });
  }, [qc, projectId]);
}

// ── Fragments ─────────────────────────────────────────────────────────────────

export const useFragmentTabs = (projectId: number) =>
  useQuery({
    queryKey: ["fragment-tabs", projectId],
    queryFn: () => fragmentsApi.getTabs(projectId),
    enabled: !!projectId,
  });

export const useUpdateFragmentTabs = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (customTabs: string[]) => fragmentsApi.updateTabs(projectId, customTabs),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fragment-tabs", projectId] }),
  });
};

export const useFragments = (projectId: number) =>
  useQuery({
    queryKey: ["fragments", projectId],
    queryFn: () => fragmentsApi.list(projectId),
    enabled: !!projectId,
  });

export const useCreateFragment = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof fragmentsApi.create>[1]) =>
      fragmentsApi.create(projectId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fragments", projectId] }),
  });
};

export const useUpdateFragment = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof fragmentsApi.update>[1] }) =>
      fragmentsApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fragments", projectId] }),
  });
};

export const useDeleteFragment = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fragmentsApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["fragments", projectId] }),
  });
};

// ── Scene Commands ────────────────────────────────────────────────────────────

export const useSyncSceneCommands = (sceneId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (commands: SceneCommandIn[]) => sceneCommandsApi.sync(sceneId, commands),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["codex"] });           // refreshes CodexEntry.inventory
      qc.invalidateQueries({ queryKey: ["codex-relations"] });
      qc.invalidateQueries({ queryKey: ["item-log"] });
      qc.invalidateQueries({ queryKey: ["currency-balance"] });
      qc.invalidateQueries({ queryKey: ["character-currencies"] });
      qc.invalidateQueries({ queryKey: ["inventory-summary"] });
    },
  });
};

export const useItemLog = (sceneId: number, itemId: number, characterId: number) =>
  useQuery({
    queryKey: ["item-log", sceneId, itemId, characterId],
    queryFn: () => sceneCommandsApi.getItemLog(sceneId, itemId, characterId),
    enabled: sceneId > 0 && itemId > 0 && characterId > 0,
  });

export const useCurrencyBalance = (sceneId: number, characterId: number, currencyName: string) =>
  useQuery({
    queryKey: ["currency-balance", sceneId, characterId, currencyName],
    queryFn: () => sceneCommandsApi.getCurrencyBalance(sceneId, characterId, currencyName),
    enabled: sceneId > 0 && characterId > 0 && !!currencyName,
  });

export const useCharacterCurrencies = (characterId: number) =>
  useQuery({
    queryKey: ["character-currencies", characterId],
    queryFn: () => codexApi.getCharacterCurrencies(characterId),
    enabled: characterId > 0,
  });

export const useInventorySummary = (characterId: number) =>
  useQuery({
    queryKey: ["inventory-summary", characterId],
    queryFn: () => codexApi.getInventorySummary(characterId),
    enabled: characterId > 0,
  });

export const useResyncProjectCommands = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sceneCommandsApi.resyncAll(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inventory-summary"] });
      qc.invalidateQueries({ queryKey: ["project-item-log"] });
      qc.invalidateQueries({ queryKey: ["project-currency-log"] });
      qc.invalidateQueries({ queryKey: ["codex"] });
    },
  });
};

export const useProjectItemLog = (projectId: number, itemId: number, characterId: number) =>
  useQuery<ProjectItemLogEntry[]>({
    queryKey: ["project-item-log", projectId, itemId, characterId],
    queryFn: () => sceneCommandsApi.getProjectItemLog(projectId, itemId, characterId),
    enabled: projectId > 0 && itemId > 0 && characterId > 0,
  });

export const useProjectCurrencyLog = (projectId: number, characterId: number, currencyName: string) =>
  useQuery<ProjectCurrencyLogEntry[]>({
    queryKey: ["project-currency-log", projectId, characterId, currencyName],
    queryFn: () => sceneCommandsApi.getProjectCurrencyLog(projectId, characterId, currencyName),
    enabled: projectId > 0 && characterId > 0 && !!currencyName,
  });

export const useCharacterItemLog = (characterId: number, itemId: number) =>
  useQuery<ProjectItemLogEntry[]>({
    queryKey: ["character-item-log", characterId, itemId],
    queryFn: () => codexApi.getCharacterItemLog(characterId, itemId),
    enabled: characterId > 0 && itemId > 0,
  });

export const useCharacterCurrencyLog = (characterId: number, currencyName: string) =>
  useQuery<ProjectCurrencyLogEntry[]>({
    queryKey: ["character-currency-log", characterId, currencyName],
    queryFn: () => codexApi.getCharacterCurrencyLog(characterId, currencyName),
    enabled: characterId > 0 && !!currencyName,
  });

// ── Images ────────────────────────────────────────────────────────────────────

export const useUploadProjectCover = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => imagesApi.uploadProjectCover(projectId, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["projects", projectId] });
    },
  });
};

export const useDeleteProjectCover = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => imagesApi.deleteProjectCover(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["projects", projectId] });
    },
  });
};

export const useUploadCodexImage = (entryId: number, projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => imagesApi.uploadCodexImage(entryId, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["codex", projectId] }),
  });
};

export const useDeleteCodexImage = (entryId: number, projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => imagesApi.deleteCodexImage(entryId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["codex", projectId] }),
  });
};

// ── Mention stats ─────────────────────────────────────────────────────────────

export const useSceneMentionStats = (sceneId: number) =>
  useQuery({
    queryKey: ["mention-stats", "scene", sceneId],
    queryFn: () => mentionStatsApi.forScene(sceneId),
    enabled: sceneId > 0,
  });

export const useProjectMentionStats = (projectId: number) =>
  useQuery({
    queryKey: ["mention-stats", "project", projectId],
    queryFn: () => mentionStatsApi.forProject(projectId),
    enabled: projectId > 0,
  });

export const useEntrySceneMentions = (entryId: number) =>
  useQuery({
    queryKey: ["entry-scene-mentions", entryId],
    queryFn: () => mentionStatsApi.forEntry(entryId),
    enabled: entryId > 0,
  });

export const useRescanProjectMentions = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => mentionStatsApi.rescanProject(projectId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entry-scene-mentions"] });
      qc.invalidateQueries({ queryKey: ["mention-stats"] });
    },
  });
};

// ── Writing log ───────────────────────────────────────────────────────────────

export const useProjectWritingLog = (projectId: number) =>
  useQuery({
    queryKey: ["writing-log", "project", projectId],
    queryFn: () => writingLogApi.forProject(projectId),
    enabled: projectId > 0,
  });

export const useGlobalWritingLog = () =>
  useQuery({
    queryKey: ["writing-log", "global"],
    queryFn: () => writingLogApi.global(),
  });

export const useProjectGhostTexts = (projectId: number) =>
  useQuery({
    queryKey: ["ghost-texts", projectId],
    queryFn: () => writingLogApi.ghostTexts(projectId),
    enabled: projectId > 0,
  });

// ── Settings ──────────────────────────────────────────────────────────────────

export const useSettings = () =>
  useQuery({ queryKey: ["settings"], queryFn: settingsApi.get });

export const useUpdateSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: settingsApi.update,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
};

export const useOpenRouterModels = () =>
  useQuery<OpenRouterModel[]>({
    queryKey: ["openrouter-models"],
    queryFn: settingsApi.getModels,
    staleTime: 1000 * 60 * 5,  // cache for 5 min — list rarely changes
    retry: false,
  });

export const useServiceStatus = (enabled = true) =>
  useQuery({
    queryKey: ["service-status"],
    queryFn: settingsApi.serviceStatus,
    enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

export const useGrammarCheck = () =>
  useMutation<GrammarCheckResult, Error, { text: string; language?: string }>({
    mutationFn: ({ text, language }) => grammarApi.check(text, language),
  });

export const usePandocFonts = (enabled = true) =>
  useQuery({
    queryKey: ["pandoc-fonts"],
    queryFn:  fontsApi.pandocFonts,
    enabled,
    staleTime: 1000 * 60 * 10,   // cache 10 min — font list rarely changes
    retry: false,
  });

// ── AI Prompts ────────────────────────────────────────────────────────────────

export const usePrompts = () =>
  useQuery<AIPrompt[]>({
    queryKey: ["ai-prompts"],
    queryFn: promptsApi.list,
    staleTime: 1000 * 60 * 5,
  });

export const useCreatePrompt = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: promptsApi.create,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-prompts"] }),
  });
};

export const useUpdatePrompt = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof promptsApi.update>[1] }) =>
      promptsApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-prompts"] }),
  });
};

export const useDeletePrompt = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: promptsApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-prompts"] }),
  });
};

export const useRevertPrompt = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: promptsApi.revert,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ai-prompts"] }),
  });
};

export const useProjectScenes = (projectId: number) =>
  useQuery<ProjectSceneItem[]>({
    queryKey: ["project-scenes", projectId],
    queryFn: () => projectsApi.listScenes(projectId),
    enabled: projectId > 0,
    staleTime: 1000 * 60 * 2,
  });

// ── Scene Versions ────────────────────────────────────────────────────────────

export const useSceneVersions = (sceneId: number) =>
  useQuery<SceneVersion[]>({
    queryKey: ["scene-versions", sceneId],
    queryFn: () => versionsApi.list(sceneId),
    enabled: sceneId > 0,
    refetchOnMount: "always",
  });

export const useCreateSceneVersion = (sceneId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => versionsApi.create(sceneId, content),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["scene-versions", sceneId] }),
  });
};

export const useRestoreSceneVersion = (sceneId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (versionId: number) => versionsApi.restore(sceneId, versionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["scene-versions", sceneId] });
      qc.invalidateQueries({ queryKey: ["scene", sceneId] });
    },
  });
};

// ── Corkboard ─────────────────────────────────────────────────────────────────

/** Reorder scenes without a specific chapter binding — used in corkboard. */
export const useReorderScenesGlobal = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: scenesApi.reorder,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["corkboard", projectId] });
      qc.invalidateQueries({ queryKey: ["structure", projectId] });
      qc.invalidateQueries({ queryKey: ["scenes"] });
    },
  });
};

/** Move/update a scene with a dynamic ID — used in corkboard DnD. */
export const useMoveScene = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sceneId, data }: { sceneId: number; data: Parameters<typeof scenesApi.update>[1] }) =>
      scenesApi.update(sceneId, data),
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ["corkboard", projectId] });
      qc.invalidateQueries({ queryKey: ["scenes"] });
      if (variables.data.chapter_id !== undefined) {
        qc.invalidateQueries({ queryKey: ["structure", projectId] });
      }
    },
  });
};

export const useProjectStructure = (projectId: number) =>
  useQuery<CorkboardAct[]>({
    queryKey: ["structure", projectId],
    queryFn: () => projectsApi.structure(projectId),
    enabled: !!projectId,
  });

export const useCorkboard = (projectId: number) =>
  useQuery<CorkboardData>({
    queryKey: ["corkboard", projectId],
    queryFn: () => projectsApi.corkboard(projectId),
    enabled: !!projectId,
  });

export const useGenerateSynopsis = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sceneId: number) => synopsisApi.generate(sceneId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["corkboard", projectId] });
      qc.invalidateQueries({ queryKey: ["structure", projectId] });
    },
  });
};

export const useUpdateSceneSynopsis = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sceneId, synopsis }: { sceneId: number; synopsis: string | null }) =>
      scenesApi.update(sceneId, { synopsis }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["corkboard", projectId] });
      qc.invalidateQueries({ queryKey: ["structure", projectId] });
    },
  });
};

// ── Analytics ─────────────────────────────────────────────────────────────────

export const useProjectAnalytics = (projectId: number) =>
  useQuery<ProjectAnalytics>({
    queryKey: ["analytics", projectId],
    queryFn: () => analyticsApi.get(projectId),
    enabled: projectId > 0,
    staleTime: 1000 * 60 * 2,  // 2 min cache — recompute is cheap
  });

// ── Research ──────────────────────────────────────────────────────────────────

export const useResearch = (projectId: number) =>
  useQuery<ResearchItem[]>({
    queryKey: ["research", projectId],
    queryFn: () => researchApi.list(projectId),
    enabled: projectId > 0,
  });

export const useCreateResearch = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Parameters<typeof researchApi.create>[1]) =>
      researchApi.create(projectId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["research", projectId] }),
  });
};

export const useUpdateResearch = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Parameters<typeof researchApi.update>[1] }) =>
      researchApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["research", projectId] }),
  });
};

export const useDeleteResearch = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: researchApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["research", projectId] }),
  });
};

export const useRefetchResearchUrl = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: researchApi.refetchUrl,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["research", projectId] }),
  });
};

export const useUploadResearchImage = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) =>
      imagesApi.uploadResearchImage(id, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["research", projectId] }),
  });
};

export const useDeleteResearchImage = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => imagesApi.deleteResearchImage(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["research", projectId] }),
  });
};

export const useUploadResearchPdf = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, file }: { id: number; file: File }) =>
      imagesApi.uploadResearchPdf(id, file),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["research", projectId] }),
  });
};

export const useDeleteResearchPdf = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => imagesApi.deleteResearchPdf(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["research", projectId] }),
  });
};

// ── Query / Submission tracker ────────────────────────────────────────────────

export const useSubmissions = (projectId: number) =>
  useQuery<QuerySubmission[]>({
    queryKey: ["submissions", projectId],
    queryFn: () => submissionsApi.list(projectId),
    enabled: projectId > 0,
  });

export const useCreateSubmission = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: QuerySubmissionCreate) => submissionsApi.create(projectId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["submissions", projectId] }),
  });
};

export const useUpdateSubmission = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<QuerySubmissionCreate> }) =>
      submissionsApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["submissions", projectId] }),
  });
};

export const useDeleteSubmission = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => submissionsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["submissions", projectId] }),
  });
};

// ── Export profiles ───────────────────────────────────────────────────────────

export const useExportProfiles = (projectId: number) =>
  useQuery<ExportProfile[]>({
    queryKey: ["export-profiles", projectId],
    queryFn: () => exportProfilesApi.list(projectId),
    enabled: projectId > 0,
  });

export const useCreateExportProfile = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: ExportProfileCreate) => exportProfilesApi.create(projectId, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["export-profiles", projectId] }),
  });
};

export const useUpdateExportProfile = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: number; data: Partial<ExportProfileCreate> }) =>
      exportProfilesApi.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["export-profiles", projectId] }),
  });
};

export const useDeleteExportProfile = (projectId: number) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => exportProfilesApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["export-profiles", projectId] }),
  });
};

// ── Publisher profiles ────────────────────────────────────────────────────────

export const usePublisherProfiles = () =>
  useQuery<PublisherProfile[]>({
    queryKey: ["publisher-profiles"],
    queryFn: publishersApi.list,
    staleTime: 1000 * 60 * 60, // 1 hour — reference data rarely changes
  });

// ── Achievements ──────────────────────────────────────────────────────────────

export const useAchievements = () =>
  useQuery({
    queryKey: ["achievements"],
    queryFn: achievementsApi.list,
    staleTime: 1000 * 30,
  });

export const useStatsTotals = () =>
  useQuery<StatsTotals>({ queryKey: ["stats-totals"], queryFn: statsApi.totals, staleTime: 1000 * 60 });

// ── Sync mirror ───────────────────────────────────────────────────────────────

export const useSyncStatus = () =>
  useQuery<SyncStatus>({
    queryKey: ["sync-status"],
    queryFn:  syncApi.status,
    refetchInterval: 30_000,
    staleTime: 0,
  });
