import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDriveTokenFromCookie } from "@/lib/google-drive";
import { isBlockedQuestionImage } from "@/lib/question-image-filter";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";

export const maxDuration = 120; // allow long extraction runs

interface ExtractRequest {
  questionId: string; // ib_questions.id
}

function getAuthedClient(token: Record<string, unknown>) {
  const oauth2 = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2.setCredentials(token);
  return oauth2;
}

/**
 * Extract all inline images from a Google Doc.
 * Returns array of { objectId, contentUri, width, height }.
 */
async function getDocImages(
  auth: OAuth2Client,
  docId: string
): Promise<
  { objectId: string; contentUri: string; width: number; height: number }[]
> {
  const docs = google.docs({ version: "v1", auth });
  const { data: doc } = await docs.documents.get({ documentId: docId });

  const images: {
    objectId: string;
    contentUri: string;
    width: number;
    height: number;
  }[] = [];

  const inlineObjects = doc.inlineObjects ?? {};
  for (const [objectId, obj] of Object.entries(inlineObjects)) {
    const embedded = obj.inlineObjectProperties?.embeddedObject;
    if (!embedded?.imageProperties?.contentUri) continue;

    images.push({
      objectId,
      contentUri: embedded.imageProperties.contentUri,
      width: embedded.size?.width?.magnitude ?? 0,
      height: embedded.size?.height?.magnitude ?? 0,
    });
  }

  return images;
}

/**
 * Download an image from a URI using the authenticated client.
 */
async function downloadImage(
  auth: OAuth2Client,
  uri: string
): Promise<{ buffer: Buffer; contentType: string }> {
  const accessToken = (await auth.getAccessToken()).token;
  const res = await fetch(uri, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to download image: ${res.status} ${res.statusText}`);
  }
  const contentType = res.headers.get("content-type") ?? "image/png";
  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

function extensionForType(contentType: string): string {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("svg")) return "svg";
  return "png";
}

function isDriveFileNotFound(err: unknown): boolean {
  const status =
    (err as { code?: number; response?: { status?: number } } | null)?.code ??
    (err as { response?: { status?: number } } | null)?.response?.status;
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return status === 404 || /file not found|requested entity was not found/i.test(msg);
}

export async function POST(request: NextRequest) {
  const startedAt = Date.now();
  const diagnostics: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    durationMs: 0,
    phases: {
      auth: {},
      lookup: {},
      questionDoc: {
        scannedInlineObjects: 0,
        blockedSkipped: 0,
        uploaded: 0,
        uploadFailures: [] as string[],
      },
      markschemeDoc: {
        scannedInlineObjects: 0,
        blockedSkipped: 0,
        uploaded: 0,
        uploadFailures: [] as string[],
      },
    },
    warnings: [] as string[],
  };

  const finish = () => {
    diagnostics.durationMs = Date.now() - startedAt;
    return diagnostics;
  };

  // Auth checks
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated", diagnostics: finish() }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  (diagnostics.phases as Record<string, unknown>).auth = {
    userId: user.id,
    role: profile?.role ?? null,
  };
  if (!profile || profile.role !== "teacher") {
    return NextResponse.json({ error: "Forbidden", diagnostics: finish() }, { status: 403 });
  }

  // Google Drive token
  const token = (await getDriveTokenFromCookie()) as Record<string, unknown> | null;
  if (!token) {
    return NextResponse.json(
      { error: "Google Drive not connected. Please connect first.", diagnostics: finish() },
      { status: 401 }
    );
  }

  const body = (await request.json()) as ExtractRequest;
  if (!body.questionId) {
    return NextResponse.json(
      { error: "questionId is required", diagnostics: finish() },
      { status: 400 }
    );
  }

  // Look up the question
  const { data: question, error: qErr } = await supabase
    .from("ib_questions")
    .select("id, code, google_doc_id, google_ms_id")
    .eq("id", body.questionId)
    .single();

  if (qErr || !question) {
    return NextResponse.json({ error: "Question not found", diagnostics: finish() }, { status: 404 });
  }

  (diagnostics.phases as Record<string, unknown>).lookup = {
    questionId: question.id,
    code: question.code,
    hasGoogleDocId: !!question.google_doc_id,
    hasGoogleMsId: !!question.google_ms_id,
    googleDocId: question.google_doc_id,
    googleMsId: question.google_ms_id,
  };

  if (!question.google_doc_id) {
    return NextResponse.json(
      { error: "No Google Doc linked to this question", diagnostics: finish() },
      { status: 400 }
    );
  }

  // Guard: if google_doc_id equals google_ms_id the question doc is not set up
  // correctly (markscheme doc was stored in both folders). Refuse to extract
  // question images from a doc that is actually the markscheme.
  if (question.google_ms_id && question.google_doc_id === question.google_ms_id) {
    return NextResponse.json(
      {
        error: "Question doc and markscheme doc are the same file — question doc link needs to be fixed before extracting images.",
        diagnostics: finish(),
      },
      { status: 400 }
    );
  }

  const auth = getAuthedClient(token);

  const { data: partRows } = await supabase
    .from("question_parts")
    .select("id")
    .eq("question_id", question.id)
    .order("sort_order", { ascending: true });
  const partIds = (partRows ?? []).map((p) => p.id as string);
  (diagnostics.phases as Record<string, unknown>).lookup = {
    ...(diagnostics.phases as Record<string, Record<string, unknown>>).lookup,
    partCount: partIds.length,
  };

  const results: { type: string; storagePath: string; sortOrder: number }[] = [];

  // Extract from question doc
  try {
    const questionImages = await getDocImages(auth, question.google_doc_id);
    (diagnostics.phases as Record<string, Record<string, unknown>>).questionDoc.scannedInlineObjects = questionImages.length;

    for (let i = 0; i < questionImages.length; i++) {
      const img = questionImages[i];
      const { buffer, contentType } = await downloadImage(auth, img.contentUri);
      if (isBlockedQuestionImage(buffer)) {
        console.log(`Skipping blocked question image for ${question.code} at question/${String(i + 1).padStart(2, "0")}`);
        const qPhase = (diagnostics.phases as Record<string, Record<string, unknown>>).questionDoc;
        qPhase.blockedSkipped = Number(qPhase.blockedSkipped ?? 0) + 1;
        continue;
      }
      const ext = extensionForType(contentType);
      const storagePath = `${question.code}/question/${String(i + 1).padStart(2, "0")}.${ext}`;

      // Upload to Supabase Storage
      const { error: uploadErr } = await supabase.storage
        .from("question-images")
        .upload(storagePath, buffer, {
          contentType,
          upsert: true,
        });

      if (uploadErr) {
        if (uploadErr.message?.toLowerCase().includes("bucket not found")) {
          return NextResponse.json(
            {
              error:
                "Storage bucket 'question-images' was not found. Run migration 013_question_images.sql in the same Supabase project used by NEXT_PUBLIC_SUPABASE_URL.",
              partial: results,
              diagnostics: finish(),
            },
            { status: 500 }
          );
        }
        console.error(`Upload failed for ${storagePath}:`, uploadErr);
        const qPhase = (diagnostics.phases as Record<string, Record<string, unknown>>).questionDoc;
        const failures = (qPhase.uploadFailures as string[]) ?? [];
        failures.push(`${storagePath}: ${uploadErr.message}`);
        qPhase.uploadFailures = failures.slice(-20);
        continue;
      }

      // Insert record in question_images table
      await supabase.from("question_images").upsert(
        {
          question_id: question.id,
          part_id: partIds[i] ?? null,
          image_type: "question",
          storage_path: storagePath,
          source_google_doc_id: question.google_doc_id,
          sort_order: i,
          alt_text: `Question image ${i + 1} for ${question.code}`,
        },
        { onConflict: "question_id,image_type,sort_order" }
      );

      results.push({
        type: "question",
        storagePath,
        sortOrder: i,
      });
      const qPhase = (diagnostics.phases as Record<string, Record<string, unknown>>).questionDoc;
      qPhase.uploaded = Number(qPhase.uploaded ?? 0) + 1;
    }
  } catch (err) {
    console.error("Error extracting question doc images:", err);
    if (isDriveFileNotFound(err)) {
      await supabase
        .from("ib_questions")
        .update({ google_doc_id: null })
        .eq("id", question.id);
      (diagnostics.warnings as string[]).push("Question doc link was stale and has been cleared");
      return NextResponse.json(
        {
          error:
            "Question Google Doc was not found in Drive. The stale question-doc link has been cleared. Re-link using Sync Doc Links / Fix Links and try again.",
          partial: results,
          diagnostics: finish(),
        },
        { status: 400 }
      );
    }
    (diagnostics.warnings as string[]).push(`Question doc extraction failed: ${err instanceof Error ? err.message : String(err)}`);
    return NextResponse.json(
      {
        error: `Failed to extract from question doc: ${err instanceof Error ? err.message : String(err)}`,
        partial: results,
        diagnostics: finish(),
      },
      { status: 500 }
    );
  }

  // Extract from markscheme doc (if exists)
  if (question.google_ms_id) {
    try {
      const msImages = await getDocImages(auth, question.google_ms_id);
      (diagnostics.phases as Record<string, Record<string, unknown>>).markschemeDoc.scannedInlineObjects = msImages.length;

      // Delete all existing markscheme image records so re-extraction is clean
      // (removes any stale rows introduced by previous runs)
      await supabase
        .from("question_images")
        .delete()
        .eq("question_id", question.id)
        .eq("image_type", "markscheme");

      let writeIdx = 0;
      for (let i = 0; i < msImages.length; i++) {
        const img = msImages[i];
        const { buffer, contentType } = await downloadImage(
          auth,
          img.contentUri
        );
        if (isBlockedQuestionImage(buffer)) {
          console.log(`Skipping blocked markscheme image for ${question.code} (raw index ${i})`);
          const msPhase = (diagnostics.phases as Record<string, Record<string, unknown>>).markschemeDoc;
          msPhase.blockedSkipped = Number(msPhase.blockedSkipped ?? 0) + 1;
          continue;
        }
        const ext = extensionForType(contentType);
        const storagePath = `${question.code}/markscheme/${String(writeIdx + 1).padStart(2, "0")}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from("question-images")
          .upload(storagePath, buffer, {
            contentType,
            upsert: true,
          });

        if (uploadErr) {
          if (uploadErr.message?.toLowerCase().includes("bucket not found")) {
            return NextResponse.json(
              {
                error:
                  "Storage bucket 'question-images' was not found. Run migration 013_question_images.sql in the same Supabase project used by NEXT_PUBLIC_SUPABASE_URL.",
                partial: results,
                diagnostics: finish(),
              },
              { status: 500 }
            );
          }
          console.error(`Upload failed for ${storagePath}:`, uploadErr);
          const msPhase = (diagnostics.phases as Record<string, Record<string, unknown>>).markschemeDoc;
          const failures = (msPhase.uploadFailures as string[]) ?? [];
          failures.push(`${storagePath}: ${uploadErr.message}`);
          msPhase.uploadFailures = failures.slice(-20);
          continue;
        }

        await supabase.from("question_images").insert({
          question_id: question.id,
          part_id: partIds[writeIdx] ?? null,
          image_type: "markscheme",
          storage_path: storagePath,
          source_google_doc_id: question.google_ms_id,
          sort_order: writeIdx,
          alt_text: `Markscheme image ${writeIdx + 1} for ${question.code}`,
        });

        results.push({
          type: "markscheme",
          storagePath,
          sortOrder: writeIdx,
        });
        const msPhase = (diagnostics.phases as Record<string, Record<string, unknown>>).markschemeDoc;
        msPhase.uploaded = Number(msPhase.uploaded ?? 0) + 1;
        writeIdx++;
      }
    } catch (err) {
      console.error("Error extracting markscheme doc images:", err);
      if (isDriveFileNotFound(err)) {
        await supabase
          .from("ib_questions")
          .update({ google_ms_id: null })
          .eq("id", question.id);
        (diagnostics.warnings as string[]).push(
          "Markscheme doc not found; stale markscheme-doc link was cleared"
        );
      }
      (diagnostics.warnings as string[]).push(
        `Markscheme extraction failed after question extraction succeeded: ${err instanceof Error ? err.message : String(err)}`
      );
      // Return partial success — question images were extracted
    }
  }

  return NextResponse.json({
    questionId: question.id,
    code: question.code,
    extracted: results.length,
    images: results,
    diagnostics: finish(),
  });
}
