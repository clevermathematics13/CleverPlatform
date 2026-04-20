import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDriveTokenFromCookie } from "@/lib/google-drive";
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

export async function POST(request: NextRequest) {
  // Auth checks
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "teacher") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Google Drive token
  const token = (await getDriveTokenFromCookie()) as Record<string, unknown> | null;
  if (!token) {
    return NextResponse.json(
      { error: "Google Drive not connected. Please connect first." },
      { status: 401 }
    );
  }

  const body = (await request.json()) as ExtractRequest;
  if (!body.questionId) {
    return NextResponse.json(
      { error: "questionId is required" },
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
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  if (!question.google_doc_id) {
    return NextResponse.json(
      { error: "No Google Doc linked to this question" },
      { status: 400 }
    );
  }

  const auth = getAuthedClient(token);
  const results: { type: string; storagePath: string; sortOrder: number }[] = [];

  // Extract from question doc
  try {
    const questionImages = await getDocImages(auth, question.google_doc_id);

    for (let i = 0; i < questionImages.length; i++) {
      const img = questionImages[i];
      const { buffer, contentType } = await downloadImage(auth, img.contentUri);
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
        console.error(`Upload failed for ${storagePath}:`, uploadErr);
        continue;
      }

      // Insert record in question_images table
      await supabase.from("question_images").upsert(
        {
          question_id: question.id,
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
    }
  } catch (err) {
    console.error("Error extracting question doc images:", err);
    return NextResponse.json(
      {
        error: `Failed to extract from question doc: ${err instanceof Error ? err.message : String(err)}`,
        partial: results,
      },
      { status: 500 }
    );
  }

  // Extract from markscheme doc (if exists)
  if (question.google_ms_id) {
    try {
      const msImages = await getDocImages(auth, question.google_ms_id);

      for (let i = 0; i < msImages.length; i++) {
        const img = msImages[i];
        const { buffer, contentType } = await downloadImage(
          auth,
          img.contentUri
        );
        const ext = extensionForType(contentType);
        const storagePath = `${question.code}/markscheme/${String(i + 1).padStart(2, "0")}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from("question-images")
          .upload(storagePath, buffer, {
            contentType,
            upsert: true,
          });

        if (uploadErr) {
          console.error(`Upload failed for ${storagePath}:`, uploadErr);
          continue;
        }

        await supabase.from("question_images").upsert(
          {
            question_id: question.id,
            image_type: "markscheme",
            storage_path: storagePath,
            source_google_doc_id: question.google_ms_id,
            sort_order: i,
            alt_text: `Markscheme image ${i + 1} for ${question.code}`,
          },
          { onConflict: "question_id,image_type,sort_order" }
        );

        results.push({
          type: "markscheme",
          storagePath,
          sortOrder: i,
        });
      }
    } catch (err) {
      console.error("Error extracting markscheme doc images:", err);
      // Return partial success — question images were extracted
    }
  }

  return NextResponse.json({
    questionId: question.id,
    code: question.code,
    extracted: results.length,
    images: results,
  });
}
