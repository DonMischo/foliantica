"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, PenLine } from "lucide-react";
import { useChapterRead } from "@/store/queries";
import { sanitizeHtml } from "@/lib/sanitize";

export default function ChapterReadPage() {
  const { id, chapterId } = useParams();
  const projectId = Number(id);
  const chapterIdNum = Number(chapterId);
  const router = useRouter();

  const { data, isLoading, error } = useChapterRead(chapterIdNum);

  if (isLoading) return (
    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
      Loading…
    </div>
  );
  if (error || !data) return (
    <div className="flex items-center justify-center h-full text-destructive text-sm">
      Failed to load chapter
    </div>
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-3 border-b border-border shrink-0">
        <Link
          href={`/projects/${projectId}/acts/${data.act_id}`}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title={`Back to ${data.act_title}`}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <p className="text-xs text-muted-foreground">{data.act_title}</p>
          <h1 className="text-base font-semibold">{data.title}</h1>
        </div>
        <div className="ml-auto text-xs text-muted-foreground">
          {data.scenes.length} scene{data.scenes.length !== 1 ? "s" : ""}
        </div>
      </header>

      {/* Flowing text */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-8 py-8 space-y-0">
          {data.scenes.map((scene, idx) => (
            <div key={scene.id} className="group relative">
              {/* Scene title */}
              {scene.title && (
                <div className="flex items-center gap-2 mt-8 mb-2 first:mt-0">
                  <h2 className="text-sm font-bold text-foreground">{scene.title}</h2>
                  <button
                    onClick={() => router.push(`/projects/${projectId}/scenes/${scene.id}`)}
                    className="opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity"
                    title="Edit this scene"
                  >
                    <PenLine className="h-3 w-3" />
                  </button>
                </div>
              )}

              {/* Scene content rendered as HTML */}
              <div
                className="story-prose max-w-none text-sm text-foreground/90"
                dangerouslySetInnerHTML={{ __html: sanitizeHtml(scene.content) }}
              />

              {/* Separator between scenes */}
              {idx < data.scenes.length - 1 && (
                <div className="flex items-center justify-center my-6">
                  <div className="flex gap-2 text-muted-foreground/40">
                    <span>✦</span><span>✦</span><span>✦</span>
                  </div>
                </div>
              )}
            </div>
          ))}

          {data.scenes.length === 0 && (
            <p className="text-center text-muted-foreground text-sm py-12">
              No scenes in this chapter yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
