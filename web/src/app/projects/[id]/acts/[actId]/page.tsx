"use client";

import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, PenLine } from "lucide-react";
import { useActRead } from "@/store/queries";
import { sanitizeHtml } from "@/lib/sanitize";

export default function ActReadPage() {
  const { id, actId } = useParams();
  const projectId = Number(id);
  const actIdNum = Number(actId);
  const router = useRouter();

  const { data, isLoading, error } = useActRead(actIdNum);

  if (isLoading) return (
    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
      Loading…
    </div>
  );
  if (error || !data) return (
    <div className="flex items-center justify-center h-full text-destructive text-sm">
      Failed to load act
    </div>
  );

  const totalScenes = data.chapters.reduce((n, ch) => n + ch.scenes.length, 0);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <header className="flex items-center gap-3 px-6 py-3 border-b border-border shrink-0">
        <Link
          href={`/projects/${projectId}`}
          className="text-muted-foreground hover:text-foreground transition-colors"
          title="Back to project"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-base font-semibold">{data.title}</h1>
          <p className="text-xs text-muted-foreground">
            {data.chapters.length} chapter{data.chapters.length !== 1 ? "s" : ""} · {totalScenes} scene{totalScenes !== 1 ? "s" : ""}
          </p>
        </div>
      </header>

      {/* Flowing text */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-8 py-8">
          {data.chapters.map((chapter, chIdx) => (
            <div key={chapter.id} className="mb-12">
              {/* Chapter heading */}
              <Link
                href={`/projects/${projectId}/chapters/${chapter.id}`}
                className="block mb-4 group"
              >
                <h2 className="text-base font-bold text-foreground group-hover:text-primary transition-colors">
                  {chapter.title}
                </h2>
                <div className="h-px bg-border/50 mt-1" />
              </Link>

              {/* Scenes */}
              {chapter.scenes.map((scene, scIdx) => (
                <div key={scene.id} className="group relative">
                  {scene.title && (
                    <div className="flex items-center gap-2 mt-6 mb-2 first:mt-0">
                      <h3 className="text-sm font-bold text-foreground">{scene.title}</h3>
                      <button
                        onClick={() => router.push(`/projects/${projectId}/scenes/${scene.id}`)}
                        className="opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity"
                        title="Edit this scene"
                      >
                        <PenLine className="h-3 w-3" />
                      </button>
                    </div>
                  )}

                  <div
                    className="story-prose max-w-none text-sm text-foreground/90"
                    dangerouslySetInnerHTML={{ __html: sanitizeHtml(scene.content) }}
                  />

                  {scIdx < chapter.scenes.length - 1 && (
                    <div className="flex items-center justify-center my-5">
                      <div className="flex gap-2 text-muted-foreground/40 text-xs">
                        <span>✦</span><span>✦</span><span>✦</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}

              {chapter.scenes.length === 0 && (
                <p className="text-xs text-muted-foreground italic">No scenes yet.</p>
              )}
            </div>
          ))}

          {data.chapters.length === 0 && (
            <p className="text-center text-muted-foreground text-sm py-12">
              No chapters in this act yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
