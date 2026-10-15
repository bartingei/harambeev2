import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

const BUCKET = "campaign-photos";

export const Route = createFileRoute("/api/public/campaign-image/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const parsed = z.string().uuid().safeParse(params.id);
        if (!parsed.success) return new Response("Not found", { status: 404 });

        const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
        const url = process.env["SUPABASE_URL"]!;
        const client = createClient<Database>(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: {
            fetch: (input, init) => {
              const headers = new Headers(init?.headers);
              if (key.startsWith("sb_") && headers.get("Authorization") === `Bearer ${key}`) {
                headers.delete("Authorization");
              }
              headers.set("apikey", key);
              return fetch(input, { ...init, headers });
            },
          },
        });

        const { data: campaign } = await client
          .from("campaigns")
          .select("cover_photo")
          .eq("id", parsed.data)
          .maybeSingle();

        const path = campaign?.cover_photo;
        if (!path || path.startsWith("http")) return new Response("Not found", { status: 404 });

        const { data } = await client.storage.from(BUCKET).createSignedUrl(path, 60);
        if (!data?.signedUrl) return new Response("Not found", { status: 404 });

        const image = await fetch(data.signedUrl);
        if (!image.ok || !image.body) return new Response("Not found", { status: 404 });

        return new Response(image.body, {
          headers: {
            "Content-Type": image.headers.get("content-type") ?? "image/jpeg",
            "Content-Length": image.headers.get("content-length") ?? "",
            "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
          },
        });
      },
    },
  },
});